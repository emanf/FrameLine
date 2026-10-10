import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
import engine
from auto_background import connected_border


class AutoBackgroundTests(unittest.TestCase):
    def run_removal(self, image, **options):
        with tempfile.TemporaryDirectory() as directory:
            source, output = Path(directory)/'source.png', Path(directory)/'result.png'
            image.save(source)
            result = engine.remove_background({'path': str(source), 'output': str(output),
                                                'mode': 'auto', **options})
            with Image.open(output) as decoded:
                return decoded.copy(), result

    def character(self, background=(20, 230, 40)):
        image = Image.new('RGBA', (40, 30), (*background, 255))
        draw = ImageDraw.Draw(image)
        draw.rectangle((10, 5, 29, 24), fill=(60, 20, 170, 255))
        draw.rectangle((11, 6, 15, 13), fill=(230, 80, 40, 255))
        draw.rectangle((20, 10, 23, 13), fill=(*background, 255))
        return image

    def test_auto_detects_any_background_and_preserves_colorful_subject_and_interior(self):
        for color in ((20,230,40), (255,255,255), (0,0,0), (80,20,190), (235,120,40)):
            with self.subTest(color=color):
                source = self.character(color)
                result, metadata = self.run_removal(source)
                self.assertEqual(metadata['key_color'], list(color))
                self.assertEqual(result.getpixel((0,0))[3], 0)
                for point in ((11,6), (18,18), (21,11)):
                    self.assertEqual(result.getpixel(point), source.getpixel(point))

    def test_aggressive_removes_enclosed_matches_and_wider_shades(self):
        source = self.character()
        source.putpixel((1,1), (65,230,40,255))
        normal, _ = self.run_removal(source)
        aggressive, _ = self.run_removal(source, aggressive=True, aggressive_amount=50)
        self.assertEqual(normal.getpixel((21,11))[3], 255)
        self.assertEqual(aggressive.getpixel((21,11))[3], 0)
        self.assertEqual(normal.getpixel((1,1))[3], 255)
        self.assertEqual(aggressive.getpixel((1,1))[3], 0)
        self.assertEqual(aggressive.getpixel((11,6)), source.getpixel((11,6)))

    def test_subject_touching_opposite_borders_is_not_a_second_background_color(self):
        source = Image.new('RGBA', (40,30), (20,230,40,255))
        ImageDraw.Draw(source).rectangle((10,0,29,29), fill=(60,20,170,255))
        result, metadata = self.run_removal(source)
        self.assertEqual(metadata['background_colors'], [[20,230,40]])
        self.assertEqual(result.getpixel((15,0)), source.getpixel((15,0)))
        self.assertEqual(result.getpixel((1,15))[3],0)
        self.assertEqual(result.getpixel((38,15))[3],0)

    def test_multiple_border_shades_and_each_batch_image_detects_own_color(self):
        source = self.character()
        draw = ImageDraw.Draw(source)
        draw.rectangle((0,0,5,29), fill=(20,180,40,255))
        result, metadata = self.run_removal(source)
        self.assertIn([20,180,40], metadata['background_colors'])
        self.assertEqual(result.getpixel((2,10))[3], 0)
        other, metadata = self.run_removal(self.character((220,210,190)))
        self.assertEqual(metadata['key_color'], [220,210,190])
        self.assertEqual(other.getpixel((2,10))[3], 0)

    def test_custom_color_transparency_and_no_opaque_border(self):
        source = self.character()
        for x in range(40):
            source.putpixel((x,0), (255,255,255,0))
            source.putpixel((x,29), (255,255,255,0))
        for y in range(30):
            source.putpixel((0,y), (255,255,255,0))
            source.putpixel((39,y), (255,255,255,0))
        with self.assertRaisesRegex(ValueError, 'custom background color'):
            self.run_removal(source)
        result, metadata = self.run_removal(source, background_source='custom', key_color=[20,230,40])
        self.assertEqual(result.getpixel((1,1))[3], 0)
        self.assertEqual(result.getpixel((0,0))[3], 0)
        self.assertEqual(metadata['background_colors'], [[20,230,40]])
        self.assertEqual(result.getpixel((11,6)), source.getpixel((11,6)))

    def test_connected_mask_handles_narrow_shapes_and_matches_reference_flood(self):
        import random
        from PIL import ImageDraw
        randomizer = random.Random(7)
        for width, height in ((1,1), (1,20), (20,1), (31,27)):
            candidate = Image.frombytes('L', (width,height), bytes(randomizer.choice((0,255)) for _ in range(width*height)))
            padded = Image.new('L', (width+2,height+2),255)
            padded.paste(candidate,(1,1))
            ImageDraw.floodfill(padded,(0,0),128)
            expected = padded.crop((1,1,width+1,height+1)).point(lambda value: 255 if value==128 else 0)
            actual = connected_border(candidate, lambda: None, lambda *args: None)
            self.assertEqual(actual.tobytes(), expected.tobytes())

    def test_optional_edge_effects_preview_apply_parity_and_progress(self):
        options = {'softness':4, 'edge_smoothing':50, 'fringe_cleanup':{
            'method':'recover','width':4,'strength':100,'tolerance':24,'sample_distance':16,
            'min_opacity':0,'max_opacity':100}}
        events = []
        with patch.object(engine, 'report_progress', side_effect=lambda *event: events.append(event)):
            preview, _ = self.run_removal(self.character(), **options)
            applied, _ = self.run_removal(self.character(), **options)
        self.assertEqual(preview.tobytes(), applied.tobytes())
        self.assertTrue(any('Detecting' in event[2] for event in events))
        self.assertTrue(any('Recovering' in event[2] for event in events))

    def test_validation_and_cancellation(self):
        for options in ({'background_source':'wrong'}, {'aggressive':1}, {'aggressive_amount':101},
                        {'aggressive_amount':True}, {'background_source':'custom','key_color':[0,True,0]}):
            with self.subTest(options=options), self.assertRaises(ValueError):
                self.run_removal(self.character(), **options)
        with patch.object(engine, 'check_cancelled', side_effect=engine.ExportCancelled), self.assertRaises(engine.ExportCancelled):
            self.run_removal(self.character())

    def test_ignore_brush_preserves_source_rgba_after_all_edge_effects_in_every_method(self):
        from background_ignore import ignore_mask
        source = self.character()
        source.putpixel((6,15), (20,230,40,123))
        marks = [{'size':.3, 'points':[[.15,.5],[.25,.5]]}]
        mask = ignore_mask(marks, 40,30,lambda:None)
        for mode in ('auto','chroma','sample'):
            with self.subTest(mode=mode):
                result, _ = self.run_removal(source, mode=mode, key_color=[20,230,40],
                    sample_point=[0,0], ignore_strokes=marks, softness=64,
                    edge_smoothing=80, edge_color=[255,255,255], spill=100,
                    fringe_cleanup={'method':'replace','strength':100,'width':4,'tolerance':100,
                                    'sample_distance':16,'min_opacity':0,'max_opacity':100})
                for y in range(30):
                    for x in range(40):
                        if mask.getpixel((x,y)):
                            self.assertEqual(result.getpixel((x,y)), source.getpixel((x,y)))
                self.assertEqual(result.getpixel((0,0))[3],0)
                self.assertEqual(result.getpixel((6,15)),(20,230,40,123))

    def test_ignore_brush_normalized_batch_and_multiple_marks(self):
        marks = [{'size':.2,'points':[[.1,.5],[.25,.5]]}, {'size':.1,'points':[[.8,.8]]}]
        for size in ((40,30),(80,60)):
            source = Image.new('RGBA',size,(10,220,50,255))
            result, _ = self.run_removal(source, aggressive=True, ignore_strokes=marks)
            self.assertEqual(result.getpixel((size[0]//10,size[1]//2)),(10,220,50,255))
            self.assertEqual(result.getpixel((int(size[0]*.8),int(size[1]*.8))),(10,220,50,255))
            self.assertEqual(result.getpixel((size[0]//2,0))[3],0)

    def test_ignore_brush_rejects_malformed_marks_and_supports_cancel(self):
        from background_ignore import ignore_mask
        for marks in (None,{},[None],[{'size':True,'points':[[.5,.5]]}],
                      [{'size':1,'points':[]}],[{'size':1,'points':[[float('nan'),0]]}],
                      [{'size':1,'points':[[2,0]]}]):
            with self.subTest(marks=marks), self.assertRaises(ValueError):
                self.run_removal(self.character(), ignore_strokes=marks)
        with self.assertRaises(engine.ExportCancelled):
            ignore_mask([{'size':.2,'points':[[.5,.5]]}],40,30,lambda: (_ for _ in ()).throw(engine.ExportCancelled()))


if __name__ == '__main__':
    unittest.main()
