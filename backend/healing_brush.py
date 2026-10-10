"""Recover a selected foreground color and coverage from a two-color mixture."""

import math
from array import array
from collections import deque


def _hsv(color):
    r, g, b = (value / 255 for value in color)
    maximum, minimum = max(r, g, b), min(r, g, b)
    delta = maximum - minimum
    hue = 0
    if delta:
        hue = (g-b)/delta if maximum == r else (b-r)/delta+2 if maximum == g else (r-g)/delta+4
        hue = (hue*60+360) % 360
    return hue, delta/maximum if maximum else 0


def auto_keep_field(image, remove, sample_distance, check_cancelled=lambda: None, tolerance=24):
    width, height = image.size
    data = image.tobytes()
    count = width*height
    owners = array('i', [-1])*count
    distances = bytearray(count)
    contrast = bytearray(max(abs(data[i*4+c]-remove[c]) for c in range(3)) for i in range(count))
    base_hue, base_saturation = _hsv(remove)
    queue = deque()

    def matches(pixel, donor):
        direction = [data[donor*4+c]-remove[c] for c in range(3)]
        denominator = sum(value*value for value in direction)
        if not denominator:
            return False
        alpha = sum((data[pixel*4+c]-remove[c])*direction[c] for c in range(3))/denominator
        return 0 <= alpha < .995 and max(abs(data[pixel*4+c]-(remove[c]+alpha*direction[c])) for c in range(3)) <= max(8, min(32, tolerance))
    for i in range(count):
        if i % 4096 == 0:
            check_cancelled()
        if data[i*4+3] < 191 or contrast[i] < 24:
            continue
        hue, saturation = _hsv(data[i*4:i*4+3])
        hue_difference = min(abs(base_hue-hue), 360-abs(base_hue-hue))
        if base_saturation >= .12 and saturation >= .12 and hue_difference <= 30:
            continue
        x, y = i % width, i // width
        peak = True
        for dy in (-1, 0, 1):
            if not peak:
                break
            for dx in (-1, 0, 1):
                if not 0 <= x+dx < width or not 0 <= y+dy < height:
                    continue
                other = (y+dy)*width+x+dx
                if data[other*4+3] >= 191 and contrast[other] > contrast[i]+8:
                    direction = [data[other*4+c]-remove[c] for c in range(3)]
                    denominator = sum(value*value for value in direction)
                    alpha = sum((data[i*4+c]-remove[c])*direction[c] for c in range(3))/denominator
                    if 0 <= alpha < 1 and max(abs(data[i*4+c]-(remove[c]+alpha*direction[c])) for c in range(3)) <= 8:
                        peak = False
                        break
        if peak:
            owners[i] = i
            queue.append(i)
    while queue:
        i = queue.popleft()
        if i % 4096 == 0:
            check_cancelled()
        if distances[i] >= sample_distance:
            continue
        x, y = i % width, i // width
        for other in (i-1 if x else -1, i+1 if x+1 < width else -1, i-width if y else -1, i+width if y+1 < height else -1):
            if other < 0 or not data[other*4+3] or owners[other] == owners[i]:
                continue
            if owners[other] != -1 and not (contrast[owners[i]] > contrast[owners[other]]+8 and matches(other, owners[i])):
                continue
            if owners[other] == -1 and not matches(other, owners[i]):
                continue
            owners[other] = owners[i]
            distances[other] = distances[i]+1
            queue.append(other)
    return owners


