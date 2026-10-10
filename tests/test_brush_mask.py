import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
import engine
from brush_mask import brush_mask


class BrushMaskTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.source = self.root / 'blank.png'
        Image.new('RGBA',(24,20)).save(self.source)
        self.stroke = {'tool':'brush','color':'#0000ff','opacity':1,'size':5,'shape':'round',
                       'feather':0,'antiAlias':True,'points':[[.5,.5]]}

    def test_backend_and_renderer_use_identical_edge_and_feather_coverage(self):
        cases = json.loads((Path(__file__).parent / 'fixtures' / 'brush-masks.json').read_text())
        for case in cases:
            with self.subTest(name=case['name']):
                self.assertEqual(hashlib.sha256(brush_mask(case,24,20).tobytes()).hexdigest(),case['hash'])

    def test_opacity_and_retracing_for_pixel_and_smooth_round_and_square_brushes(self):
        for shape in ('round','square'):
            for anti_alias in (True,False):
                for feather in (0,40):
                    stroke = {**self.stroke,'shape':shape,'antiAlias':anti_alias,'feather':feather,
                              'opacity':.3,'points':[[.2,.2],[.7,.6]]}
                    forward = engine.render_image_with_strokes(self.source,[stroke])
                    retraced = engine.render_image_with_strokes(self.source,[{**stroke,'points':stroke['points']*2}])
                    self.assertEqual(forward.tobytes(),retraced.tobytes())
                    alpha = set(forward.getchannel('A').tobytes())
                    self.assertLessEqual(max(alpha),77)
                    if not anti_alias and not feather:
                        self.assertEqual(alpha,{0,77})

    def test_eraser_and_cleanup_share_the_new_smooth_or_pixel_mask(self):
        filled = self.root / 'filled.png'
        Image.new('RGBA',(24,20),(3,170,3,255)).save(filled)
        for anti_alias in (True,False):
            stroke = {**self.stroke,'antiAlias':anti_alias}
            mask = brush_mask(stroke,24,20)
            erased = engine.render_image_with_strokes(filled,[{**stroke,'tool':'eraser'}])
            self.assertEqual(erased.getchannel('A').tobytes(), bytes(255-m for m in mask.tobytes()))
            healed = engine.render_image_with_strokes(filled,[{**stroke,'tool':'healing','color':'#000000','backgroundColor':'#04f404','tolerance':2}])
            alpha = set(healed.getchannel('A').tobytes())
            self.assertIn(77,alpha)
            if not anti_alias:
                self.assertEqual(alpha,{77,255})
            if anti_alias:
                self.assertTrue(any(77<a<255 for a in alpha))

    def test_source_and_frame_exports_preserve_each_strokes_anti_aliasing(self):
        for anti_alias in (True,False):
            stroke = {**self.stroke,'antiAlias':anti_alias}
            expected = engine.render_image_with_strokes(self.source,[stroke])
            for mode in ('sources','frames'):
                directory = self.root / f'{mode}-{anti_alias}'
                entry = {'path':str(self.source),'paint_strokes':[stroke],'duration_frames':1}
                engine.export_images({'mode':mode,'output':str(directory),'images':[entry],'clips':[entry]})
                with Image.open(next(directory.glob('*.png'))) as exported:
                    self.assertEqual(exported.convert('RGBA').tobytes(),expected.tobytes())

    def test_invalid_anti_aliasing_is_rejected_and_legacy_strokes_still_render(self):
        for value in (None,0,1,'true',{},[]):
            with self.assertRaisesRegex(ValueError,'anti-aliasing'):
                engine.render_image_with_strokes(self.source,[{**self.stroke,'antiAlias':value}])
        legacy = {**self.stroke}
        del legacy['antiAlias']
        self.assertEqual(set(engine.render_image_with_strokes(self.source,[legacy]).getchannel('A').tobytes()),{0,255})
