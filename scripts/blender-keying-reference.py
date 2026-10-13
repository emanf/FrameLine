"""Generate optional reference pixels using Blender's real CPU Keying compositor node.

Run with Blender --background --factory-startup --python this-file -- manifest.json.
The manifest specifies input PNGs, RGB key colors, options, and a JSON output path.
Blender is a verification tool only; FrameLine does not require it to run.
"""
import argparse
import json
import sys
from pathlib import Path
import bpy


def linear(value):
    value /= 255
    return value / 12.92 if value <= .04045 else ((value + .055) / 1.055) ** 2.4


def render_case(case, directory):
    scene = bpy.context.scene
    image = bpy.data.images.load(str(Path(case['path']).resolve()), check_existing=False)
    image.colorspace_settings.name = 'sRGB'
    image.alpha_mode = 'STRAIGHT'
    tree = bpy.data.node_groups.new('Keying reference', 'CompositorNodeTree')
    tree.interface.new_socket(name='Image', in_out='OUTPUT', socket_type='NodeSocketColor')
    source = tree.nodes.new('CompositorNodeImage')
    source.image = image
    key = tree.nodes.new('CompositorNodeKeying')
    key.inputs['Key Color'].default_value = (*[linear(value) for value in case['key']], 1)
    for identifier, value in case.get('inputs', {}).items():
        key.inputs[identifier].default_value = value
    output = tree.nodes.new('NodeGroupOutput')
    tree.links.new(source.outputs['Image'], key.inputs['Image'])
    tree.links.new(key.outputs['Image'], output.inputs['Image'])
    scene.compositing_node_group = tree
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.render.resolution_x, scene.render.resolution_y = image.size
    scene.render.resolution_percentage = 100
    scene.render.use_compositing = True
    scene.render.compositor_device = 'CPU'
    scene.render.image_settings.file_format = 'OPEN_EXR'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.image_settings.color_depth = '32'
    destination = directory / (case['name'] + '.exr')
    scene.render.filepath = str(destination)
    bpy.ops.render.render(write_still=True)
    result = bpy.data.images.load(str(destination), check_existing=False)
    # Blender's image pixel API uses bottom-up rows and associated linear RGBA.
    pixels = list(result.pixels)
    width, height = result.size
    rows = [pixels[row*width*4:(row+1)*width*4] for row in reversed(range(height))]
    record = {'name': case['name'], 'key': case['key'], 'inputs': case.get('inputs', {}),
              'width': width, 'height': height, 'linear_rgba': [value for row in rows for value in row]}
    bpy.data.images.remove(result)
    bpy.data.images.remove(image)
    bpy.data.node_groups.remove(tree)
    return record


parser = argparse.ArgumentParser()
parser.add_argument('manifest')
options = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
manifest = json.loads(Path(options.manifest).read_text())
destination = Path(manifest['output']).resolve()
destination.parent.mkdir(parents=True, exist_ok=True)
results = [render_case(case, destination.parent) for case in manifest['cases']]
destination.write_text(json.dumps({'blender': bpy.app.version_string, 'color_space': 'scene-linear sRGB', 'cases': results}, indent=2))
