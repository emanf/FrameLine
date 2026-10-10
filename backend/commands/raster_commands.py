"""Render and cache source images, brush strokes, crop geometry, and outlines."""
import json
import math
from pathlib import Path


class RasterCommands:
    """Render and cache source images, brush strokes, crop geometry, and outlines."""
    def __init__(self, context):
        self.context = context

    def positive_frame_count(self, value):
        """Validate a positive integer timeline frame count."""
        context = self.context
        if isinstance(value, bool) or not isinstance(value, int) or value < 1:
            raise ValueError('Clip durations must be positive whole numbers of frames.')
        return value

    def apply_image_crop(self, image, crop):
        """Apply normalized crop bounds as exact source-pixel coverage."""
        context = self.context
        if crop is None:
            return image
        if not isinstance(crop, dict):
            raise ValueError('Project contains invalid crop bounds.')
        bounds = [crop.get(key) for key in ('left', 'top', 'right', 'bottom')]
        if any((isinstance(value, bool) or not isinstance(value, (int, float)) or (not math.isfinite(value)) for value in bounds)):
            raise ValueError('Project contains invalid crop bounds.')
        left, top, right, bottom = bounds
        if left < 0 or top < 0 or right > 1 or (bottom > 1) or (left >= right) or (top >= bottom):
            raise ValueError('Project contains invalid crop bounds.')
        width, height = image.size
    
        def pixel_edge(value):
            nearest = round(value)
            return nearest if abs(value - nearest) < 1e-07 else value
        box = (max(0, math.floor(pixel_edge(left * width))), max(0, math.floor(pixel_edge(top * height))), min(width, math.ceil(pixel_edge(right * width))), min(height, math.ceil(pixel_edge(bottom * height))))
        if box[0] >= box[2] or box[1] >= box[3]:
            raise ValueError('Crop bounds must include at least one image pixel.')
        return image.crop(box)

    def apply_image_outline(self, image, outline):
        """Render an inside, center, or outside outline from source alpha."""
        context = self.context
        from PIL import Image, ImageChops, ImageFilter
        from alpha_morphology import square_alpha_extrema
        if outline is None:
            return image
        if not isinstance(outline, dict):
            raise ValueError('Project contains invalid outline settings.')
        size = outline.get('size')
        position = outline.get('position', 'center')
        softness = outline.get('softness', 0)
        opacity = outline.get('opacity', 1)
        color = outline.get('color', '#ffffff')
        if isinstance(size, bool) or not isinstance(size, int) or size < 1 or (size > 100):
            raise ValueError('Outline size must be a whole number between 1 and 100.')
        if position not in ('inside', 'center', 'outside'):
            raise ValueError('Outline position must be inside, center, or outside.')
        if isinstance(softness, bool) or not isinstance(softness, (int, float)) or (not math.isfinite(softness)) or (softness < 0) or (softness > 20):
            raise ValueError('Outline edge softness must be between 0 and 20.')
        if isinstance(opacity, bool) or not isinstance(opacity, (int, float)) or (not math.isfinite(opacity)) or (opacity < 0) or (opacity > 1):
            raise ValueError('Outline opacity must be between 0 and 1.')
        if not isinstance(color, str) or len(color) != 7 or color[0] != '#' or any((character not in '0123456789abcdefABCDEF' for character in color[1:])):
            raise ValueError('Outline color must be a six-digit hexadecimal color.')
        from processing_cache import cached_image, image_key
        alpha = image.getchannel('A')
        offset = 0 if position == 'inside' else (size if position == 'outside' else (size + 1) // 2) + math.ceil(softness * 3)
    
        def build_ring():
            if position == 'inside':
                inner = square_alpha_extrema(alpha, size, False, context.check_cancelled)
                ring = ImageChops.subtract(alpha, inner)
            else:
                padded = Image.new('L', (image.width + offset * 2, image.height + offset * 2), 0)
                padded.paste(alpha, (offset, offset))
                outer = square_alpha_extrema(padded, size if position == 'outside' else (size + 1) // 2, True, context.check_cancelled)
                inner = padded if position == 'outside' else square_alpha_extrema(padded, size // 2, False, context.check_cancelled)
                ring = ImageChops.subtract(outer, inner)
            if softness:
                ring = ring.filter(ImageFilter.GaussianBlur(radius=softness))
                if position == 'inside':
                    ring = ImageChops.multiply(ring, alpha)
            return ring
        context.check_cancelled()
        ring = cached_image(image_key('outline-ring', alpha, parameters=(size, position, softness)), build_ring)
        if offset:
            expanded = Image.new('RGBA', ring.size, (0, 0, 0, 0))
            expanded.paste(image, (offset, offset))
            image = expanded
        if opacity < 1:
            ring = ring.point(lambda value: round(value * opacity))
        outline_layer = Image.new('RGBA', image.size, tuple(bytes.fromhex(color[1:])) + (0,))
        outline_layer.putalpha(ring)
        return Image.alpha_composite(image, outline_layer)

    def render_image_with_strokes(self, path, strokes=(), crop=None, outline=None):
        """Return a bounded cached rendering keyed by source metadata and committed effects."""
        context = self.context
        from hashlib import blake2b
        from processing_cache import cached_image
        source = Path(path).resolve()
        metadata = source.stat()
        edits = blake2b(json.dumps([strokes, crop, outline], sort_keys=True, separators=(',', ':')).encode(), digest_size=20).digest()
        key = ('working-image', str(source), metadata.st_mtime_ns, metadata.st_size, edits)
        context.check_cancelled()
        return cached_image(key, lambda: context._render_image_with_strokes(source, strokes, crop, outline))

    def _render_image_with_strokes(self, path, strokes=(), crop=None, outline=None):
        """Rasterize source strokes and apply crop/outline once before caching."""
        context = self.context
        from PIL import Image, ImageChops, ImageDraw, ImageFilter
        with Image.open(path) as opened:
            image = opened.convert('RGBA')
        width, height = image.size
        for stroke in strokes:
            tool = stroke.get('tool')
            points = stroke.get('points')
            size = stroke.get('size')
            shape = stroke.get('shape', 'round')
            feather = stroke.get('feather', 0)
            anti_alias = stroke.get('antiAlias')
            if 'antiAlias' in stroke and (not isinstance(anti_alias, bool)):
                raise ValueError('Paint stroke anti-aliasing must be a boolean.')
            if tool not in ('brush', 'eraser', 'healing') or not isinstance(points, list) or (not points):
                raise ValueError('Project contains an invalid paint stroke.')
            if isinstance(size, bool) or not isinstance(size, (int, float)) or (not math.isfinite(size)) or (size <= 0):
                raise ValueError('Paint stroke size must be greater than zero.')
            if shape not in ('round', 'square'):
                raise ValueError('Paint stroke shape must be round or square.')
            if isinstance(feather, bool) or not isinstance(feather, int) or feather < 0 or (feather > 100):
                raise ValueError('Paint stroke feather must be a whole number between 0 and 100.')
            coordinates = []
            for point in points:
                if not isinstance(point, list) or len(point) != 2 or any((isinstance(value, bool) or not isinstance(value, (int, float)) or (not math.isfinite(value)) for value in point)) or any((value < 0 or value > 1 for value in point)):
                    raise ValueError('Project contains invalid paint stroke coordinates.')
                if not feather and anti_alias is not True:
                    coordinates.append((min(width - 1, math.floor(point[0] * width)), min(height - 1, math.floor(point[1] * height))))
                else:
                    coordinates.append((point[0] * width, point[1] * height))
            stroke_width = max(1, round(size))
            mask = Image.new('L', image.size, 0)
            draw = ImageDraw.Draw(mask)
            if isinstance(anti_alias, bool):
                from brush_mask import brush_mask
                mask = brush_mask(stroke, width, height, context.check_cancelled)
            elif shape == 'round' and (not feather):
                from pixel_brush import draw_pixel_round_stroke
                draw_pixel_round_stroke(draw, coordinates, size, width, height, context.check_cancelled)
            elif shape == 'round':
                scale = 4
                padding = size / 2 + 2
                left = max(0, math.floor(min((x for x, y in coordinates)) - padding))
                top = max(0, math.floor(min((y for x, y in coordinates)) - padding))
                right = min(width, math.ceil(max((x for x, y in coordinates)) + padding))
                bottom = min(height, math.ceil(max((y for x, y in coordinates)) + padding))
                smooth = Image.new('L', ((right - left) * scale, (bottom - top) * scale), 0)
                smooth_draw = ImageDraw.Draw(smooth)
                smooth_points = [((x - left) * scale, (y - top) * scale) for x, y in coordinates]
                smooth_draw.line(smooth_points, fill=255, width=max(1, round(size * scale)), joint='curve')
                radius = size * scale / 2
                for x, y in smooth_points:
                    smooth_draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=255)
                mask.paste(smooth.resize((right - left, bottom - top), Image.Resampling.LANCZOS), (left, top))
            elif not feather:
                pixel_points = []
                for index, point in enumerate(coordinates):
                    previous = coordinates[index - 1] if index else point
                    steps = max(abs(point[0] - previous[0]), abs(point[1] - previous[1]), 1)
                    for step in range(0 if index == 0 else 1, steps + 1):
                        x = math.floor(previous[0] + (point[0] - previous[0]) * step / steps + 0.5)
                        y = math.floor(previous[1] + (point[1] - previous[1]) * step / steps + 0.5)
                        pixel_points.append((x, y))
                offset = stroke_width // 2
                for x, y in pixel_points:
                    draw.rectangle((x - offset, y - offset, x - offset + stroke_width - 1, y - offset + stroke_width - 1), fill=255)
            else:
                half = stroke_width / 2
                for x, y in coordinates:
                    draw.rectangle((x - half, y - half, x + half, y + half), fill=255)
                for start, end in zip(coordinates, coordinates[1:]):
                    dx, dy = (end[0] - start[0], end[1] - start[1])
                    length = math.hypot(dx, dy)
                    if not length:
                        continue
                    offset_x = -dy * half / length
                    offset_y = dx * half / length
                    draw.polygon([(start[0] + offset_x, start[1] + offset_y), (end[0] + offset_x, end[1] + offset_y), (end[0] - offset_x, end[1] - offset_y), (start[0] - offset_x, start[1] - offset_y)], fill=255)
            if feather and anti_alias is None:
                mask = mask.filter(ImageFilter.GaussianBlur(radius=size * feather / 100))
            if tool == 'eraser':
                if isinstance(anti_alias, bool):
                    image.putalpha(Image.frombytes('L', image.size, bytes((math.floor(a * (255 - m) / 255 + 0.5) for a, m in zip(image.getchannel('A').tobytes(), mask.tobytes())))))
                else:
                    image.putalpha(ImageChops.multiply(image.getchannel('A'), ImageChops.invert(mask)))
                continue
            color = stroke.get('color')
            opacity = stroke.get('opacity')
            if not isinstance(color, str) or len(color) != 7 or color[0] != '#' or any((character not in '0123456789abcdefABCDEF' for character in color[1:])):
                raise ValueError('Paint stroke color must be a hexadecimal RGB value.')
            if isinstance(opacity, bool) or not isinstance(opacity, (int, float)) or (not math.isfinite(opacity)) or (opacity < 0) or (opacity > 1):
                raise ValueError('Paint stroke opacity must be between zero and one.')
            if tool == 'healing':
                from healing_brush import heal_image
                image = heal_image(image, mask, stroke, context.check_cancelled)
                continue
            rgba = tuple((int(color[index:index + 2], 16) for index in (1, 3, 5))) + (round(opacity * 255),)
            layer = Image.new('RGBA', image.size, rgba[:3] + (0,))
            mask = mask.point(lambda value: math.floor(value * opacity + 0.5) if isinstance(anti_alias, bool) or (shape == 'round' and (not feather)) else round(value * opacity))
            layer.putalpha(mask)
            image = Image.alpha_composite(image, layer)
        image = context.apply_image_crop(image, crop)
        return context.apply_image_outline(image, outline)
