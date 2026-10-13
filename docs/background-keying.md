# Screen Keying

Screen Keying estimates a screen color and generates a continuous transparency matte. It independently implements the saturation-ratio and despill behavior described by Blender's [Keying node](https://docs.blender.org/manual/en/latest/compositing/types/keying/keying.html) and [compositor implementation](https://github.com/blender/blender/blob/main/source/blender/nodes/composite/nodes/node_composite_keying.cc). FrameLine does not launch Blender during editing or include its source code. The stored method identifier remains `auto` for compatibility with existing settings.

## Detection and processing

`backend/auto_background.py` samples opaque pixels from all four borders, bounded to about 1,024 samples per side. Quantized color groups identify the dominant backdrop. Additional strong groups must span at least three sides to avoid treating a subject touching two borders as another background. For colored groups, a lower saturation percentile of observed samples handles screen variations without following rare outliers. Custom selection bypasses detection. Only shades sharing the dominant screen channel participate in colored-screen keying.

`backend/screen_keying.py` decodes sRGB bytes into scene-linear channels. Let `p` be the key's strongest RGB channel and `s`, `t` its other channels in descending channel-index order. Equal maxima choose the highest channel index. With balance `b`, the saturation measure is:

```text
other = s × (1 − b) + t × b
saturation = (p − other) × abs(1 − other)
matte = clamp(1 − input_saturation / key_saturation, 0, 1)
output_alpha = source_alpha × matte
```

Input saturation uses associated (premultiplied) scene-linear RGB; the key color is opaque. Matching screen saturation becomes transparent, and foreground mixtures receive partial alpha. Multiple detected screen shades use the minimum matte. The final output stores straight sRGB color and 8-bit alpha.

Black/White Levels remap stable matte areas to `clamp((matte − black) / (white − black), 0, 1)`. A neighborhood is considered an edge when fewer than 90% of its pixels differ from the center by less than Edge Tolerance. Those edges retain their original matte. Edge Size is the neighborhood radius, with replicated pixels at image borders. Tiled processing reads a surrounding halo so tile boundaries produce the same result as processing the complete image.

Despill subtracts `max(p − other, 0) × strength` from the screen's primary channel in linear light, using its own balance. It affects RGB independently of the matte. A cached 16-bit lookup converts channels back to sRGB without Python pixel loops. Ignore masks restore original working RGBA after all processing, including optional edge effects.

## Controls and behavior

| Control | Default | Purpose |
| --- | --- | --- |
| Key Balance | 0.5 | Weight the two non-screen channels in saturation estimation |
| Black / White Levels | 0 / 1 | Clip background residue / solidify retained foreground |
| Edge Size / Tolerance | 3 px / 0.1 | Protect varying matte edges from level clipping |
| Despill Strength / Balance | 100% / 0.5 | Reduce screen-channel contamination in foreground color |
| Border-connected only | Off | Preserve enclosed matching areas; Aggressive overrides this |
| Tolerance | 128 | Neutral baseline; higher values raise black clipping, lower values lower white clipping |

Aggressive adds background clipping according to its strength. Optional smoothing, edge blur, tint, and edge-color cleanup are separate postprocessing steps and remain off initially. Presets can restore previously saved settings.

White, black, gray, and nearly neutral keys do not provide a useful saturation denominator. These backgrounds use maximum-channel color distance and border connectivity, preserving enclosed details unless Aggressive is active. Saturation controls are disabled while this fallback is shown. A fully transparent border cannot identify an opaque backdrop; choose a custom color instead.

Color keying cannot distinguish a green object from the same green screen. Protect such details with Ignore, use connected-only removal where appropriate, or choose a different backdrop. Despill can also change foreground colors sharing the screen channel. Uneven lighting and compression can require level adjustment; a default key is not guaranteed to remove every artifact.

## Contour cleanup and preview cancellation

**Smooth contour** is initially disabled. `contour_smoothing` supplies the maximum boundary movement: 0 disables it, Curved outline allows up to 64 source pixels, and Pixel cleanup allows up to 8. `contour_options` selects the method and independent controls:

```json
{"method":"curve","strength":100,"radius":32,"preserve_corners":true,"corner_angle":110}
```

Strength ranges from 0–100%, Detail size (`radius`) from 1–128 px, and the protected interior angle from 10–160°. Higher angle thresholds protect more corners. Numeric requests without `contour_options` retain the legacy Pixel cleanup behavior. New UI sessions default to Curved outline with an 8 px maximum change. Existing numeric preferences remain readable.

