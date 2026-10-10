"""Straighten pixel stair steps and supersample a cutout's alpha boundary.

The output remains an RGBA image. Supersampling adds coverage at the boundary,
not a blur across the subject or a feathered halo around it.
"""

import math
import re
from collections import deque


def _difference(runs, covered):
    index = 0
    for left, right in runs:
        while index < len(covered) and covered[index][1] <= left:
            index += 1
        cursor = left
        other = index
        while other < len(covered) and covered[other][0] < right:
            start, end = covered[other]
            if cursor < start:
                yield cursor, min(start, right)
            cursor = max(cursor, end)
            if cursor >= right:
                break
            other += 1
        if cursor < right:
            yield cursor, right


def _contours(mask, check_cancelled):
    width, height = mask.size
    data = mask.tobytes()
    edges = {}
    count = 0

    def edge(start, end):
        nonlocal count
        count += 1
        if count > 500000:
            raise ValueError("This silhouette has too many separate edges to smooth. Use a smaller image or turn off edge smoothing.")
        edges.setdefault(start, []).append(end)

    previous = []
    for y in range(height + 1):
        if y % 128 == 0:
            check_cancelled()
        row = data[y * width:(y + 1) * width]
        current = [match.span() for match in re.finditer(b"\xff+", row)]
        for left, right in current:
            edge((left, y + 1), (left, y))
            edge((right, y), (right, y + 1))
        for left, right in _difference(current, previous):
            edge((left, y), (right, y))
        for left, right in _difference(previous, current):
            edge((right, y), (left, y))
        previous = current

    def take(start, index=0):
        ends = edges[start]
        end = ends.pop(index)
        if not ends:
            del edges[start]
        return end

    contours = []
    while edges:
        check_cancelled()
        start = next(iter(edges))
        current = take(start)
        points = [start]
        previous = start
        while current != start:
            points.append(current)
            dx, dy = current[0] - previous[0], current[1] - previous[1]

            def turn(end):
                nx, ny = end[0] - current[0], end[1] - current[1]
                cross = dx * ny - dy * nx
                # At a diagonal contact, turn right to keep the two components
                # separate rather than joining them into a self-crossing loop.
                return 0 if cross > 0 else 1 if dx * nx + dy * ny > 0 else 2 if cross < 0 else 3

            options = edges[current]
            index = min(range(len(options)), key=lambda i: turn(options[i]))
            previous, current = current, take(current, index)
        points = [point for i, point in enumerate(points) if
                  (point[0] - points[i - 1][0]) * (points[(i + 1) % len(points)][1] - point[1])
                  != (point[1] - points[i - 1][1]) * (points[(i + 1) % len(points)][0] - point[0])]
        if len(points) >= 3:
            contours.append(points)
    return contours


