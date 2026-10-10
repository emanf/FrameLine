"""Inherited processor API and loading for trusted, locally installed tool plugins."""
import contextlib
import hashlib
import importlib.util
import sys
from pathlib import Path
from PIL import Image


class ImageProcessorPlugin:
    """Subclass and implement process; return an RGBA Pillow image of the result."""
    def process(self, image, options, context):
        raise NotImplementedError("Implement ImageProcessorPlugin.process.")


class ProcessingContext:
    """Progress and cooperative cancellation for both preview and committed processing."""
    def __init__(self, report_progress, check_cancelled):
        self._report_progress = report_progress
        self._output = sys.stdout
        self.check_cancelled = check_cancelled

    def report_progress(self, current, total, message):
        """Send protocol progress on stdout even while plugin print output is redirected."""
        with contextlib.redirect_stdout(self._output):
            self._report_progress(current, total, message)


class ToolPluginLoader:
    """Cache loaded classes by path and modification time within the worker process."""
    def __init__(self):
        self.cache = {}

    def load(self, source):
        path = Path(source).resolve(strict=True)
        signature = (path.stat().st_mtime_ns, path.stat().st_size)
        cached = self.cache.get(path)
        if cached and cached[0] == signature:
            return cached[1]
        name = "frameline_extension_" + hashlib.sha256(str(path).encode()).hexdigest()[:20]
        # A package namespace supports helpers imported relative to processor.py.
        spec = importlib.util.spec_from_file_location(name, path, submodule_search_locations=[str(path.parent)])
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        try:
            with contextlib.redirect_stdout(sys.stderr):
                # Compile the current source instead of accepting a stale bytecode
                # cache when equal-length edits share the same second timestamp.
                exec(compile(path.read_bytes(), str(path), 'exec'), module.__dict__)
            cls = module.Processor
            if not isinstance(cls, type) or not issubclass(cls, ImageProcessorPlugin):
                raise TypeError("Processor must extend ImageProcessorPlugin.")
            processor = cls()
        except Exception:
            sys.modules.pop(name, None)
            raise
        if len(self.cache) >= 64:
            oldest = next(iter(self.cache))
            del self.cache[oldest]
        self.cache[path] = (signature, processor)
        return processor


LOADER = ToolPluginLoader()


def process_tool_plugin(request, render_image, report_progress, check_cancelled):
    """Process the current edited source and persist the host-owned output PNG."""
    check_cancelled()
    report_progress(0, 100, "Preparing tool image")
    image = render_image(request["path"], request.get("paint_strokes", []), request.get("crop"), request.get("outline")).convert("RGBA")
    processor = LOADER.load(request["processor"])
    context = ProcessingContext(report_progress, check_cancelled)
    with contextlib.redirect_stdout(sys.stderr):
        result = processor.process(image, request.get("options", {}), context)
    if not isinstance(result, Image.Image) or result.width <= 0 or result.height <= 0 or max(result.size) > 32767 or result.width * result.height > 100000000:
        raise ValueError("Processor must return a valid Pillow image within supported dimensions.")
    check_cancelled()
    output = Path(request["output"])
    output.parent.mkdir(parents=True, exist_ok=True)
    result.convert("RGBA").save(output, format="PNG", compress_level=1)
    report_progress(100, 100, "Tool complete")
    return {"path": str(output.resolve()), "width": result.width, "height": result.height, "format": "PNG"}
