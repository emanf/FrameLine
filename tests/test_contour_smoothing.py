"""Verify boundary cleanup flattens teeth without polygon corners or feathering."""
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'backend'))
import engine
from edge_smoothing import simplify_silhouette, antialias_silhouette


def noisy_rectangle():
    alpha = Image.new('L', (64, 64))
    drawing = ImageDraw.Draw(alpha)
    drawing.rectangle((8, 16, 55, 55), fill=255)
    drawing.rectangle((20, 13, 20, 15), fill=255)
    alpha.putpixel((36, 15), 255)
    alpha.putpixel((28, 16), 0)
    return alpha


class ContourSmoothingTests(unittest.TestCase):
    def test_flattens_small_bumps_and_notches_without_creating_feathered_pixels(self):
        alpha = noisy_rectangle()
        rgb, result = simplify_silhouette(Image.new('RGB', alpha.size, 'red'), alpha, 4)
        expected = Image.new('L', alpha.size)
        ImageDraw.Draw(expected).rectangle((8, 16, 55, 55), fill=255)
        self.assertEqual(result.tobytes(), expected.tobytes())
        self.assertEqual(set(result.tobytes()), {0, 255})
        self.assertEqual(rgb.getpixel((28, 16)), (255, 0, 0))

    def test_preserves_interiors_holes_islands_and_large_sharp_corners(self):
        alpha = Image.new('L', (80, 64))
        draw = ImageDraw.Draw(alpha)
        draw.polygon([(8, 16), (24, 16), (32, 4), (40, 16), (60, 16), (60, 56), (8, 56)], fill=160)
        draw.rectangle((18, 28, 32, 42), fill=0)
        alpha.putpixel((72, 40), 80)
        rgb = Image.new('RGB', alpha.size, (200, 50, 80))
        rgb.putpixel((45, 40), (20, 70, 210))
        colors, result = simplify_silhouette(rgb, alpha, 2)
        self.assertEqual(result.getpixel((32, 5)), 160)
        self.assertEqual(result.getpixel((25, 34)), 0)
        self.assertEqual(result.getpixel((72, 40)), 80)
        self.assertEqual(result.getpixel((45, 40)), 160)
        self.assertEqual(colors.getpixel((45, 40)), (20, 70, 210))
        self.assertEqual(result.size, alpha.size)

    def test_anti_aliasing_remains_an_independent_optional_pass(self):
        alpha = Image.new('L', (40, 40))
        ImageDraw.Draw(alpha).polygon([(5, 5), (33, 29), (5, 29)], fill=255)
        rgb, shaped = simplify_silhouette(Image.new('RGB', alpha.size, 'red'), alpha, 2)
        self.assertEqual(set(shaped.tobytes()), {0, 255})
        _, smooth = antialias_silhouette(rgb, shaped, 75)
        self.assertTrue(any(0 < value < 255 for value in smooth.tobytes()))

    def test_disabled_validation_and_cancellation(self):
        alpha = noisy_rectangle()
        rgb = Image.new('RGB', alpha.size, 'blue')
        self.assertEqual(simplify_silhouette(rgb, alpha, 0)[1].tobytes(), alpha.tobytes())
        for value in [True, -1, 9, '2', float('nan')]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                simplify_silhouette(rgb, alpha, value)
        def cancelled():
            raise engine.ExportCancelled()
        with self.assertRaises(engine.ExportCancelled):
            simplify_silhouette(rgb, alpha, 2, cancelled)

    def test_contour_cleanup_works_in_every_removal_method(self):
        alpha = noisy_rectangle()
        source = Image.new('RGBA', alpha.size, (0, 255, 0, 255))
        source.paste(Image.new('RGBA', alpha.size, (220, 30, 80, 255)), mask=alpha)
        expected = Image.new('L', alpha.size)
        ImageDraw.Draw(expected).rectangle((8, 16, 55, 55), fill=255)
        with tempfile.TemporaryDirectory() as directory:
            original = Path(directory)/'source.png'
            source.save(original)
            for mode in ['auto', 'chroma', 'sample']:
                with self.subTest(mode=mode):
                    output = Path(directory)/(mode+'.png')
                    engine.remove_background({'path': str(original), 'output': str(output), 'mode': mode,
                        'key_color': [0, 255, 0], 'sample_point': [0, 0], 'softness': 0, 'spill': 0,
                        'contour_smoothing': 4})
                    with Image.open(output) as result:
                        self.assertEqual(result.getchannel('A').tobytes(), expected.tobytes())

    def test_removal_pipeline_preview_apply_protection_opacity_and_optional_blur(self):
        alpha = noisy_rectangle()
        alpha = alpha.point(lambda value: 100 if value else 0)
        source = Image.new('RGBA', alpha.size, (0, 255, 0, 255))
        subject = Image.new('RGBA', alpha.size, (220, 30, 80, 100))
        source.paste(subject, mask=alpha.point(lambda value: 255 if value else 0))
        with tempfile.TemporaryDirectory() as directory:
            original = Path(directory)/'source.png'
            source.save(original)
            options = {'path': str(original), 'mode': 'auto', 'contour_smoothing': 4,
                       'ignore_strokes': [{'size': .08, 'points': [[.3125, .21875]]}]}
            outputs = []
            events = []
            with patch.object(engine, 'report_progress', side_effect=lambda *event: events.append(event)):
                for name in ['preview', 'apply']:
                    output = Path(directory)/(name+'.png')
                    engine.remove_background({**options, 'output': str(output)})
                    with Image.open(output) as decoded:
                        outputs.append(decoded.copy())
            self.assertEqual(outputs[0].tobytes(), outputs[1].tobytes())
            self.assertEqual(outputs[0].getpixel((45, 40)), (220, 30, 80, 100))
            self.assertEqual(outputs[0].getpixel((20, 14)), source.getpixel((20, 14)))
            self.assertTrue(any('contour cleanup' in event[2] for event in events))
            output = Path(directory)/'blur.png'
            engine.remove_background({**options, 'softness': 64, 'output': str(output)})
            with Image.open(output) as blurred:
                self.assertNotEqual(blurred.tobytes(), outputs[0].tobytes())

    def test_repeated_alternating_and_irregular_teeth_become_flat_in_every_orientation(self):
        for pattern, tolerance in [([0, 2], 2), ([0, 0, -2, 0, 0, 2, 0, 0], 2),
                                   ([0, 2, 1, -1, 0, 1, -2, 1, 2, 0], 3)]:
            alpha = Image.new('L', (128, 80))
            for x in range(16, 112):
                top = 24+pattern[(x-16)%len(pattern)]
                alpha.paste(255, (x, top, x+1, 72))
            for orientation in [None, Image.Transpose.ROTATE_90, Image.Transpose.ROTATE_180, Image.Transpose.ROTATE_270]:
                with self.subTest(pattern=pattern, orientation=orientation):
                    source = alpha.copy() if orientation is None else alpha.transpose(orientation)
                    _, cleaned = simplify_silhouette(Image.new('RGB', source.size, 'red'), source, tolerance)
                    if orientation is not None:
                        inverse = {Image.Transpose.ROTATE_90: Image.Transpose.ROTATE_270,
                                   Image.Transpose.ROTATE_180: Image.Transpose.ROTATE_180,
                                   Image.Transpose.ROTATE_270: Image.Transpose.ROTATE_90}[orientation]
                        cleaned = cleaned.transpose(inverse)
                    heights = [next(y for y in range(80) if cleaned.getpixel((x, y))) for x in range(24, 104)]
                    self.assertEqual(len(set(heights)), 1, 'Repeated teeth must not become a different sawtooth pattern')
                    self.assertLessEqual(abs(heights[0]-24), tolerance)
                    self.assertEqual(set(cleaned.tobytes()), {0, 255})

    def test_clean_diagonal_and_one_pixel_structures_are_preserved(self):
        for points in [[(8, 8), (50, 50), (8, 50)], [(4, 4), (58, 58)]]:
            alpha = Image.new('L', (64, 64))
            draw = ImageDraw.Draw(alpha)
            if len(points) == 3:
                draw.polygon(points, fill=255)
            else:
                draw.line(points, fill=255, width=1)
            _, result = simplify_silhouette(Image.new('RGB', alpha.size, 'red'), alpha, 2)
            self.assertEqual(result.tobytes(), alpha.tobytes())
