"""Check curved outlines against supplied before/after masks and meaningful corners."""
import sys
import tempfile
import unittest
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'backend'))
import engine
from curve_smoothing import smooth_curves, validate_curve_options, CurveSmoother
from edge_smoothing import simplify_silhouette

FIXTURES = Path(__file__).parent/'fixtures'


class CurveSmoothingTests(unittest.TestCase):
    def triangle(self):
        mask = Image.new('L', (128, 128))
        ImageDraw.Draw(mask).polygon([(64, 8), (120, 112), (8, 112)], fill=255)
        return mask

    def test_supplied_noisy_circle_moves_toward_clean_reference_without_assuming_a_circle(self):
        with Image.open(FIXTURES/'curve-before.png') as source, Image.open(FIXTURES/'curve-after.png') as reference:
            rgb, result = smooth_curves(Image.new('RGB', source.size, 'black'), source, 12, {'radius': 64}, 100)
            before_error = sum(ImageChops.difference(source, reference).histogram()[1:])
            binary = result.point(lambda value: 255 if value >= 128 else 0)
            after_error = sum(ImageChops.difference(binary, reference).histogram()[1:])
            self.assertLess(after_error, before_error*.4)
            self.assertLess(after_error/(sum(reference.histogram()[1:])+sum(binary.histogram()[1:])), .003)
            self.assertEqual(rgb.getpixel((300, 250)), (0, 0, 0))
            self.assertTrue(any(0 < value < 255 for value in result.tobytes()))

    def test_corner_angle_and_protection_control_intentional_triangle_points(self):
        mask = self.triangle()
        rgb = Image.new('RGB', mask.size, 'red')
        _, protected = smooth_curves(rgb, mask, 24, {'radius': 32, 'corner_angle': 110}, 100)
        _, rounded = smooth_curves(rgb, mask, 24, {'radius': 32, 'preserve_corners': False}, 100)
        _, low_angle = smooth_curves(rgb, mask, 24, {'radius': 32, 'corner_angle': 30}, 100)
        self.assertGreater(protected.getpixel((64, 9)), 200)
        self.assertEqual(rounded.getpixel((64, 9)), 0)
        self.assertEqual(low_angle.getpixel((64, 9)), 0)
        self.assertGreater(rounded.getpixel((64, 70)), 200)

    def test_non_circular_curves_keep_their_proportions(self):
        mask = Image.new('L', (160, 100))
        draw = ImageDraw.Draw(mask)
        draw.ellipse((12, 20, 148, 80), fill=255)
        draw.ellipse((42, 23, 48, 31), fill=255)
        _, result = smooth_curves(Image.new('RGB', mask.size, 'blue'), mask, 6, {'radius': 24}, 100)
        left, top, right, bottom = result.getbbox()
        self.assertGreater((right-left)/(bottom-top), 2)
        self.assertGreater(result.getpixel((80, 50)), 200)

    def test_strength_zero_maximum_change_and_pixel_mode_remain_predictable(self):
        mask = self.triangle()
        rgb = Image.new('RGB', mask.size, (70, 110, 200))
        unchanged = smooth_curves(rgb, mask, 12, {'strength': 0})
        self.assertEqual(unchanged[0].tobytes(), rgb.tobytes())
        self.assertEqual(unchanged[1].tobytes(), mask.tobytes())
        _, hard = smooth_curves(rgb, mask, 1, {'preserve_corners': False})
        self.assertEqual(set(hard.tobytes()), {0, 255})
        self.assertGreater(hard.getpixel((64, 10)), 200)
        pixel = simplify_silhouette(rgb, mask, 2, options={'method': 'pixel'})
        legacy = simplify_silhouette(rgb, mask, 2)
        self.assertEqual(pixel[1].tobytes(), legacy[1].tobytes())

    def test_preserves_translucent_colored_interiors_holes_and_thin_islands(self):
        mask = self.triangle().point(lambda value: 100 if value else 0)
        ImageDraw.Draw(mask).ellipse((42, 50, 84, 94), fill=0)
        mask.putpixel((5, 5), 40)
        rgb = Image.new('RGB', mask.size, (210, 35, 70))
        rgb.putpixel((64, 105), (20, 60, 230))
        colors, alpha = smooth_curves(rgb, mask, 8, {'radius': 16}, 100)
        self.assertEqual(alpha.getpixel((64, 70)), 0)
        self.assertEqual(alpha.getpixel((5, 5)), 40)
        self.assertEqual(alpha.getpixel((64, 105)), 100)
        self.assertEqual(colors.getpixel((64, 105)), (20, 60, 230))
        self.assertLessEqual(alpha.getextrema()[1], 100)

    def test_settings_validation_cancellation_and_cached_progress(self):
        for options in [{'method': 'unknown'}, {'radius': True}, {'radius': 129}, {'strength': float('nan')},
                        {'preserve_corners': 1}, {'corner_angle': 0}, {'extra': 1}]:
            with self.subTest(options=options), self.assertRaises(ValueError):
                validate_curve_options(options)
        def cancelled():
            raise engine.ExportCancelled()
        with self.assertRaises(engine.ExportCancelled):
            smooth_curves(Image.new('RGB', (128, 128)), self.triangle(), 8, {}, cancel=cancelled)
        events = []
        smooth_curves(Image.new('RGB', (128, 128)), self.triangle(), 8, {}, progress=lambda *event: events.append(event))
        self.assertTrue(any('curved outline' in event[2] for event in events))
        self.assertEqual([event[0] for event in events], sorted(event[0] for event in events))

    def test_pipeline_preview_apply_matches_and_ignore_restores_original_source(self):
        mask = self.triangle()
        source = Image.new('RGBA', mask.size, (0, 255, 0, 255))
        source.paste(Image.new('RGBA', mask.size, (210, 35, 70, 255)), mask=mask)
        with tempfile.TemporaryDirectory() as directory:
            original = Path(directory)/'source.png'
            source.save(original)
            options = {'path': str(original), 'mode': 'auto', 'contour_smoothing': 12,
                       'contour_options': {'radius': 32, 'preserve_corners': False}, 'edge_smoothing': 100,
                       'ignore_strokes': [{'size': .06, 'points': [[.5, .07]]}]}
            outputs = []
            for name in ['preview', 'apply']:
                destination = Path(directory)/(name+'.png')
                engine.remove_background({**options, 'output': str(destination)})
                with Image.open(destination) as image:
                    outputs.append(image.copy())
            self.assertEqual(outputs[0].tobytes(), outputs[1].tobytes())
            self.assertEqual(outputs[0].getpixel((64, 9)), source.getpixel((64, 9)))
            self.assertEqual(outputs[0].getpixel((64, 70)), (210, 35, 70, 255))
