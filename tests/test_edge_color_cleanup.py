import sys
import tempfile
import unittest
from pathlib import Path
from PIL import Image, ImageDraw

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
import engine
from healing_brush import recover_color_pixel


class EdgeColorCleanupTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.source = self.root/'source.png'
        self.output = self.root/'clean.png'

    def make_shape(self, keep=(0,0,0), background=(4,244,4), mixed=(3,170,3), opacity=255):
        image = Image.new('RGBA',(32,32),(*background,255))
        draw = ImageDraw.Draw(image)
        draw.rectangle((4,4,27,27),fill=(*mixed,opacity))
        draw.rectangle((6,6,25,25),fill=(*keep,255))
        image.save(self.source)
        return image

    def remove(self, background=(4,244,4), cleanup=None, **changes):
        engine.remove_background({'path':str(self.source),'output':str(self.output),'mode':'chroma',
                                  'key_color':list(background),'tolerance':100,'softness':0,'spill':0,
                                  'fringe_cleanup':{'method':'recover','width':2,'tolerance':2,**(cleanup or {})},**changes})
        with Image.open(self.output) as image:
            return image.copy()

    def test_recovery_matches_the_brush_formula_even_when_removal_discarded_mixed_pixels(self):
        original = self.make_shape()
        result = self.remove()
        self.assertEqual(result.getpixel((4,16)),(0,0,0,77))
        self.assertEqual(result.getpixel((5,16)),(0,0,0,77))
        self.assertEqual(result.getpixel((16,16)),(0,0,0,255))
        self.assertEqual(result.getpixel((0,0)),(0,0,0,0))
        self.assertEqual(result.getpixel((4,16)),recover_color_pixel(original.getpixel((4,16)),(0,0,0),(4,244,4),2,1))
        with Image.open(self.source) as source:
            self.assertEqual(source.tobytes(),original.tobytes())

    def test_arbitrary_backgrounds_and_multicolored_shapes_keep_local_foreground_colors(self):
        for keep,background,mixed in [((240,30,80),(10,230,40),(102,150,56)),
                                      ((20,80,190),(255,255,255),(138,168,223)),
                                      ((220,80,40),(30,40,240),(106,56,160))]:
            with self.subTest(background=background):
                original = self.make_shape(keep,background,mixed)
                result = self.remove(background)
                self.assertEqual(result.getpixel((4,16)),recover_color_pixel(original.getpixel((4,16)),keep,background,2,1))
        image = self.make_shape((240,30,80),(10,230,40),(102,150,56))
        draw = ImageDraw.Draw(image)
        draw.rectangle((16,4,27,27),fill=(18,154,112,255))
        draw.rectangle((16,6,25,25),fill=(30,40,220,255))
        image.save(self.source)
        result = self.remove((10,230,40))
        self.assertEqual(result.getpixel((8,4)),(240,30,80,102))
        self.assertEqual(result.getpixel((23,4)),(30,40,220,102))

    def test_width_strength_opacity_limits_and_existing_alpha_are_respected(self):
        self.make_shape()
        narrow = self.remove(cleanup={'width':1})
        self.assertEqual(narrow.getpixel((4,16))[3],0,'width one cannot reach a pixel two steps outside the cutout')
        self.assertEqual(narrow.getpixel((5,16)),(0,0,0,77))
        half = self.remove(cleanup={'strength':50})
        self.assertEqual(half.getpixel((4,16)),recover_color_pixel((3,170,3,255),(0,0,0),(4,244,4),2,.5))
        zero = self.remove(cleanup={'strength':0},softness=35)
        engine.remove_background({'path':str(self.source),'output':str(self.output),'mode':'chroma',
                                  'key_color':[4,244,4],'tolerance':100,'softness':35,'spill':0})
        with Image.open(self.output) as baseline:
            self.assertEqual(zero.tobytes(),baseline.tobytes(),'zero strength leaves removal and blur unchanged')
        self.make_shape(opacity=128)
        transparent = self.remove()
        self.assertEqual(transparent.getpixel((4,16)),(0,0,0,39),'source opacity is multiplied only once')
        skipped = self.remove(cleanup={'min_opacity':60})
        self.assertEqual(skipped.getpixel((4,16))[3],0)

    def test_manual_keep_handles_thin_shapes_without_inventing_a_local_sample(self):
        image = Image.new('RGBA',(24,24),(4,244,4,255))
        ImageDraw.Draw(image).line((4,12,19,12),fill=(3,170,3,255))
        image.save(self.source)
        auto = self.remove(tolerance=0)
        self.assertEqual(auto.getpixel((12,12)),(3,170,3,255))
        manual = self.remove(tolerance=0,cleanup={'keep_color':[0,0,0]})
        self.assertEqual(manual.getpixel((12,12)),(0,0,0,77))

    def test_transparent_gaps_unrelated_colors_and_connected_sample_regions_are_protected(self):
        image = Image.new('RGBA',(32,32),(4,244,4,255))
        draw = ImageDraw.Draw(image)
        draw.rectangle((3,3,14,25),fill=(0,0,0,255))
        draw.line((18,5,18,23),fill=(3,170,3,255))
        draw.line((3,12,3,16),fill=(255,0,255,255))
        image.save(self.source)
        result = self.remove(tolerance=0)
        self.assertEqual(result.getpixel((18,12)),(3,170,3,255),'no donor travels through uniform background')
        self.assertEqual(result.getpixel((3,14)),(255,0,255,255),'unrelated edge detail is not on the mixture line')
        draw.rectangle((4,4,13,20),fill=(4,244,4,255))
        image.save(self.source)
        protected = self.remove(mode='sample',sample_point=[0,0],connected_only=True,tolerance=0)
        self.assertEqual(protected.getpixel((8,12)),(4,244,4,255),'an enclosed unsampled green hole stays protected')

    def test_batch_sampling_handles_each_images_size_and_preserves_nonmatching_frames(self):
        for size in [(32,32),(13,21)]:
            image = Image.new('RGBA',size,(4,244,4,255))
            ImageDraw.Draw(image).rectangle((3,3,size[0]-4,size[1]-4),fill=(0,0,0,255))
            image.save(self.source)
            result = self.remove(mode='sample',sample_color=[4,244,4],sample_point=[1000,1000],connected_only=True)
            self.assertEqual(result.getpixel((0,0))[3],0)
            self.assertEqual(result.getpixel((size[0]//2,size[1]//2)),(0,0,0,255))
        Image.new('RGBA',(8,8),(255,0,0,255)).save(self.source)
        result = self.remove(mode='sample',sample_color=[4,244,4],connected_only=True)
        self.assertEqual(result.getpixel((0,0)),(255,0,0,255))

    def test_recovery_and_shape_antialiasing_are_compatible_and_invalid_options_fail(self):
        self.make_shape()
        smooth = self.remove(edge_smoothing=75)
        self.assertEqual(smooth.getpixel((4,16))[:3],(0,0,0))
        for changes in [{'method':'unknown'},{'keep_color':'black'},{'keep_color':[0,256,0]},{'keep_color':[4,244,4]}]:
            with self.assertRaises(ValueError):
                self.remove(cleanup=changes)
