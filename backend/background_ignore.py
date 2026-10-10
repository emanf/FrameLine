"""A hard protection mask; the red overlay's opacity is only a display choice."""
import math
from PIL import Image, ImageChops
from brush_mask import brush_mask


def ignore_mask(strokes, width, height, cancel):
    if not isinstance(strokes, list):
        raise ValueError('Ignore brush marks must be a list.')
    if not strokes:
        return None
    mask = Image.new('L', (width, height))
    for stroke in strokes:
        cancel()
        if not isinstance(stroke, dict):
            raise ValueError('Invalid Ignore brush mark.')
        size, points = stroke.get('size'), stroke.get('points')
        if isinstance(size, bool) or not isinstance(size, (int, float)) or not math.isfinite(size) or not 0 < size <= 100000:
            raise ValueError('Ignore brush size must be positive and finite.')
        if not isinstance(points, list) or not points:
            raise ValueError('Ignore brush marks need at least one point.')
        for point in points:
            if (not isinstance(point, list) or len(point) != 2 or
                    any(isinstance(value, bool) or not isinstance(value, (int, float)) or
                        not math.isfinite(value) or not 0 <= value <= 1 for value in point)):
                raise ValueError('Ignore brush points must be inside the image.')
        # Relative sizes/coordinates keep the same marked area for batch frames.
        mask = ImageChops.lighter(mask, brush_mask({
            'size':size * min(width, height), 'points':points,
            'shape':'round', 'antiAlias':False, 'feather':0,
        }, width, height, cancel))
    return mask
