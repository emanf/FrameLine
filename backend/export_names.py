"""Portable source-export filenames; image labels never become directory paths."""
import re
from pathlib import Path

IMAGE_EXTENSION = re.compile(r'\.(png|jpe?g|webp|bmp|gif|tiff?|svg|avif)$', re.IGNORECASE)
DEVICE_NAME = re.compile(r'^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)', re.IGNORECASE)


def source_export_name(image, index, rendered, output, used):
    source = Path(image['path'])
    label = image.get('name')
    label = label if isinstance(label, str) and label.strip() else f'{index:04d}_{source.name}'
    label = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', label).strip().rstrip('. ')
    stem = IMAGE_EXTENSION.sub('', label).rstrip('. ') or 'Image'
    if DEVICE_NAME.match(stem):
        stem = '_' + stem
    # Leave room for the real data-format extension and a collision suffix.
    stem = stem[:220].rstrip('. ')
    extension = '.png' if rendered else source.suffix.lower()
    name = stem + extension
    counter = 2
    while name.casefold() in used or (output / name).exists():
        name = f'{stem} ({counter}){extension}'
        counter += 1
    used.add(name.casefold())
    return name
