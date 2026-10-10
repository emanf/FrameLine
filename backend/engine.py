"""JSON-lines transport and composition facade for FrameLine processing commands."""
import json
import math
import os
import shutil
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

TASK_CANCEL_FILE = None
TASK_OUTPUT_LOCK = threading.Lock()
REQUEST_ID = None
LAST_PROGRESS = None


class ExportCancelled(Exception):
    pass


def check_cancelled():
    if TASK_CANCEL_FILE and Path(TASK_CANCEL_FILE).exists():
        raise ExportCancelled("Export cancelled.")


def report_progress(current, total, message):
    global LAST_PROGRESS
    if not TASK_CANCEL_FILE and REQUEST_ID is None:
        return
    now = time.monotonic()
    if LAST_PROGRESS and LAST_PROGRESS[0] == message and current < total and now - LAST_PROGRESS[1] < .05:
        return
    LAST_PROGRESS = (message, now)
    with TASK_OUTPUT_LOCK:
        payload = {
            "type": "progress",
            "current": current,
            "total": total,
            "message": message,
        }
        if REQUEST_ID is not None:
            payload["id"] = REQUEST_ID
        print(json.dumps(payload), flush=True)


def inspect_images(paths):
    """Inspect source dimensions and formats without changing the source files."""
    return _background_commands.inspect_images(paths)


def sample_image_color(request):
    """Read an RGBA sample at a validated source-image position."""
    return _background_commands.sample_image_color(request)


def remove_background(request):
    """Generate a cutout using validated removal, edge, and protection options."""
    return _background_commands.remove_background(request)


def gif_timeline(clips, fps, speed):
    """Convert whole-frame clip durations into GIF-compatible timing segments."""
    return _gif_commands.gif_timeline(clips, fps, speed)


def save_gif(images, durations, output, loop):
    """Encode pre-rendered images and durations as a GIF with the requested loop mode."""
    return _gif_commands.save_gif(images, durations, output, loop)


def export_gif(request):
    """Render timeline clips and export a cancellable GIF animation."""
    return _gif_commands.export_gif(request)


def encode_gif_cancellable(request):
    """Encode a prepared GIF in a separate worker while honoring cancellation."""
    return _gif_commands.encode_gif_cancellable(request)


def positive_frame_count(value):
    """Validate a positive integer timeline frame count."""
    return _raster_commands.positive_frame_count(value)


def apply_image_crop(image, crop):
    """Apply normalized crop bounds as exact source-pixel coverage."""
    return _raster_commands.apply_image_crop(image, crop)


def apply_image_outline(image, outline):
    """Render an inside, center, or outside outline from source alpha."""
    return _raster_commands.apply_image_outline(image, outline)


def apply_outline(request):
    """Create an owned outlined PNG from a materialized source."""
    return _image_commands.apply_outline(request)


def refine_edges(request):
    """Process cutout alpha and edge colors, reporting progress and cancellation."""
    return _image_commands.refine_edges(request)


def clean_pixels(request):
    """Reduce whole-image noise with validated edge-aware cleanup settings."""
    return _image_commands.clean_pixels(request)


def render_current_image(request):
    """Bake current crop, outline, and strokes into an owned working PNG."""
    return _image_commands.render_current_image(request)


def render_image_with_strokes(path, strokes=(), crop=None, outline=None):
    """Return a bounded cached rendering keyed by source metadata and committed effects."""
    return _raster_commands.render_image_with_strokes(path, strokes, crop, outline)


def _render_image_with_strokes(path, strokes=(), crop=None, outline=None):
    """Rasterize source strokes and apply crop/outline once before caching."""
    return _raster_commands._render_image_with_strokes(path, strokes, crop, outline)


def ffmpeg_executable(request):
    """Resolve and validate the supplied FFmpeg executable path."""
    return _video_commands.ffmpeg_executable(request)


def ffprobe_executable(request):
    """Resolve and validate the supplied FFprobe executable path."""
    return _video_commands.ffprobe_executable(request)


def run_ffmpeg(arguments, timeout=3600, progress_total=None, progress_fps=1, progress_offset=0, input_frames=None):
    """Run media processing with bounded stderr, correlated progress, and cooperative cancellation."""
    return _video_commands.run_ffmpeg(arguments, timeout, progress_total, progress_fps, progress_offset, input_frames)


def timeline_durations(sample_times, total_frames, video_duration):
    """Derive positive whole-frame clip durations from video sampling positions."""
    return _video_commands.timeline_durations(sample_times, total_frames, video_duration)


