import io
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

from PIL import Image, ImageChops

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
import engine
from project_archive import save_project_archive, open_project_archive


class ProjectArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.original = self.root / "original.png"
        self.working = self.root / "working.png"
        Image.new("RGBA", (12, 8), "red").save(self.original)
        Image.new("RGBA", (12, 8), "green").save(self.working)
        self.project = {
            "version": 1, "name": "Saved animation", "fps": 30, "defaultDurationFrames": 24,
            "playbackSpeed": 0.5, "loopEnabled": False, "currentFrame": 3,
            "images": [{
                "id": "image-1", "name": "subject.png", "path": str(self.working),
                "width": 12, "height": 8, "originalPath": str(self.original),
                "originalDimensions": {"width": 12, "height": 8}, "sourcePath": str(self.original),
                "paintStrokes": [{"tool": "brush", "color": "#0000ff", "opacity": 1, "size": 3,
                                  "shape": "square", "points": [[0.5, 0.5]]}],
                "crop": {"left": 0.25, "top": 0.25, "right": 0.75, "bottom": 0.75},
            }],
            "clips": [{"id": "clip-1", "imageId": "image-1", "durationFrames": 12}],
        }

    def tearDown(self):
        self.temporary.cleanup()

    def test_archive_preserves_healing_colors_and_transparency_after_source_deletion(self):
        Image.new("RGBA", (12, 8), (3, 170, 3, 255)).save(self.working)
        stroke = {"tool": "healing", "color": "#000000", "backgroundColor": "#04f404",
                  "tolerance": 2, "opacity": 1, "size": 3, "shape": "square", "points": [[.5, .5]]}
        self.project["images"][0]["paintStrokes"] = [stroke]
        archive_path = self.root / "healed.frameline"
        save_project_archive({"project": self.project, "output": str(archive_path)}, engine.render_image_with_strokes)
        with zipfile.ZipFile(archive_path) as archive:
            with Image.open(io.BytesIO(archive.read("results/000001.png"))) as result:
                self.assertEqual(result.getpixel((3, 2)), (0, 0, 0, 77))
        self.working.unlink()
        reopened = open_project_archive({"path": str(archive_path), "output": str(self.root / "reopened")})["project"]
        image = reopened["images"][0]
        self.assertEqual(image["paintStrokes"], [stroke])
        actual = engine.render_image_with_strokes(image["path"], image["paintStrokes"], image["crop"])
        self.assertEqual(actual.getpixel((3, 2)), (0, 0, 0, 77))

    def test_archive_reopens_originals_and_edited_results_after_sources_are_deleted(self):
        archive_path = self.root / "animation.frameline"
        expected = engine.render_image_with_strokes(self.working, self.project["images"][0]["paintStrokes"], self.project["images"][0]["crop"])
        save_project_archive({"project": self.project, "output": str(archive_path)}, engine.render_image_with_strokes)
        with zipfile.ZipFile(archive_path) as archive:
            self.assertEqual(len([name for name in archive.namelist() if name.startswith("assets/")]), 2)
            manifest_text = archive.read("project.json").decode()
            self.assertNotIn(str(self.root).replace("\\", "\\\\"), manifest_text)
            with Image.open(io.BytesIO(archive.read("results/000001.png"))) as result:
                self.assertEqual(result.size, (6, 4))
                self.assertIsNone(ImageChops.difference(expected, result).getbbox())
        self.original.unlink()
        self.working.unlink()
        reopened = open_project_archive({"path": str(archive_path), "output": str(self.root / "reopened")})["project"]
        self.assertEqual(reopened["clips"], self.project["clips"])
        self.assertEqual(reopened["fps"], 30)
        self.assertEqual(reopened["playbackSpeed"], 0.5)
        self.assertFalse(reopened["loopEnabled"])
        image = reopened["images"][0]
        self.assertEqual(image["paintStrokes"], self.project["images"][0]["paintStrokes"])
        self.assertEqual(image["crop"], self.project["images"][0]["crop"])
        self.assertEqual(image["sourcePath"], image["originalPath"])
        actual = engine.render_image_with_strokes(image["path"], image["paintStrokes"], image["crop"])
        self.assertIsNone(ImageChops.difference(expected, actual).getbbox())
        with Image.open(image["originalPath"]) as original:
            self.assertEqual(original.getpixel((0, 0)), (255, 0, 0, 255))
        # A second save/open cycle must remain independent of the first cache.
        second_archive = self.root / "second.frameline"
        save_project_archive({"project": reopened, "output": str(second_archive)}, engine.render_image_with_strokes)
        second = open_project_archive({"path": str(second_archive), "output": str(self.root / "second-cache")})["project"]
        self.assertNotEqual(second["images"][0]["path"], image["path"])
        self.assertEqual(second["images"][0]["paintStrokes"], image["paintStrokes"])

    def test_padded_assets_reopen_and_export_with_transparency_and_originals(self):
        padded = Image.new("RGBA", (18, 17), (0, 0, 0, 0))
        with Image.open(self.original) as original:
            padded.paste(original, (4, 6))
        padded.save(self.working)
        image = self.project["images"][0]
        image.update({"width": 18, "height": 17})
        image.pop("paintStrokes")
        image.pop("crop")
        archive_path = self.root / "padded.frameline"
        save_project_archive({"project": self.project, "output": str(archive_path)}, engine.render_image_with_strokes)
        self.original.unlink()
        self.working.unlink()
        reopened = open_project_archive({"path": str(archive_path), "output": str(self.root / "padded-cache")})["project"]
        image = reopened["images"][0]
        self.assertEqual((image["width"], image["height"]), (18, 17))
        with Image.open(image["path"]) as result:
            self.assertEqual(result.getpixel((0, 0)), (0, 0, 0, 0))
            self.assertEqual(result.getpixel((4, 6)), (255, 0, 0, 255))
            self.assertIsNone(ImageChops.difference(result, padded).getbbox())
        with Image.open(image["originalPath"]) as original:
            self.assertEqual(original.size, (12, 8))
        exports = self.root / "padded-exports"
        engine.export_images({"mode": "sources", "output": str(exports), "images": [image]})
        self.assertEqual(image['name'], 'subject.png')
        with Image.open(exports / 'subject.png') as exported:
            self.assertEqual(exported.size, (18, 17))
            self.assertEqual(exported.getpixel((0, 0))[3], 0)

    def test_archive_rejects_missing_sources_and_unsafe_asset_references(self):
        self.working.unlink()
        with self.assertRaisesRegex(ValueError, "image is missing"):
            save_project_archive({"project": self.project, "output": str(self.root / "missing.frameline")}, engine.render_image_with_strokes)
        self.project["images"][0]["path"] = "../escaped.png"
        archive_path = self.root / "invalid.frameline"
        with zipfile.ZipFile(archive_path, "w") as archive:
            archive.writestr("project.json", json.dumps({"format": "FrameLine", "archiveVersion": 1, "project": self.project}))
            archive.writestr("../escaped.png", b"bad")
        with self.assertRaisesRegex(ValueError, "invalid image asset path"):
            open_project_archive({"path": str(archive_path), "output": str(self.root / "cache")})
        self.assertFalse((self.root / "cache").exists())
        self.assertFalse((self.root.parent / "escaped.png").exists())

    def test_background_removal_and_sampling_use_the_cropped_painted_result(self):
        Image.new("RGB", (12, 8), (0, 255, 0)).save(self.original)
        stroke = {"tool": "brush", "color": "#0000ff", "opacity": 1, "size": 3,
                  "shape": "square", "points": [[0.5, 0.5]]}
        crop = {"left": 0.25, "top": 0.25, "right": 0.75, "bottom": 0.75}
        current = self.root / "current.png"
        engine.render_current_image({"path": str(self.original), "output": str(current), "paint_strokes": [stroke], "crop": crop})
        self.assertEqual(engine.sample_image_color({"path": str(current), "x": 3, "y": 2})["color"], [0, 0, 255])
        removed = self.root / "removed.png"
        result = engine.remove_background({
            "path": str(self.original), "output": str(removed), "paint_strokes": [stroke], "crop": crop,
            "mode": "chroma", "key_color": [0, 255, 0], "tolerance": 0, "softness": 0, "spill": 0,
        })
        self.assertEqual((result["width"], result["height"]), (6, 4))
        with Image.open(removed) as image:
            self.assertEqual(image.getpixel((3, 2)), (0, 0, 255, 255))
            self.assertEqual(image.getpixel((0, 0))[3], 0)
        with Image.open(self.original) as original:
            self.assertEqual(original.size, (12, 8))
            self.assertEqual(original.getpixel((6, 4)), (0, 255, 0))
