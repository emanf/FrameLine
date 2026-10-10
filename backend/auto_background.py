"""Border color estimation and connected color segmentation (no model download)."""
from collections import defaultdict
from PIL import Image, ImageChops


def detect_colors(image, cancel):
    width, height = image.size
    pixels = image.load()
    bins = defaultdict(lambda: [0, [0, 0, 0], set()])
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
    if not bins:
        raise ValueError('No opaque background found on the image border. Choose a custom background color instead.')
    ranked = sorted(bins.values(), key=lambda entry: -entry[0])
    dominant = ranked[0][0]
    colors = []
    for count, sums, sides in ranked:
        if colors and (count < dominant * .35 or len(sides) < 3):
            continue
        color = [round(value / count) for value in sums]
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


def segment_background(image, request, tolerance, softness, cancel, progress):
    source = request.get('background_source', 'auto')
    if source not in ('auto', 'custom'):
        raise ValueError('Background source must be auto or custom.')
    aggressive = request.get('aggressive', False)
    amount = request.get('aggressive_amount', 50)
    if not isinstance(aggressive, bool):
        raise ValueError('Aggressive removal must be enabled or disabled.')
    if isinstance(amount, bool) or not isinstance(amount, int) or not 0 <= amount <= 100:
        raise ValueError('Aggressive amount must be a whole number between 0 and 100.')
    if source == 'custom':
        color = request.get('key_color')
        if (not isinstance(color, list) or len(color) != 3 or
                any(isinstance(c, bool) or not isinstance(c, int) or not 0 <= c <= 255 for c in color)):
            raise ValueError('Custom background color must contain three whole RGB values between 0 and 255.')
        colors = [color]
    else:
        progress(12, 100, 'Detecting background colors…')
        colors = detect_colors(image, cancel)
    progress(20, 100, 'Finding background pixels…')
    channels = image.convert('RGB').split()
    distance = None
    for color in colors:
        cancel()
        current = Image.new('L', image.size)
        for channel, value in zip(channels, color):
            current = ImageChops.lighter(current, channel.point(lambda c: abs(c-value)))
        distance = current if distance is None else ImageChops.darker(distance, current)
    # The automatic palette models shading already; use a narrower threshold
    # than the legacy single-color key so colorful foreground details survive.
    threshold = round(tolerance / 8) + (round(amount*.64) if aggressive else 0)
    candidate = distance.point(lambda value: 255 if value <= min(255, threshold+softness) else 0)
    transparent = image.getchannel('A').point(lambda value: 255 if value == 0 else 0)
    candidate = ImageChops.lighter(candidate, transparent)
    region = candidate if aggressive else connected_border(candidate, cancel, progress)
    alpha = distance.point(lambda value: 0 if value <= threshold else 255)
    alpha = Image.composite(alpha, Image.new('L', image.size, 255), region)
    return alpha, region, colors