def normalize_sample_frames(frame_paths, expected_count):
    """Normalize decoded samples to the requested count without losing their order."""
    return _video_commands.normalize_sample_frames(frame_paths, expected_count)


def import_video(request):
    """Probe and decode video into owned PNG frames using the requested sampling mode."""
    return _video_commands.import_video(request)


def export_video(request):
    """Render timeline images and encode the requested video format with progress."""
    return _video_commands.export_video(request)


def export_images(request):
    """Export source images or trimmed timeline frames using safe output names."""
    return _export_commands.export_images(request)


def export_sheet(request):
    """Render a contact sheet from current clip images and valid layout parameters."""
    return _export_commands.export_sheet(request)


from commands.background_commands import BackgroundCommands
_background_commands = BackgroundCommands(sys.modules[__name__])
from commands.gif_commands import GifCommands
_gif_commands = GifCommands(sys.modules[__name__])
from commands.raster_commands import RasterCommands
_raster_commands = RasterCommands(sys.modules[__name__])
from commands.image_commands import ImageCommands
_image_commands = ImageCommands(sys.modules[__name__])
from commands.video_commands import VideoCommands
_video_commands = VideoCommands(sys.modules[__name__])
from commands.export_commands import ExportCommands
_export_commands = ExportCommands(sys.modules[__name__])

from project_archive import save_project_archive, open_project_archive

from tool_plugin import process_tool_plugin

COMMANDS = {
    "process_tool_plugin": lambda message: process_tool_plugin(message, render_image_with_strokes, report_progress, check_cancelled),
    "inspect_images": lambda message: inspect_images(message["paths"]),
    "sample_image_color": lambda message: sample_image_color(message),
    "remove_background": lambda message: remove_background(message),
    "apply_outline": lambda message: apply_outline(message),
    "refine_edges": lambda message: refine_edges(message),
    "clean_pixels": lambda message: clean_pixels(message),
    "render_current_image": lambda message: render_current_image(message),
    "save_project": lambda message: save_project_archive(message, render_image_with_strokes),
    "open_project": lambda message: open_project_archive(message),
    "import_video": lambda message: import_video(message),
    "export_gif": lambda message: export_gif(message),
    "export_video": lambda message: export_video(message),
    "export_images": lambda message: export_images(message),
    "export_sheet": lambda message: export_sheet(message),
}


def run_export_task(cancel_file):
    global TASK_CANCEL_FILE
    TASK_CANCEL_FILE = cancel_file
    message = {}
    try:
        message = json.loads(sys.stdin.read())
        command_name = message.get("command")
        if command_name not in ("export_gif", "export_video", "export_images", "export_sheet"):
            raise ValueError(f"Unknown export task: {command_name}")
        result = COMMANDS[command_name](message)
        response = {"type": "result", "result": result}
    except ExportCancelled:
        response = {"type": "cancelled"}
    except Exception as error:
        response = {"type": "error", "error": str(error)}
    print(json.dumps(response), flush=True)


def run_gif_worker():
    from PIL import Image

    request = json.loads(sys.stdin.read())
    images = []
    for value in request["images"]:
        with Image.open(value) as opened:
            images.append(opened.convert("RGBA"))
    save_gif(images, request["durations"], request["output"], request.get("loop", True))


def main():
    global REQUEST_ID, TASK_CANCEL_FILE, LAST_PROGRESS
    if len(sys.argv) == 3 and sys.argv[1] == "--task":
        run_export_task(sys.argv[2])
        return
    if len(sys.argv) == 2 and sys.argv[1] == "--gif-worker":
        run_gif_worker()
        return
    for line in sys.stdin:
        message = {}
        try:
            message = json.loads(line)
            REQUEST_ID = message.get("id")
            TASK_CANCEL_FILE = message.get("cancel_file")
            LAST_PROGRESS = None
            check_cancelled()
            command = COMMANDS.get(message.get("command"))
            if command is None:
                raise ValueError(f"Unknown engine command: {message.get('command')}")
            result = command(message)
            report_progress(100, 100, "Finished")
            response = {"id": message["id"], "result": result}
        except ExportCancelled:
            response = {"id": message.get("id"), "error": "Preview superseded.", "cancelled": True}
        except Exception as error:
            response = {"id": message.get("id"), "error": str(error)}
        print(json.dumps(response), flush=True)
        REQUEST_ID = TASK_CANCEL_FILE = LAST_PROGRESS = None


if __name__ == "__main__":
    main()
