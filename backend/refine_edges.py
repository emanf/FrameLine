"""Refine cutout transparency and repair boundary colors from local interiors."""

import re
from collections import deque


def validate_refine_options(options):
    if not isinstance(options, dict):
        raise ValueError("Refine Edges options must be an object.")
    result = {}
    for name, default, maximum in (("clean", 10, 100), ("repair", 60, 100),
                                   ("smooth", 25, 100), ("shrink", 0, 3), ("width", 2, 16)):
        value = options.get(name, default)
        minimum = 1 if name == "width" else 0
        if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
            raise ValueError(f"Refine Edges {name} must be a whole number between {minimum} and {maximum}.")
        result[name] = value
    return result


def _erode(mask, radius, check_cancelled):
    from PIL import ImageOps
    from alpha_morphology import square_alpha_extrema
    from processing_cache import cached_image, image_key
    check_cancelled()
    if not radius:
        return mask.copy()
    def compute():
        padded = ImageOps.expand(mask, border=radius, fill=0)
        if radius <= 24:
            from PIL import ImageFilter
            for _ in range(radius):
                check_cancelled()
                padded = padded.filter(ImageFilter.MinFilter(3))
            result = padded
        else:
            result = square_alpha_extrema(padded, radius, False, check_cancelled)
        check_cancelled()
        return result.crop((radius, radius, radius + mask.width, radius + mask.height))
    return cached_image(image_key("erosion", mask, parameters=(radius,)), compute)


