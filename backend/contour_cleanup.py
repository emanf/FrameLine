"""Flatten local boundary oscillations without fitting or rasterizing polygons."""
import math
import re
from bisect import bisect_left
from PIL import Image
from processing_cache import cached_image, image_key


def _nearest(values, target, limit):
    """Match an endpoint on a neighboring scanline within the allowed displacement."""
    index = bisect_left(values, target)
    candidates = [value for value in (index-1, index) if 0 <= value < len(values)]
    if not candidates:
        return None
    index = min(candidates, key=lambda value: abs(values[value]-target))
    return index if abs(values[index]-target) <= limit else None


def _filter_profiles(profiles, runs, tolerance, cancel):
    """Apply both opening/closing orders to matched boundary coordinates.

    Full neighborhoods keep corners and disconnected/thin features out of the
    cleanup. Matching uses the original coordinates, so intermediate filters
    cannot jump to another contour as an endpoint moves.
    """
    radius = max(1, math.ceil(tolerance))
    links = []
    for row, values in enumerate(profiles):
        if row % 64 == 0:
            cancel()
        row_links = []
        for index, position in enumerate(values):
            neighbors = []
            if runs[row][index][1]-runs[row][index][0] > 2 and not _corner(profiles, row, position, radius, tolerance):
                for other in range(max(0, row-radius), min(len(profiles), row+radius+1)):
                    match = _nearest(profiles[other], position, tolerance*2)
                    if match is None:
                        neighbors = []
                        break
                    neighbors.append((other, match))
            values_in_window = [profiles[other][match] for other, match in neighbors]
            differences = [b-a for a, b in zip(values_in_window, values_in_window[1:])]
            if differences and (min(differences) >= 0 or max(differences) <= 0):
                # Flat and monotonic boundaries already have a coherent shape.
                # Keep them fixed instead of filtering through a clipped endpoint.
                neighbors = []
            row_links.append(neighbors)
        links.append(row_links)

    def sequence(operations):
        current = profiles
        for operation in operations:
            result = []
            for row, values in enumerate(current):
                if row % 64 == 0:
                    cancel()
                result.append([operation(current[other][match] for other, match in links[row][index])
                               if links[row][index] else position for index, position in enumerate(values)])
            current = result
        return current

    first = sequence((min, max, max, min))
    second = sequence((max, min, min, max))
    return [[(a+b)/2 for a, b in zip(left, right)] for left, right in zip(first, second)]


def _corner(profiles, row, position, radius, tolerance):
    """Protect persistent opposing slopes rather than treating their tip as a noise spike."""
    if row < radius*2 or row+radius*2 >= len(profiles):
        return False
    neighbors = []
    for other in range(row-radius*2, row+radius*2+1):
        index = _nearest(profiles[other], position, tolerance*4)
        if index is None:
            return False
        neighbors.append(profiles[other][index])
    left, right = neighbors[:radius*2+1], neighbors[radius*2:]
    if max(left)-min(left) <= tolerance or max(right)-min(right) <= tolerance:
        return False
    left_delta = [b-a for a, b in zip(left, left[1:])]
    right_delta = [b-a for a, b in zip(right, right[1:])]
    return ((max(left_delta) <= 0 and min(right_delta) >= 0)
            or (min(left_delta) >= 0 and max(right_delta) <= 0))


def _smooth_axis(mask, tolerance, cancel):
    """Clean both ends of foreground runs while preserving their order and width."""
    width, height = mask.size
    data = mask.tobytes()
    runs = []
    for row in range(height):
        if row % 64 == 0:
            cancel()
        runs.append([match.span() for match in re.finditer(b'\xff+', data[row*width:(row+1)*width])])
    if sum(len(row) for row in runs) > 250000:
        raise ValueError('This image has too many separate boundary details. Use Clean Pixels first or disable contour cleanup.')
    starts = _filter_profiles([[left for left, _ in row] for row in runs], runs, tolerance, cancel)
    ends = _filter_profiles([[right for _, right in row] for row in runs], runs, tolerance, cancel)
    result = bytearray(len(data))
    for row, spans in enumerate(runs):
        if row % 64 == 0:
            cancel()
        previous = 0
        for index, (left, right) in enumerate(spans):
            start, end = math.ceil(starts[row][index]), math.floor(ends[row][index])
            if (right-left <= 2 or abs(start-left) > tolerance or abs(end-right) > tolerance
                    or start < previous or end-start < (right-left)/2
                    or (index+1 < len(spans) and end > spans[index+1][0])):
                start, end = left, right
            result[row*width+start:row*width+end] = b'\xff'*(end-start)
            previous = end
    return Image.frombytes('L', mask.size, bytes(result))


def clean_contour(rgb, alpha, tolerance, cancel=lambda: None, progress=lambda *_: None):
    """Flatten small edge teeth, preserving original interior color and opacity."""
    from edge_smoothing import _apply_coverage
    cancel()
    solid = alpha.point(lambda value: 255 if value else 0)
    if solid.getextrema() in ((0, 0), (255, 255)):
        return rgb.copy(), alpha.copy()
    def compute():
        vertical = _smooth_axis(solid.transpose(Image.Transpose.TRANSPOSE), tolerance, cancel)
        progress(48, 100, 'Flattening small edge bumps…')
        cleaned = _smooth_axis(vertical.transpose(Image.Transpose.TRANSPOSE), tolerance, cancel)
        return cleaned
    progress(44, 100, 'Reading cutout boundary…')
    coverage = cached_image(image_key('boundary-profile-cleanup-v1', solid, parameters=(tolerance,)), compute)
    progress(52, 100, 'Finishing contour cleanup…')
    cancel()
    return _apply_coverage(rgb, alpha, coverage, cancel)
