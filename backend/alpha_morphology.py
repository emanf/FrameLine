"""Exact square alpha dilation/erosion without quadratic large-kernel work."""

from collections import deque
from PIL import Image, ImageFilter


def square_alpha_extrema(image, radius, maximum, check_cancelled=lambda: None):
    check_cancelled()
    if radius == 0:
        return image.copy()
    if radius <= 8:
        filter_type = ImageFilter.MaxFilter if maximum else ImageFilter.MinFilter
        return image.filter(filter_type(radius * 2 + 1))
    width, height = image.size
    source = image.tobytes()
    horizontal = bytearray(width * height)
    output = bytearray(width * height)

    def scan(data, target, start, step, length):
        candidates = deque()
        # Clipping a min/max window is equivalent to Pillow's replicated edges.
        for end in range(length + radius):
            if end < length:
                value = data[start + end * step]
                if maximum:
                    while candidates and candidates[-1][1] <= value:
                        candidates.pop()
                else:
                    while candidates and candidates[-1][1] >= value:
                        candidates.pop()
                candidates.append((end, value))
            center = end - radius
            if center >= 0:
                while candidates[0][0] < center - radius:
                    candidates.popleft()
                target[start + center * step] = candidates[0][1]

    for row in range(height):
        if row % 64 == 0:
            check_cancelled()
        scan(source, horizontal, row * width, 1, width)
    for column in range(width):
        if column % 64 == 0:
            check_cancelled()
        scan(horizontal, output, column, width, height)
    return Image.frombytes("L", image.size, bytes(output))
