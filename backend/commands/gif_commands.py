"""Build timed GIF frames and encode cancellable animation exports."""
import json
import math
import os
import subprocess
import sys
import time
import uuid
from pathlib import Path


class GifCommands:
    """Build timed GIF frames and encode cancellable animation exports."""
    def __init__(self, context):
        self.context = context

    def gif_timeline(self, clips, fps, speed):
        """Convert whole-frame clip durations into GIF-compatible timing segments."""
        context = self.context
        frames = 0
        ticks = 0
        selected = []
        durations = []
        for clip in clips:
            frames += context.positive_frame_count(clip['duration_frames'])
            end = round(frames * 100 / (fps * speed))
            if end > ticks:
                selected.append(clip)
                durations.append((end - ticks) * 10)
                ticks = end
        if not selected and clips:
            selected = [clips[-1]]
            durations = [10]
        return (selected, durations)

    def save_gif(self, images, durations, output, loop):
        """Encode pre-rendered images and durations as a GIF with the requested loop mode."""
        context = self.context
        from PIL import Image
        width = max((image.width for image in images))
        height = max((image.height for image in images))
        canvases = []
        for image in images:
            canvas = Image.new('RGBA', (width, height), (0, 0, 0, 0))
            canvas.paste(image, ((width - image.width) // 2, (height - image.height) // 2))
            canvases.append(canvas)
        options = {'save_all': True, 'append_images': canvases[1:], 'duration': durations, 'disposal': 2}
        if loop:
            options['loop'] = 0
        canvases[0].save(output, format='GIF', **options)

    def export_gif(self, request):
        """Render timeline clips and export a cancellable GIF animation."""
        context = self.context
        fps = float(request['fps'])
        speed = float(request.get('playback_speed', 1))
        if not math.isfinite(fps) or fps <= 0 or fps > 240:
            raise ValueError('FPS must be greater than zero and no more than 240.')
        if not math.isfinite(speed) or speed <= 0 or speed > 16:
            raise ValueError('Playback speed must be greater than 0 and no more than 16×.')
        output = Path(request['output'])
        clips = request['clips']
        if not clips:
            raise ValueError('There are no timeline clips to export.')
        clips, durations = context.gif_timeline(clips, fps, speed)
        output.parent.mkdir(parents=True, exist_ok=True)
        temporary_output = output.with_name(f'.{output.stem}.frameline-{uuid.uuid4().hex}{output.suffix}')
        try:
            if context.TASK_CANCEL_FILE:
                from tempfile import TemporaryDirectory
                with TemporaryDirectory(prefix='frameline-gif-') as directory:
                    rendered_paths = []
                    for index, clip in enumerate(clips, start=1):
                        context.check_cancelled()
                        rendered_path = Path(directory) / f'frame_{index:06d}.png'
                        context.render_image_with_strokes(clip['path'], clip.get('paint_strokes', []), clip.get('crop'), clip.get('outline')).save(rendered_path, format='PNG')
                        rendered_paths.append(str(rendered_path))
                        context.report_progress(index, len(clips) + 2, f'Preparing GIF image {index} of {len(clips)}…')
                    context.report_progress(len(clips) + 1, len(clips) + 2, 'Encoding GIF…')
                    context.encode_gif_cancellable({'images': rendered_paths, 'durations': durations, 'loop': request.get('loop_enabled', True), 'output': str(temporary_output)})
                    context.report_progress(len(clips) + 2, len(clips) + 2, 'Finishing GIF export…')
            else:
                images = []
                for clip in clips:
                    images.append(context.render_image_with_strokes(clip['path'], clip.get('paint_strokes', []), clip.get('crop'), clip.get('outline')))
                context.save_gif(images, durations, temporary_output, request.get('loop_enabled', True))
            context.check_cancelled()
            os.replace(temporary_output, output)
        finally:
            temporary_output.unlink(missing_ok=True)
        return {'output': str(output.resolve())}

    def encode_gif_cancellable(self, request):
        """Encode a prepared GIF in a separate worker while honoring cancellation."""
        context = self.context
        command = [sys.executable]
        if not getattr(sys, 'frozen', False):
            command.append(str(Path(context.__file__).resolve()))
        command.append('--gif-worker')
        process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, encoding='utf-8', errors='replace')
        process.stdin.write(json.dumps(request))
        process.stdin.close()
        try:
            while process.poll() is None:
                try:
                    context.check_cancelled()
                except context.ExportCancelled:
                    process.terminate()
                    try:
                        process.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()
                    raise
                time.sleep(0.05)
            error = process.stderr.read().strip()
            if process.returncode:
                raise RuntimeError(f'GIF encoding failed: {error or 'Unknown encoder error.'}')
        finally:
            process.stderr.close()
