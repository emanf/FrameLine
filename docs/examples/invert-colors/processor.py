"""Example processor using the same lifecycle for preview, Apply, and batches."""
from PIL import Image, ImageOps
from tool_plugin import ImageProcessorPlugin


class Processor(ImageProcessorPlugin):
    """Invert RGB with an adjustable blend; preserve the original alpha channel."""
    def process(self, image, options, context):
        strength = options.get("strength", 100)
        if isinstance(strength, bool) or not isinstance(strength, (int, float)) or not 0 <= strength <= 100:
            raise ValueError("Strength must be a number between 0 and 100.")
        context.check_cancelled()
        context.report_progress(25, 100, "Inverting colors")
        rgb = image.convert("RGB")
        result = Image.blend(rgb, ImageOps.invert(rgb), strength / 100).convert("RGBA")
        result.putalpha(image.getchannel("A"))
        context.check_cancelled()
        context.report_progress(90, 100, "Finishing inversion")
        return result
