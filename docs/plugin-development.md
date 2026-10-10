# Developing FrameLine tools

A tool is a class extending FrameLine's tool SDK. Its folder is discovered at startup; the app validates its manifest and registers its button and controls. No edits to the application entry points are required.

## Try the example

1. Copy `docs/examples/invert-colors` into `extensions/invert-colors` in a source checkout, or into the `extensions` folder inside the app's user-data directory.
2. Restart FrameLine and import or create an image.
3. Select Invert Colors, enable it, adjust Strength, and choose This image or All images.
4. Apply to commit the result, or Discard to restore the working image. Undo reverses Apply.

User-data locations normally include `%APPDATA%\frameline` on Windows, `~/Library/Application Support/frameline` on macOS, and `~/.config/frameline` on Linux. The packaged app's user-data folder is the appropriate installation location when its source is read-only. Release builds also copy bundled tools to `resources/extensions` outside the app archive so Python processors can read their files.

```text
extensions/
  invert-colors/
    plugin.json
    index.mjs
    processor.py
```

## Manifest

```json
{
  "id": "example-invert",
  "name": "Invert Colors",
  "apiVersion": 1,
  "entry": "index.mjs",
  "processor": "processor.py"
}
```

The ID must start with a lowercase letter and contain at most 64 lowercase letters, digits, or hyphens. It must match the tool's definition. Built-in IDs and duplicate IDs are rejected. `entry` is a relative `.mjs` file; optional `processor` is a relative `.py` file. Both must resolve to regular files inside the plugin folder. A renderer request cannot select a different Python file.

Discovery checks the checkout's `extensions` directory first, then user-data extensions. Invalid folders are reported individually and do not stop other tools from loading. Restart after installing, removing, or changing a plugin. There is no package-manager installation, dependency resolution, or hot reload.

## Schema-driven image tools

```javascript
import {ImageProcessorTool} from '@frameline/tools';

export default class InvertColorsTool extends ImageProcessorTool {
  static definition = {
    id: 'example-invert',
    name: 'Invert Colors',
    icon: 'invert_colors',
    group: 'features',
    mode: 'adjustment',
    description: 'Invert image colors without changing transparency.',
    fields: [
      {key: 'strength', label: 'Strength', type: 'range',
       min: 0, max: 100, step: 1, defaultValue: 100, suffix: '%'}
    ]
  };
}
```

The host creates themed inputs, option outputs, Enable, progress, scope, Apply, and Discard. It also schedules previews, resolves pending edits before navigation, validates revisions, groups batch undo, preserves originals, and stores preferences. Supported field types are `range`, `number`, `checkbox`, `select`, and `color`; see the [API reference](tool-api.md) for their schema.

Do not copy the app's toolbar HTML or implement a second preview scheduler. The inherited implementation connects your processor to those services.

## Python processor

```python
from PIL import Image, ImageOps
from tool_plugin import ImageProcessorPlugin

class Processor(ImageProcessorPlugin):
    """Invert RGB while preserving the current source's alpha channel."""
    def process(self, image, options, context):
        strength = options.get("strength", 100)
        if isinstance(strength, bool) or not isinstance(strength, (int, float)) or not 0 <= strength <= 100:
            raise ValueError("Strength must be between 0 and 100.")
        context.check_cancelled()
        context.report_progress(25, 100, "Inverting colors")
        rgb = image.convert("RGB")
        result = Image.blend(rgb, ImageOps.invert(rgb), strength / 100).convert("RGBA")
        result.putalpha(image.getchannel("A"))
        context.check_cancelled()
        return result
```

Export a class named `Processor`. It must inherit `ImageProcessorPlugin`; `process` receives the already edited RGBA image, validated renderer options, and a processing context. Validate options again in Python because backend requests are an independent boundary. Return a Pillow image; the host writes the output PNG. Supported dimensions are positive, at most 32767 on either side, and at most 100 million pixels.

Call `context.check_cancelled()` between expensive phases or tiles. Report progress with `context.report_progress(current, total, message)`. Preview and Apply use the same method and must produce the same pixels for the same input/settings. Keep processors deterministic and avoid global image state; preview and Apply run in different worker processes.

