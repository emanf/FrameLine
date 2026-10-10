import json
import sys
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path
import os
from PIL import ImageChops

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
import engine

PACKAGED_FFMPEG = (
    Path(__file__).resolve().parents[1]
    / "node_modules"
    / "ffmpeg-static"
    / ("ffmpeg.exe" if os.name == "nt" else "ffmpeg")
)


class ImageEngineTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.red = self.root / "red.png"
        self.blue = self.root / "blue.png"
        Image.new("RGB", (12, 8), "red").save(self.red)
        Image.new("RGB", (12, 8), "blue").save(self.blue)
        self.clips = [
            {"path": str(self.red), "image_id": "red", "duration_frames": 24},
            {"path": str(self.blue), "image_id": "blue", "duration_frames": 48},
        ]
        self.ffmpeg = Path(os.environ.get("FRAMELINE_FFMPEG_PATH", PACKAGED_FFMPEG))
        self.ffprobe = Path(os.environ.get(
            "FRAMELINE_FFPROBE_PATH",
            Path(__file__).resolve().parents[1] / "node_modules" / "ffprobe-static" / "bin" /
            ("win32" if os.name == "nt" else "linux") / ("x64" if sys.maxsize > 2**32 else "ia32") /
            ("ffprobe.exe" if os.name == "nt" else "ffprobe"),
        ))

    def tearDown(self):
        self.temporary.cleanup()

    def test_background_removal_supports_chroma_sample_regions_and_originals(self):
        source = self.root / "screen.png"
        image = Image.new("RGB", (5, 1))
        for x, color in enumerate(((0, 255, 0), (0, 255, 0), (255, 0, 0), (0, 255, 0), (0, 255, 0))):
            image.putpixel((x, 0), color)
        image.save(source)

        chroma_output = self.root / "chroma.png"
        result = engine.remove_background({
            "path": str(source), "output": str(chroma_output), "mode": "chroma",
            "key_color": [0, 255, 0], "tolerance": 0, "softness": 0, "spill": 0,
        })
        self.assertEqual((result["width"], result["height"]), (5, 1))
        with Image.open(chroma_output) as output:
            self.assertEqual([output.getpixel((x, 0))[3] for x in range(5)], [0, 0, 255, 0, 0])

        sampled_output = self.root / "sampled.png"
        engine.remove_background({
            "path": str(source), "output": str(sampled_output), "mode": "sample",
            "sample_point": [0, 0], "tolerance": 0, "softness": 0, "connected_only": True,
        })
        with Image.open(sampled_output) as output:
            self.assertEqual([output.getpixel((x, 0))[3] for x in range(5)], [0, 0, 255, 255, 255])

        global_output = self.root / "sampled-global.png"
        engine.remove_background({
            "path": str(source), "output": str(global_output), "mode": "sample",
            "sample_point": [0, 0], "tolerance": 0, "softness": 0, "connected_only": False,
        })
        with Image.open(global_output) as output:
            self.assertEqual([output.getpixel((x, 0))[3] for x in range(5)], [0, 0, 255, 0, 0])
        self.assertTrue(source.is_file())

    def test_edge_softness_preserves_opaque_subject_interior(self):
        source = self.root / "soft-edge.png"
        image = Image.new("RGB", (15, 15), (0, 255, 0))
        for x in range(3, 12):
            for y in range(3, 12):
                image.putpixel((x, y), (0, 195, 0))
        image.save(source)
        output_path = self.root / "soft-edge-output.png"
        engine.remove_background({
            "path": str(source), "output": str(output_path), "mode": "chroma",
            "key_color": [0, 255, 0], "tolerance": 55, "softness": 35, "spill": 0,
        })
        with Image.open(output_path) as output:
            alpha = output.getchannel("A")
            self.assertEqual(alpha.getpixel((0, 0)), 0)
            self.assertGreaterEqual(alpha.getpixel((7, 7)), 250)
            self.assertGreater(alpha.getpixel((3, 7)), 0)
            self.assertLess(alpha.getpixel((3, 7)), 255)

    def test_edge_antialiasing_keeps_sharp_points_without_blur_or_key_color_fringe(self):
        source = self.root / "sharp-point.png"
        image = Image.new("RGBA", (64, 64), (0, 255, 0, 255))
        subject = (235, 80, 40, 255)
        ImageDraw.Draw(image).polygon([(8, 8), (55, 32), (8, 56), (22, 32)], fill=subject)
        image.save(source)
        for mode, connected in (("chroma", True), ("sample", True), ("sample", False)):
            with self.subTest(mode=mode, connected=connected):
                options = {
                    "path": str(source), "mode": mode, "key_color": [0, 255, 0],
                    "sample_point": [0, 0], "connected_only": connected,
                    "tolerance": 0, "softness": 0, "spill": 0,
                }
                raw_path, smooth_path = self.root / "raw.png", self.root / "smooth.png"
                engine.remove_background({**options, "output": str(raw_path)})
                engine.remove_background({**options, "output": str(smooth_path), "edge_smoothing": 75})
                with Image.open(raw_path) as raw, Image.open(smooth_path) as smooth:
                    self.assertEqual(smooth.size, image.size)
                    self.assertEqual(smooth.getchannel("A").getbbox(), raw.getchannel("A").getbbox())
                    self.assertEqual(smooth.getpixel((55, 32)), subject, "sharp tip stays opaque")
                    self.assertEqual(smooth.getpixel((35, 32)), subject, "interior stays unchanged")
                    pixels = list(smooth.getdata())
                    partial = sum(0 < pixel[3] < 255 for pixel in pixels)
                    self.assertGreater(partial, 50, "diagonal edges receive coverage anti-aliasing")
                    self.assertLess(partial, 200, "coverage stays close to the boundary without a blur halo")
                    self.assertTrue(all(pixel[:3] == subject[:3] for pixel in pixels if pixel[3]),
                                    "new edge pixels use subject colors instead of the green screen")
        with Image.open(source) as original:
            self.assertEqual(original.tobytes(), image.tobytes(), "original file is preserved")

    def test_fringe_cleanup_replaces_green_with_local_color_preserving_alpha_and_original(self):
        source = self.root / "green-fringe.png"
        image = Image.new("RGBA", (21, 17), (0, 255, 0, 255))
        image.paste((40, 190, 40, 128), (5, 4, 16, 13))
        image.paste((220, 40, 30, 255), (6, 5, 15, 12))
        image.save(source)
        for mode, connected in (("chroma", True), ("sample", True), ("sample", False)):
            for softness in (0, 35):
                with self.subTest(mode=mode, connected=connected, softness=softness):
                    options = {"path": str(source), "mode": mode, "sample_point": [0, 0],
                               "key_color": [0, 255, 0], "connected_only": connected,
                               "tolerance": 0, "softness": softness, "spill": 100}
                    raw_path, clean_path = self.root / "raw-fringe.png", self.root / "clean-fringe.png"
                    engine.remove_background({**options, "output": str(raw_path)})
                    engine.remove_background({**options, "output": str(clean_path), "fringe_cleanup": {}})
                    with Image.open(raw_path) as raw, Image.open(clean_path) as cleaned:
                        self.assertEqual(raw.getchannel("A").tobytes(), cleaned.getchannel("A").tobytes())
                        self.assertEqual(cleaned.getpixel((5, 8))[:3], (220, 40, 30))
                        self.assertEqual(cleaned.getpixel((10, 8)), (220, 40, 30, 255))
                        if not softness:
                            self.assertEqual(cleaned.getpixel((5, 8))[3], 128, "50% opacity is not applied twice in connected sampling")
                        self.assertEqual(cleaned.getpixel((0, 0))[3], 0)
        with Image.open(source) as original:
            self.assertEqual(original.tobytes(), image.tobytes())

    def test_fringe_cleanup_strength_and_opacity_range(self):
        source = self.root / "opacity-fringe.png"
        image = Image.new("RGBA", (20, 20), (0, 255, 0, 255))
        image.paste((40, 190, 40, 128), (4, 4, 16, 16))
        image.paste((220, 40, 30, 255), (5, 5, 15, 15))
        image.putpixel((4, 7), (40, 190, 40, 64))
        image.putpixel((4, 11), (40, 190, 40, 192))
        image.save(source)
        options = {"path": str(source), "mode": "chroma", "key_color": [0, 255, 0],
                   "tolerance": 0, "softness": 0, "spill": 0}
        for strength, color in ((0, (40, 190, 40)), (50, (130, 115, 35)), (100, (220, 40, 30))):
            with self.subTest(strength=strength):
                output = self.root / "strength.png"
                engine.remove_background({**options, "output": str(output), "fringe_cleanup": {"strength": strength, "max_opacity": 50}})
                with Image.open(output) as result:
                    self.assertEqual(result.getpixel((4, 9)), (*color, 128))
                    self.assertEqual(result.getpixel((4, 11)), (40, 190, 40, 192), "higher opacity is outside the selected range")
        output = self.root / "minimum-opacity.png"
        engine.remove_background({**options, "output": str(output), "fringe_cleanup": {"min_opacity": 50}})
        with Image.open(output) as result:
            self.assertEqual(result.getpixel((4, 7)), (40, 190, 40, 64))
            self.assertEqual(result.getpixel((4, 9)), (220, 40, 30, 128))
            self.assertEqual(result.getpixel((4, 11)), (220, 40, 30, 192))

    def test_fringe_cleanup_retains_exact_key_color_at_half_opacity_when_clean_sample_exists(self):
        source = self.root / "exact-green-fringe.png"
        for background_alpha in (0, 255):
            for mode in ("chroma", "sample"):
                for strength, expected in ((50, (110, 148, 15)), (100, (220, 40, 30))):
                    with self.subTest(background_alpha=background_alpha, mode=mode, strength=strength):
                        image = Image.new("RGBA", (21, 17), (0, 255, 0, background_alpha))
                        image.paste((0, 255, 0, 128), (5, 4, 16, 13))
                        image.paste((220, 40, 30, 255), (6, 5, 15, 12))
                        image.save(source)
                        output = self.root / "exact-green-clean.png"
                        engine.remove_background({"path": str(source), "output": str(output), "mode": mode,
                                                  "sample_point": [0, 0], "key_color": [0, 255, 0],
                                                  "tolerance": 0, "softness": 0, "spill": 100,
                                                  "fringe_cleanup": {"strength": strength, "tolerance": 200}})
                        with Image.open(output) as result:
                            self.assertEqual(result.getpixel((5, 8)), (*expected, 128), "replace RGB once without discarding 50% opacity")
                            self.assertEqual(result.getpixel((0, 0))[3], 0, "opaque key background is still removed")

    def test_fringe_cleanup_custom_color_and_tolerance(self):
        source = self.root / "blue-fringe.png"
        image = Image.new("RGBA", (15, 15), (0, 255, 0, 255))
        image.paste((20, 80, 190, 128), (3, 3, 12, 12))
        image.paste((230, 50, 30, 255), (4, 4, 11, 11))
        image.save(source)
        for cleanup, expected in (({}, (20, 80, 190)),
                                  ({"color": [0, 0, 255], "tolerance": 79}, (20, 80, 190)),
                                  ({"color": [0, 0, 255], "tolerance": 80}, (230, 50, 30))):
            with self.subTest(cleanup=cleanup):
                output = self.root / "custom-cleanup.png"
                engine.remove_background({"path": str(source), "output": str(output), "mode": "chroma",
                                          "key_color": [0, 255, 0], "tolerance": 0, "softness": 0,
                                          "spill": 0, "fringe_cleanup": cleanup})
                with Image.open(output) as result:
                    self.assertEqual(result.getpixel((3, 7)), (*expected, 128))

    def test_fringe_cleanup_keeps_different_local_colors_and_does_not_cross_transparent_gaps(self):
        source = self.root / "two-colors.png"
        image = Image.new("RGBA", (30, 15), (0, 255, 0, 0))
        image.paste((40, 190, 40, 128), (3, 3, 12, 12))
        image.paste((230, 40, 30, 255), (4, 4, 11, 11))
        image.paste((40, 190, 40, 128), (18, 3, 27, 12))
        image.paste((30, 40, 230, 255), (19, 4, 26, 11))
        image.putpixel((14, 7), (40, 190, 40, 128))
        image.save(source)
        output = self.root / "local-cleanup.png"
        engine.remove_background({"path": str(source), "output": str(output), "mode": "chroma",
                                  "key_color": [0, 255, 0], "tolerance": 0, "softness": 0,
                                  "spill": 0, "fringe_cleanup": {}})
        with Image.open(output) as result:
            self.assertEqual(result.getpixel((3, 7)), (230, 40, 30, 128))
            self.assertEqual(result.getpixel((26, 7)), (30, 40, 230, 128))
            self.assertEqual(result.getpixel((14, 7)), (40, 190, 40, 128), "an isolated fringe gets no unrelated color")

    def test_fringe_cleanup_limits_edge_width_and_sample_distance(self):
        source = self.root / "wide-fringe.png"
        image = Image.new("RGBA", (31, 31), (0, 255, 0, 0))
        image.paste((40, 190, 40, 255), (4, 4, 27, 27))
        image.paste((220, 40, 30, 255), (9, 9, 22, 22))
        image.save(source)
        for distance, color in ((2, (40, 190, 40)), (10, (220, 40, 30))):
            with self.subTest(distance=distance):
                output = self.root / "distance.png"
                engine.remove_background({"path": str(source), "output": str(output), "mode": "chroma",
                                          "key_color": [0, 255, 0], "tolerance": 0, "softness": 0,
                                          "spill": 0, "fringe_cleanup": {"width": 2, "sample_distance": distance}})
                with Image.open(output) as result:
                    self.assertEqual(result.getpixel((4, 15))[:3], color)
                    self.assertEqual(result.getpixel((7, 15)), (40, 190, 40, 255), "pixels beyond the edit band remain unchanged")

    def test_fringe_cleanup_and_antialiasing_share_shape_without_changing_alpha(self):
        source = self.root / "smooth-fringe.png"
        image = Image.new("RGBA", (64, 64), (0, 255, 0, 255))
        draw = ImageDraw.Draw(image)
        draw.polygon([(8, 8), (55, 32), (8, 56), (22, 32)], fill=(40, 190, 40, 128))
        draw.polygon([(12, 14), (48, 32), (12, 50), (25, 32)], fill=(220, 40, 30, 255))
        image.save(source)
        results = []
        for cleanup in (None, {}):
            output = self.root / f"smooth-fringe-{len(results)}.png"
            engine.remove_background({"path": str(source), "output": str(output), "mode": "chroma",
                                      "key_color": [0, 255, 0], "tolerance": 0, "softness": 0,
                                      "spill": 0, "edge_smoothing": 75, "fringe_cleanup": cleanup})
            with Image.open(output) as result:
                results.append(result.copy())
        self.assertEqual(results[0].getchannel("A").tobytes(), results[1].getchannel("A").tobytes())
        self.assertEqual(results[0].getpixel((55, 32)), (40, 190, 40, 128))
        self.assertEqual(results[1].getpixel((55, 32)), (220, 40, 30, 128))

    def test_fringe_cleanup_rejects_invalid_settings_before_writing(self):
        output = self.root / "invalid-fringe.png"
        invalid_options = [False, [], "on", {"min_opacity": 90, "max_opacity": 50},
                           {"color": "green"}, {"color": [0, 256, 0]}, {"color": [True, 0, 0]}]
        for field, bad in (("width", 0), ("width", 33), ("sample_distance", 65),
                           ("strength", 101), ("min_opacity", -1), ("max_opacity", 101),
                           ("tolerance", 256), ("tolerance", True), ("strength", 50.5)):
            invalid_options.append({field: bad})
        for cleanup in invalid_options:
            with self.subTest(cleanup=cleanup), self.assertRaisesRegex(ValueError, "Color fringe"):
                engine.remove_background({"path": str(self.red), "output": str(output), "mode": "chroma",
                                          "key_color": [0, 255, 0], "fringe_cleanup": cleanup})
        self.assertFalse(output.exists())

    def test_edge_antialiasing_preserves_holes_tiny_islands_and_diagonal_contacts(self):
        source = self.root / "details.png"
        image = Image.new("RGBA", (32, 32), (0, 255, 0, 255))
        draw = ImageDraw.Draw(image)
        draw.rectangle((4, 4, 27, 27), fill="red")
        draw.rectangle((10, 10, 21, 21), fill=(0, 255, 0, 255))
        image.putpixel((15, 15), (255, 0, 0, 255))  # Island nested in a hole.
        image.putpixel((6, 6), (0, 255, 0, 255))  # One-pixel hole.
        image.putpixel((1, 1), (255, 0, 0, 255))
        image.putpixel((2, 2), (255, 0, 0, 255))  # Diagonally touching islands.
        image.save(source)
        for connected in (False, True):
            with self.subTest(connected=connected):
                output = self.root / "details-output.png"
                engine.remove_background({
                    "path": str(source), "output": str(output), "mode": "sample",
                    "sample_point": [0, 0], "tolerance": 0, "softness": 0,
                    "edge_smoothing": 100, "connected_only": connected, "spill": 0,
                })
                with Image.open(output) as result:
                    for point in ((1, 1), (2, 2), (15, 15), (4, 4), (27, 27)):
                        self.assertEqual(result.getpixel(point)[3], 255)
                    self.assertEqual(result.getpixel((0, 0))[3], 0)
                    self.assertEqual(result.getpixel((1, 2))[3], 0)
                    for point in ((6, 6), (10, 10), (21, 21)):
                        self.assertEqual(result.getpixel(point)[3], 255 if connected else 0,
                                         "connected sampling protects enclosed matching colors")

    def test_edge_antialiasing_preserves_subject_opacity(self):
        source = self.root / "translucent.png"
        image = Image.new("RGBA", (64, 64), (0, 255, 0, 0))
        ImageDraw.Draw(image).polygon([(8, 8), (55, 32), (8, 56), (22, 32)], fill=(235, 80, 40, 128))
        image.save(source)
        for mode, connected in (("chroma", True), ("sample", True), ("sample", False)):
            with self.subTest(mode=mode, connected=connected):
                output = self.root / "translucent-output.png"
                engine.remove_background({
                    "path": str(source), "output": str(output), "mode": mode,
                    "key_color": [0, 255, 0], "sample_point": [0, 0], "connected_only": connected,
                    "tolerance": 0, "softness": 0, "spill": 0, "edge_smoothing": 75,
                })
                with Image.open(output) as result:
                    self.assertEqual(result.getpixel((35, 32)), (235, 80, 40, 128))
                    alpha = result.getchannel("A")
                    self.assertEqual(alpha.getextrema()[1], 128)
                    self.assertTrue(any(0 < value < 128 for value in alpha.getdata()))

    def test_edge_antialiasing_preserves_empty_full_and_single_row_masks(self):
        for size, colors in (((5, 1), ["lime", "red", "lime", "red", "lime"]),
                             ((1, 5), ["lime", "red", "lime", "red", "lime"]),
                             ((12, 8), ["red"] * 96), ((12, 8), ["lime"] * 96)):
            with self.subTest(size=size, color=colors[0]):
                source = self.root / "axis-aligned.png"
                image = Image.new("RGB", size)
                image.putdata([Image.new("RGB", (1, 1), color).getpixel((0, 0)) for color in colors])
                image.save(source)
                outputs = []
                for amount in (0, 100):
                    output = self.root / f"aligned-{amount}.png"
                    engine.remove_background({
                        "path": str(source), "output": str(output), "mode": "chroma",
                        "key_color": [0, 255, 0], "tolerance": 0, "softness": 0,
                        "spill": 0, "edge_smoothing": amount,
                    })
                    with Image.open(output) as result:
                        outputs.append(result.tobytes())
                self.assertEqual(*outputs)

    def test_edge_antialiasing_ignores_blur_and_validates_strength(self):
        source = self.root / "settings.png"
        image = Image.new("RGB", (64, 64), "lime")
        ImageDraw.Draw(image).polygon([(8, 8), (55, 32), (8, 56)], fill="red")
        image.save(source)
        options = {"path": str(source), "mode": "sample", "sample_point": [0, 0],
                   "tolerance": 0, "spill": 0, "edge_smoothing": 75}
        outputs = []
        for softness in (0, 255):
            output = self.root / f"settings-{softness}.png"
            engine.remove_background({**options, "output": str(output), "softness": softness})
            with Image.open(output) as result:
                outputs.append(result.tobytes())
        self.assertEqual(*outputs)
        rejected = self.root / "invalid.png"
        for amount in (True, -1, 101, float("nan"), float("inf"), "75", None):
            with self.subTest(amount=amount), self.assertRaisesRegex(ValueError, "Edge smoothing"):
                engine.remove_background({**options, "output": str(rejected), "edge_smoothing": amount})
        self.assertFalse(rejected.exists())

    def test_edge_antialiasing_has_no_seams_between_raster_strips(self):
        source = self.root / "repeated.png"
        image = Image.new("RGB", (64, 320), "lime")
        draw = ImageDraw.Draw(image)
        for offset in (32, 96, 160, 224):
            draw.polygon([(8, 8 + offset), (55, 32 + offset), (8, 56 + offset), (22, 32 + offset)], fill="red")
        image.save(source)
        output = self.root / "repeated-output.png"
        engine.remove_background({
            "path": str(source), "output": str(output), "mode": "chroma",
            "key_color": [0, 255, 0], "tolerance": 0, "softness": 0, "spill": 0,
            "edge_smoothing": 75,
        })
        with Image.open(output) as result:
            first = result.crop((0, 32, 64, 96)).tobytes()
            for offset in (96, 160, 224):
                self.assertEqual(first, result.crop((0, offset, 64, offset + 64)).tobytes())

    def test_paint_strokes_render_and_eraser_removes_prior_paint(self):
        brush_stroke = {
            "tool": "brush", "color": "#0000ff", "opacity": 1, "size": 3,
            "points": [[0.5, 0.5]],
        }
        painted = engine.render_image_with_strokes(self.red, [brush_stroke])
        self.assertEqual(painted.getpixel((6, 4)), (0, 0, 255, 255))
        erased = engine.render_image_with_strokes(self.red, [
            brush_stroke,
            {
                "tool": "eraser", "color": "#000000", "opacity": 1, "size": 3,
                "points": [[0.5, 0.5]],
            },
        ])
        self.assertEqual(erased.getpixel((6, 4))[3], 0)
        self.assertEqual(erased.getpixel((0, 4)), (255, 0, 0, 255))

    def test_healing_brush_recovers_user_mixture_inside_brush_only(self):
        source = self.root / "healing-mixture.png"
        image = Image.new("RGBA", (7, 1))
        pixels = [(3, 170, 3, 255), (4, 244, 4, 255), (0, 0, 0, 101),
                  (3, 170, 3, 255), (0, 0, 255, 255), (3, 170, 3, 128), (3, 170, 3, 255)]
        image.putdata(pixels)
        image.save(source)
        stroke = {"tool": "healing", "color": "#000000", "backgroundColor": "#04f404",
                  "tolerance": 2, "opacity": 1, "size": 5, "shape": "square", "points": [[.5, .5]]}
        result = engine.render_image_with_strokes(source, [stroke])
        self.assertEqual(list(result.getdata()), [(3, 170, 3, 255), (0, 0, 0, 0), (0, 0, 0, 101),
                                                (0, 0, 0, 77), (0, 0, 255, 255), (0, 0, 0, 39), (3, 170, 3, 255)])
        repeated = engine.render_image_with_strokes(source, [stroke, stroke])
        self.assertEqual(result.tobytes(), repeated.tobytes(), "full healing does not compound alpha")
        with Image.open(source) as original:
            self.assertEqual(list(original.getdata()), pixels)

    def test_healing_brush_arbitrary_colors_and_partial_coverage(self):
        from healing_brush import heal_image
        stroke = {"tool": "healing", "color": "#f01e50", "backgroundColor": "#0ae628",
                  "tolerance": 0, "opacity": 1}
        result = heal_image(Image.new("RGBA", (1, 1), (102, 150, 56, 255)), Image.new("L", (1, 1), 255), stroke)
        self.assertEqual(result.getpixel((0, 0)), (240, 30, 80, 102))
        stroke.update(color="#000000", backgroundColor="#00ff00")
        result = heal_image(Image.new("RGBA", (1, 1), (0, 170, 0, 255)), Image.new("L", (1, 1), 128), stroke)
        self.assertEqual(result.getpixel((0, 0)), (0, 127, 0, 170), "feather uses premultiplied interpolation")
        stroke["opacity"] = .5
        result = heal_image(Image.new("RGBA", (1, 1), (0, 170, 0, 255)), Image.new("L", (1, 1), 255), stroke)
        self.assertEqual(result.getpixel((0, 0)), (0, 128, 0, 170))

    def test_healing_brush_rejects_invalid_mixture_settings(self):
        stroke = {"tool": "healing", "color": "#000000", "backgroundColor": "#04f404",
                  "tolerance": 24, "opacity": 1, "size": 3, "points": [[.5, .5]]}
        for invalid in ({"backgroundColor": "#000000"}, {"backgroundColor": "green"},
                        {"backgroundColor": None}, {"tolerance": -1}, {"tolerance": 256},
                        {"tolerance": True}, {"tolerance": 24.5}):
            with self.subTest(invalid=invalid), self.assertRaisesRegex(ValueError, "Color Cleanup"):
                engine.render_image_with_strokes(self.red, [{**stroke, **invalid}])

    def test_source_and_frame_exports_include_healing_transparency(self):
        source = self.root / "heal-export.png"
        Image.new("RGBA", (5, 5), (3, 170, 3, 255)).save(source)
        stroke = {"tool": "healing", "color": "#000000", "backgroundColor": "#04f404",
                  "tolerance": 2, "opacity": 1, "size": 3, "shape": "square", "points": [[.5, .5]]}
        sources, frames = self.root / "healed-sources", self.root / "healed-frames"
        engine.export_images({"images": [{"path": str(source), "paint_strokes": [stroke]}], "output": str(sources), "mode": "sources"})
        engine.export_images({"clips": [{"path": str(source), "paint_strokes": [stroke], "duration_frames": 1}], "output": str(frames), "mode": "frames"})
        for folder in (sources, frames):
            files = list(folder.glob("*.png"))
            self.assertEqual(len(files), 1)
            with Image.open(files[0]) as result:
                self.assertEqual(result.getpixel((2, 2)), (0, 0, 0, 77))
                self.assertEqual(result.getpixel((0, 0)), (3, 170, 3, 255))

    def test_feathered_round_paint_exports_retain_smooth_edges_and_fractional_positions(self):
        source = self.root / "transparent-paint.png"
        Image.new("RGBA", (32, 32), (0, 0, 0, 0)).save(source)
        stroke = {
            "tool": "brush", "color": "#0000ff", "opacity": 1, "size": 3,
            "feather": 1,
            "points": [[0.23, 0.25], [0.4, 0.42], [0.63, 0.32]],
        }
        painted = engine.render_image_with_strokes(source, [stroke])
        alpha = painted.getchannel("A")
        self.assertTrue(any(0 < value < 255 for value in alpha.getdata()))
        self.assertEqual(painted.getpixel((8, 8)), (0, 0, 255, 255))
        shifted = engine.render_image_with_strokes(source, [{
            **stroke, "points": [[x + 0.25 / 32, y] for x, y in stroke["points"]],
        }])
        self.assertIsNotNone(ImageChops.difference(alpha, shifted.getchannel("A")).getbbox())
        exports = self.root / "smooth-sources"
        engine.export_images({"mode": "sources", "output": str(exports), "images": [
            {"path": str(source), "paint_strokes": [stroke]},
        ]})
        with Image.open(exports / "0001_transparent-paint.png") as exported:
            self.assertIsNone(ImageChops.difference(painted, exported).getbbox())

    def test_square_paint_and_feathered_edges_render(self):
        square = engine.render_image_with_strokes(self.red, [{
            "tool": "brush", "color": "#0000ff", "opacity": 1, "size": 4,
            "shape": "square", "points": [[0.5, 0.5]],
        }])
        self.assertEqual(square.getpixel((6, 4)), (0, 0, 255, 255))
        self.assertEqual(square.getpixel((3, 4)), (255, 0, 0, 255))

        feathered = engine.render_image_with_strokes(self.red, [{
            "tool": "brush", "color": "#0000ff", "opacity": 1, "size": 2,
            "feather": 100, "points": [[0.5, 0.5]],
        }])
        blue_channels = [feathered.getpixel((x, 4))[2] for x in range(12)]
        self.assertTrue(any(0 < blue < 255 for blue in blue_channels))

    def test_crop_keeps_exact_manual_pixel_bounds(self):
        image = Image.new("RGBA", (100, 100))
        image.putpixel((29, 17), (255, 0, 0, 255))
        crop = {"left": 29 / 100, "top": 17 / 100, "right": 55 / 100, "bottom": 55 / 100}
        cropped = engine.apply_image_crop(image, crop)
        self.assertEqual(cropped.size, (26, 38))
        self.assertEqual(cropped.getpixel((0, 0)), (255, 0, 0, 255))

    def test_crop_is_rendered_for_source_and_frame_exports(self):
        crop = {"left": 0.25, "top": 0.25, "right": 0.75, "bottom": 0.75}
        cropped = engine.render_image_with_strokes(self.red, crop=crop)
        self.assertEqual(cropped.size, (6, 4))
        with self.assertRaisesRegex(ValueError, "invalid crop bounds"):
            engine.render_image_with_strokes(self.red, crop={"left": 0.8, "top": 0, "right": 0.2, "bottom": 1})

        sources = self.root / "cropped-sources"
        engine.export_images({
            "mode": "sources", "output": str(sources),
            "images": [{"path": str(self.red), "crop": crop}],
        })
        with Image.open(sources / "0001_red.png") as source:
            self.assertEqual(source.size, (6, 4))

        frames = self.root / "cropped-frames"
        engine.export_images({
            "mode": "frames", "output": str(frames),
            "clips": [{"path": str(self.red), "duration_frames": 1, "crop": crop}],
        })
        with Image.open(frames / "frame_000001.png") as frame:
            self.assertEqual(frame.size, (6, 4))

    def test_outline_uses_image_alpha_and_supports_position_softness_and_opacity(self):
        source = self.root / "transparent-subject.png"
        subject = Image.new("RGBA", (9, 9), (0, 0, 0, 0))
        for x in range(3, 6):
            for y in range(3, 6):
                subject.putpixel((x, y), (255, 0, 0, 255))
        subject.save(source)

        outside = engine.render_image_with_strokes(source, outline={
            "size": 2, "position": "outside", "softness": 0,
            "opacity": 1, "color": "#00ff00",
        })
        self.assertEqual(outside.size, (13, 13))
        self.assertEqual(outside.getpixel((4, 6)), (0, 255, 0, 255))
        self.assertEqual(outside.getpixel((6, 6)), (255, 0, 0, 255))

        center = engine.render_image_with_strokes(source, outline={
            "size": 2, "position": "center", "softness": 0,
            "opacity": 1, "color": "#ffffff",
        })
        self.assertEqual(center.size, (11, 11))

        inside = engine.render_image_with_strokes(source, outline={
            "size": 1, "position": "inside", "softness": 1,
            "opacity": 0.5, "color": "#0000ff",
        })
        self.assertEqual(inside.size, (9, 9))
        self.assertGreater(inside.getpixel((3, 4))[3], 0)
        self.assertLess(inside.getpixel((3, 4))[0], 255)

        output = self.root / "outlined-sources"
        engine.export_images({
            "mode": "sources", "output": str(output),
            "images": [{
                "path": str(source),
                "outline": {"size": 2, "position": "outside", "color": "#00ff00", "opacity": 1},
            }],
        })
        with Image.open(output / "0001_transparent-subject.png") as exported:
            self.assertEqual(exported.size, (13, 13))

        with self.assertRaisesRegex(ValueError, "Outline position"):
            engine.render_image_with_strokes(source, outline={"size": 2, "position": "outside-ish"})

    def test_apply_outline_bakes_output_without_stacking_on_source(self):
        source = self.root / "outline-source.png"
        subject = Image.new("RGBA", (7, 7), (0, 0, 0, 0))
        for x in range(2, 5):
            for y in range(2, 5):
                subject.putpixel((x, y), (255, 0, 0, 255))
        subject.save(source)
        outline = {
            "size": 2, "position": "outside", "softness": 0,
            "opacity": 1, "color": "#00ff00",
        }
        first = self.root / "outlined-once.png"
        second = self.root / "outlined-again.png"
        engine.apply_outline({"path": str(source), "output": str(first), "outline": outline})
        engine.apply_outline({"path": str(source), "output": str(second), "outline": outline})
        with Image.open(first) as once, Image.open(second) as again:
            self.assertEqual(once.size, (11, 11))
            self.assertEqual(ImageChops.difference(once, again).getbbox(), None)
        with Image.open(source) as original:
            self.assertEqual(original.size, (7, 7))

    def test_unfeathered_one_pixel_square_brush_snaps_to_pixel_grid(self):
        painted = engine.render_image_with_strokes(self.red, [{
            "tool": "brush", "color": "#0000ff", "opacity": 1, "size": 1,
            "shape": "square", "feather": 0, "points": [[0.29, 0.31]],
        }])
        self.assertEqual(painted.getpixel((3, 2)), (0, 0, 255, 255))
        self.assertEqual(painted.getpixel((2, 2)), (255, 0, 0, 255))
        self.assertEqual(painted.getpixel((4, 2)), (255, 0, 0, 255))
        self.assertEqual(painted.getpixel((3, 1)), (255, 0, 0, 255))
        self.assertEqual(painted.getpixel((3, 3)), (255, 0, 0, 255))

    def test_source_and_frame_exports_include_paint_strokes(self):
        strokes = [{
            "tool": "brush", "color": "#0000ff", "opacity": 1, "size": 3,
            "points": [[0.5, 0.5]],
        }]
        sources = self.root / "painted-sources"
        engine.export_images({
            "mode": "sources", "output": str(sources),
            "images": [{"path": str(self.red), "paint_strokes": strokes}],
        })
        with Image.open(sources / "0001_red.png") as source:
            self.assertEqual(source.convert("RGBA").getpixel((6, 4)), (0, 0, 255, 255))

        frames = self.root / "painted-frames"
        engine.export_images({
            "mode": "frames", "output": str(frames),
            "clips": [{
                "path": str(self.red), "duration_frames": 1,
                "paint_strokes": strokes,
            }],
        })
        with Image.open(frames / "frame_000001.png") as frame:
            self.assertEqual(frame.convert("RGBA").getpixel((6, 4)), (0, 0, 255, 255))

    def test_full_spill_suppression_removes_key_color_from_soft_edges(self):
        source = self.root / "green-edge.png"
        image = Image.new("RGB", (15, 15), (0, 255, 0))
        for x in range(3, 12):
            for y in range(3, 12):
                image.putpixel((x, y), (0, 195, 0))
        image.save(source)
        output_path = self.root / "green-edge-output.png"
        engine.remove_background({
            "path": str(source), "output": str(output_path), "mode": "chroma",
            "key_color": [0, 255, 0], "tolerance": 55, "softness": 35, "spill": 100,
        })
        with Image.open(output_path) as output:
            alpha = output.getchannel("A")
            self.assertGreater(alpha.getpixel((3, 7)), 0)
            self.assertLess(alpha.getpixel((3, 7)), 255)
            self.assertEqual(output.getpixel((3, 7))[1], 0)
            self.assertEqual(alpha.getpixel((7, 7)), 255)
            self.assertEqual(output.getpixel((7, 7))[1], 195)

    def test_spill_suppression_can_tint_soft_edges_with_selected_color(self):
        source = self.root / "green-edge-color.png"
        image = Image.new("RGB", (15, 15), (0, 255, 0))
        for x in range(3, 12):
            for y in range(3, 12):
                image.putpixel((x, y), (0, 195, 0))
        image.save(source)
        output_path = self.root / "green-edge-blue.png"
        engine.remove_background({
            "path": str(source), "output": str(output_path), "mode": "chroma",
            "key_color": [0, 255, 0], "tolerance": 55, "softness": 35,
            "spill": 100, "spill_color": [0, 0, 255],
        })
        with Image.open(output_path) as output:
            pixel = output.getpixel((3, 7))
            self.assertGreater(pixel[2], 0)
            self.assertEqual(pixel[1], 0)
            self.assertGreater(pixel[3], 0)
            self.assertLess(pixel[3], 255)

        with self.assertRaisesRegex(ValueError, "Suppressed edge color"):
            engine.remove_background({
                "path": str(source), "output": str(output_path), "mode": "chroma",
                "key_color": [0, 255, 0], "spill_color": [0, 256, 0],
            })

    def test_soft_edge_tint_replaces_white_fringe_without_recoloring_subject_or_alpha(self):
        source = self.root / "white-background.png"
        image = Image.new("RGBA", (31, 31), "white")
        for x in range(10, 21):
            for y in range(10, 21):
                image.putpixel((x, y), (40, 60, 80, 255))
        image.putpixel((0, 0), (255, 255, 255, 0))
        image.save(source)
        for mode, connected in (("chroma", True), ("sample", True), ("sample", False)):
            for softness in (35, 255):
                with self.subTest(mode=mode, connected=connected, softness=softness):
                    options = {
                        "path": str(source), "mode": mode, "key_color": [255, 255, 255],
                        "sample_point": [1, 1], "connected_only": connected,
                        "tolerance": 0, "softness": softness, "spill": 0,
                    }
                    baseline_path = self.root / "white-fringe.png"
                    tinted_path = self.root / "tinted-fringe.png"
                    engine.remove_background({**options, "output": str(baseline_path)})
                    engine.remove_background({
                        **options, "output": str(tinted_path),
                        "edge_color": [10, 20, 200], "edge_tint": 100,
                    })
                    with Image.open(baseline_path) as baseline, Image.open(tinted_path) as tinted:
                        self.assertIsNone(ImageChops.difference(baseline.getchannel("A"), tinted.getchannel("A")).getbbox())
                        self.assertEqual(tinted.getpixel((15, 15))[:3], (40, 60, 80))
                        self.assertEqual(tinted.getpixel((10, 15))[:3], (40, 60, 80))
                        self.assertEqual(baseline.getpixel((9, 15))[:3], (255, 255, 255))
                        self.assertGreater(tinted.getpixel((9, 15))[3], 0)
                        self.assertEqual(tinted.getpixel((9, 15))[:3], (10, 20, 200))
                        self.assertEqual(tinted.getpixel((0, 0))[3], 0)
                    with Image.open(source) as original:
                        self.assertIsNone(ImageChops.difference(image, original).getbbox())

    def test_soft_edge_tint_strength_and_validation(self):
        source = self.root / "white-edge.png"
        image = Image.new("RGB", (15, 15), "white")
        image.paste((0, 0, 0), (3, 3, 12, 12))
        image.save(source)
        output = self.root / "tinted.png"
        options = {
            "path": str(source), "output": str(output), "mode": "chroma",
            "key_color": [255, 255, 255], "tolerance": 0, "softness": 35,
            "spill": 0, "edge_color": [0, 0, 255],
        }
        for strength, expected in ((0, (255, 255, 255)), (50, (127, 127, 255)), (100, (0, 0, 255))):
            engine.remove_background({**options, "edge_tint": strength})
            with Image.open(output) as tinted:
                self.assertEqual(tinted.getpixel((2, 7))[:3], expected)
        for invalid in ([0, 256, 0], [True, 0, 0], [0, 0], "#000000"):
            with self.assertRaisesRegex(ValueError, "Soft edge color"):
                engine.remove_background({**options, "edge_color": invalid})
        for invalid in (-1, 101, 0.5, True):
            with self.assertRaisesRegex(ValueError, "Edge tint"):
                engine.remove_background({**options, "edge_tint": invalid})

    def test_interval_extraction_fills_missing_end_samples_with_held_last_frame(self):
        first = self.root / "frame_000001.png"
        second = self.root / "frame_000002.png"
        Image.new("RGB", (4, 4), "red").save(first)
        Image.new("RGB", (4, 4), "blue").save(second)
        result = engine.normalize_sample_frames([first, second], 4)
        self.assertEqual([path.name for path in result], [
            "frame_000001.png", "frame_000002.png", "frame_000003.png", "frame_000004.png",
        ])
        with Image.open(result[1]) as original, Image.open(result[-1]) as held:
            self.assertEqual(original.convert("RGB").tobytes(), held.convert("RGB").tobytes())

    def test_inspect_and_gif_use_image_dimensions_and_frame_durations(self):
        inspected = engine.inspect_images([str(self.red)])
        self.assertEqual((inspected[0]["width"], inspected[0]["height"]), (12, 8))
        output = self.root / "result.gif"
        engine.export_gif({"output": str(output), "fps": 24, "clips": self.clips})
        with Image.open(output) as result:
            self.assertEqual(result.n_frames, 2)
            self.assertEqual(result.info["duration"], 1000)
            result.seek(1)
            self.assertEqual(result.info["duration"], 2000)
            self.assertEqual(result.info["loop"], 0)
        single_play = self.root / "single-play.gif"
        engine.export_gif({
            "output": str(single_play), "fps": 24, "loop_enabled": False, "clips": self.clips,
        })
        with Image.open(single_play) as result:
            self.assertNotIn("loop", result.info)
        faster = self.root / "faster.gif"
        engine.export_gif({
            "output": str(faster), "fps": 24, "playback_speed": 2, "clips": self.clips,
        })
        with Image.open(faster) as result:
            self.assertEqual(result.info["duration"], 500)
            result.seek(1)
            self.assertEqual(result.info["duration"], 1000)

    def test_source_and_frame_exports_follow_the_requested_mode(self):
        sources = self.root / "sources"
        source_result = engine.export_images({
            "mode": "sources",
            "output": str(sources),
            "images": [{"path": str(self.red)}, {"path": str(self.blue)}],
        })
        self.assertEqual(source_result["files"], 2)
        self.assertEqual(len(list(sources.glob("*.png"))), 2)

        frames = self.root / "frames"
        frame_result = engine.export_images({
            "mode": "frames",
            "output": str(frames),
            "clips": self.clips,
        })
        self.assertEqual(frame_result["files"], 72)
        self.assertEqual(len(list(frames.glob("*.png"))), 72)
        with self.assertRaisesRegex(ValueError, "whole numbers"):
            engine.export_images({
                "mode": "frames", "output": str(self.root / "invalid"),
                "clips": [{"path": str(self.red), "duration_frames": 1.5}],
            })

    def test_export_task_reports_progress_and_cancels_frame_export(self):
        cancel_file = self.root / "cancel-export"
        process = subprocess.Popen(
            [sys.executable, str(Path(engine.__file__).resolve()), "--task", str(cancel_file)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        request = {
            "command": "export_images",
            "mode": "frames",
            "output": str(self.root / "cancelled-frames"),
            "clips": [{"path": str(self.red), "duration_frames": 1000}],
        }
        process.stdin.write(json.dumps(request))
        process.stdin.close()
        try:
            first_progress = json.loads(process.stdout.readline())
            self.assertEqual(first_progress["type"], "progress")
            self.assertEqual(first_progress["current"], 1)
            cancel_file.write_text("cancel", encoding="utf-8")
            result = json.loads(process.stdout.readline())
            while result["type"] == "progress":
                result = json.loads(process.stdout.readline())
            self.assertEqual(result["type"], "cancelled")
            self.assertEqual(process.wait(timeout=10), 0)
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
            process.stdout.close()
            process.stderr.close()

    def test_gif_export_task_finishes_through_cancellable_encoder(self):
        cancel_file = self.root / "cancel-gif"
        output = self.root / "task-result.gif"
        process = subprocess.Popen(
            [sys.executable, str(Path(engine.__file__).resolve()), "--task", str(cancel_file)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        process.stdin.write(json.dumps({
            "command": "export_gif",
            "output": str(output),
            "fps": 24,
            "clips": self.clips,
        }))
        process.stdin.close()
        try:
            messages = [json.loads(line) for line in process.stdout]
            self.assertEqual(messages[-1]["type"], "result")
            self.assertTrue(output.is_file())
            self.assertEqual(process.wait(timeout=20), 0)
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
            process.stdout.close()
            process.stderr.close()

    @unittest.skipUnless(PACKAGED_FFMPEG.is_file(), "bundled FFmpeg is not installed")
    def test_video_export_task_reports_encoding_progress(self):
        cancel_file = self.root / "cancel-video"
        output = self.root / "task-video.mp4"
        process = subprocess.Popen(
            [sys.executable, str(Path(engine.__file__).resolve()), "--task", str(cancel_file)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        process.stdin.write(json.dumps({
            "command": "export_video",
            "output": str(output),
            "format": "mp4",
            "fps": 4,
            "ffmpeg_path": str(self.ffmpeg),
            "clips": [{"path": str(self.red), "duration_frames": 2}],
        }))
        process.stdin.close()
        try:
            messages = [json.loads(line) for line in process.stdout]
            self.assertEqual(messages[-1]["type"], "result")
            self.assertTrue(any(message.get("message") == "Encoding video…" for message in messages))
            self.assertTrue(output.is_file())
            self.assertEqual(process.wait(timeout=30), 0)
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
            process.stdout.close()
            process.stderr.close()

    def test_contact_sheet_supports_per_clip_and_per_frame_modes(self):
        clip_sheet = self.root / "clips.png"
        frame_sheet = self.root / "frames-sheet.png"
        self.assertEqual(engine.export_sheet({
            "output": str(clip_sheet), "mode": "clips", "clips": self.clips,
        })["images"], 2)
        self.assertEqual(engine.export_sheet({
            "output": str(frame_sheet), "mode": "frames", "clips": self.clips,
        })["images"], 72)
        with Image.open(clip_sheet) as image:
            self.assertTrue(image.width > 0 and image.height > 0)

    @unittest.skipUnless(
        PACKAGED_FFMPEG.is_file(),
        "bundled FFmpeg is not installed",
    )
    def test_video_import_extracts_project_rate_frames_and_video_export_encodes_timeline(self):
        os.environ["FRAMELINE_FFMPEG_PATH"] = str(self.ffmpeg)
        source_video = self.root / "source.mp4"
        engine.run_ffmpeg([
            str(self.ffmpeg), "-hide_banner", "-loglevel", "error", "-y",
            "-loop", "1", "-i", str(self.red), "-t", "0.5", "-r", "4",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", str(source_video),
        ])
        imported = engine.import_video({
            "path": str(source_video), "output": str(self.root / "extracted"), "fps": 4,
            "ffprobe_path": str(self.ffprobe),
        })
        self.assertEqual(imported["fps"], 4)
        self.assertEqual(len(imported["images"]), 2)
        self.assertEqual([frame["duration_frames"] for frame in imported["images"]], [1, 1])

        interval = engine.import_video({
            "path": str(source_video), "output": str(self.root / "interval"), "fps": 4,
            "mode": "interval", "interval_seconds": 0.25,
            "ffprobe_path": str(self.ffprobe),
        })
        self.assertEqual(len(interval["images"]), 2)
        self.assertEqual([frame["duration_frames"] for frame in interval["images"]], [1, 1])

        decimal_interval = engine.import_video({
            "path": str(source_video), "output": str(self.root / "decimal-interval"), "fps": 24,
            "mode": "interval", "interval_seconds": 0.1,
            "ffprobe_path": str(self.ffprobe),
        })
        self.assertEqual(len(decimal_interval["images"]), 5)
        self.assertEqual([frame["duration_frames"] for frame in decimal_interval["images"]], [2] * 5)
        for frame, timestamp in zip(decimal_interval["images"], (0, 0.1, 0.2, 0.3, 0.4)):
            self.assertAlmostEqual(frame["time_seconds"], timestamp)
            self.assertIn(f"{timestamp:.3f}s", frame["name"])
            self.assertAlmostEqual(frame["duration_seconds"], frame["duration_frames"] / 24)

        partial_interval = engine.import_video({
            "path": str(source_video), "output": str(self.root / "partial-interval"), "fps": 24,
            "mode": "interval", "interval_seconds": 0.3,
            "ffprobe_path": str(self.ffprobe),
        })
        self.assertEqual([frame["duration_frames"] for frame in partial_interval["images"]], [7, 7])

        for interval_value, expected_count in ((0.3, 2), (0.7, 1), (1.3, 1), (10.0, 1)):
            with self.subTest(interval=interval_value):
                sampled = engine.import_video({
                    "path": str(source_video),
                    "output": str(self.root / f"interval-{interval_value}"),
                    "fps": 24,
                    "mode": "interval",
                    "interval_seconds": interval_value,
                    "ffprobe_path": str(self.ffprobe),
                })
                self.assertEqual(len(sampled["images"]), expected_count)

        count = engine.import_video({
            "path": str(source_video), "output": str(self.root / "count"), "fps": 24,
            "mode": "count", "image_count": 3,
            "ffprobe_path": str(self.ffprobe),
        })
        self.assertEqual(len(count["images"]), 3)
        self.assertEqual([frame["duration_frames"] for frame in count["images"]], [4, 4, 4])
        for frame, timestamp in zip(count["images"], (0, 0.5 / 3, 1 / 3)):
            self.assertAlmostEqual(frame["time_seconds"], timestamp)

        short_timeline_count = engine.import_video({
            "path": str(source_video), "output": str(self.root / "short-timeline-count"), "fps": 4,
            "mode": "count", "image_count": 20,
            "ffprobe_path": str(self.ffprobe),
        })
        self.assertEqual(len(short_timeline_count["images"]), 20)
        self.assertEqual([frame["duration_frames"] for frame in short_timeline_count["images"]], [1] * 20)

        changing_video = self.root / "changing.mp4"
        engine.run_ffmpeg([
            str(self.ffmpeg), "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", "testsrc2=size=64x48:rate=24:duration=1",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", str(changing_video),
        ])
        short_video = self.root / "short.mp4"
        engine.run_ffmpeg([
            str(self.ffmpeg), "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", "testsrc2=size=64x48:rate=24:duration=0.1",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", str(short_video),
        ])
        short_interval = engine.import_video({
            "path": str(short_video), "output": str(self.root / "short-interval"), "fps": 24,
            "mode": "interval", "interval_seconds": 0.1,
            "ffprobe_path": str(self.ffprobe),
        })
        self.assertEqual(len(short_interval["images"]), 2)

        sampled_video = engine.import_video({
            "path": str(changing_video), "output": str(self.root / "sampled-changing"), "fps": 24,
            "mode": "interval", "interval_seconds": 0.1,
            "ffprobe_path": str(self.ffprobe),
        })
        self.assertEqual(len(sampled_video["images"]), 10)
        self.assertEqual([frame["duration_frames"] for frame in sampled_video["images"]], [2] * 10)
        self.assertEqual(sum(frame["duration_frames"] for frame in sampled_video["images"]), 20)
        with Image.open(sampled_video["images"][0]["path"]) as first_sample, Image.open(sampled_video["images"][5]["path"]) as later_sample:
            self.assertIsNotNone(ImageChops.difference(first_sample.convert("RGB"), later_sample.convert("RGB")).getbbox())
        with Image.open(sampled_video["images"][-2]["path"]) as penultimate_sample, Image.open(sampled_video["images"][-1]["path"]) as final_sample:
            self.assertIsNotNone(ImageChops.difference(penultimate_sample.convert("RGB"), final_sample.convert("RGB")).getbbox())

        for format_name in ("mp4", "mov", "webm", "avi", "mkv"):
            with self.subTest(format=format_name):
                output = self.root / f"timeline.{format_name}"
                result = engine.export_video({
                    "output": str(output), "fps": 4, "playback_speed": 2,
                    "clips": [
                        {"path": imported["images"][0]["path"], "duration_frames": 2},
                        {"path": str(self.blue), "duration_frames": 2},
                    ],
                })
                self.assertEqual(result["frames"], 4)
                self.assertEqual(result["fps"], 8)
                self.assertTrue(output.is_file())
                decoded = engine.run_ffmpeg([
                    str(self.ffmpeg), "-hide_banner", "-loglevel", "error", "-i", str(output),
                    "-map", "0:v:0", "-f", "framemd5", "-",
                ])
                frame_hashes = [line for line in decoded.stdout.splitlines() if line and not line.startswith("#")]
                self.assertEqual(len(frame_hashes), 4)


    def test_gif_quantization_preserves_duration_and_uses_one_canvas(self):
        for fps in (24, 60, 120, 240):
            with self.subTest(fps=fps):
                clips = [
                    {"path": str(self.red if index % 2 else self.blue), "duration_frames": 1}
                    for index in range(fps)
                ]
                output = self.root / f"timed-{fps}.gif"
                engine.export_gif({"output": str(output), "fps": fps, "clips": clips})
                with Image.open(output) as gif:
                    delays = []
                    for index in range(gif.n_frames):
                        gif.seek(index)
                        delays.append(gif.info.get("duration", 0))
                    self.assertEqual(sum(delays), 1000)
                    self.assertTrue(all(delay >= 10 for delay in delays))

        large = self.root / "large.png"
        Image.new("RGBA", (24, 16), "green").save(large)
        output = self.root / "mixed.gif"
        # Exercise the separate cancellable GIF worker as well.
        previous = engine.TASK_CANCEL_FILE
        engine.TASK_CANCEL_FILE = str(self.root / "not-cancelled")
        try:
            engine.export_gif({"output": str(output), "fps": 60, "clips": [
                {"path": str(self.red), "duration_frames": 1},
                {"path": str(large), "duration_frames": 59},
            ]})
        finally:
            engine.TASK_CANCEL_FILE = previous
        with Image.open(output) as gif:
            duration = 0
            for index in range(gif.n_frames):
                gif.seek(index)
                self.assertEqual(gif.size, (24, 16))
                duration += gif.info["duration"]
            self.assertEqual(duration, 1000)

    @unittest.skipUnless(PACKAGED_FFMPEG.is_file(), "bundled FFmpeg is not installed")
    def test_video_preserves_exact_frames_and_clip_boundaries(self):
        for fps, speed, durations in (
            (24, 1, (1, 1)), (30, 1, (1, 1)), (60, 1, (1, 1)),
            (24, 1, (24, 48)), (29.97, 1, (7, 13)),
            (24, 2, (3, 5)), (24, 0.5, (3, 5)),
        ):
            with self.subTest(fps=fps, speed=speed, durations=durations):
                output = self.root / "exact.mp4"
                engine.export_video({"output": str(output), "fps": fps, "playback_speed": speed,
                    "ffmpeg_path": str(self.ffmpeg), "clips": [
                        {"path": str(self.red), "duration_frames": durations[0]},
                        {"path": str(self.blue), "duration_frames": durations[1]},
                    ]})
                decoded = subprocess.run([
                    str(self.ffmpeg), "-v", "error", "-i", str(output),
                    "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
                ], capture_output=True, check=True).stdout
                frame_bytes = 12 * 8 * 3
                self.assertEqual(len(decoded), sum(durations) * frame_bytes)
                for index in range(sum(durations)):
                    pixel = decoded[index * frame_bytes:index * frame_bytes + 3]
                    self.assertGreater(pixel[0 if index < durations[0] else 2], 230)
                    self.assertLess(pixel[2 if index < durations[0] else 0], 20)

    @unittest.skipUnless(PACKAGED_FFMPEG.is_file(), "bundled FFmpeg is not installed")
    def test_video_composites_transparency_instead_of_revealing_hidden_rgb(self):
        source = self.root / "transparent.png"
        image = Image.new("RGBA", (12, 8), (0, 255, 0, 0))
        for x in range(6, 12):
            for y in range(8):
                image.putpixel((x, y), (255, 255, 255, 128))
        image.save(source)
        output = self.root / "alpha.mp4"
        engine.export_video({"output": str(output), "fps": 24, "ffmpeg_path": str(self.ffmpeg),
            "clips": [{"path": str(source), "duration_frames": 1}]})
        raw = subprocess.run([
            str(self.ffmpeg), "-v", "error", "-i", str(output),
            "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
        ], capture_output=True, check=True).stdout
        self.assertTrue(all(channel < 5 for channel in raw[:3]))
        offset = (4 * 12 + 9) * 3
        self.assertTrue(all(120 <= channel <= 135 for channel in raw[offset:offset + 3]))

    def test_feathered_eraser_composites_existing_transparency(self):
        opaque = self.root / "opaque.png"
        partial = self.root / "partial.png"
        Image.new("RGBA", (12, 8), (255, 0, 0, 255)).save(opaque)
        Image.new("RGBA", (12, 8), (255, 0, 0, 128)).save(partial)
        stroke = {"tool": "eraser", "size": 2, "feather": 100, "points": [[0.5, 0.5]]}
        opaque_alpha = engine.render_image_with_strokes(opaque, [stroke]).getpixel((6, 4))[3]
        partial_alpha = engine.render_image_with_strokes(partial, [stroke]).getpixel((6, 4))[3]
        self.assertAlmostEqual(partial_alpha, opaque_alpha * 128 / 255, delta=1)

    @unittest.skipUnless(PACKAGED_FFMPEG.is_file(), "bundled FFmpeg is not installed")
    def test_streaming_video_cancellation_preserves_existing_output(self):
        source = self.root / "large-video-frame.png"
        Image.new("RGB", (1280, 720), "red").save(source)
        output = self.root / "existing.mp4"
        output.write_bytes(b"existing export")
        cancel_file = self.root / "cancel-stream"
        process = subprocess.Popen(
            [sys.executable, str(Path(engine.__file__).resolve()), "--task", str(cancel_file)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        process.stdin.write(json.dumps({"command": "export_video", "output": str(output), "fps": 24,
            "ffmpeg_path": str(self.ffmpeg), "clips": [{"path": str(source), "duration_frames": 10000}]}))
        process.stdin.close()
        try:
            messages = []
            for line in process.stdout:
                message = json.loads(line)
                messages.append(message)
                if message.get("type") == "progress" and message.get("message") == "Encoding video…" and message.get("current", 0) > 2:
                    cancel_file.write_text("cancel", encoding="utf-8")
                if message.get("type") == "cancelled":
                    break
            self.assertEqual(messages[-1]["type"], "cancelled")
            self.assertEqual(process.wait(timeout=10), 0)
            self.assertEqual(output.read_bytes(), b"existing export")
            self.assertFalse(list(self.root.glob("*.frameline-*")))
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
            process.stdout.close()
            process.stderr.close()

    @unittest.skipUnless(PACKAGED_FFMPEG.is_file(), "bundled FFmpeg is not installed")
    def test_streaming_source_failure_does_not_publish_a_truncated_video(self):
        output = self.root / "keep.mp4"
        output.write_bytes(b"existing export")
        render = engine.render_image_with_strokes
        calls = 0

        def disappearing_source(*args, **kwargs):
            nonlocal calls
            calls += 1
            if calls == 4:
                raise FileNotFoundError("Source disappeared during export")
            return render(*args, **kwargs)

        with patch.object(engine, "render_image_with_strokes", side_effect=disappearing_source):
            with self.assertRaisesRegex(FileNotFoundError, "Source disappeared"):
                engine.export_video({"output": str(output), "fps": 24, "clips": self.clips, "ffmpeg_path": str(self.ffmpeg)})
        self.assertEqual(output.read_bytes(), b"existing export")
        self.assertFalse(list(self.root.glob("*.frameline-*")))


if __name__ == "__main__":
    unittest.main()
