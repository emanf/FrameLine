"""Export source images, timeline PNG frames, and contact sheets."""
import os
import shutil
import uuid
from pathlib import Path


class ExportCommands:
    """Export source images, timeline PNG frames, and contact sheets."""
    def __init__(self, context):
        self.context = context

    def export_images(self, request):
        """Export source images or trimmed timeline frames using safe output names."""
        context = self.context
        output = Path(request['output'])
        output.mkdir(parents=True, exist_ok=True)
        mode = request['mode']
        count = 0
        if mode == 'sources':
            from export_names import source_export_name
            used_names = set()
            images = request['images']
            for index, image in enumerate(images, start=1):
                context.check_cancelled()
                source = Path(image['path'])
                strokes = image.get('paint_strokes', image.get('paintStrokes', []))
                crop = image.get('crop')
                outline = image.get('outline')
                temporary_destination = None
                destination = output / source_export_name(image, index, bool(strokes or crop or outline), output, used_names)
                if strokes or crop or outline:
                    temporary_destination = destination.with_name(f'.{destination.name}.frameline-{uuid.uuid4().hex}')
                    context.render_image_with_strokes(source, strokes, crop, outline).save(temporary_destination, format='PNG')
                else:
                    temporary_destination = destination.with_name(f'.{destination.name}.frameline-{uuid.uuid4().hex}')
                    shutil.copy2(source, temporary_destination)
                os.replace(temporary_destination, destination)
                count += 1
                context.report_progress(index, len(images), f'Exported {image.get('name', source.name)}…')
        elif mode == 'frames':
            from PIL import Image
            clips = request['clips']
            total = sum((context.positive_frame_count(clip['duration_frames']) for clip in clips))
            frame_number = 1
            for clip in request['clips']:
                context.check_cancelled()
                frame_count = context.positive_frame_count(clip['duration_frames'])
                frame = context.render_image_with_strokes(clip['path'], clip.get('paint_strokes', []), clip.get('crop'), clip.get('outline'))
                for _ in range(frame_count):
                    context.check_cancelled()
                    destination = output / f'frame_{frame_number:06d}.png'
                    temporary_destination = destination.with_name(f'.{destination.name}.frameline-{uuid.uuid4().hex}')
                    try:
                        frame.save(temporary_destination, format='PNG')
                        os.replace(temporary_destination, destination)
                    finally:
                        temporary_destination.unlink(missing_ok=True)
                    frame_number += 1
                    count += 1
                    context.report_progress(count, total, f'Exported frame {count} of {total}…')
        else:
            raise ValueError(f'Unknown image sequence export mode: {mode}')
        return {'output': str(output.resolve()), 'files': count}

    def export_sheet(self, request):
        """Render a contact sheet from current clip images and valid layout parameters."""
        context = self.context
        from PIL import Image, ImageOps
        clips = request['clips']
        if request['mode'] not in ('clips', 'frames'):
            raise ValueError(f'Unknown contact sheet mode: {request['mode']}')
        count = sum((context.positive_frame_count(clip['duration_frames']) for clip in clips)) if request['mode'] == 'frames' else len(clips)
        if count <= 0:
            raise ValueError('There are no timeline images to include in the contact sheet.')
        if count > 1000:
            raise ValueError('Contact sheets are limited to 1,000 thumbnails. Export source images or frames for larger sequences.')
        columns = min(5, count)
        rows = (count + columns - 1) // columns
        cell_width, cell_height, margin = (192, 136, 8)
        sheet = Image.new('RGB', (columns * cell_width + margin, rows * cell_height + margin), '#111111')
        index = 0
        for clip_index, clip in enumerate(clips, start=1):
            context.check_cancelled()
            repeats = context.positive_frame_count(clip['duration_frames']) if request['mode'] == 'frames' else 1
            thumbnail = ImageOps.contain(context.render_image_with_strokes(clip['path'], clip.get('paint_strokes', []), clip.get('crop'), clip.get('outline')), (176, 112))
            for _ in range(repeats):
                x = margin + index % columns * cell_width + (cell_width - thumbnail.width) // 2
                y = margin + index // columns * cell_height + (cell_height - thumbnail.height) // 2
                sheet.paste(thumbnail, (x, y), thumbnail)
                index += 1
            context.report_progress(index, count, f'Creating contact sheet image {clip_index} of {len(clips)}…')
        output = Path(request['output'])
        temporary_output = output.with_name(f'.{output.stem}.frameline-{uuid.uuid4().hex}{output.suffix}')
        try:
            sheet.save(temporary_output, format='PNG')
            context.check_cancelled()
            os.replace(temporary_output, output)
        finally:
            temporary_output.unlink(missing_ok=True)
        return {'output': str(output.resolve()), 'images': count}
