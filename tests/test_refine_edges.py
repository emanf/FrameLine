import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
import engine
from refine_edges import refine_cutout, validate_refine_options


class RefineEdgesTests(unittest.TestCase):
    def options(self, **changes):
        return dict(clean=0, repair=100, smooth=0, shrink=0, width=2, **changes)

    def colorful(self):
        image = Image.new('RGBA', (40, 28), (0, 255, 0, 0))
        draw = ImageDraw.Draw(image)
        draw.rectangle((4, 4, 19, 23), fill=(220, 30, 70, 255))
        draw.rectangle((20, 4, 35, 23), fill=(30, 80, 220, 255))
        draw.rectangle((4, 4, 35, 23), outline=(245, 245, 245, 128))
        draw.rectangle((11, 10, 14, 13), fill='white')
        return image

    def test_color_repair_uses_each_local_palette_and_preserves_alpha_and_interior(self):
        image = self.colorful()
        result = refine_cutout(image, self.options())
        self.assertEqual(result.getpixel((4, 12)), (220, 30, 70, 128))
        self.assertEqual(result.getpixel((35, 12)), (30, 80, 220, 128))
        self.assertEqual(result.getpixel((12, 11)), (255, 255, 255, 255))
        self.assertEqual(result.getchannel('A').tobytes(), image.getchannel('A').tobytes())
        self.assertEqual(result.getpixel((0, 0)), (0, 0, 0, 0))

    def test_separate_shapes_do_not_borrow_colors_across_transparency(self):
        image = Image.new('RGBA', (40, 20))
        draw = ImageDraw.Draw(image)
        draw.rectangle((2, 2, 15, 17), fill=(230, 40, 20, 255))
        draw.rectangle((2, 2, 15, 17), outline=(20, 230, 20, 150))
        draw.rectangle((17, 2, 30, 17), fill=(20, 40, 230, 255))
        draw.rectangle((17, 2, 30, 17), outline=(245, 245, 245, 150))
        result = refine_cutout(image, self.options())
        self.assertEqual(result.getpixel((15, 10)), (230, 40, 20, 150))
        self.assertEqual(result.getpixel((17, 10)), (20, 40, 230, 150))
        self.assertEqual(result.getpixel((16, 10)), (0, 0, 0, 0))

    def test_translucent_artwork_and_thin_details_keep_opacity(self):
        image = Image.new('RGBA', (40, 24))
        draw = ImageDraw.Draw(image)
        draw.rectangle((3, 3, 18, 20), fill=(210, 30, 150, 100))
        draw.rectangle((3, 3, 18, 20), outline=(80, 230, 80, 50))
        draw.line((30, 3, 30, 20), fill=(20, 140, 210, 100))
        draw.rectangle((34, 3, 39, 20), fill=(40, 60, 230, 255))
        result = refine_cutout(image, self.options())
        self.assertEqual(result.getpixel((3, 12)), (210, 30, 150, 50))
        self.assertEqual(result.getpixel((30, 12)), (20, 140, 210, 100))
        self.assertEqual(result.getchannel('A').tobytes(), image.getchannel('A').tobytes())

    def test_strength_blends_and_width_does_not_recolor_the_interior(self):
        image = self.colorful()
        options = self.options()
        options['repair'] = 50
        result = refine_cutout(image, options)
        self.assertEqual(result.getpixel((4, 12)), (232, 138, 158, 128))
        self.assertEqual(result.getpixel((19, 12)), image.getpixel((19, 12)))

    def test_cleanup_removes_faint_specks_but_keeps_internal_translucency(self):
        image = self.colorful()
        image.putpixel((1, 1), (40, 40, 40, 4))
        image.putpixel((12, 16), (220, 30, 70, 60))
        options = self.options()
        options.update(clean=10, repair=0)
        result = refine_cutout(image, options)
        self.assertEqual(result.getpixel((1, 1)), (0, 0, 0, 0))
        self.assertEqual(result.getpixel((12, 16)), image.getpixel((12, 16)))

    def test_shrink_is_optional_and_does_not_change_canvas_dimensions(self):
        image = self.colorful()
        options = self.options()
        options.update(shrink=1, repair=0)
        result = refine_cutout(image, options)
        self.assertEqual(result.size, image.size)
        self.assertEqual(result.getpixel((4, 12))[3], 0)
        self.assertEqual(result.getpixel((10, 16)), image.getpixel((10, 16)))

    def test_smoothing_preserves_holes_and_does_not_resurrect_hidden_green(self):
        image = Image.new('RGBA', (36, 36), (0, 255, 0, 0))
        draw = ImageDraw.Draw(image)
        draw.polygon(((4, 25), (18, 3), (31, 25)), fill=(210, 40, 100, 255))
        draw.rectangle((16, 13, 19, 17), fill=(0, 255, 0, 0))
        options = self.options()
        options.update(smooth=100, repair=0)
        result = refine_cutout(image, options)
        self.assertEqual(result.getpixel((17, 15))[3], 0)
        self.assertTrue(any(0 < pixel[3] < 255 for pixel in result.getdata()))
        self.assertTrue(all(pixel[:3] == (210, 40, 100) for pixel in result.getdata() if pixel[3]))

    def test_noop_and_opaque_images_are_unchanged(self):
        options = self.options()
        options.update(repair=0)
        image = self.colorful()
        self.assertEqual(refine_cutout(image, options).tobytes(), image.tobytes())
        opaque = Image.new('RGBA', (12, 10), (50, 100, 210, 255))
        self.assertEqual(refine_cutout(opaque, {}).tobytes(), opaque.tobytes())

    def test_validation_and_cancellation(self):
        for options in (None, [], {'repair': True}, {'clean': -1}, {'width': 0}, {'smooth': 101}, {'shrink': 4}, {'width': 2.5}):
            with self.assertRaises(ValueError):
                validate_refine_options(options)
        def cancelled():
            raise RuntimeError('cancelled')
        with self.assertRaisesRegex(RuntimeError, 'cancelled'):
            refine_cutout(self.colorful(), {}, cancelled)

    def test_engine_consumes_crop_and_paint_and_preserves_original_file(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'source.png'
            output = Path(directory) / 'refined.png'
            self.colorful().save(source)
            original = source.read_bytes()
            strokes = [{'tool': 'brush', 'color': '#ffc040', 'size': 3, 'opacity': 1, 'shape': 'square', 'points': [[.5, .5]]}]
            crop = dict(left=.1, top=.1, right=.9, bottom=.9)
            request = dict(path=str(source), output=str(output), paint_strokes=strokes, crop=crop,
                           options=dict(clean=0, repair=0, smooth=0, shrink=0, width=2))
            result = engine.refine_edges(request)
            expected = engine.render_image_with_strokes(str(source), strokes, crop)
            with Image.open(output) as actual:
                self.assertEqual(actual.tobytes(), expected.tobytes())
                self.assertEqual((result['width'], result['height']), expected.size)
            self.assertEqual(source.read_bytes(), original)

    def test_refined_assets_reopen_and_export_after_original_files_are_removed(self):
        from project_archive import save_project_archive, open_project_archive
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, output, archive = root / 'source.png', root / 'refined.png', root / 'project.frameline'
            self.colorful().save(source)
            engine.refine_edges(dict(path=str(source), output=str(output), options=self.options()))
            with Image.open(output) as opened:
                expected = opened.convert('RGBA').copy()
            project = dict(version=1, name='Refined colors', fps=24, defaultDurationFrames=24,
                           playbackSpeed=1, loopEnabled=True, currentFrame=0,
                           images=[dict(id='image', name='source.png', path=str(output), width=40, height=28,
                                        originalPath=str(source), originalDimensions=dict(width=40, height=28))],
                           clips=[dict(id='clip', imageId='image', durationFrames=24)])
            save_project_archive(dict(project=project, output=str(archive)), engine.render_image_with_strokes)
            source.unlink()
            output.unlink()
            reopened = open_project_archive(dict(path=str(archive), output=str(root / 'reopened')))['project']
            image = reopened['images'][0]
            self.assertEqual(engine.render_image_with_strokes(image['path']).tobytes(), expected.tobytes())
            self.assertTrue(Path(image['originalPath']).is_file())
            exported = root / 'exported'
            engine.export_images(dict(mode='sources', images=reopened['images'], output=str(exported)))
            with Image.open(next(exported.glob('*.png'))) as actual:
                self.assertEqual(actual.convert('RGBA').tobytes(), expected.tobytes())


if __name__ == '__main__':
    unittest.main()
