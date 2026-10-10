"""Replace color contamination near alpha boundaries with local subject colors."""

import re
from collections import deque


def validate_cleanup(options):
    if options is None:
        return None
    if not isinstance(options, dict):
        raise ValueError("Color fringe cleanup options must be an object.")
    method = options.get('method', 'replace')
    if method not in ('replace', 'recover'):
        raise ValueError('Color fringe cleanup method must be replace or recover.')
    result = {}
    for field, default, minimum, maximum in (
        ("tolerance", 100, 0, 255), ("width", 8, 1, 32),
        ("min_opacity", 0, 0, 100), ("max_opacity", 100, 0, 100),
        ("strength", 100, 0, 100), ("sample_distance", 16, 1, 64),
    ):
        value = options.get(field, default)
        if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
            raise ValueError(f"Color fringe {field.replace('_', ' ')} must be a whole number between {minimum} and {maximum}.")
        result[field] = value
    if result["min_opacity"] > result["max_opacity"]:
        raise ValueError("Color fringe minimum opacity cannot exceed maximum opacity.")
    color = options.get("color")
    if color is not None and (
        not isinstance(color, list) or len(color) != 3
        or any(isinstance(channel, bool) or not isinstance(channel, int) or not 0 <= channel <= 255 for channel in color)
    ):
        raise ValueError("Color fringe target color must contain three whole RGB values between 0 and 255.")
    result["color"] = color
    if 'method' in options:
        result['method'] = method
    keep = options.get('keep_color')
    if keep is not None and (not isinstance(keep,list) or len(keep)!=3
                            or any(isinstance(c,bool) or not isinstance(c,int) or not 0<=c<=255 for c in keep)):
        raise ValueError('Color fringe Keep color must contain three whole RGB values between 0 and 255.')
    if keep is not None:
        result['keep_color'] = keep
    return result


def clean_color_fringe(rgb, reference_rgb, alpha, key_color, options, check_cancelled=lambda: None, target_mask=None):
    """Change RGB only. Search through visible contaminated pixels, never air.

    Multi-source propagation samples the nearest clean side of each fringe
    within a bounded distance. It keeps different parts of the character's
    palette local and leaves pixels unchanged when no clean sample is found.
    """
    from PIL import Image, ImageChops, ImageFilter, ImageOps

    if not options["strength"]:
        return rgb, None
    color = options["color"] if options["color"] is not None else key_color
    difference = None
    for channel, value in zip(reference_rgb.split(), color):
        delta = ImageChops.difference(channel, Image.new("L", alpha.size, value))
        difference = delta if difference is None else ImageChops.lighter(difference, delta)
    matched = difference.point(lambda value: 255 if value <= options["tolerance"] else 0)
    if not matched.getbbox():
        return rgb, None
    visible = alpha.point(lambda value: 255 if value else 0)
    # A padded zero border also treats the outside of the image as transparent.
    eroded = ImageOps.expand(visible, border=1, fill=0)
    for _ in range(options["width"]):
        check_cancelled()
        eroded = eroded.filter(ImageFilter.MinFilter(3))
    crop_box = (1, 1, alpha.width + 1, alpha.height + 1)
    edge_band = ImageChops.subtract(visible, eroded.crop(crop_box))
    minimum = round(options["min_opacity"] * 255 / 100)
    maximum = round(options["max_opacity"] * 255 / 100)
    opacity_mask = alpha.point(lambda value: 255 if value and minimum <= value <= maximum else 0)
    targets = ImageChops.multiply(matched, ImageChops.multiply(edge_band, opacity_mask))
    if target_mask is not None:
        targets = ImageChops.multiply(targets, target_mask)
    if not targets.getbbox():
        return rgb, None
    # Samples can lie farther inside the subject than the band being edited.
    for _ in range(max(0, options["sample_distance"] - options["width"])):
        check_cancelled()
        eroded = eroded.filter(ImageFilter.MinFilter(3))
    search_band = ImageChops.subtract(visible, eroded.crop(crop_box))
    pending = bytearray(ImageChops.multiply(matched, search_band).tobytes())
    match_data, target_data, alpha_data = matched.tobytes(), targets.tobytes(), alpha.tobytes()
    source_pixels = reference_rgb.load()
    result = rgb.copy()
    repaired = Image.new("L", alpha.size)
    repaired_pixels = repaired.load()
    pixels = result.load()
    width, height = alpha.size
    strength = options["strength"] / 100

    def neighbors(index):
        x, y = index % width, index // width
        for dy in (-1, 0, 1):
            if not 0 <= y + dy < height:
                continue
            for dx in (-1, 0, 1):
                if (dx or dy) and 0 <= x + dx < width:
                    yield index + dy * width + dx

    def replace(index, sample):
        if target_data[index]:
            position = (index % width, index // width)
            existing = pixels[position]
            pixels[position] = tuple(round(old + (new - old) * strength) for old, new in zip(existing, sample))
            repaired_pixels[position] = 255

    # Seed all boundaries first for an even nearest-neighbor wavefront. Prefer
    # the most opaque clean neighbor where equally near samples are available.
    queue = deque()
    search_data = bytes(pending)
    for y in range(height):
        if y % 64 == 0:
            check_cancelled()
        for run in re.finditer(b"\xff+", search_data[y * width:(y + 1) * width]):
            for index in range(y * width + run.start(), y * width + run.end()):
                samples = [neighbor for neighbor in neighbors(index) if alpha_data[neighbor] and not match_data[neighbor]]
                if samples:
                    donor = max(samples, key=lambda neighbor: alpha_data[neighbor])
                    sample = source_pixels[donor % width, donor // width]
                    pending[index] = 0
                    replace(index, sample)
                    queue.append((index, sample, 1))
    processed = 0
    while queue:
        if processed % 4096 == 0:
            check_cancelled()
        processed += 1
        index, sample, distance = queue.popleft()
        if distance >= options["sample_distance"]:
            continue
        for neighbor in neighbors(index):
            if pending[neighbor]:
                pending[neighbor] = 0
                replace(neighbor, sample)
                queue.append((neighbor, sample, distance + 1))
    return result, repaired if repaired.getbbox() else None