Relative Python helper imports are supported because each processor loads in its own package namespace. Helpers are local files inside your folder; third-party dependencies must already be available in the Python environment. The loader caches processors by file path and modification time. Restart the app after changing helper modules.

Normal plugin print output is redirected to stderr to protect the JSON-lines protocol. Use the context for progress rather than printing JSON or calling internal transport functions.

## JavaScript processors

Omit `processor` from the manifest and override `process`:

```javascript
async process(image, options, {onProgress} = {}) {
  const source = await this.context.materializeImage(image);
  try {
    const loaded = await this.context.loadImage(source);
    const canvas = document.createElement('canvas');
    canvas.width = loaded.naturalWidth;
    canvas.height = loaded.naturalHeight;
    canvas.getContext('2d').drawImage(loaded, 0, 0);
    // Perform your canvas operation, yielding between expensive phases.
    onProgress?.({current: 90, total: 100, message: 'Saving image'});
    return await this.context.storeCanvas(canvas);
  } finally {
    if (source.temporary) await this.context.releaseImages([source.path]);
  }
}
```

Return a host-owned `{path, width, height}` PNG result. The scheduler releases previews and uncommitted outputs. Do not return an arbitrary source path as temporary output. Materialize once to include crop and paint; release only sources marked `temporary`.

JavaScript runs in the renderer and cannot access Node APIs. CPU-heavy processing should use Python or another explicitly integrated worker, with progress and cancellation. Yielding once does not make a long synchronous loop responsive.

## Pointer and action tools

Extend `PointerTool` with `mode: 'pointer'` and `group: 'basic'` for a gesture tool. Override `pointerDown`, `pointerMove`, and `pointerUp`; return `true` synchronously to consume an event. The host captures consumed pointer gestures and supplies normalized image coordinates, pressure, modifiers, coalesced samples, and cancellation state. Right-button panning remains handled by the preview.

Use `context.materializeImage` and `context.loadImage` to prepare a canvas, `context.previewCanvas(canvas)` for an uncommitted display, and `context.commitCanvas(canvas)` on release to create one undo step. `commitCanvas` saves an owned PNG with revision guards and visible progress. Keep a prepared canvas available before accepting a pointer-down; pointer hooks cannot wait for asynchronous image decoding. Override `apply` when your gesture leaves a pending draft instead of committing on release. Override `deactivate` to clear gesture state after switching tools, and `dispose` for retained resources.

Extend `ActionTool` with `mode: 'action'` and override `activate()` for immediate commands or custom dialogs. The base ActionTool routes built-in actions; an installed action supplies its own implementation. Before changing an image, use a canvas commit or a processor rather than modifying project objects directly.

`mount()` can create custom controls and pass an element to `context.mountPanel(element)`. Use app theme classes such as `brush-controls`, `tool-option`, and `secondary-button`. The host manages its visibility; the plugin owns handlers and must remove them in `dispose()`. Custom adjustment tools can react to `enabledChanged(enabled)`. Schema-driven `ImageProcessorTool` remains the simplest choice for effects requiring current/all scope and managed Apply/Discard.

## Persistence and trust

Applied results are stored as normal working images and included in portable projects. They remain viewable and exportable without the extension installed. Original assets and undo snapshots are retained by the host; processor recipes are not replayed when reopening a project.

Extensions are trusted local code. Renderer modules retain Electron's renderer isolation, but a Python processor runs with the app's user privileges. Path validation prevents accidental entry-point traversal; it is not a security sandbox for arbitrary Python code. Install and distribute code you trust.

## Testing a tool

Test options at their limits, transparent images, colorful artwork, small images, cropped/painted inputs, preview/Apply equality, current/all scope, Undo/Redo, Discard, cancellation, and save/open. Use the example as a fixture rather than enabling it for all users.

`tests/tool-plugins.test.mjs` covers registry and discovery behavior. `tests/test_tool_plugin.py` covers the Python SDK. `npm run test:main` copies the example to a temporary extension folder and exercises actual discovery, renderer controls, preview processing, batch Apply, Undo/Redo, progress, and portable save/open.
