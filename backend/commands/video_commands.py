"""Probe, decode, normalize, and encode video using supplied FFmpeg executables."""
import math
import os
import subprocess
import threading
import time
import uuid
from pathlib import Path


class VideoCommands:
    """Probe, decode, normalize, and encode video using supplied FFmpeg executables."""
    def __init__(self, context):
        self.context = context

    def ffmpeg_executable(self, request):
        """Resolve and validate the supplied FFmpeg executable path."""
        context = self.context
        executable = request.get('ffmpeg_path') or os.environ.get('FRAMELINE_FFMPEG_PATH')
        if not executable or not Path(executable).is_file():
            raise RuntimeError('The bundled FFmpeg executable could not be found. Reinstall the application dependencies.')
        return executable

    def ffprobe_executable(self, request):
        """Resolve and validate the supplied FFprobe executable path."""
        context = self.context
        executable = request.get('ffprobe_path') or os.environ.get('FRAMELINE_FFPROBE_PATH')
        if not executable or not Path(executable).is_file():
            raise RuntimeError('The bundled FFprobe executable could not be found. Reinstall the application dependencies.')
        return executable

    def run_ffmpeg(self, arguments, timeout=3600, progress_total=None, progress_fps=1, progress_offset=0, input_frames=None):
        """Run media processing with bounded stderr, correlated progress, and cooperative cancellation."""
        context = self.context
        if not context.TASK_CANCEL_FILE and progress_total is None and (input_frames is None):
            try:
                result = subprocess.run(arguments, check=False, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=timeout)
            except subprocess.TimeoutExpired as error:
                raise RuntimeError('FFmpeg did not finish before the one-hour processing limit.') from error
            if result.returncode:
                details = result.stderr.strip().splitlines()
                message = details[-1] if details else 'Unknown FFmpeg error.'
                raise RuntimeError(f'FFmpeg failed: {message}')
            return result
        process = subprocess.Popen(arguments, stdin=subprocess.PIPE if input_frames is not None else subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8', errors='replace')
        stderr_lines = []
        writer_errors = []
    
        def write_frames():
            try:
                for frame in input_frames:
                    context.check_cancelled()
                    try:
                        process.stdin.buffer.write(frame)
                    except (BrokenPipeError, OSError):
                        return
            except Exception as error:
                writer_errors.append(error)
                process.kill()
            finally:
                try:
                    process.stdin.close()
                except (BrokenPipeError, OSError):
                    pass
    
        def read_progress():
            out_time = 0
            for line in process.stdout:
                if '=' not in line:
                    continue
                key, value = line.rstrip().split('=', 1)
                if key not in ('out_time_us', 'out_time_ms'):
                    continue
                try:
                    out_time = int(value)
                except ValueError:
                    continue
                if progress_total:
                    frames = max(0, min(progress_total, round(out_time * progress_fps / 1000000)))
                    context.report_progress(progress_offset + frames, progress_offset + progress_total + 1, 'Encoding video…')
        progress_reader = threading.Thread(target=read_progress, daemon=True)
        stderr_reader = threading.Thread(target=lambda: stderr_lines.extend(process.stderr), daemon=True)
        progress_reader.start()
        stderr_reader.start()
        writer = threading.Thread(target=write_frames, daemon=True) if input_frames is not None else None
        if writer:
            writer.start()
        started = time.monotonic()
        try:
            while process.poll() is None:
                if time.monotonic() - started > timeout:
                    process.kill()
                    process.wait()
                    raise RuntimeError('FFmpeg did not finish before the one-hour processing limit.')
                try:
                    context.check_cancelled()
                except context.ExportCancelled:
                    process.terminate()
                    try:
                        process.wait(timeout=3)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()
                    raise
                time.sleep(0.05)
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
            progress_reader.join()
            stderr_reader.join()
            if writer:
                writer.join()
            process.stdout.close()
            process.stderr.close()
        if writer_errors:
            raise writer_errors[0]
        if process.returncode:
            details = ''.join(stderr_lines).strip().splitlines()
            message = details[-1] if details else 'Unknown FFmpeg error.'
            raise RuntimeError(f'FFmpeg failed: {message}')
        return subprocess.CompletedProcess(arguments, process.returncode)

    def timeline_durations(self, sample_times, total_frames, video_duration):
        """Derive positive whole-frame clip durations from video sampling positions."""
        context = self.context
        if not sample_times:
            return []
        total_frames = max(total_frames, len(sample_times))
        starts = []
        for index, sample_time in enumerate(sample_times):
            frame = round(sample_time / video_duration * total_frames)
            lower_bound = starts[-1] + 1 if starts else 0
            upper_bound = total_frames - len(sample_times) + index
            starts.append(max(lower_bound, min(upper_bound, frame)))
        if starts and starts[-1] >= total_frames:
            raise ValueError('The final sampled image falls outside the available project timeline.')
        return [(starts[index + 1] if index + 1 < len(starts) else total_frames) - start for index, start in enumerate(starts)]

    def normalize_sample_frames(self, frame_paths, expected_count):
        """Normalize decoded samples to the requested count without losing their order."""
        context = self.context
        from PIL import Image
        if not frame_paths:
            raise ValueError('FFmpeg could not decode any video frames.')
        frame_paths = sorted(frame_paths)
        for extra_path in frame_paths[expected_count:]:
            extra_path.unlink()
        frame_paths = frame_paths[:expected_count]
        while len(frame_paths) < expected_count:
            next_path = frame_paths[-1].with_name(f'frame_{len(frame_paths) + 1:06d}.png')
            with Image.open(frame_paths[-1]) as last_frame:
                last_frame.save(next_path, format='PNG')
            frame_paths.append(next_path)
        return frame_paths

    def import_video(self, request):
        """Probe and decode video into owned PNG frames using the requested sampling mode."""
        context = self.context
        from PIL import Image
        fps = float(request['fps'])
        if not math.isfinite(fps) or fps <= 0 or fps > 240:
            raise ValueError('Video import FPS must be greater than 0 and no more than 240.')
        source = Path(request['path'])
        if not source.is_file():
            raise FileNotFoundError(f'Video file not found: {source}')
        mode = request.get('mode', 'default')
        interval = float(request.get('interval_seconds', 1))
        image_count = request.get('image_count', 100)
        if mode == 'interval' and (not math.isfinite(interval) or interval <= 0 or interval > 86400):
            raise ValueError('Frame interval must be a finite value greater than 0 and no more than 86,400 seconds.')
        if mode == 'count' and (isinstance(image_count, bool) or not isinstance(image_count, int) or image_count < 1 or (image_count > 100000)):
            raise ValueError('Image count must be a whole number between 1 and 100,000.')
        if mode not in ('default', 'interval', 'count'):
            raise ValueError(f'Unknown video frame extraction mode: {mode}')
        probe = subprocess.run([context.ffprobe_executable(request), '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', str(source)], check=False, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=60)
        if probe.returncode:
            details = probe.stderr.strip().splitlines()
            raise RuntimeError(f'FFprobe failed: {(details[-1] if details else 'Could not read video metadata.')}')
        try:
            video_duration = float(probe.stdout.strip().splitlines()[0])
        except (ValueError, IndexError) as error:
            raise ValueError('Could not determine the duration of the video.') from error
        if not math.isfinite(video_duration) or video_duration <= 0:
            raise ValueError('The video must have a finite duration greater than zero.')
        total_frames = max(1, round(video_duration * fps))
        if mode == 'interval':
            sample_times = [index * interval for index in range(max(1, math.ceil(video_duration / interval - 1e-12)))]
        elif mode == 'count':
            sample_times = [index * video_duration / image_count for index in range(image_count)]
        else:
            sample_times = []
        output = Path(request['output'])
        output.mkdir(parents=True, exist_ok=True)
        pattern = output / 'frame_%06d.png'
        if mode == 'default':
            extraction_fps = fps
        elif mode == 'interval':
            extraction_fps = max(1 / interval, 1 / video_duration) if len(sample_times) == 1 else 1 / interval
        else:
            extraction_fps = image_count / video_duration
        rounding = 'near' if mode in ('default', 'interval') else 'up'
        filters = []
        if mode == 'interval':
            filters.append(f'tpad=stop_mode=clone:stop_duration={video_duration:.12g}')
        filters.append(f'fps={extraction_fps:.12g}:start_time=0:round={rounding}')
        if mode == 'count':
            filters.append(f'tpad=stop_mode=clone:stop_duration={video_duration:.12g}')
        arguments = [context.ffmpeg_executable(request), '-hide_banner', '-loglevel', 'error', '-i', str(source), '-map', '0:v:0', '-vf', ','.join(filters), '-fps_mode', 'vfr', '-start_number', '1']
        if mode == 'interval':
            arguments.extend(['-frames:v', str(len(sample_times))])
        elif mode == 'count':
            arguments.extend(['-frames:v', str(image_count)])
        arguments.append(str(pattern))
        context.run_ffmpeg(arguments)
        frame_paths = sorted(output.glob('frame_*.png'))
        if mode == 'count':
            frame_paths = context.normalize_sample_frames(frame_paths, image_count)
        frames = []
        for frame_path in frame_paths:
            with Image.open(frame_path) as image:
                frames.append({'path': str(frame_path.resolve()), 'name': f'{source.stem} · {frame_path.stem}', 'width': image.width, 'height': image.height, 'format': 'PNG', 'duration_frames': 1})
        if not frames:
            raise ValueError('FFmpeg found no video frames to import.')
        if mode == 'interval':
            if len(frames) != len(sample_times):
                raise ValueError(f'FFmpeg extracted {len(frames)} images for {len(sample_times)} requested interval samples.')
            interval_frames = max(1, round(interval * fps))
            durations = [interval_frames] * len(frames)
            for frame, timestamp, duration in zip(frames, sample_times, durations):
                frame['name'] = f'{source.stem} · {timestamp:.3f}s'
                frame['time_seconds'] = timestamp
                frame['duration_seconds'] = duration / fps
                frame['duration_frames'] = duration
        elif mode == 'count':
            count = len(frames)
            if count != image_count:
                raise ValueError(f'FFmpeg extracted {count} images, but {image_count} were requested.')
            durations = context.timeline_durations(sample_times, total_frames, video_duration)
            for frame, timestamp, duration in zip(frames, sample_times, durations):
                frame['name'] = f'{source.stem} · {timestamp:.3f}s'
                frame['time_seconds'] = timestamp
                frame['duration_seconds'] = duration / fps
                frame['duration_frames'] = duration
        return {'images': frames, 'fps': fps}

    def export_video(self, request):
        """Render timeline images and encode the requested video format with progress."""
        context = self.context
        from PIL import Image, ImageOps
        clips = request['clips']
        if not clips:
            raise ValueError('There are no timeline clips to export.')
        fps = float(request['fps'])
        speed = float(request.get('playback_speed', 1))
        if not math.isfinite(fps) or fps <= 0 or fps > 240:
            raise ValueError('Export FPS must be greater than 0 and no more than 240.')
        if not math.isfinite(speed) or speed <= 0 or speed > 16:
            raise ValueError('Export playback speed must be greater than 0 and no more than 16×.')
        width = 0
        height = 0
        total_frames = sum((context.positive_frame_count(clip['duration_frames']) for clip in clips))
        total_progress = len(clips) * 2 + total_frames + 1
        for index, clip in enumerate(clips, start=1):
            context.check_cancelled()
            context.positive_frame_count(clip['duration_frames'])
            image = context.render_image_with_strokes(clip['path'], clip.get('paint_strokes', []), clip.get('crop'), clip.get('outline'))
            width = max(width, image.width)
            height = max(height, image.height)
            context.report_progress(index, total_progress, f'Preparing video image {index} of {len(clips)}…')
        width += width % 2
        height += height % 2
        output = Path(request['output']).resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        format_name = output.suffix.lower().lstrip('.')
        codecs = {'mp4': ('libx264', ['-crf', '18', '-movflags', '+faststart']), 'mov': ('libx264', ['-crf', '18']), 'webm': ('libvpx-vp9', ['-crf', '30', '-b:v', '0']), 'avi': ('mpeg4', ['-q:v', '3']), 'mkv': ('libx264', ['-crf', '18'])}
        if format_name not in codecs:
            raise ValueError(f'Unsupported video export format: {format_name}')
    
        def frames():
            for index, clip in enumerate(clips):
                context.check_cancelled()
                image = ImageOps.contain(context.render_image_with_strokes(clip['path'], clip.get('paint_strokes', []), clip.get('crop'), clip.get('outline')), (width, height))
                canvas = Image.new('RGB', (width, height), 'black')
                canvas.paste(image, ((width - image.width) // 2, (height - image.height) // 2), image.getchannel('A'))
                pixels = canvas.tobytes()
                context.report_progress(len(clips) + index + 1, total_progress, f'Rendering video image {index + 1} of {len(clips)}…')
                for _ in range(clip['duration_frames']):
                    yield pixels
        codec, options = codecs[format_name]
        temporary_output = output.with_name(f'.{output.stem}.frameline-{uuid.uuid4().hex}{output.suffix}')
        try:
            context.report_progress(len(clips) * 2, total_progress, 'Encoding video…')
            context.run_ffmpeg([context.ffmpeg_executable(request), '-hide_banner', '-loglevel', 'error', '-progress', 'pipe:1', '-nostats', '-y', '-f', 'rawvideo', '-pixel_format', 'rgb24', '-video_size', f'{width}x{height}', '-framerate', f'{fps * speed:.12g}', '-i', 'pipe:0', '-vf', 'format=yuv420p', '-frames:v', str(total_frames), '-fps_mode', 'passthrough', '-c:v', codec, *options, str(temporary_output)], progress_total=total_frames, progress_fps=fps * speed, progress_offset=len(clips) * 2, input_frames=frames())
            context.check_cancelled()
            os.replace(temporary_output, output)
        finally:
            temporary_output.unlink(missing_ok=True)
        context.report_progress(total_progress, total_progress, 'Finishing video export…')
        return {'output': str(output), 'fps': fps * speed, 'frames': sum((clip['duration_frames'] for clip in clips))}
