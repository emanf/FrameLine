"""Whole-image noise cleanup using local color agreement, with alpha unchanged.

Native Pillow channel operations keep work out of Python pixel loops. Tiles
bound temporary memory; a halo covers every filter stage so tiles do not seam.
"""
import math
from PIL import Image, ImageChops, ImageFilter, ImageMath


def validate_clean_options(options):
    if not isinstance(options, dict):
        raise ValueError('Clean Pixels options must be an object.')
    result = {}
    for name, default, minimum, maximum in (
        ('strength', 80, 0, 100), ('tolerance', 32, 1, 100),
        ('radius', 2, 1, 8), ('speckles', 60, 0, 100),
    ):
        value = options.get(name, default)
        if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
            raise ValueError(f'Clean Pixels {name} must be a whole number between {minimum} and {maximum}.')
        result[name] = value
    return result


def color_distance(first, second):
    bands = ImageChops.difference(first, second).split()
    return ImageChops.lighter(ImageChops.lighter(bands[0], bands[1]), bands[2])


def _speckles(rgb, alpha, options):
    if not options['speckles']:
        return rgb
    median = rgb.filter(ImageFilter.MedianFilter(3))
    # Only replace isolated outliers surrounded by a consistent local color.
    # Avoid thin boundaries, texture, and neighborhoods crossing transparency.
    spread = color_distance(median.filter(ImageFilter.MaxFilter(3)), median.filter(ImageFilter.MinFilter(3)))
    stable = spread.point(lambda value: 255 if value <= options['tolerance'] else 0)
    alpha_spread = ImageChops.subtract(alpha.filter(ImageFilter.MaxFilter(3)), alpha.filter(ImageFilter.MinFilter(3)))
    stable = ImageChops.multiply(stable, alpha_spread.point(lambda value: 255 if value <= 8 else 0))
    outlier = color_distance(rgb, median).point(lambda value: 255 if value > options['tolerance'] else 0)
    mask = ImageChops.multiply(stable, outlier).point(lambda value: round(value * options['speckles'] / 100))
    return Image.composite(median, rgb, mask)


def _smooth(rgb, alpha, distance, tolerance, check_cancelled):
    # Joint RGB weights preserve colored borders and shading rather than
    # averaging each color channel into unrelated neighboring colors.
    weights = [round(255 * math.exp(-2 * (value / tolerance) ** 2)) if value < tolerance * 2 else 0 for value in range(256)]
    sums = [band.convert('F') for band in rgb.split()]
    total = Image.new('F', rgb.size, 1)
    for dx, dy in ((-1,0),(1,0),(0,-1),(0,1),(-1,-1),(1,-1),(-1,1),(1,1)):
        check_cancelled()
        transform = (1, 0, dx * distance, 0, 1, dy * distance)
        neighbor = rgb.transform(rgb.size, Image.Transform.AFFINE, transform, Image.Resampling.NEAREST)
        neighbor_alpha = alpha.transform(alpha.size, Image.Transform.AFFINE, transform, Image.Resampling.NEAREST)
        weight = color_distance(rgb, neighbor).point(weights)
        similar_alpha = ImageChops.difference(alpha, neighbor_alpha).point(lambda value: 255 if value <= 16 else 0)
        visible = neighbor_alpha.point(lambda value: 255 if value else 0)
        weight = ImageChops.multiply(ImageChops.multiply(weight, similar_alpha), visible)
        spatial = .7 if dx and dy else 1
        weight = ImageMath.lambda_eval(lambda a: a['w'] * (spatial / 255), w=weight.convert('F'))
        total = ImageMath.lambda_eval(lambda a: a['s'] + a['w'], s=total, w=weight)
        sums = [ImageMath.lambda_eval(lambda a: a['s'] + a['v'] * a['w'], s=value, v=band, w=weight)
                for value, band in zip(sums, neighbor.split())]
    return Image.merge('RGB', [ImageMath.lambda_eval(lambda a: a['convert'](a['s'] / a['w'] + .5, 'L'), s=value, w=total) for value in sums])


def clean_image_pixels(image, options, check_cancelled=lambda: None, progress=lambda *_: None, tile_height=128):
    from processing_cache import cached_image, image_key
    options = validate_clean_options(options)
    image = image.convert('RGBA')
    check_cancelled()
    if not options['strength']:
        progress(100, 100, 'No pixel cleanup requested.')
        return image.copy()
    key = image_key('clean-pixels', image, parameters=tuple(options.items()))

    def compute():
        result = image.copy()
        distances = sorted(set((1, options['radius'])))
        halo = 3 + sum(distances)
        for top in range(0, image.height, tile_height):
            check_cancelled()
            bottom = min(image.height, top + tile_height)
            start, end = max(0, top-halo), min(image.height, bottom+halo)
            tile = image.crop((0, start, image.width, end))
            rgb, alpha = tile.convert('RGB'), tile.getchannel('A')
            filtered = _speckles(rgb, alpha, options)
            for distance in distances:
                filtered = _smooth(filtered, alpha, distance, options['tolerance'], check_cancelled)
            filtered = Image.blend(rgb, filtered, options['strength'] / 100)
            # Even hidden RGB data remains untouched on fully transparent pixels.
            filtered = Image.composite(filtered, rgb, alpha.point(lambda value: 255 if value else 0))
            filtered.putalpha(alpha)
            result.paste(filtered.crop((0, top-start, image.width, bottom-start)), (0, top))
            progress(bottom, image.height, f'Cleaning pixels… {round(bottom / image.height * 100)}%')
        return result

    result = cached_image(key, compute)
    check_cancelled()
    progress(100, 100, 'Pixel cleanup complete.')
    return result
