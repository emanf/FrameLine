# Tool API reference

API version: **1**. Renderer tools import public classes from `@frameline/tools`; Python processors import `ImageProcessorPlugin` from `tool_plugin`.

## Inheritance

```text
ToolPlugin
  ActionTool
  PointerTool
  ImageTool
    ImageProcessorTool
```

| Class | Purpose |
| --- | --- |
| `ToolPlugin` | Definition, selection, lifecycle, and optional pointer hooks |
| `ActionTool` | Immediate action; installed tools override `activate()` |
| `PointerTool` | Gestures without an Enable checkbox |
| `ImageTool` | Custom adjustments with Enable state |
| `ImageProcessorTool` | Managed preview, processing, Apply/Discard, and current/all batches |

Built-in tools live in individual files under `src/renderer/tools/builtin/`. Their classes use the same registry and lifecycle as installed tools, delegating specialized gestures and processing to application services.

## Definition

| Property | Requirement |
| --- | --- |
| `id` | Unique lowercase ID, matching the manifest; 1–64 characters |
| `name` | Nonempty display name, at most 80 characters |
| `icon` | Material Symbols Rounded icon identifier, e.g. `invert_colors` |
| `group` | `features`, `basic`, `magic`, or `clear` |
| `mode` | `adjustment`, `pointer`, or `action`; processors use `adjustment` |
| `description` | Optional panel help text |
| `tooltip` | Optional toolbar tooltip; defaults to the display name |
| `ariaLabel` | Optional accessible button name |
| `fields` | Optional array of up to 32 controls |

Installed tools use generated button IDs and cannot override them. `previewMethod` and `applyMethod` are internal built-in adapters to existing preload methods; extension processors use their manifest's Python entry or override `process()`.

## Field schemas

Each field needs a unique `key` (lowercase letter followed by letters, digits, or hyphens; up to 32 characters), a nonempty `label`, a `type`, and a `defaultValue`. Optional `suffix` displays a unit after its value.

| Type | Additional properties | Default |
| --- | --- | --- |
| `range`, `number` | Finite `min`, `max`, optional positive `step` (defaults to 1) | Finite number inside bounds |
| `checkbox` | None | Boolean |
| `color` | None | Six-digit hexadecimal RGB, e.g. `#102030` |
| `select` | Nonempty `options: [{value, label}]` | String matching an option value |

Numeric values are clamped and snapped to the declared step relative to their minimum. Invalid color or select values restore defaults. Schemas and registered definitions are immutable copies. Controls use `preview-<id>-<key>` IDs and `[data-tool-field]` for host gesture tracking.

## Lifecycle and processing methods

| Method/property | Contract |
| --- | --- |
| `activate()` | Select through host pending-edit and processing guards |
| `apply()` | Commit the active draft; return true on success |
| `discard()` | Remove pending host preview changes |
| `mount()` | Optional setup after registration; mount custom controls here |
| `enabledChanged(enabled)` | Optional custom adjustment Enable handler |
| `deactivate()` | Clear transient state after an accepted tool switch |
| `dispose()` | Release plugin-owned resources when closing |
| `pointerDown(event)`, `pointerMove(event)`, `pointerUp(event)` | Return true synchronously to consume an event |
| `process(image, options, task)` | Processor result Promise, used for preview and Apply |
| `id`, `name`, `buttonId`, `requiresEnable`, `isProcessor` | Read-only getters derived from registered metadata/class |

Processor `task` contains `preview` and optional `onProgress({current,total,message})`. The default `process` routes the current edited source to the registered Python processor. An override must return `{path,width,height}` for an owned PNG. Options come from `ToolOptionsViewModel`; the source includes working dimensions, path, and committed effect data.

Pointer events contain normalized `x/y`, `pressure`, `pointerId`, `button`, `shiftKey`, `ctrlKey`, `altKey`, `cancelled`, and normalized coalesced `samples`. Coordinates may fall outside 0–1 during captured dragging. Clamp or clip according to the tool's intended behavior. A cancelled release must restore or discard its draft.

## Host context

| Service | Behavior |
| --- | --- |
| `select(id)` | Guarded tool selection |
| `discard()` | Clear pending host previews |
| `applyProcessor()` | Commit a processor's draft with selected scope |
| `process(id,image,options,task)` | Route a registered Python/built-in processor |
| `currentImage()` | Clone of the active image's project data |
| `materializeImage(image)` | Edited source with `temporary` ownership flag |
| `loadImage(image)` | Decode a path into an HTML Image |
| `storeCanvas(canvas)` | Save an owned PNG, without committing a project edit |
| `previewCanvas(canvas)` | Show a full-image, uncommitted custom draft |
| `commitCanvas(canvas)` | Save and commit one current-image history step with progress and revision validation |
| `releaseImages(paths)` | Discard owned temporary outputs |
| `mountPanel(element)` | Mount custom HTML controls with a host-assigned panel ID |
| `reportError(error)` | Show a themed error notification |

`action(id)` and `command(name)` are built-in adapters; supported command names are `applyCrop`, `applyOutlineControls`, `applyPadding`, and `applyPaintDraft`. Installed tools should use the public image services above. Context is frozen and does not expose the application's mutable view model or Node APIs.

## Python contract

```python
class Processor(ImageProcessorPlugin):
    def process(self, image, options, context):
        # image is an edited RGBA Pillow image
        context.check_cancelled()
        context.report_progress(50, 100, "Processing image")
        return image
```

Return a valid Pillow image. The host converts it to RGBA and writes its owned output. The method is called independently for each batch image. Validate inputs, keep processing deterministic, and report progress at meaningful stages. Do not catch cancellation as a normal error and continue processing.

Processor modules have a package namespace, allowing relative helper imports. Their instances are cached per worker; retain only bounded reusable lookup data, never a previous request's image or output path.

## State boundaries

The registry holds tool instances and immutable definitions. The options view model holds validated control values. `EditorSessionViewModel` holds pending drafts and preview scheduling state. `TimelineViewModel` owns the project and persistent history. Tool preference values are local settings; applied PNGs are project assets. A plugin must not add arbitrary project fields without updating validation, persistence, and tests.
