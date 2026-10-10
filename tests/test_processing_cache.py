import os
import random
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from PIL import Image, ImageDraw, ImageFilter, ImageOps

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
import engine
from processing_cache import CACHE, ProcessingCache
from refine_edges import _erode, _refine_cutout, refine_cutout


class ProcessingCacheTests(unittest.TestCase):
    def setUp(self):
        CACHE.clear()

    def test_budget_lru_and_oversized_entries(self):
        cache = ProcessingCache(10)
        cache.put("a", "first", 4)
        cache.put("b", "second", 4)
        cache.get("a")
        cache.put("c", "third", 4)
        self.assertIsNone(cache.get("b"))
        self.assertEqual(cache.get("a"), "first")
        cache.put("large", "uncached", 11)
        self.assertIsNone(cache.get("large"))
        self.assertLessEqual(cache.bytes, 10)
        cache.clear()
        self.assertEqual(cache.bytes, 0)

    def test_working_images_are_cached_but_never_expose_mutable_cache_contents(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "input.png"
            Image.new("RGBA", (13, 9), "red").save(source)
            with patch.object(engine, "_render_image_with_strokes", wraps=engine._render_image_with_strokes) as render:
                first = engine.render_image_with_strokes(source)
                first.putpixel((0, 0), (0, 0, 0, 0))
                second = engine.render_image_with_strokes(source)
                self.assertEqual(second.getpixel((0, 0)), (255, 0, 0, 255))
                self.assertEqual(render.call_count, 1)
                stamp = source.stat().st_mtime_ns
                Image.new("RGBA", (13, 9), "blue").save(source)
                os.utime(source, ns=(stamp+1_000_000, stamp+1_000_000))
                self.assertEqual(engine.render_image_with_strokes(source).getpixel((0, 0)), (0, 0, 255, 255))
                self.assertEqual(render.call_count, 2)

    def test_fast_erosion_matches_repeated_pillow_passes_and_zero_borders(self):
        rng = random.Random(36)
        mask = Image.frombytes("L", (31, 23), bytes(rng.randrange(256) for _ in range(31*23)))
        for radius in [0, 1, 2, 16, 25, 60]:
            expected = ImageOps.expand(mask, border=radius, fill=0)
            for _ in range(radius):
                expected = expected.filter(ImageFilter.MinFilter(3))
            expected = expected.crop((radius, radius, radius+mask.width, radius+mask.height))
            self.assertEqual(_erode(mask, radius, lambda: None).tobytes(), expected.tobytes())

    def test_transparent_padding_optimization_matches_full_processing(self):
        image = Image.new("RGBA", (143, 107), (4, 244, 4, 0))
        draw = ImageDraw.Draw(image)
        draw.polygon([(49, 30), (88, 36), (85, 75), (53, 68), (62, 49)], fill=(25, 80, 160, 190))
        draw.ellipse((65, 39, 73, 49), fill=(0, 0, 0, 0))
        draw.rectangle((16, 18, 18, 20), fill=(205, 25, 55, 70))
        for width in [2, 16]:
            for strength in [25, 60, 100]:
                options = dict(clean=10, repair=strength, smooth=25, shrink=1, width=width)
                full = _refine_cutout(image, options)
                optimized = refine_cutout(image, options)
                self.assertEqual(optimized.tobytes(), full.tobytes())

    def test_sparse_color_shapes_keep_original_smoothing_coordinates(self):
        rng = random.Random(75)
        for _ in range(24):
            image = Image.new("RGBA", (127, 103), (5, 220, 8, 0))
            draw = ImageDraw.Draw(image)
            for _ in range(8):
                x, y = rng.randrange(35, 75), rng.randrange(30, 65)
                draw.ellipse((x, y, x+rng.randrange(2, 14), y+rng.randrange(2, 14)),
                             fill=tuple(rng.randrange(256) for _ in range(3))+(rng.randrange(1, 256),))
            options = dict(clean=rng.randrange(100), repair=rng.randrange(100), smooth=rng.randrange(100),
                           shrink=rng.randrange(4), width=rng.randrange(1, 17))
            self.assertEqual(refine_cutout(image, options).tobytes(), _refine_cutout(image, options).tobytes())
