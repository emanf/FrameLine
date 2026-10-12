"""Protection compositing, effect commands, and mutating extension boundaries."""
import sys
import tempfile
import unittest
from pathlib import Path
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
import engine
from protected_effects import protection_mask, protect_effect
from tool_plugin import process_tool_plugin


class ProtectedEffectsTests(unittest.TestCase):
    def mark(self, size=6, point=(.5, .5), anti_alias=False):
        return {'size': size, 'shape': 'square', 'antiAlias': anti_alias, 'feather': 0, 'points': [list(point)]}

    def test_exact_protected_rgba_and_expanded_alignment(self):
        source = Image.new('RGBA', (20, 20), (13, 24, 35, 0))
        source.putpixel((10, 10), (25, 100, 190, 128))
        output = Image.new('RGBA', (26, 28), (240, 20, 10, 255))
        result = protect_effect(source, output, [self.mark()])
        self.assertEqual(result.getpixel((13, 14)), source.getpixel((10, 10)))
        self.assertEqual(result.getpixel((12, 13)), (13, 24, 35, 0))
        self.assertEqual(result.getpixel((0, 0)), (240, 20, 10, 255))
        self.assertEqual(source.getpixel((10, 10)), (25, 100, 190, 128))

    def test_union_cache_is_independent_and_soft_boundary_is_alpha_aware(self):
        marks = [self.mark(5, (.51, .48), True)]
        mask = protection_mask(marks, (20, 20))
        self.assertEqual(mask.tobytes(), protection_mask(marks * 2, (20, 20)).tobytes())
        original_mask = mask.tobytes()
        mask.paste(0, (0, 0, 20, 20))
        self.assertEqual(protection_mask(marks, (20, 20)).tobytes(), original_mask)
        source = Image.new('RGBA', (20, 20), (0, 0, 255, 0))
        result = protect_effect(source, Image.new('RGBA', source.size, (255, 0, 0, 255)), marks)
        partial = [(x, y) for y in range(20) for x in range(20) if 0 < original_mask[y*20+x] < 255]
        self.assertTrue(partial)
        for point in partial:
            self.assertEqual(result.getpixel(point)[:3], (255, 0, 0), 'transparent source color must not bleed')

    def test_invalid_masks_reject_nested_or_nonfinite_brush_data(self):
        for mark in [self.mark(0), {**self.mark(), 'antiAlias': 1}, {**self.mark(), 'points': [[float('nan'), .5]]},
                     {**self.mark(), 'ignoreStrokes': []}, {**self.mark(), 'shape': 'triangle'}]:
            with self.assertRaises(ValueError):
                protection_mask([mark], (20, 20))

    def test_background_outline_refine_and_cleanup_preserve_marked_pixels(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = Image.new('RGBA', (32, 32), (0, 255, 0, 255))
            ImageDraw.Draw(source).rectangle((10, 8, 23, 24), fill=(70, 50, 180, 255))
            path = root / 'source.png'
            source.save(path)
            marks = [self.mark(6, (.1, .1))]
            request = {'path': str(path), 'output': str(root/'background.png'), 'mode': 'chroma',
                       'key_color': [0, 255, 0], 'tolerance': 128, 'softness': 0, 'spill': 0, 'effect_ignore': marks}
            engine.remove_background(request)
            with Image.open(request['output']) as removed:
                self.assertEqual(removed.getpixel((3, 3)), source.getpixel((3, 3)))
                self.assertEqual(removed.getpixel((31, 31))[3], 0)
            source = Image.new('RGBA', (32, 32), (0, 0, 0, 0))
            ImageDraw.Draw(source).rectangle((10, 8, 23, 24), fill=(70, 50, 180, 255))
            source.putpixel((16, 16), (200, 200, 200, 255))
            source.save(path)
            marks = [self.mark(4, (9.5/32, 15.5/32)), self.mark(3)]
            output = root/'outline.png'
            engine.apply_outline({'path': str(path), 'output': str(output), 'effect_ignore': marks,
                                  'outline': {'color': '#ff0000', 'size': 3, 'position': 'outside', 'softness': 0, 'opacity': 1}})
            with Image.open(output) as outlined:
                self.assertEqual(outlined.getpixel((12, 18)), source.getpixel((9, 15)))
                self.assertGreater(outlined.getpixel((26, 9))[3], 0)
            for command, options in [(engine.refine_edges, {'clean': 100, 'repair': 100, 'smooth': 100, 'shrink': 1, 'width': 2}),
                                     (engine.clean_pixels, {'strength': 100, 'tolerance': 32, 'radius': 2, 'speckles': 100})]:
                command({'path': str(path), 'output': str(output), 'effect_ignore': marks, 'options': options})
                with Image.open(output) as result:
                    self.assertEqual(result.getpixel((16, 16)), source.getpixel((16, 16)))
                    self.assertEqual(result.getpixel((10, 15)), source.getpixel((10, 15)))

    def test_extension_that_mutates_input_cannot_change_protected_pixels(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            processor = root/'processor.py'
            processor.write_text("from tool_plugin import ImageProcessorPlugin\nclass Processor(ImageProcessorPlugin):\n def process(self,image,options,context):\n  image.paste((255,0,0,255),(0,0,image.width,image.height))\n  return image\n")
            source = Image.new('RGBA', (20, 20), (0, 100, 200, 255))
            output = root/'output.png'
            process_tool_plugin({'path': 'unused', 'processor': str(processor), 'output': str(output), 'effect_ignore': [self.mark()]},
                                lambda *_: source.copy(), lambda *_: None, lambda: None)
            with Image.open(output) as result:
                self.assertEqual(result.getpixel((10, 10)), (0, 100, 200, 255))
                self.assertEqual(result.getpixel((0, 0)), (255, 0, 0, 255))
