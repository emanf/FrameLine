"""Reusable protection masks and alpha-aware compositing for image effects."""
import json
import math
from hashlib import blake2b
from PIL import Image, ImageChops


def protection_mask(strokes, size, check_cancelled=lambda: None):
    """Cache the union of validated brush marks at the source image's pixel dimensions."""
    from brush_mask import brush_mask
    from processing_cache import cached_image
    if not isinstance(strokes, list):
        raise ValueError('Ignore marks must be a list.')
    signature = blake2b(json.dumps(strokes, sort_keys=True).encode(), digest_size=20).digest()

    def build():
        mask = Image.new('L', size, 0)
        for stroke in strokes:
            check_cancelled()
            if not isinstance(stroke, dict) or 'ignoreStrokes' in stroke or stroke.get('feather', 0) != 0:
                raise ValueError('Invalid Ignore mark.')
            diameter = stroke.get('size')
            points = stroke.get('points')
            if isinstance(diameter, bool) or not isinstance(diameter, (int, float)) or not math.isfinite(diameter) or diameter <= 0:
                raise ValueError('Ignore size must be positive.')
            if stroke.get('shape', 'round') not in ('round', 'square') or not isinstance(stroke.get('antiAlias', True), bool):
                raise ValueError('Invalid Ignore shape or anti-aliasing.')
            if not isinstance(points, list) or not points or any(not isinstance(point, list) or len(point) != 2 or any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 1 for value in point) for point in points):
                raise ValueError('Invalid Ignore coordinates.')
            mask = ImageChops.lighter(mask, brush_mask({**stroke, 'feather': 0, 'antiAlias': stroke.get('antiAlias', True)}, *size, check_cancelled))
        return mask
    return cached_image(('ignore-mask', size, signature), build)


def protect_effect(source, result, strokes, check_cancelled=lambda: None, offset=None):
    """Preserve source RGBA under protection, translating masks with expanded result canvases."""
    if not strokes:
        return result
    check_cancelled()
    mask = protection_mask(strokes, source.size, check_cancelled)
    if offset is None:
        offset = ((result.width-source.width)//2, (result.height-source.height)//2)
    original = Image.new('RGBA', result.size, (0, 0, 0, 0))
    original.paste(source, offset)
    aligned_mask = Image.new('L', result.size, 0)
    aligned_mask.paste(mask, offset)
    blended = Image.composite(original.convert('RGBa'), result.convert('RGBA').convert('RGBa'), aligned_mask).convert('RGBA')
    # Fully protected pixels retain their exact channels, including transparent RGB.
    return Image.composite(original, blended, aligned_mask.point(lambda alpha: 255 if alpha == 255 else 0))
