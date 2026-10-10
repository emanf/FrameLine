"""Produce owned PNG outputs for live image tools and committed processing."""
from pathlib import Path


class ImageCommands:
    """Produce owned PNG outputs for live image tools and committed processing."""
    def __init__(self, context):
        self.context = context

    def apply_outline(self, request):
        """Create an owned outlined PNG from a materialized source."""
        context = self.context
        from PIL import Image
        context.report_progress(5, 100, 'Preparing outline…')
        image = context.render_image_with_strokes(request['path'])
        context.report_progress(20, 100, 'Calculating outline…')
        result = context.apply_image_outline(image, request.get('outline'))
        context.report_progress(90, 100, 'Saving outlined image…')
        output = Path(request['output'])
        output.parent.mkdir(parents=True, exist_ok=True)
        result.save(output, format='PNG', compress_level=1)
        return {'path': str(output.resolve()), 'width': result.width, 'height': result.height}

    def refine_edges(self, request):
        """Process cutout alpha and edge colors, reporting progress and cancellation."""
        context = self.context
        from refine_edges import refine_cutout, validate_refine_options
        options = validate_refine_options(request.get('options'))
        context.report_progress(5, 100, 'Preparing edited image…')
        image = context.render_image_with_strokes(request['path'], request.get('paint_strokes', []), request.get('crop'), request.get('outline'))
        result = refine_cutout(image, options, context.check_cancelled, lambda current, total, message: context.report_progress(10 + current / total * 80, 100, message))
        context.report_progress(90, 100, 'Saving refined image…')
        output = Path(request['output'])
        output.parent.mkdir(parents=True, exist_ok=True)
        result.save(output, format='PNG', compress_level=1)
        return {'path': str(output.resolve()), 'width': result.width, 'height': result.height}

    def clean_pixels(self, request):
        """Reduce whole-image noise with validated edge-aware cleanup settings."""
        context = self.context
        from clean_pixels import clean_image_pixels, validate_clean_options
        options = validate_clean_options(request.get('options'))
        context.report_progress(5, 100, 'Preparing edited image…')
        image = context.render_image_with_strokes(request['path'], request.get('paint_strokes', []), request.get('crop'), request.get('outline'))
        result = clean_image_pixels(image, options, context.check_cancelled, lambda current, total, message: context.report_progress(10 + current / total * 80, 100, message))
        context.report_progress(90, 100, 'Saving cleaned image…')
        output = Path(request['output'])
        output.parent.mkdir(parents=True, exist_ok=True)
        result.save(output, format='PNG', compress_level=1)
        return {'path': str(output.resolve()), 'width': result.width, 'height': result.height}

    def render_current_image(self, request):
        """Bake current crop, outline, and strokes into an owned working PNG."""
        context = self.context
        result = context.render_image_with_strokes(request['path'], request.get('paint_strokes', []), request.get('crop'), request.get('outline'))
        output = Path(request['output'])
        output.parent.mkdir(parents=True, exist_ok=True)
        result.save(output, format='PNG', compress_level=1)
        return {'path': str(output.resolve()), 'width': result.width, 'height': result.height}
