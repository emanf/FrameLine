"""Regenerate compact test samples from Blender, using the fixture's input recipe.

Blender is optional and used only for verification. Standard tests read the saved
reference; they neither launch Blender nor require its Python module.
"""
import argparse
import json
import subprocess
from pathlib import Path
from PIL import Image


def regenerate(blender, recipe, destination, directory):
    """Render the recorded color swatches and replace only measured reference data."""
    directory.mkdir(parents=True, exist_ok=True)
    fixture = json.loads(recipe.read_text(encoding='utf-8'))
    colors, block = fixture['source_colors'], fixture['block_width']
    image = Image.new('RGBA', (len(colors)*block, fixture['height']))
    image.putdata([tuple(color) for _ in range(image.height)
                   for color in colors for _ in range(block)])
    source = directory/'colors.png'
    image.save(source)
    reference = directory/'reference.json'
    manifest = directory/'manifest.json'
    manifest.write_text(json.dumps({
        'output': str(reference.resolve()),
        'cases': [{key: value for key, value in case.items() if key in ('name', 'key', 'inputs')}
                  | {'path': str(source.resolve())} for case in fixture['cases']]
    }, indent=2), encoding='utf-8')
    script = Path(__file__).with_name('blender-keying-reference.py')
    subprocess.run([str(blender), '--background', '--factory-startup', '--python', str(script),
                    '--', str(manifest.resolve())], check=True)
    measured = json.loads(reference.read_text(encoding='utf-8'))
    cases = {case['name']: case for case in measured['cases']}
    for case in fixture['cases']:
        rendered = cases[case['name']]
        for sample in case['samples']:
            offset = (sample['y']*rendered['width']+sample['x'])*4
            sample['linear_rgba'] = rendered['linear_rgba'][offset:offset+4]
    fixture['blender'] = measured['blender']
    fixture['color_space'] = measured['color_space']
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(fixture, indent=2)+'\n', encoding='utf-8')
    print(f'Reference samples saved to {destination}')


if __name__ == '__main__':
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--blender', type=Path, required=True, help='Path to the Blender executable (5.2+)')
    parser.add_argument('--recipe', type=Path, default=root/'tests/fixtures/keying-reference.json')
    parser.add_argument('--output', type=Path, default=root/'tests/fixtures/keying-reference.json')
    parser.add_argument('--work-dir', type=Path, default=root/'build/keying-reference')
    arguments = parser.parse_args()
    regenerate(arguments.blender, arguments.recipe, arguments.output, arguments.work_dir)
