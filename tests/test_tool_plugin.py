import io
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from PIL import Image
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
import engine
from tool_plugin import ToolPluginLoader, process_tool_plugin


class ToolPluginTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.source = self.root / 'source.png'
        image = Image.new('RGBA', (4, 3), (40, 60, 80, 128))
        image.putpixel((0, 0), (20, 30, 40, 0))
        image.save(self.source)
        self.example = Path(__file__).resolve().parents[1] / 'docs/examples/invert-colors/processor.py'

    def request(self, **values):
        return {'path': str(self.source), 'processor': str(self.example), 'output': str(self.root / 'output.png'), 'options': {'strength': 100}, **values}

    def test_example_processes_edited_source_and_preserves_alpha(self):
        events = []
        result = process_tool_plugin(self.request(crop={'left': .25, 'top': 0, 'right': .75, 'bottom': 1}),
                                     engine.render_image_with_strokes, lambda *event: events.append(event), lambda: None)
        with Image.open(result['path']) as image:
            self.assertEqual(image.size, (2, 3))
            self.assertEqual(image.getpixel((0, 0)), (215, 195, 175, 128))
        self.assertEqual(events[-1][:2], (100, 100))
        self.assertTrue(any(event[0] == 25 for event in events))

    def test_invalid_output_options_and_cancellation_do_not_create_output(self):
        for strength in [-1, 101, True, 'bad']:
            with self.assertRaises(ValueError):
                process_tool_plugin(self.request(options={'strength': strength}), engine.render_image_with_strokes, lambda *args: None, lambda: None)
        self.assertFalse((self.root / 'output.png').exists())
        def cancelled():
            raise engine.ExportCancelled()
        with self.assertRaises(engine.ExportCancelled):
            process_tool_plugin(self.request(), engine.render_image_with_strokes, lambda *args: None, cancelled)
        invalid = self.root / 'invalid.py'
        invalid.write_text('from tool_plugin import ImageProcessorPlugin\nclass Processor(ImageProcessorPlugin):\n def process(self,image,options,context): return None\n')
        with self.assertRaises(ValueError):
            process_tool_plugin(self.request(processor=str(invalid)), engine.render_image_with_strokes, lambda *args: None, lambda: None)

    def test_loader_reuses_class_and_reload_uses_changed_source(self):
        loader = ToolPluginLoader()
        first = loader.load(self.example)
        self.assertIs(first, loader.load(self.example))
        invalid = self.root / 'invalid.py'
        invalid.write_text('class Processor: pass')
        with self.assertRaises(TypeError):
            loader.load(invalid)
        invalid.write_text(self.example.read_text())
        self.assertIsNotNone(loader.load(invalid))

    def test_equal_length_processor_edits_reload_without_stale_bytecode(self):
        path = self.root / 'reload.py'
        template = 'from tool_plugin import ImageProcessorPlugin\nclass Processor(ImageProcessorPlugin):\n version = {}\n def process(self,image,options,context): return image\n'
        path.write_text(template.format(1))
        stamp = path.stat().st_mtime_ns // 1000000000 * 1000000000 + 100000000
        os.utime(path, ns=(stamp, stamp))
        loader = ToolPluginLoader()
        first = loader.load(path)
        self.assertEqual(first.version, 1)
        original = path.stat().st_mtime_ns
        path.write_text(template.format(2))
        os.utime(path, ns=(original, original + 100000000))
        self.assertEqual(loader.load(path).version, 2)

    def test_plugin_prints_do_not_corrupt_protocol_and_progress_still_uses_stdout(self):
        noisy = self.root / 'noisy.py'
        noisy.write_text('from tool_plugin import ImageProcessorPlugin\nprint("import diagnostic")\nclass Processor(ImageProcessorPlugin):\n def process(self,image,options,context):\n  print("processing diagnostic")\n  context.report_progress(50,100,"stage")\n  return image\n')
        output, diagnostics = io.StringIO(), io.StringIO()
        with redirect_stdout(output), redirect_stderr(diagnostics):
            process_tool_plugin(self.request(processor=str(noisy)), engine.render_image_with_strokes,
                                lambda *args: print('protocol progress'), lambda: None)
        self.assertNotIn('diagnostic', output.getvalue())
        self.assertIn('processing diagnostic', diagnostics.getvalue())
        self.assertIn('protocol progress', output.getvalue())


if __name__ == '__main__':
    unittest.main()
