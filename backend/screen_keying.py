"""Linear-light screen mattes and despill using native, tiled Pillow channel operations.

The saturation-ratio method follows the published behavior of Blender's Keying node.
This module implements the equations independently; it does not require Blender.
"""
import math
from functools import lru_cache
from PIL import Image, ImageMath


DEFAULTS = {'screen_balance': .5, 'black_level': 0., 'white_level': 1.,
            'edge_size': 3, 'edge_tolerance': .1, 'despill_strength': 1.,
            'despill_balance': .5, 'connected_only': False}


def validate_options(options=None):
    """Validate optional keying parameters, keeping the default matte free of postprocessing."""
    if options is None:
        options = {}
    if not isinstance(options, dict):
        raise ValueError('Keying settings must be an object.')
    if set(options) - set(DEFAULTS):
        raise ValueError('Unknown keying setting.')
    result = {**DEFAULTS, **options}
    for name in ('screen_balance', 'black_level', 'white_level', 'edge_tolerance', 'despill_strength', 'despill_balance'):
        value = result[name]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 1:
            raise ValueError(f'Keying {name} must be between 0 and 1.')
    if result['white_level'] <= result['black_level']:
        raise ValueError('Keying White Level must be higher than Black Level.')
    if isinstance(result['edge_size'], bool) or not isinstance(result['edge_size'], int) or not 0 <= result['edge_size'] <= 8:
        raise ValueError('Keying edge size must be a whole number between 0 and 8.')
    if not isinstance(result['connected_only'], bool):
        raise ValueError('Connected keying must be enabled or disabled.')
    return result


def srgb_to_linear(value):
    """Decode an encoded channel in 0–1 to scene-linear light."""
    return value / 12.92 if value <= .04045 else ((value + .055) / 1.055) ** 2.4


LINEAR = [srgb_to_linear(value / 255) for value in range(256)]


@lru_cache(maxsize=1)
def encoded_lookup():
    """Use a native 16-bit lookup to encode float channels without Python pixel loops."""
    return [round(255 * (12.92 * value / 65535 if value / 65535 <= .0031308
                        else 1.055 * (value / 65535) ** (1 / 2.4) - .055)) for value in range(65536)]


def encode_channel(channel):
    bounded = ImageMath.lambda_eval(lambda a: a['min'](a['max'](a['v'], 0), 1) * 65535 + .5, v=channel)
    return bounded.convert('I').point(encoded_lookup(), mode='L')


def saturation_indices(color):
    """Select the strongest screen channel, breaking equal maxima by channel order."""
    primary = max(range(3), key=lambda index: (color[index], index))
    others = sorted((index for index in range(3) if index != primary), reverse=True)
    return primary, *others


def key_saturation(color, balance):
    values = [LINEAR[value] for value in color]
    primary, second, third = saturation_indices(values)
    average = values[second] * (1 - balance) + values[third] * balance
    return (values[primary] - average) * (1 - average)


def raw_matte(channels, source_alpha, color, balance):
    """Compute the continuous key saturation ratio from associated linear RGBA."""
    primary, second, third = saturation_indices(color)
    saturation = key_saturation(color, balance)
    if saturation <= 1e-8:
        raise ValueError('A saturated screen color is required for screen keying.')
    return ImageMath.lambda_eval(
        lambda a: a['min'](a['max'](1 - ((a['p'] - (a['s'] * (1-balance) + a['t'] * balance))
                   * (1 - (a['s'] * (1-balance) + a['t'] * balance))) / saturation, 0), 1),
        p=ImageMath.lambda_eval(lambda a: a['v'] * a['alpha']/255, v=channels[primary], alpha=source_alpha),
        s=ImageMath.lambda_eval(lambda a: a['v'] * a['alpha']/255, v=channels[second], alpha=source_alpha),
        t=ImageMath.lambda_eval(lambda a: a['v'] * a['alpha']/255, v=channels[third], alpha=source_alpha))


def extend_edges(image, radius):
    """Replicate boundary pixels for the same neighborhood rule at image borders."""
    width, height = image.size
    result = Image.new(image.mode, (width+radius*2, height+radius*2))
    result.paste(image, (radius, radius))
    result.paste(image.crop((0, 0, width, 1)).resize((width, radius)), (radius, 0))
    result.paste(image.crop((0, height-1, width, height)).resize((width, radius)), (radius, height+radius))
    result.paste(result.crop((radius, 0, radius+1, result.height)).resize((radius, result.height)), (0, 0))
    result.paste(result.crop((width+radius-1, 0, width+radius, result.height)).resize((radius, result.height)), (width+radius, 0))
    return result


def remap_matte(matte, options, cancel):
    """Remap stable matte regions while preserving high-variance edge neighborhoods."""
    black, white = options['black_level'], options['white_level']
    if black == 0 and white == 1:
        return matte
    radius = options['edge_size']
    if radius:
        padded = extend_edges(matte, radius)
    else:
        padded = matte
    count = Image.new('I', matte.size, 0)
    width, height = matte.size
    for dy in range(-radius, radius+1):
        cancel()
        for dx in range(-radius, radius+1):
            neighbor = padded.crop((radius+dx, radius+dy, radius+dx+width, radius+dy+height))
            count = ImageMath.lambda_eval(lambda a: a['c'] + (abs(a['v']-a['n']) < options['edge_tolerance']), c=count, v=matte, n=neighbor)
    edge = ImageMath.lambda_eval(lambda a: a['c'] < (radius*2+1)**2 * .9, c=count)
    return ImageMath.lambda_eval(lambda a: a['v']*a['edge'] + a['min'](a['max']((a['v']-black)/(white-black), 0), 1)*(1-a['edge']), v=matte, edge=edge)


def screen_key(image, colors, options, cancel, progress, tile_height=128):
    """Return a raw matte and despilled straight RGB, preserving all image dimensions."""
    options = validate_options(options)
    image = image.convert('RGBA')
    width, height = image.size
    rgb = Image.new('RGB', image.size)
    alpha = Image.new('L', image.size)
    halo = options['edge_size'] if options['black_level'] or options['white_level'] != 1 else 0
    for top in range(0, height, tile_height):
        cancel()
        bottom = min(height, top+tile_height)
        start, end = max(0, top-halo), min(height, bottom+halo)
        source = image.crop((0, start, width, end))
        channels = [channel.point(LINEAR, mode='F') for channel in source.convert('RGB').split()]
        source_alpha = source.getchannel('A').convert('F')
        matte = None
        for color in colors:
            current = raw_matte(channels, source_alpha, color, options['screen_balance'])
            matte = current if matte is None else ImageMath.lambda_eval(lambda a: a['min'](a['x'], a['y']), x=matte, y=current)
        matte = remap_matte(matte, options, cancel)
        quantized = ImageMath.lambda_eval(lambda a: a['v']*255+.5, v=matte).convert('L')
        primary, second, third = saturation_indices(colors[0])
        strength, balance = options['despill_strength'], options['despill_balance']
        if strength:
            channels[primary] = ImageMath.lambda_eval(lambda a: a['p'] - a['max'](a['p']-(a['s']*(1-balance)+a['t']*balance), 0)*strength,
                                                       p=channels[primary], s=channels[second], t=channels[third])
        encoded = Image.merge('RGB', [encode_channel(channel) for channel in channels])
        crop = (0, top-start, width, bottom-start)
        rgb.paste(encoded.crop(crop), (0, top))
        alpha.paste(quantized.crop(crop), (0, top))
        progress(20+round(15*bottom/height), 100, 'Calculating soft keying matte and despill…')
    return rgb, alpha
