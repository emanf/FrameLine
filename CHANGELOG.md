# Changelog

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