def heal_auto_image(image, mask, stroke, remove, check_cancelled):
    bounds = mask.getbbox()
    if not bounds or not stroke['opacity']:
        return image
    radius = stroke.get('sampleDistance', 24)
    box = (max(0, bounds[0]-radius-1), max(0, bounds[1]-radius-1),
           min(image.width, bounds[2]+radius+1), min(image.height, bounds[3]+radius+1))
    reference = image.crop(box)
    owners = auto_keep_field(reference, remove, radius, check_cancelled, stroke['tolerance'])
    source = reference.load()
    result = image.copy()
    pixels, coverage_pixels = result.load(), mask.load()
    for y in range(bounds[1], bounds[3]):
        if y % 64 == 0:
            check_cancelled()
        for x in range(bounds[0], bounds[2]):
            strength = coverage_pixels[x,y]/255*stroke['opacity']
            original = pixels[x,y]
            if not strength or not original[3]:
                continue
            alpha, keep = 0, remove
            if max(abs(original[c]-remove[c]) for c in range(3)) > min(8, stroke['tolerance']):
                donor = owners[(y-box[1])*reference.width+x-box[0]]
                if donor < 0:
                    continue
                keep = source[donor % reference.width, donor // reference.width][:3]
                direction = tuple(keep[c]-remove[c] for c in range(3))
                denominator = sum(value*value for value in direction)
                if not denominator:
                    continue
                alpha = max(0, min(1, sum((original[c]-remove[c])*direction[c] for c in range(3))/denominator))
                error = max(abs(original[c]-(remove[c]+alpha*direction[c])) for c in range(3))
                if error > stroke['tolerance'] or alpha >= .995:
                    continue
            coverage = 1 if stroke.get('recoverTransparency') is False and alpha > 0 else alpha
            remaining = 1-strength+strength*coverage
            rgb = tuple(math.floor((original[c]*(1-strength)+keep[c]*strength*coverage)/remaining+.5)
                        for c in range(3)) if remaining else keep
            pixels[x,y] = (*rgb, math.floor(original[3]*remaining+.5))
    return result


def recover_color_pixel(original, keep, remove, tolerance, strength):
    """Recover straight foreground RGB and coverage from a two-color mixture."""
    direction = tuple(f-b for f, b in zip(keep, remove))
    denominator = sum(channel * channel for channel in direction)
    if not denominator or not original[3] or not strength:
        return None
    alpha = max(0, min(1, sum((original[i]-remove[i])*direction[i] for i in range(3)) / denominator))
    if max(abs(original[i]-(remove[i]+alpha*direction[i])) for i in range(3)) > tolerance:
        return None
    remaining = 1-strength+strength*alpha
    rgb = tuple(math.floor((original[i]*(1-strength)+keep[i]*strength*alpha) / remaining+.5)
                for i in range(3)) if remaining else keep
    return (*rgb, math.floor(original[3]*remaining+.5))


def heal_image(image, mask, stroke, check_cancelled=lambda: None):
    background = stroke.get("backgroundColor")
    tolerance = stroke.get("tolerance")
    if (not isinstance(background, str) or len(background) != 7 or background[0] != "#"
            or any(channel not in "0123456789abcdefABCDEF" for channel in background[1:])):
        raise ValueError("Color Cleanup Remove color must be a hexadecimal RGB value.")
    if isinstance(tolerance, bool) or not isinstance(tolerance, int) or not 0 <= tolerance <= 255:
        raise ValueError("Color Cleanup tolerance must be a whole number between 0 and 255.")
    for field in ('autoKeep', 'recoverTransparency'):
        if field in stroke and not isinstance(stroke[field], bool):
            raise ValueError(f"Color Cleanup {field} must be a boolean.")
    sample_distance = stroke.get('sampleDistance', 24)
    if isinstance(sample_distance, bool) or not isinstance(sample_distance, int) or not 1 <= sample_distance <= 128:
        raise ValueError("Color Cleanup sample distance must be between 1 and 128 pixels.")
    keep = tuple(int(stroke["color"][index:index + 2], 16) for index in (1, 3, 5))
    remove = tuple(int(background[index:index + 2], 16) for index in (1, 3, 5))
    if stroke.get('autoKeep') is True:
        return heal_auto_image(image, mask, stroke, remove, check_cancelled)
    direction = tuple(foreground - background for foreground, background in zip(keep, remove))
    denominator = sum(channel * channel for channel in direction)
    if not denominator:
        raise ValueError("Color Cleanup Keep color and Remove color must be different.")
    bounds = mask.getbbox()
    if not bounds or not stroke["opacity"]:
        return image
    result = image.copy()
    pixels, coverage_pixels = result.load(), mask.load()
    for y in range(bounds[1], bounds[3]):
        if y % 64 == 0:
            check_cancelled()
        for x in range(bounds[0], bounds[2]):
            coverage = coverage_pixels[x, y] / 255 * stroke["opacity"]
            original = pixels[x, y]
            if not coverage or not original[3]:
                continue
            recovered = recover_color_pixel(original, keep, remove, tolerance, coverage)
            if recovered is not None:
                pixels[x, y] = recovered
    return result
