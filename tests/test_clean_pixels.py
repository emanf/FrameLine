import random
import sys
import tempfile
import unittest
from pathlib import Path
from PIL import Image, ImageDraw, ImageStat

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
import engine
from clean_pixels import clean_image_pixels, validate_clean_options
from processing_cache import CACHE


class CleanPixelTests(unittest.TestCase):
    def setUp(self):
        CACHE.clear()

    def noisy(self, size=(48, 42)):
        rng = random.Random(17)
        image = Image.new('RGBA', size)
        for y in range(image.height):
            for x in range(image.width):
                color = (180, 40, 70) if x < image.width // 2 else (30, 100, 220)
                image.putpixel((x, y), tuple(max(0, min(255, value+rng.randint(-9, 9))) for value in color)+(255,))
        return image

    def test_reduces_interior_noise_without_crossing_multicolor_boundaries(self):
        image = self.noisy()
        result = clean_image_pixels(image, {'strength':100,'tolerance':32,'speckles':0})
        before = ImageStat.Stat(image.crop((4,4,20,36))).stddev[:3]
        after = ImageStat.Stat(result.crop((4,4,20,36))).stddev[:3]
        self.assertTrue(all(b < a*.6 for a,b in zip(before,after)), (before,after))
        for x, color in ((23,(180,40,70)), (24,(30,100,220))):
            actual = result.getpixel((x,20))[:3]
            self.assertTrue(all(abs(a-b) < 12 for a,b in zip(actual,color)),actual)

    def test_alpha_and_hidden_colors_are_exactly_preserved(self):
        image = self.noisy()
        alpha = Image.new('L', image.size)
        alpha.putdata([(x*13+y*7)%256 for y in range(image.height) for x in range(image.width)])
        image.putalpha(alpha)
        image.putpixel((15,15),(4,240,3,0))
        result = clean_image_pixels(image, {'strength':100,'speckles':100})
        self.assertEqual(result.getchannel('A').tobytes(),image.getchannel('A').tobytes())
        self.assertEqual(result.getpixel((15,15)),image.getpixel((15,15)))
        self.assertEqual(result.size,image.size)

    def test_optional_speckle_removal_replaces_isolated_wrong_colors(self):
        image = Image.new('RGBA',(30,24),(20,30,45,255))
        image.putpixel((12,12),(0,240,0,255))
        cleaned = clean_image_pixels(image, {'strength':100,'speckles':100})
        self.assertEqual(cleaned.getpixel((12,12)),(20,30,45,255))
        preserved = clean_image_pixels(image, {'strength':100,'speckles':0})
        self.assertEqual(preserved.getpixel((12,12)),image.getpixel((12,12)))

    def test_tiny_color_details_gradients_and_eye_glow_remain(self):
        image = Image.new('RGBA',(40,30),(5,5,5,255))
        draw=ImageDraw.Draw(image)
        draw.line((8,5,8,25),fill=(230,40,20,255))
        for radius in range(6,0,-1):
            value=round(255*(1-radius/7))
            draw.ellipse((24-radius,15-radius,24+radius,15+radius),fill=(value,value,value,255))
        draw.ellipse((22,13,26,17),fill='white')
        result=clean_image_pixels(image,{'strength':100,'speckles':0,'tolerance':16})
        self.assertEqual(result.getpixel((8,15)),image.getpixel((8,15)))
        self.assertEqual(result.getpixel((24,15)),(255,255,255,255))
        self.assertTrue(10 < result.getpixel((29,15))[0] < 150)

    def test_tiles_do_not_seam_and_cached_images_are_not_shared(self):
        image=self.noisy((36,160));options={'strength':100,'radius':5,'speckles':80}
        tiled=clean_image_pixels(image,options,tile_height=23)
        CACHE.clear()
        complete=clean_image_pixels(image,options,tile_height=1000)
        self.assertEqual(tiled.tobytes(),complete.tobytes())
        complete.putpixel((0,0),(0,0,0,0))
        self.assertEqual(clean_image_pixels(image,options).tobytes(),tiled.tobytes())

    def test_validation_noop_progress_and_cancellation(self):
        for options in (None, [], {'radius':0}, {'radius':9}, {'strength':True}, {'tolerance':1.5}, {'speckles':101}):
            with self.assertRaises(ValueError):validate_clean_options(options)
        image=self.noisy();events=[]
        result=clean_image_pixels(image,{'strength':0},progress=lambda *event:events.append(event))
        self.assertEqual(result.tobytes(),image.tobytes());self.assertEqual(events[-1][:2],(100,100))
        clean_image_pixels(image,{},progress=lambda *event:events.append(event))
        self.assertTrue(any(event[0]!=100 for event in events))
        calls=0
        def cancel():
            nonlocal calls
            calls+=1
            if calls>4:raise RuntimeError('cancelled')
        CACHE.clear()
        with self.assertRaisesRegex(RuntimeError,'cancelled'):clean_image_pixels(image,{},cancel)

    def test_engine_consumes_current_crop_and_strokes_and_exports_cleaned_result(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);source=root/'source.png';output=root/'cleaned.png'
            self.noisy().save(source)
            crop={'left':.25,'top':0,'right':.75,'bottom':1}
            strokes=[{'tool':'brush','color':'#ffffff','opacity':1,'size':7,'shape':'square','points':[[.5,.5]]}]
            request={'path':str(source),'output':str(output),'paint_strokes':strokes,'crop':crop,'options':{'strength':100}}
            engine.clean_pixels(request)
            with Image.open(output) as result:
                self.assertEqual(result.size,(24,42));self.assertEqual(result.getpixel((12,21)),(255,255,255,255))
            exports=root/'exports'
            engine.export_images({'mode':'sources','output':str(exports),'images':[{'name':'Clean','path':str(output)}]})
            self.assertEqual((exports/'Clean.png').read_bytes(),output.read_bytes())


if __name__=='__main__':unittest.main()