`curve_smoothing.py` samples each closed boundary uniformly and uses a local tangent/normal frame. A robust weighted quadratic fit estimates smooth normal displacement. Projected sampling weights stop a bump's vertical sides from dominating the fit, and residual weights reduce outlier influence. Three passes produce a flowing target without assuming a circle or replacing the whole image with a geometric primitive. Corners must remain below the selected angle at two scales; smoothing arcs end at protected corners rather than crossing them. Very small or thin components and excessive area changes are retained. Strength blends toward the target, and displacement is bounded relative to the original sample chain.

Local polynomial fitting preserves trends rather than averaging image colors; see the [polynomial-filtering reference](https://docs.scipy.org/doc/scipy/reference/generated/scipy.signal.savgol_filter.html) and [weighted fitting reference](https://numpy.org/doc/stable/reference/generated/numpy.polyfit.html). FrameLine implements its fit directly and does not require SciPy or NumPy. Targets are cached separately from strength, movement, and anti-alias settings, so those adjustments reuse the expensive fit. Processing reports progress and checks cancellation while tracing, fitting, and rasterizing. High detail size or movement can still remove intentional features; this is not a semantic hair detector.

Pixel cleanup in `contour_cleanup.py` scans nonzero-alpha runs along both axes and matches nearby endpoints on neighboring scanlines. Both opening/closing orders filter coordinate profiles to flatten small oscillations. Complete matching neighborhoods, coherent flat/monotonic boundaries, thin spans, and persistent opposing slopes are protected. Runs cannot cross neighbors or lose more than half their span. Its [opening/closing principle](https://docs.opencv.org/4.x/d9/d61/tutorial_py_morphological_ops.html) is applied to boundary coordinates; OpenCV is not a dependency.

Newly covered pixels borrow nearby foreground RGBA so removed screen color is not exposed. Original interior colors and opacity remain intact. Curved outlines render at four samples per axis when anti-aliasing is enabled; that coverage is blended with crisp coverage according to the anti-alias strength. The old anti-alias contour pass is skipped so it cannot reshape the new curve a second time. Edge blur is a separate optional pass, and final Ignore compositing restores protected source pixels. `tests/fixtures/curve-before.png` and `curve-after.png` contain registered binary circle regions derived from the supplied examples; `curve-reference.json` records their crops and threshold. Tests measure movement toward that reference, preserve non-circular proportions, and check corner-angle behavior, transparency, protection, cancellation, and Preview/Apply equality.

Routine preview cancellation crosses IPC as `{cancelled: true, code: "PREVIEW_SUPERSEDED"}`. `ImageProcessingService` recreates the coded exception in the renderer, preserving existing latest-request guards and unsubscribing from progress. Preview handlers delete incomplete outputs before returning that envelope. Genuine processing failures still reject. This avoids Electron's handler error logs for replaced work without hiding invalid settings or engine failures. **Reset settings** restores factory processing controls, including keying and contour settings, while preserving Ignore strokes and inspection settings.

## Reference verification

`tests/fixtures/keying-reference.json` contains samples measured with Blender 5.2.2 LTS's CPU Keying node. Cases cover green, blue, red, tied-channel keys, partially transparent sources, balances, despill strength, and matte clipping. Python tests compare visible RGBA within one 8-bit channel value after linear-to-sRGB conversion. They also compare tiled and complete results byte for byte and exercise validation, cancellation, neutral backgrounds, and Ignore protection. Electron tests check controls, presets, real IPC, progress, and Preview/Apply equality.

To regenerate measured samples, install Blender 5.2+ and run from the repository:

```powershell
python scripts/regenerate-keying-reference.py --blender "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"
npm run test:backend
```

The generator reconstructs the input swatches and options from the fixture, writes temporary inputs and EXRs under ignored `build/keying-reference/`, invokes `scripts/blender-keying-reference.py`, and replaces the measured samples in the fixture. Use `--output build/keying-reference/candidate.json` to inspect a candidate without replacing the tracked reference. Review measured changes before accepting a new Blender version.

The Blender-side script also accepts a JSON manifest for custom comparisons:

```json
{
  "output": "build/keying-reference/reference.json",
  "cases": [{
    "name": "example",
    "path": "path/to/image.png",
    "key": [0, 255, 0],
    "inputs": {"Key Balance": 0.5, "Despill Strength": 1.0}
  }]
}
```

```text
blender --background --factory-startup --python scripts/blender-keying-reference.py -- manifest.json
```

The verifier forces sRGB inputs, straight alpha, CPU compositing, and scene-linear EXR output. Reference equality concerns these color-space assumptions and equivalent controls, not Blender's display transform or additional nodes. FrameLine works with 8-bit sRGB image assets and does not reproduce every Blender color-management configuration, garbage/core matte socket, or postprocessing node.
