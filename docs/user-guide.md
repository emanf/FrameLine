# Using FrameLine

Install and launch FrameLine using either option in the [README](../README.md). The steps below cover the editing tools and their scope; [keyboard and mouse shortcuts](../README.md#keyboard-and-mouse-shortcuts) are listed there.

## Add artwork

Use **+** in the Import panel to choose **Import media** or **Create Empty Images**. Image files become clips with the default duration; video import can extract at a chosen frame rate, interval, or image count. SVG and AVIF imports are converted to editable raster images.

For blank images, choose a preset or enter dimensions, background, and quantity. Transparency is the default. When artwork is already present, FrameLine can use the last imported image's dimensions and corner colors. New images use numbered names such as `Image 001`.

Click an Import item to preview it. Its context menu provides selection, copy/cut/paste, duplicate, and delete actions. The rename button beside the trash icon applies numbered sequences or custom patterns to all or selected images; it changes project labels and exported names rather than renaming the original files.

## Find a tool

The toolbox has two columns separated into three areas:

| Area | Tools, in row order |
| --- | --- |
| Restore | Clear / Recover |
| Image effects | Remove Background / Crop, Outline / Padding, Refine Edges / Clean Pixels |
| Basic tools | Hand / Brush, Color Cleanup / Eraser, Ignore |

Hover a button for its name. Hand is selected at startup. Installed tools appear in their declared section and continue onto another row when needed.

Crop, Outline, Padding, Refine Edges, and Clean Pixels use **Enable** for live preview. Choose the current image or all images before applying. **Apply** commits the result and turns live preview off; **Discard**, or unchecking Enable, removes the pending preview. Switching tools resolves pending changes before leaving them.

## Protect and recover areas

Select **Ignore** and paint the areas you want effects to preserve. The translucent red marks are saved when you release the mouse. **Protect marked areas** controls whether effects honor the mask. **Clear Ignore marks** removes it from the current image; Undo restores it.

The eye button beside Preview Background and the **Show Ignore overlay** checkbox control only the red display. Hiding it keeps protection active and does not create a project edit. Visibility is remembered as an app preference. The overlay is excluded from saved image pixels and exports.

Protection applies to new Brush, Eraser, and Color Cleanup strokes, background removal, outline, edge refinement, pixel cleanup, and supported extension results. Crop expands its proposed bounds to retain protected footprints. Padding keeps the existing image pixels and moves their protection with them. Changes to the mask affect later edits; previously applied edits are not recalculated.

Select **Recover** beside Clear to restore only the pixels you brush over from the imported original, including transparency. Recover deliberately works inside Ignore marks too. **Clear** restores the entire original and clears edits and protection for the chosen image or batch. Both operations are undoable.

Ignore and Recover share size, anti-aliasing, and round/square controls. Alt + mouse wheel changes size. Each released gesture is one Undo/Redo step. Preparing or saving Recover pixels displays progress.

## Paint and clean an image

Brush, Eraser, and Color Cleanup accumulate a draft while you draw. Releasing the mouse records one stroke in history. Apply saves completed strokes without combining their individual undo steps; Discard removes the pending strokes.

For pixel art, turn anti-aliasing off and set feather to zero. For smooth boundaries, enable anti-aliasing; feather controls the additional soft falloff. Brush also has color and opacity controls. Coverage is combined within a stroke, so crossing the same path does not repeatedly build opacity.

Use Color Cleanup when unwanted colors are mixed into foreground pixels. Set Remove and Keep colors, or use Auto Keep to sample nearby foreground colors while retaining hair shading and highlights. Automatic Remove detection is off by default and samples the clicked brush area using the original background's color family as a reference.

Remove Background opens a separate window. **Screen Keying** detects screen colors from the image border, or uses a custom color you choose. Colored screens use a soft saturation matte and built-in despill, following Blender's Keying approach. White, black, gray, and nearly neutral backgrounds use connected color-distance removal instead. Chroma key and sampled-color modes are also available. The preview shows an arrow normally; hold the right mouse button and drag to pan.

Expand **Keying controls** to adjust Key Balance, Black/White Levels, Edge Size/Tolerance, and Despill Strength/Balance. Defaults correspond to the Keying node's basic settings: balance 0.5, levels 0/1, edge size 3 px, edge tolerance 0.1, and despill strength 100% with balance 0.5. Leave Tolerance at 128 and optional edge effects off to start. Increase Black Level or enable Aggressive for faint background residue; lower White Level to make partially retained foreground more opaque. Edge Size/Tolerance protect varying edge pixels from level clipping. These are matte controls rather than a blur.

Screen keying also removes enclosed screen-colored areas. Enable **Connected background only** to preserve enclosed matches; Aggressive overrides that restriction. Neutral backgrounds always use connected removal unless Aggressive is enabled, and saturation controls are disabled for them. If artwork itself shares the screen color, use Ignore to protect it; reduce Despill Strength if foreground colors lose too much saturation.

Optional edge controls add smoothing, blur, tint, and residual-color cleanup after keying. The window's Ignore brush preserves marked source pixels, and Apply to All detects each image's background independently when automatic selection is active. Preview and Apply use the same settings. See [Background keying](background-keying.md) for the algorithm and reference tests.

Under **Edge shape**, enable **Smooth contour**. **Curved outline** reconstructs a flowing boundary for circles, organic artwork, and other shapes. Strength blends toward the smoothed outline; Detail size sets the size of irregularities to smooth; Maximum change limits movement from the original boundary. Start with the defaults, then increase Detail size for wider bumps. A strong setting for the supplied noisy-circle example is 100% Strength, 64 px Detail size, and 12 px Maximum change.

**Protect sharp corners** preserves pointed features that remain sharp at two detail scales. The angle control protects corners with interior angles up to its value: 110° keeps triangle tips and right-angle corners, while a lower value or disabling protection lets more points round off. Large Detail size and Maximum change can remove intentional small features; use Ignore to protect specific areas. **Pixel cleanup** keeps the faster local tooth/notch cleanup with an 8 px movement limit. These settings are shared by preview, Apply, Apply to All, and saved presets.

Enable anti-aliasing for smooth pixel coverage along the reconstructed curve; Edge blur instead creates a soft transition. Curve smoothing changes the outline and does not blur image colors. **Reset settings** restores factory removal values and turns optional effects off. Ignore marks, the current zoom/pan, and preview background stay intact.

Refine Edges handles cutout transparency and color fringes. Clean Pixels handles noise and speckles across the image while keeping alpha unchanged. These controls use the current edited image, so earlier crop, paint, or background changes remain part of the next operation.

## Reduce and arrange the animation

Drag Start and End inside the timeline to set the playback loop. The square loop toggle sits with the playback controls. Frame and duration information is shown in the Frame line panel.

Deleting or cutting clips shifts each loop marker back by the number of removed frames before it. Deleting an imported image does the same for all its timeline clips. If the entire loop is removed, a one-frame range remains at the deletion point; an empty timeline resets the range. Undo restores the clips and their previous loop range.

Use Ctrl to toggle clips and Shift to select a range. Selected clips can move together, share duration changes, or use **Reverse** from their context menu. Reverse changes only selected slots. **Delete frames before** and **Delete frames after** remove timeline clips around the clicked clip while leaving the Import images available.

Open **Frame cleanup** beside the timeline title. Choose whole clips or individual playback frames, then pick a pattern and scope. **Keep every 5**, starting at 1, retains 1, 6, 11, 16, and so on. Other modes cover odd/even positions, repeated keep/skip blocks, target counts or percentages, and custom ranges.

Review the retained items at the bottom before applying. Use × on a preview item to exclude it, or enter forced keep/remove ranges under Manual exceptions. Use the page controls for long results and choose whether timing shortens or retained items hold the original duration. Applying changes the timeline as one undo step and leaves imported assets available.

## Save and export

Save a `.frameline` project to keep the timeline, source originals, current edited images, and effect data together. The portable bundle can reopen without the original files. View preferences, such as Ignore overlay visibility, stay local to the app.

Choose the full timeline, Start–End range, or selected clips for export. The range chooses which time positions are included; **PNG frame sequence** renders each included playback frame, including repeated frames in held clips. Source-image exports use current working images, while GIF/video follow the project frame rate and playback speed.

The About button beside the window controls shows version and author details. Click a link to open it, or use its adjacent copy icon to copy the address.
