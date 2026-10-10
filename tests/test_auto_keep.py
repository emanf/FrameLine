import sys
import tempfile
import unittest
from pathlib import Path
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
import engine
from healing_brush import heal_image
from project_archive import save_project_archive, open_project_archive


class AutoKeepTests(unittest.TestCase):
    def source(self):
        image = Image.new('RGBA', (9, 3))
        colors = [(0,0,0), (120,30,10), (240,200,80)]
        for y, color in enumerate(colors):
            for x in range(9):
                rgb = color if x < 3 else tuple((color[c]+(0,240,0)[c])//2 for c in range(3)) if x < 6 else (0,240,0)
                image.putpixel((x,y), (*rgb,255))
        return image

    def stroke(self, **changes):
        return {'tool':'healing','color':'#000000','backgroundColor':'#00f000','tolerance':1,
                'opacity':1,'autoKeep':True,'sampleDistance':24,'recoverTransparency':True,
                'size':3,'shape':'square','antiAlias':False,'feather':0,'points':[[4/9,1/3]], **changes}

    def test_engine_brush_and_exports_recover_multiple_foreground_colors(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary)/'hair.png'
            self.source().save(source)
            stroke = self.stroke()
            result = engine.render_image_with_strokes(source, [stroke])
            for y, color in enumerate([(0,0,0), (120,30,10), (240,200,80)]):
                self.assertEqual(result.getpixel((4,y)), (*color,128))
            output = Path(temporary)/'frames'
            engine.export_images({'mode':'frames','output':str(output),'clips':[{
                'path':str(source),'duration_frames':1,'paint_strokes':[stroke]}]})
            with Image.open(output/'frame_000001.png') as exported:
                self.assertEqual(exported.tobytes(), result.tobytes())

    def test_no_crossing_transparent_gap_and_opacity_can_be_preserved(self):
        image=self.source()
        mask=Image.new('L', image.size,255)
        preserved=heal_image(image,mask,self.stroke(recoverTransparency=False))
        self.assertEqual(preserved.getpixel((4,1)),(120,30,10,255))
        for y in range(3):
            image.putpixel((2,y),(0,0,0,0))
        result=heal_image(image,mask,self.stroke())
        self.assertEqual(result.getpixel((4,1)), image.getpixel((4,1)))

    def test_new_fields_reject_invalid_values_and_cancellation_is_checked(self):
        image=self.source()
        mask=Image.new('L',image.size,255)
        for change in ({'autoKeep':1},{'recoverTransparency':'yes'},{'sampleDistance':0},
                       {'sampleDistance':129},{'sampleDistance':True}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                heal_image(image,mask,self.stroke(**change))
        def cancel():
            raise engine.ExportCancelled('test cancellation')
        with self.assertRaises(engine.ExportCancelled):
            heal_image(image,mask,self.stroke(),cancel)

    def test_auto_keep_survives_portable_save_open_with_editable_strokes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary)
            source=root/'hair.png'
            self.source().save(source)
            image={'id':'hair','path':str(source),'name':'Hair','width':9,'height':3,
                   'originalPath':str(source),'originalDimensions':{'width':9,'height':3},
                   'paintStrokes':[self.stroke()]}
            project={'version':1,'images':[image],'clips':[{'id':'clip','imageId':'hair','durationFrames':24}]}
            archive=root/'hair.frameline'
            save_project_archive({'project':project,'output':str(archive)},engine.render_image_with_strokes)
            reopened=open_project_archive({'path':str(archive),'output':str(root/'unpacked')})['project']['images'][0]
            self.assertEqual(reopened['paintStrokes'], image['paintStrokes'])
            result=engine.render_image_with_strokes(reopened['path'],reopened['paintStrokes'])
            self.assertEqual(result.getpixel((4,1)),(120,30,10,128))