def _simplify_open(points, tolerance):
    keep = {0, len(points) - 1}
    pending = [(0, len(points) - 1)]
    while pending:
        first, last = pending.pop()
        ax, ay = points[first]
        bx, by = points[last]
        dx, dy = bx - ax, by - ay
        length_squared = dx * dx + dy * dy
        farthest, distance_squared = first, tolerance * tolerance
        for index in range(first + 1, last):
            x, y = points[index]
            t = max(0, min(1, ((x - ax) * dx + (y - ay) * dy) / length_squared)) if length_squared else 0
            distance = (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2
            if distance > distance_squared:
                farthest, distance_squared = index, distance
        if farthest != first:
            keep.add(farthest)
            pending.extend(((first, farthest), (farthest, last)))
    return [points[index] for index in sorted(keep)]


def _area(points):
    return abs(sum(x * points[i - 1][1] - y * points[i - 1][0]
                   for i, (x, y) in enumerate(points))) / 2


def _straighten(points, strength):
    # Keep tiny islands and holes, including one-pixel details.
    if _area(points) <= 4:
        return points
    split = max(range(1, len(points)), key=lambda i:
                (points[i][0] - points[0][0]) ** 2 + (points[i][1] - points[0][1]) ** 2)
    # Remove at most one source pixel of staircase deviation. Direction changes
    # and sharp corners remain polygon vertices; there is no corner rounding.
    tolerance = strength / 100
    simplified = (_simplify_open(points[:split + 1], tolerance)[:-1]
                  + _simplify_open(points[split:] + points[:1], tolerance)[:-1])
    # Simplification must not collapse a narrow component.
    if len(simplified) >= 3 and _area(simplified) >= _area(points) / 2:
        return simplified
    return points


def _rasterize(contours, size, scale, check_cancelled, origin=(0, 0)):
    from PIL import Image, ImageDraw

    width, height = size[0] * scale, size[1] * scale
    offset_x, offset_y = origin[0] * scale, origin[1] * scale
    mask = Image.new("L", size)
    # Rasterize in strips so even a large image gets four samples per axis
    # without allocating a full 16-times-larger intermediate image.
    strip_height = max(scale, min(512, 32000000 // width // scale * scale))
    strip = Image.new("L", (width, min(strip_height, height)))
    drawing = ImageDraw.Draw(strip)
    strip_start = 0
    starts = {}
    for points in contours:
        for index, (x1, y1) in enumerate(points):
            x2, y2 = points[index - 1]
            x1 += origin[0]; x2 += origin[0]
            y1 += origin[1]; y2 += origin[1]
            if y1 == y2:
                continue
            if y1 > y2:
                x1, x2, y1, y2 = x2, x1, y2, y1
            first = max(offset_y, math.ceil(y1 * scale - 0.5))
            end = min(offset_y + height, math.ceil(y2 * scale - 0.5))
            if first >= end:
                continue
            slope = (x2 - x1) / (y2 - y1)
            x = x1 * scale + (first + 0.5 - y1 * scale) * slope
            starts.setdefault(first - offset_y, []).append([end - offset_y, x, slope])
    active = []
    for y in range(height):
        if y % 128 == 0:
            check_cancelled()
        active = [edge for edge in active if edge[0] > y]
        active.extend(starts.get(y, ()))
        intersections = sorted(edge[1] for edge in active)
        # Even/odd fill keeps holes and nested islands regardless of winding.
        for left, right in zip(intersections[::2], intersections[1::2]):
            # Round in the original coordinate system, then translate. This
            # preserves exact coverage when processing a cropped work region.
            start = max(0, math.ceil(left - 0.5) - offset_x)
            end = min(width - 1, math.ceil(right - 0.5) - 1 - offset_x)
            if start <= end:
                drawing.line((start, y - strip_start, end, y - strip_start), fill=255)
        for edge in active:
            edge[1] += edge[2]
        if y + 1 == strip_start + strip.height:
            mask.paste(strip.resize((size[0], strip.height // scale), Image.Resampling.BOX), (0, strip_start // scale))
            strip_start = y + 1
            if strip_start < height:
                strip = Image.new("L", (width, min(strip_height, height - strip_start)))
                drawing = ImageDraw.Draw(strip)
    return mask


def antialias_silhouette(rgb, alpha, strength, check_cancelled=lambda: None, origin=(0, 0)):
    from PIL import Image, ImageChops
    from processing_cache import CACHE, cached_image, image_key

    solid = alpha.point(lambda value: 255 if value else 0)
    check_cancelled()
    key = image_key("silhouette-contours", solid)
    contours = CACHE.get(key)
    if contours is None:
        contours = _contours(solid, check_cancelled)
        CACHE.put(key, contours, sum(len(points) for points in contours) * 160)
    if not contours:
        return rgb, alpha.copy()
    coverage = cached_image(image_key("silhouette-coverage", solid, parameters=(strength, origin)),
                            lambda: _rasterize([_straighten(points, strength) for points in contours],
                                               alpha.size, 4, check_cancelled, origin))
    grown = ImageChops.multiply(coverage.point(lambda value: 255 if value else 0), ImageChops.invert(solid))
    # Anti-aliasing can cover previously keyed pixels along diagonal edges.
    # Extend nearby subject colors and opacity into those pixels, rather than
    # revealing the green/white RGB of the removed background.
    filled = Image.merge("RGBA", (*rgb.split(), alpha))
    pixels = filled.load()
    original = alpha.load()
    width, height = alpha.size
    data = grown.tobytes()
    pending = set()
    for y in range(height):
        if y % 128 == 0:
            check_cancelled()
        for match in re.finditer(b"\xff+", data[y * width:(y + 1) * width]):
            pending.update(range(y * width + match.start(), y * width + match.end()))

    def neighbors(index):
        x, y = index % width, index // width
        if x:
            yield index - 1
        if x + 1 < width:
            yield index + 1
        if y:
            yield index - width
        if y + 1 < height:
            yield index + width

    queue = deque()
    for index in pending:
        for neighbor in neighbors(index):
            x, y = neighbor % width, neighbor // width
            if original[x, y]:
                pixels[index % width, index // width] = pixels[x, y]
                queue.append(index)
                break
    pending.difference_update(queue)
    processed = 0
    while queue:
        if processed % 4096 == 0:
            check_cancelled()
        processed += 1
        index = queue.popleft()
        for neighbor in neighbors(index):
            if neighbor in pending:
                pending.remove(neighbor)
                pixels[neighbor % width, neighbor // width] = pixels[index % width, index // width]
                queue.append(neighbor)
    return filled.convert("RGB"), ImageChops.multiply(coverage, filled.getchannel("A"))
