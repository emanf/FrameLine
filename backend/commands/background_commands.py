"""Inspect sources and remove backgrounds while preserving protected subject regions."""
import math
from pathlib import Path


class BackgroundCommands:
    """Inspect sources and remove backgrounds while preserving protected subject regions."""
    def __init__(self, context):
        self.context = context

    def inspect_images(self, paths):
        """Inspect source dimensions and formats without changing the source files."""
        context = self.context
        from PIL import Image
        results = []
        for value in paths:
            path = Path(value)
            with Image.open(path) as image:
                results.append({'path': str(path.resolve()), 'name': path.name, 'width': image.width, 'height': image.height, 'format': image.format})
        return results

    def sample_image_color(self, request):
        """Read an RGBA sample at a validated source-image position."""
        context = self.context
        from PIL import Image
        with Image.open(request['path']) as image:
            x = request['x']
            y = request['y']
            if isinstance(x, bool) or isinstance(y, bool) or (not isinstance(x, int)) or (not isinstance(y, int)):
                raise ValueError('Sample coordinates must be whole pixels.')
            if x < 0 or y < 0 or x >= image.width or (y >= image.height):
                raise ValueError('The selected color sample is outside the image.')
            return {'color': list(image.convert('RGB').getpixel((x, y)))}

    def remove_background(self, request):
        """Generate a cutout using validated removal, edge, and protection options."""
        context = self.context
        from PIL import Image, ImageChops, ImageDraw, ImageFilter
        from fringe_cleanup import clean_color_fringe, validate_cleanup
        source_path = Path(request['path'])
        mode = request.get('mode', 'auto')
        if mode not in ('auto', 'chroma', 'sample'):
            raise ValueError(f'Unknown background-removal method: {mode}')
        tolerance = request.get('tolerance', 128 if mode == 'auto' else 55)
        softness = request.get('softness', 0 if mode == 'auto' else 35)
        spill = request.get('spill', 0 if mode == 'auto' else 50)
        edge_tint = request.get('edge_tint', 100)
        edge_smoothing = request.get('edge_smoothing', 0)
        fringe_cleanup = validate_cleanup(request.get('fringe_cleanup'))
        recover_edges = fringe_cleanup is not None and fringe_cleanup.get('method') == 'recover' and (fringe_cleanup['strength'] > 0)
        if isinstance(edge_smoothing, bool) or not isinstance(edge_smoothing, (int, float)) or (not math.isfinite(edge_smoothing)) or (not 0 <= edge_smoothing <= 100):
            raise ValueError('Edge smoothing must be between 0 and 100 percent.')
        for name, value in (('Tolerance', tolerance), ('Softness', softness)):
            if isinstance(value, bool) or not isinstance(value, int) or value < 0 or (value > 255):
                raise ValueError(f'{name} must be a whole number between 0 and 255.')
        if isinstance(spill, bool) or not isinstance(spill, int) or spill < 0 or (spill > 100):
            raise ValueError('Spill must be a whole number between 0 and 100 percent.')
        if isinstance(edge_tint, bool) or not isinstance(edge_tint, int) or (not 0 <= edge_tint <= 100):
            raise ValueError('Edge tint must be a whole number between 0 and 100 percent.')
        edge_color = request.get('edge_color')
        if edge_color is not None and (not isinstance(edge_color, list) or len(edge_color) != 3 or any((isinstance(channel, bool) or not isinstance(channel, int) or (not 0 <= channel <= 255) for channel in edge_color))):
            raise ValueError('Soft edge color must contain three whole RGB values between 0 and 255.')
        spill_color = request.get('spill_color')
        if spill_color is not None and (not isinstance(spill_color, list) or len(spill_color) != 3 or any((isinstance(channel, bool) or not isinstance(channel, int) or channel < 0 or (channel > 255) for channel in spill_color))):
            raise ValueError('Suppressed edge color must contain three whole RGB values between 0 and 255.')
        context.report_progress(5, 100, 'Preparing background removal…')
        image = context.render_image_with_strokes(source_path, request.get('paint_strokes', []), request.get('crop'), request.get('outline'))
        width, height = image.size
        from background_ignore import ignore_mask
        protected = ignore_mask(request.get('ignore_strokes', []), width, height, context.check_cancelled)
        auto_region = None
        background_colors = None
        if mode == 'auto':
            from auto_background import segment_background
            auto_alpha, auto_region, background_colors = segment_background(image, request, tolerance, 0 if edge_smoothing else softness, context.check_cancelled, context.report_progress)
            key_color = background_colors[0]
        elif mode == 'chroma':
            key_color = request.get('key_color')
            if not isinstance(key_color, list) or len(key_color) != 3 or any((isinstance(channel, bool) or not isinstance(channel, int) or channel < 0 or (channel > 255) for channel in key_color)):
                raise ValueError('Chroma key color must contain three whole RGB values between 0 and 255.')
        else:
            sample = request.get('sample_point')
            batch_color = request.get('sample_color')
            if batch_color is not None:
                if not isinstance(batch_color, list) or len(batch_color) != 3 or any((isinstance(c, bool) or not isinstance(c, int) or (not 0 <= c <= 255) for c in batch_color)):
                    raise ValueError('Sampled batch color must contain three whole RGB values between 0 and 255.')
                key_color = batch_color
            elif not isinstance(sample, list) or len(sample) != 2 or any((isinstance(value, bool) or not isinstance(value, int) for value in sample)) or (sample[0] < 0) or (sample[1] < 0) or (sample[0] >= width) or (sample[1] >= height):
                raise ValueError('Select a background color from inside the image before applying removal.')
            else:
                key_color = list(image.getpixel(tuple(sample))[:3])
        rgb = image.convert('RGB')
        if mode != 'auto':
            context.report_progress(20, 100, 'Finding background pixels…')
        channels = list(rgb.split())
        if mode == 'auto':
            alpha = auto_alpha
        else:
            key_channels = [Image.new('L', image.size, channel) for channel in key_color]
            distance = ImageChops.difference(channels[0], key_channels[0])
            for channel, key_channel in zip(channels[1:], key_channels[1:]):
                distance = ImageChops.lighter(distance, ImageChops.difference(channel, key_channel))
            alpha = distance.point(lambda value: 255 if value > tolerance else 0)
        original_alpha = image.getchannel('A')
        repaired_translucent = None
        translucent_colors = None
        if fringe_cleanup and (not recover_edges):
            translucent = original_alpha.point(lambda value: value if 0 < value < 255 else 0)
            if translucent.getbbox():
                proposed_alpha = ImageChops.lighter(ImageChops.multiply(alpha, original_alpha), translucent)
                rgb, repaired_translucent = clean_color_fringe(rgb, rgb, proposed_alpha, key_color, fringe_cleanup, context.check_cancelled, target_mask=translucent.point(lambda value: 255 if value else 0))
                if repaired_translucent is not None:
                    translucent_colors = rgb
                    alpha = ImageChops.lighter(alpha, repaired_translucent)
                    channels = list(rgb.split())
        region = auto_region
        protected_alpha = original_alpha.point(lambda value: 255 if value else 0)
        if mode == 'sample' and request.get('connected_only', True):
            sample = request.get('sample_point')
            region_softness = 0 if edge_smoothing else softness
            region = distance.point(lambda value: 255 if value <= min(255, tolerance + region_softness) else 0)
            if request.get('sample_color') is not None:
                perimeter = [(x, 0) for x in range(width)] + [(x, height - 1) for x in range(width)]
                perimeter += [(0, y) for y in range(height)] + [(width - 1, y) for y in range(height)]
                candidates = [p for p in perimeter if region.getpixel(p) and original_alpha.getpixel(p)]
                sample = min(candidates, key=lambda p: distance.getpixel(p)) if candidates else None
            if sample is not None:
                ImageDraw.floodfill(region, tuple(sample), 128, thresh=0)
            region = region.point(lambda value: 255 if value == 128 else 0)
            protected_alpha = original_alpha.point(lambda value: 255 if value else 0)
            alpha = Image.composite(alpha, protected_alpha, region)
        recovered_alpha = None
        recovered_pixels = None
        if recover_edges:
            context.report_progress(40, 100, 'Recovering edge colors…')
            from edge_color_cleanup import recover_edge_colors
            rgb, recovered_alpha, recovered_pixels = recover_edge_colors(image, ImageChops.multiply(alpha, original_alpha), key_color, fringe_cleanup, context.check_cancelled, region)
            channels = list(rgb.split())
            softness = 0
        removed_background = alpha.point(lambda value: 255 if value == 0 else 0)
        if edge_smoothing:
            context.report_progress(60, 100, 'Smoothing cutout edges…')
            from edge_smoothing import antialias_silhouette
            raw_alpha = recovered_alpha if recovered_alpha is not None else ImageChops.multiply(alpha, original_alpha)
            removed_background = raw_alpha.point(lambda value: 255 if value == 0 else 0)
            rgb, alpha = antialias_silhouette(rgb, raw_alpha, edge_smoothing, context.check_cancelled)
            channels = list(rgb.split())
        elif softness:
            alpha = alpha.filter(ImageFilter.GaussianBlur(radius=softness / 32))
            if region is not None:
                alpha = Image.composite(alpha, protected_alpha, region)
        if not edge_smoothing:
            alpha = recovered_alpha if recovered_alpha is not None else ImageChops.multiply(alpha, original_alpha)
        fringe_reference = rgb
        context.report_progress(75, 100, 'Cleaning edge colors…')
        if mode == 'chroma' and spill:
            key_index = max(range(3), key=lambda index: key_color[index])
            other_channels = [channels[index] for index in range(3) if index != key_index]
            other_max = ImageChops.lighter(*other_channels)
            excess = ImageChops.subtract(channels[key_index], other_max)
            edge = alpha.point(lambda value: 255 if 0 < value < 255 else 0)
            spill_strength = edge.point(lambda value: round(value * spill / 100))
            spill_amount = ImageChops.multiply(excess, spill_strength)
            channels[key_index] = ImageChops.subtract(channels[key_index], spill_amount)
            if spill_color is not None:
                inverse_spill = ImageChops.invert(spill_amount)
                channels = [ImageChops.add(ImageChops.multiply(channel, inverse_spill), ImageChops.multiply(Image.new('L', image.size, replacement), spill_amount)) for channel, replacement in zip(channels, spill_color)]
            rgb = Image.merge('RGB', channels)
        if edge_color is not None and edge_tint and (softness or edge_smoothing):
            visible_edge = alpha.point(lambda value: 255 if value > 0 else 0)
            tint_mask = ImageChops.multiply(removed_background, visible_edge)
            tint_mask = tint_mask.point(lambda value: round(value * edge_tint / 100))
            rgb = Image.composite(Image.new('RGB', image.size, tuple(edge_color)), rgb, tint_mask)
        if recover_edges:
            rgb = Image.composite(fringe_reference, rgb, recovered_pixels)
            rgb = Image.composite(rgb, Image.new('RGB', image.size), alpha.point(lambda a: 255 if a else 0))
        elif fringe_cleanup:
            if repaired_translucent is not None:
                rgb = Image.composite(translucent_colors, rgb, repaired_translucent)
            remaining = ImageChops.invert(repaired_translucent) if repaired_translucent is not None else None
            rgb, _ = clean_color_fringe(rgb, fringe_reference, alpha, key_color, fringe_cleanup, context.check_cancelled, target_mask=remaining)
        context.report_progress(85, 100, 'Finishing background removal…')
        result = Image.merge('RGBA', (*rgb.split(), alpha))
        if protected is not None and protected.getbbox():
            result = Image.composite(image, result, protected)
        output = Path(request['output'])
        output.parent.mkdir(parents=True, exist_ok=True)
        result.save(output, format='PNG', compress_level=1)
        return {'path': str(output.resolve()), 'width': width, 'height': height, 'key_color': key_color, **({'background_colors': background_colors} if background_colors else {})}
