# FrameLine application icon

`frameline.png` is the original approved transparent artwork. Desktop icon files are checked into the repository so release builds use the same artwork on every platform.

- `frameline.ico`: Windows, including 16–256 pixel representations.
- `frameline.icns`: macOS, including standard and Retina representations up to 1024 pixels.
- `frameline-512.png`: Linux, native windows, and the title bar.

To regenerate these containers after replacing the source artwork, run `node scripts/generate-icons.mjs` from the repository root. This preserves the original PNG and its transparency.

The application loads native icons from real files under `resources/icons` in packaged builds. Electron Builder also embeds the appropriate icon in the Windows executable and macOS app bundle.

## Artwork provenance

Generated using the built-in image-generation tool with this prompt:

> Create one polished desktop app icon for FrameLine, an image sequence and 2D animation editor. Single centered bold geometric F symbol formed from three offset animation frames, on a square canvas with genuine alpha transparency and generous transparent margins. Match a monochrome dark app theme with pearl white, silver, and charcoal contours. Thick precise shapes with soft rounded corners, subtle sculptural depth, a strong recognizable silhouette that reads at 32px. No words or letters printed as typography, no play triangle, no tiny details, no background tile, no surrounding rounded square, no external shadow, no drawn checkerboard, no mockup, no watermarks. Transparent space around and between the frame layers. Deliver a finished high-quality PNG icon.