def _repair_colors(rgb, alpha, width, strength, check_cancelled):
    from PIL import Image, ImageChops, ImageFilter
    from alpha_morphology import square_alpha_extrema
    from processing_cache import CACHE, image_key
    key = image_key("refine-color-donors", rgb, alpha, parameters=(width,))
    repaired = CACHE.get(key)
    if repaired is not None:
        return _blend_repair(rgb, repaired, strength)
    visible = alpha.point(lambda value: 255 if value else 0)
    core = _erode(visible, width, check_cancelled)
    # Local opacity confidence lets a translucent shape supply its own colors
    # even when another shape in the same image is fully opaque.
    local_peak = square_alpha_extrema(alpha, width, True)
    cutoff = local_peak.point(lambda value: max(8, round(value * .85)))
    confidence = ImageChops.subtract(cutoff, alpha).point(lambda value: 255 if value == 0 else 0)
    donors = ImageChops.multiply(core, confidence)
    targets = ImageChops.subtract(visible, core).tobytes()
    distance_limit = min(64, width * 3 + 8)
    search_band = ImageChops.subtract(visible, _erode(visible, width + distance_limit, check_cancelled))
    pending = bytearray(ImageChops.multiply(search_band, ImageChops.invert(donors)).tobytes())
    donor_data = donors.tobytes()
    source = rgb.load()
    output = rgb.copy()
    pixels = output.load()
    w, h = alpha.size

    def neighbors(index):
        x, y = index % w, index // w
        if x:
            yield index - 1
        if x + 1 < w:
            yield index + 1
        if y:
            yield index - w
        if y + 1 < h:
            yield index + w

    def replace(index, color):
        if targets[index]:
            position = (index % w, index // w)
            pixels[position] = color

    queue = deque()
    # Only pixels adjoining donors can seed the search. A native mask pass
    # avoids testing every pixel in the much wider search band in Python.
    initial = ImageChops.multiply(Image.frombytes("L", alpha.size, bytes(pending)),
                                  donors.filter(ImageFilter.MaxFilter(3))).tobytes()
    for y in range(h):
        if y % 64 == 0:
            check_cancelled()
        for run in re.finditer(b"\xff+", initial[y * w:(y + 1) * w]):
            for index in range(y * w + run.start(), y * w + run.end()):
                donor = next((neighbor for neighbor in neighbors(index) if donor_data[neighbor]), None)
                if donor is not None:
                    color = source[donor % w, donor // w]
                    pending[index] = 0
                    replace(index, color)
                    queue.append((index, color, 1))
    processed = 0
    while queue:
        if processed % 4096 == 0:
            check_cancelled()
        processed += 1
        index, color, distance = queue.popleft()
        if distance >= distance_limit:
            continue
        for neighbor in neighbors(index):
            if pending[neighbor]:
                pending[neighbor] = 0
                replace(neighbor, color)
                queue.append((neighbor, color, distance + 1))
    CACHE.put(key, output, w * h * 3)
    return _blend_repair(rgb, output, strength)


def _blend_repair(source, repaired, strength):
    from PIL import ImageChops
    if strength == 100:
        return repaired.copy()
    differences = ImageChops.difference(source, repaired).split()
    changed = ImageChops.lighter(ImageChops.lighter(differences[0], differences[1]), differences[2])
    mask = changed.point(lambda value: 255 if value else 0).tobytes()
    output = source.copy()
    old, new, target = source.load(), repaired.load(), output.load()
    width, height = source.size
    amount = strength / 100
    for y in range(height):
        for run in re.finditer(b"\xff+", mask[y * width:(y + 1) * width]):
            for x in range(run.start(), run.end()):
                target[x, y] = tuple(round(a + (b - a) * amount) for a, b in zip(old[x, y], new[x, y]))
    return output


def refine_cutout(image, options, check_cancelled=lambda: None, progress=lambda current, total, message: None):
    from PIL import Image
    options = validate_refine_options(options)
    check_cancelled()
    if any(options[name] for name in ("clean", "repair", "smooth", "shrink")):
        bounds = image.getchannel("A").getbbox() if image.mode == "RGBA" else None
        if bounds:
            # Local edge operations never need distant transparent padding.
            # Keep a two-pixel apron for geometric anti-aliasing coverage.
            left, top, right, bottom = bounds
            bounds = (max(0,left-2), max(0,top-2), min(image.width,right+2), min(image.height,bottom+2))
            if (bounds[2]-bounds[0]) * (bounds[3]-bounds[1]) < image.width * image.height * .75:
                refined = _refine_cutout(image.crop(bounds), options, check_cancelled, progress, bounds[:2])
                result = Image.new("RGBA", image.size)
                result.paste(refined, bounds[:2])
                return result
    return _refine_cutout(image, options, check_cancelled, progress)


def _refine_cutout(image, options, check_cancelled=lambda: None, progress=lambda current, total, message: None, origin=(0, 0)):
    from PIL import Image, ImageChops
    from edge_smoothing import antialias_silhouette
    options = validate_refine_options(options)
    image = image.convert("RGBA")
    alpha = image.getchannel("A")
    if not any(options[name] for name in ("clean", "repair", "smooth", "shrink")) or alpha.getextrema() in ((0, 0), (255, 255)):
        return image.copy()
    rgb = image.convert("RGB")
    progress(0, 3, "Cleaning transparency…")
    if options["clean"]:
        visible = alpha.point(lambda value: 255 if value else 0)
        band = ImageChops.subtract(visible, _erode(visible, options["width"], check_cancelled))
        threshold = round(options["clean"] * .64)
        cleaned = alpha.point(lambda value: max(0, round((value - threshold) * 255 / (255 - threshold))))
        alpha = Image.composite(cleaned, alpha, band)
    if options["shrink"]:
        alpha = _erode(alpha, options["shrink"], check_cancelled)
    if options["repair"] and alpha.getbbox():
        progress(1, 3, "Repairing edge colors…")
        rgb = _repair_colors(rgb, alpha, options["width"], options["repair"], check_cancelled)
    if options["smooth"] and alpha.getbbox():
        progress(2, 3, "Smoothing silhouette…")
        rgb, alpha = antialias_silhouette(rgb, alpha, options["smooth"], check_cancelled, origin)
    # Remove invisible contamination too, so subsequent sampling/resizing
    # cannot resurrect the RGB of the discarded background.
    rgb = Image.composite(rgb, Image.new("RGB", image.size), alpha.point(lambda value: 255 if value else 0))
    progress(3, 3, "Finishing refined image…")
    return Image.merge("RGBA", (*rgb.split(), alpha))
