"""Border palette estimation and automatic screen/neutral background keying."""
from collections import defaultdict
from PIL import Image, ImageChops
from screen_keying import key_saturation, saturation_indices, screen_key, validate_options


def detect_colors(image, cancel):
    width, height = image.size
    pixels = image.load()
    bins = defaultdict(lambda: [0, [0, 0, 0], set(), []])
    # Bounded sampling keeps estimation inexpensive even for large frames.
    for side, length in enumerate((width, width, height, height)):
        cancel()
        for offset in range(0, length, max(1, (length + 1023) // 1024)):
            point = ((offset, 0), (offset, height-1), (0, offset), (width-1, offset))[side]
            color = pixels[point]
            if color[3] < 240:
                continue
            entry = bins[tuple(channel // 24 for channel in color[:3])]
            entry[0] += 1
            for channel in range(3):
                entry[1][channel] += color[channel]
            entry[2].add(side)
            entry[3].append(list(color[:3]))
    if not bins:
        raise ValueError('No opaque background found on the image border. Choose a custom background color instead.')
    ranked = sorted(bins.values(), key=lambda entry: -entry[0])
    dominant = ranked[0][0]
    colors = []
    for count, sums, sides, samples in ranked:
        if colors and (count < dominant * .35 or len(sides) < 3):
            continue
        color = [round(value / count) for value in sums]
        if max(color) - min(color) > 32:
            # A slightly less saturated observed screen shade avoids leaving
            # compression noise opaque. A percentile rejects rare border outliers.
            samples.sort(key=lambda value: key_saturation(value, .5))
            color = samples[min(len(samples)-1, len(samples)//5)]
        if not any(max(abs(a-b) for a, b in zip(color, previous)) < 20 for previous in colors):
            colors.append(color)
        if len(colors) == 6:
            break
    return colors


def connected_border(candidate, cancel, progress):
    """Scanline flood from every border; enclosed same-color details survive."""
    width, height = candidate.size
    pending = bytearray(candidate.tobytes())
    result = bytearray(len(pending))
    seeds = list(range(width)) + list(range((height-1)*width, height*width))
    seeds += [y*width for y in range(height)] + [y*width+width-1 for y in range(height)]
    visits = 0
    filled = 0
    while seeds:
        index = seeds.pop()
        if not pending[index]:
            continue
        row = index // width * width
        left = pending.rfind(b'\0', row, index) + 1
        left = max(row, left)
        right = pending.find(b'\0', index, row+width)
        if right == -1:
            right = row+width
        pending[left:right] = b'\0' * (right-left)
        result[left:right] = b'\xff' * (right-left)
        filled += right-left
        for shift in (-width, width):
            start, end = left+shift, right+shift
            if start < 0 or end > len(pending):
                continue
            while start < end:
                start = pending.find(b'\xff', start, end)
                if start == -1:
                    break
                seeds.append(start)
                stop = pending.find(b'\0', start, end)
                start = end if stop == -1 else stop+1
        visits += 1
        if visits % 256 == 0:
            cancel()
            progress(25 + round(10*filled/len(pending)), 100, 'Tracing connected background…')
    cancel()
    return Image.frombytes('L', candidate.size, bytes(result))


def resolve_colors(image, request, cancel, progress):
    """Resolve a detected border palette or one explicitly chosen screen color."""
    source = request.get('background_source', 'auto')
    if source not in ('auto', 'custom'):
        raise ValueError('Background source must be auto or custom.')
    if source == 'custom':
        color = request.get('key_color')
        if (not isinstance(color, list) or len(color) != 3 or
                any(isinstance(c, bool) or not isinstance(c, int) or not 0 <= c <= 255 for c in color)):
            raise ValueError('Custom background color must contain three whole RGB values between 0 and 255.')
        return [color]
    progress(12, 100, 'Detecting background colors…')
    return detect_colors(image, cancel)


def color_distance(image, colors, cancel):
    """Find the nearest palette color using native maximum-channel differences."""
    channels = image.convert('RGB').split()
    distance = None
    for color in colors:
        cancel()
        current = Image.new('L', image.size)
        for channel, value in zip(channels, color):
            current = ImageChops.lighter(current, channel.point(lambda c: abs(c-value)))
        distance = current if distance is None else ImageChops.darker(distance, current)
    return distance


def key_background(image, request, tolerance, softness, cancel, progress):
    """Create a soft screen matte and despill, with a safe neutral-background fallback."""
    options = validate_options(request.get('keying'))
    aggressive = request.get('aggressive', False)
    amount = request.get('aggressive_amount', 50)
    if not isinstance(aggressive, bool):
        raise ValueError('Aggressive removal must be enabled or disabled.')
    if isinstance(amount, bool) or not isinstance(amount, int) or not 0 <= amount <= 100:
        raise ValueError('Aggressive amount must be a whole number between 0 and 100.')
    colors = resolve_colors(image, request, cancel, progress)
    chromatic = max(colors[0])-min(colors[0]) > 32 and key_saturation(colors[0], options['screen_balance']) > 1e-8
    if chromatic:
        # Retain only screen-family shades: another hue is not a second chroma key.
        primary = saturation_indices(colors[0])[0]
        shades = [color for color in colors if saturation_indices(color)[0] == primary
                  and key_saturation(color, options['screen_balance']) > 1e-8]
        effective = dict(options)
        if tolerance > 128 or aggressive:
            extra = max(0, tolerance-128)/127*.35 + (amount/100*.35 if aggressive else 0)
            effective['black_level'] = min(effective['white_level']-1e-4, effective['black_level']+extra)
        elif tolerance < 128:
            effective['white_level'] = max(effective['black_level']+1e-4, effective['white_level']-(128-tolerance)/128*.35)
        rgb, alpha = screen_key(image, shades, effective, cancel, progress)
        region = None
        if options['connected_only'] and not aggressive:
            candidate = alpha.point(lambda value: 255 if value < 255 else 0)
            candidate = ImageChops.lighter(candidate, image.getchannel('A').point(lambda value: 255 if value == 0 else 0))
            region = connected_border(candidate, cancel,
                                      lambda value, total, message: progress(35+(value-25)//2, total, message))
            alpha = Image.composite(alpha, Image.new('L', image.size, 255), region)
            rgb = Image.composite(rgb, image.convert('RGB'), region)
        return rgb, alpha, region, shades, 'screen-keying'
    # A neutral key has no saturation denominator. Color distance avoids erasing
    # the entire image for white, black, gray, or nearly neutral backdrops.
    progress(20, 100, 'Calculating neutral-background matte…')
    distance = color_distance(image, colors, cancel)
    threshold = round(tolerance/8)+(round(amount*.64) if aggressive else 0)
    candidate = distance.point(lambda value: 255 if value <= min(255, threshold+softness+2) else 0)
    candidate = ImageChops.lighter(candidate, image.getchannel('A').point(lambda value: 255 if value == 0 else 0))
    region = candidate if aggressive else connected_border(candidate, cancel, progress)
    alpha = distance.point(lambda value: 0 if value <= threshold else 255)
    alpha = Image.composite(alpha, Image.new('L', image.size, 255), region)
    return image.convert('RGB'), alpha, region, colors, 'neutral-distance'
