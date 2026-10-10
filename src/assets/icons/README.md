# FrameLine application icon

`frameline.png` is the original approved transparent artwork. Desktop icon files are checked into the repository so release builds use the same artwork on every platform.

- `frameline.ico`: Windows, including 16–256 pixel representations.
- `frameline.icns`: macOS, including standard and Retina representations up to 1024 pixels.
- `frameline-512.png`: Linux, native windows, and the title bar.

To regenerate these containers after replacing the source artwork, run `node scripts/generate-icons.mjs` from the repository root. This preserves the original PNG and its transparency.

The application loads native icons from real files under `resources/icons` in packaged builds. Electron Builder embeds the macOS bundle icon. Its Windows `afterPack` hook uses the builder's PE resource library to embed the ICO and application metadata without requiring symbolic-link privileges.

