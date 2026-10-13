# Changelog

## 1.1.1 — 2026-10-13

### Added

- Smooth contour with Curved outline and Pixel cleanup modes. Curved outline smooths shape boundaries with adjustable strength, detail size, movement limits, and angle-based corner protection. Pixel cleanup removes local teeth and notches; anti-aliasing and blur remain independent controls.
- Reset settings in Remove Background, preserving Ignore marks, zoom, pan, and the preview background.
- Background keying documentation, reference pixels from Blender's CPU compositor, and an optional reference regeneration script.

### Improved

- Replaced Auto Background with Screen Keying, independently implementing Blender's scene-linear saturation keying approach with soft transparency and built-in despill.
- Added Key Balance, Black/White Levels, edge-aware matte clipping, Despill Strength/Balance, and optional border-connected removal. Preview, Apply, batch processing, and saved presets share these settings.
- Retained a connected color-distance fallback for neutral backgrounds and existing Ignore protection. Aggressive screen removal clips faint matte residue.
- The removal preview shows the normal arrow cursor; a grabbing hand appears during right-button panning.

### Fixed

- Timeline Delete/Cut and Import image deletion now shift Start–End markers and the playhead by removed frame durations, keeping them aligned with surviving content. Undo/redo restores the loop range with the clips.
- Superseded previews return cancellation status without Electron handler error logs. Genuine processing failures remain visible.

### Validation

- Added contour checks for the noisy/clean circle reference, non-circular shapes, corner protection and rounding, thin details, opacity, Ignore protection, and Preview/Apply equality.
- Added deletion checks for varying durations, nonadjacent selections, reused images, removed loop endpoints, automatic End, empty timelines, and undo/redo. Electron checks verify visible loop handles and saved range values.
- Expanded processing and UI checks for screen keying, preview cancellation, settings reset, cursor behavior, contour controls, and batch requests.

Project format and tool API versions remain at 1. Existing portable and legacy JSON projects remain supported.

## 1.1.0 — 2026-10-12

### Added

- Frame cleanup with a retained-frame preview, every-Nth and odd/even patterns, repeating keep/skip groups, count and percentage targets, custom ranges, scope selection, and manual exceptions. Timing can shorten or hold the retained frames.
- Reverse for multiple selected timeline clips, preserving unselected positions and each clip's duration.
- Preview Ignore and Recover brushes with size, anti-aliasing, round/square shapes, Alt + wheel resizing, and one undo step per released stroke.
- Persistent Ignore masks that protect areas from effects, plus an eye toggle that hides the red overlay without disabling protection.
- About with installed version, update date, author links, and borderless contact copy buttons.

### Improved

- Brush, Eraser, Color Cleanup, Ignore, and Recover cache stroke coverage and repaint only affected pixels. Long strokes no longer replay their entire path while dragging.
- Smooth and pixel brushes share the same geometry for their cursor, live rendering, and committed result. Feathering and overlapping paths preserve their original coverage.
- Original-image alignment follows crop, padding, and outline changes so Recover restores the corresponding source pixels.
- Portable projects retain protection masks and image alignment. Python processors, JavaScript processor overrides, and custom canvas tools honor active protection.
- The toolbox uses two columns, with Clear and Recover together, image effects in the next section, and Hand and brushes below a separate divider.

### Fixed

- One-pixel square brushes drawing away from the displayed cursor at fractional zoom.
- Excessive initial timeline height and unnecessary vertical scrolling.
- Inconsistent Ignore overlay colors caused by canvas readback changes.
- Release metadata checks that depended on a hard-coded application version.

The project format and tool API remain at version 1. Existing portable and legacy JSON projects remain supported. Older processed images without original-alignment metadata use centered alignment as a fallback.
