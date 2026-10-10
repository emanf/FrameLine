import random
import sys
import unittest
from pathlib import Path
from PIL import Image, ImageFilter

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from alpha_morphology import square_alpha_extrema


class AlphaMorphologyTests(unittest.TestCase):
    def test_large_square_filters_match_pillow_at_every_pixel(self):
        randomizer = random.Random(142)
        for dimensions in [(1, 1), (1, 17), (17, 1), (7, 9), (29, 21)]:
            data = bytes(randomizer.randrange(256) for _ in range(dimensions[0] * dimensions[1]))
            image = Image.frombytes("L", dimensions, data)
            for radius in [0, 1, 8, 9, 15, 100]:
                for maximum in [False, True]:
                    with self.subTest(dimensions=dimensions, radius=radius, maximum=maximum):
                        filter_type = ImageFilter.MaxFilter if maximum else ImageFilter.MinFilter
                        expected = image.filter(filter_type(radius * 2 + 1))
                        actual = square_alpha_extrema(image, radius, maximum)
                        self.assertEqual(actual.size, expected.size)
                        self.assertEqual(actual.tobytes(), expected.tobytes())

    def test_transparent_edges_and_partial_alpha_match_pillow(self):
        image = Image.new("L", (49, 37))
        image.paste(65, (0, 0, 30, 20))
        image.paste(192, (11, 9, 35, 27))
        image.putpixel((48, 36), 255)
        for maximum in [False, True]:
            filter_type = ImageFilter.MaxFilter if maximum else ImageFilter.MinFilter
            self.assertEqual(square_alpha_extrema(image, 12, maximum).tobytes(),
                             image.filter(filter_type(25)).tobytes())
