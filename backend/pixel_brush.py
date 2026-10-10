"""Hard round brush geometry shared with renderer/model/pixel-brush.mjs."""
import math


def circle_stamp_spans(diameter):
    size = max(1, math.floor(diameter + .5))
    rows = {}

    def span(left, right, y):
        if 0 <= y < size and left <= right:
            previous = rows.get(y, (left, right))
            rows[y] = (min(left, previous[0]), max(right, previous[1]))

    x0, x1 = 0, size - 1
    a = b = size - 1
    odd = b % 2
    y0 = (b + 1) // 2
    y1 = y0 - odd
    dx = 4 * (1 - a) * b * b
    dy = 4 * (odd + 1) * a * a
    error = dx + dy + odd * a * a
    step_y, step_x = 8 * a * a, 8 * b * b
    while True:
        span(x0, x1, y0)
        span(x0, x1, y1)
        twice = 2 * error
        if twice <= dy:
            y0 += 1
            y1 -= 1
            dy += step_y
            error += dy
        if twice >= dx or 2 * error > dy:
            x0 += 1
            x1 -= 1
            dx += step_x
            error += dx
        if x0 > x1:
            break
    while y0 - y1 < b:
        span(x0 - 1, x1 + 1, y0)
        span(x0 - 1, x1 + 1, y1)
        y0 += 1
        y1 -= 1
    return [(y, left, right + 1) for y, (left, right) in sorted(rows.items())]


def draw_pixel_round_stroke(draw, coordinates, size, width, height, check_cancelled, shape='round'):
    if size >= 2 * math.hypot(width, height) + 2 and coordinates:
        check_cancelled()
        draw.rectangle((0, 0, width - 1, height - 1), fill=255)
        return
    diameter = max(1, math.floor(size + .5))
    stamp = [(y, 0, diameter) for y in range(diameter)] if shape == 'square' else circle_stamp_spans(size)
    offset = max(1, math.floor(size + .5)) // 2
    for index, point in enumerate(coordinates):
        check_cancelled()
        previous = coordinates[index - 1] if index else point
        steps = max(abs(point[0] - previous[0]), abs(point[1] - previous[1]), 1)
        for step in range(1 if index else 0, steps + 1):
            if step % 256 == 0:
                check_cancelled()
            x = math.floor(previous[0] + (point[0] - previous[0]) * step / steps + .5)
            y = math.floor(previous[1] + (point[1] - previous[1]) * step / steps + .5)
            for row, left, right in stamp:
                target_y = y - offset + row
                target_left, target_right = max(0, x - offset + left), min(width, x - offset + right)
                if 0 <= target_y < height and target_left < target_right:
                    draw.rectangle((target_left, target_y, target_right - 1, target_y), fill=255)
