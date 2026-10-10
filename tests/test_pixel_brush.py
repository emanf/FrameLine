import sys
import tempfile
import unittest
from pathlib import Path
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
import engine
from pixel_brush import circle_stamp_spans


class PixelRoundBrushTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source = self.root / "blank.png"
        Image.new("RGBA", (20, 20)).save(self.source)
        self.stroke = {"tool": "brush", "shape": "round", "feather": 0, "size": 5,
                       "color": "#0000ff", "opacity": 1, "points": [[.51, .51]]}

    def test_hard_round_stamp_is_binary_and_symmetric_at_odd_and_even_sizes(self):
        for size in (1, 3, 4, 5, 6, 8):
            with self.subTest(size=size):
                painted = engine.render_image_with_strokes(self.source, [{**self.stroke, "size": size}])
                alpha = painted.getchannel("A")
                self.assertEqual(set(alpha.getdata()), {0, 255})
                self.assertEqual(alpha.getbbox(), (10 - size // 2, 10 - size // 2, 10 - size // 2 + size, 10 - size // 2 + size))
                stamp = alpha.crop(alpha.getbbox())
                self.assertEqual(stamp.tobytes(), stamp.transpose(Image.Transpose.FLIP_LEFT_RIGHT).tobytes())
                self.assertEqual(stamp.tobytes(), stamp.transpose(Image.Transpose.FLIP_TOP_BOTTOM).tobytes())
        self.assertEqual(circle_stamp_spans(3), [(0, 1, 2), (1, 0, 3), (2, 1, 2)])
        huge = engine.render_image_with_strokes(self.source, [{**self.stroke,"size":1e100,"points":[[0,0]]}])
        self.assertEqual(set(huge.getchannel("A").getdata()), {255})

    def test_snap_and_overlapping_stamps_preserve_uniform_stroke_opacity(self):
        dot = engine.render_image_with_strokes(self.source, [self.stroke])
        shifted = engine.render_image_with_strokes(self.source, [{**self.stroke, "points": [[.54, .54]]}])
        self.assertEqual(dot.tobytes(), shifted.tobytes())
        for opacity, expected in ((.5, 128), (.3, 77)):
            stroke = {**self.stroke, "opacity": opacity, "points": [[.2,.2],[.6,.6],[.2,.2]]}
            result = engine.render_image_with_strokes(self.source, [stroke])
            self.assertEqual(set(result.getchannel("A").getdata()), {0, expected})

    def test_round_eraser_and_cleanup_use_the_same_binary_circle(self):
        filled = self.root / "filled.png"
        Image.new("RGBA", (20,20), (3,170,3,255)).save(filled)
        erased = engine.render_image_with_strokes(filled, [{**self.stroke,"tool":"eraser"}])
        self.assertEqual(set(erased.getchannel("A").getdata()), {0,255})
        healed = engine.render_image_with_strokes(filled, [{**self.stroke,"tool":"healing","color":"#000000","backgroundColor":"#04f404","tolerance":2}])
        self.assertEqual(set(healed.getchannel("A").getdata()), {77,255})
        self.assertEqual(healed.getpixel((10,10)), (0,0,0,77))

    def test_hard_circle_exports_keep_binary_edges_and_feathered_circle_stays_soft(self):
        painted = engine.render_image_with_strokes(self.source, [self.stroke])
        for mode in ("sources", "frames"):
            directory = self.root / mode
            entry = {"path": str(self.source), "paint_strokes": [self.stroke], "duration_frames": 1}
            engine.export_images({"mode": mode,"output":str(directory),"images":[entry],"clips":[entry]})
            with Image.open(next(directory.glob("*.png"))) as exported:
                self.assertEqual(exported.convert("RGBA").tobytes(), painted.tobytes())
        soft = engine.render_image_with_strokes(self.source, [{**self.stroke, "feather": 20}])
        self.assertTrue(any(0 < alpha < 255 for alpha in soft.getchannel("A").getdata()))
