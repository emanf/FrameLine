import { ControllerBase } from '../controller-base.mjs';
import { originalImage } from '../../model/image-effects.mjs';
import { detectHealingRemoveColor, detectHealingBorderColor } from '../../model/healing-brush.mjs';
import { cropPixelRect } from '../../model/crop-geometry.mjs';

/** Detect local cleanup colors and maintain brush settings. */
export class ColorCleanupToolController extends ControllerBase {
  /** Read the immutable original border as the reference for local Remove-color detection. */
  prepareHealingReference(image) {
    const runtime = this.application;
    if (!image || runtime.previewTool !== 'healing' || !document.querySelector('#preview-healing-auto').checked) return;
    const path = originalImage(image).path;
    const keep = document.querySelector('#preview-healing-auto-keep').checked ? null : document.querySelector('#preview-healing-keep').value;
    const key = `${path}|${keep}`;
    if (runtime.healingReference?.key === key) return;
    const entry = { key, pending: true, color: null };
    runtime.healingReference = entry;
    runtime.healingDetectedColor = null;
    runtime.healingDetectionError = null;
    runtime.updateHealingControls();
    (async () => {
      try {
        const source = new Image();
        source.src = runtime.localImageUrl(path);
        await source.decode();
        const canvas = document.createElement('canvas');
        const edgeSize = 128;
        const pixels = new Uint8ClampedArray(edgeSize * 4 * 4);
        // Sample all four sides independently, preserving each side's colors.
        for (let edge = 0; edge < 4; edge++) {
          const horizontal = edge < 2;
          canvas.width = horizontal ? edgeSize : 1;
          canvas.height = horizontal ? 1 : edgeSize;
          const context = canvas.getContext('2d', {willReadFrequently:true});
          if (horizontal) context.drawImage(source, 0, edge === 0 ? 0 : source.naturalHeight - 1, source.naturalWidth, 1, 0, 0, edgeSize, 1);
          else context.drawImage(source, edge === 2 ? 0 : source.naturalWidth - 1, 0, 1, source.naturalHeight, 0, 0, 1, edgeSize);
          pixels.set(context.getImageData(0, 0, canvas.width, canvas.height).data, edge * edgeSize * 4);
        }
        entry.color = detectHealingBorderColor(pixels, keep)?.color ?? null;
      } catch { /* Missing originals require a manual Remove color. */ }
      finally {
        entry.pending = false;
        if (runtime.healingReference === entry) {
          if (runtime.healingDetectionError?.startsWith('Reading the original image border')) runtime.healingDetectionError = null;
          runtime.updateHealingControls();
        }
      }
    })();
  }

  /** Find a Remove color inside the clicked brush footprint, preferring the original background hue family. */
  detectHealingColorAtBrush(image, stroke) {
    const runtime = this.application;
    runtime.healingDetectedColor = null;
    runtime.healingDetectionError = null;
    runtime.prepareHealingReference(image);
    if (runtime.healingReference?.pending) {
      runtime.healingDetectionError = 'Reading the original image border. Click again when it is ready.';
      runtime.updateHealingControls();
      return false;
    }
    const source = document.querySelector('#preview-image');
    if (!source.complete || !source.naturalWidth || source.src !== runtime.localImageUrl(image.path)) {
      runtime.healingDetectionError = 'Wait for the image to load, then click again.';
      runtime.updateHealingControls();
      return false;
    }
    const x = stroke.points[0][0] * image.width;
    const y = stroke.points[0][1] * image.height;
    const radius = stroke.size / 2;
    const crop = cropPixelRect(image.width, image.height, image.crop);
    const left = Math.max(crop.x, Math.floor(x - radius));
    const top = Math.max(crop.y, Math.floor(y - radius));
    const right = Math.min(crop.x + crop.width, Math.ceil(x + radius));
    const bottom = Math.min(crop.y + crop.height, Math.ceil(y + radius));
    try {
      if (!runtime.healingReference?.color) throw new Error('No clear unwanted color inside this brush area: the original border has no single usable background. Choose Remove color manually.');
      if (right <= left || bottom <= top) throw new Error('Click inside the visible image to detect Remove color.');
      const sample = document.createElement('canvas');
      sample.width = right - left;
      sample.height = bottom - top;
      const context = sample.getContext('2d');
      const hasPaint = !runtime.previewPaintCanvas.hidden && runtime.previewPaintCanvas.width === image.width && runtime.previewPaintCanvas.height === image.height;
      // The existing preview already includes committed and pending strokes.
      // Erasing/cleanup uses a full replacement canvas; ordinary paint is an overlay.
      if (!hasPaint || !runtime.previewImageWrap.classList.contains('paint-erases-image')) {
        context.drawImage(source, left, top, sample.width, sample.height, 0, 0, sample.width, sample.height);
      }
      if (hasPaint) context.drawImage(runtime.previewPaintCanvas, left, top, sample.width, sample.height, 0, 0, sample.width, sample.height);
      const result = detectHealingRemoveColor(context.getImageData(0, 0, sample.width, sample.height).data,
        sample.width, sample.height, stroke.autoKeep ? null : stroke.color, {x:x - left, y:y - top, size:stroke.size, shape:stroke.shape, feather:stroke.feather, antiAlias:stroke.antiAlias, tolerance:Number(document.querySelector('#preview-healing-tolerance').value)}, runtime.healingReference?.color);
      if (!result) throw new Error('No clear unwanted color inside this brush area. Click another area or choose Remove color manually.');
      runtime.healingDetectedColor = `#${result.color.map(value => value.toString(16).padStart(2, '0')).join('')}`;
      runtime.healingDetectionSource = result.source;
      document.querySelector('#preview-healing-remove').value = runtime.healingDetectedColor;
      runtime.updateHealingControls();
      return true;
    } catch (error) {
      runtime.healingDetectionError = error.message ?? String(error);
      runtime.updateHealingControls();
      return false;
    }
  }

  /** Validate cleanup colors and synchronize manual and automatic color controls. */
  updateHealingControls() {
    const runtime = this.application;
    const autoKeep = document.querySelector("#preview-healing-auto-keep").checked;
    document.querySelector("#preview-healing-hair-controls").hidden = !autoKeep;
    document.querySelector("#preview-healing-sample-distance-value").value = `${document.querySelector("#preview-healing-sample-distance").value} px`;
    document.querySelector("#preview-healing-tolerance-value").value = document.querySelector("#preview-healing-tolerance").value;
    document.querySelector("#preview-healing-strength-value").value = `${document.querySelector("#preview-healing-strength").value}%`;
    const automatic = document.querySelector("#preview-healing-auto").checked;
    document.querySelector("#preview-healing-auto-controls").hidden = !automatic;
    document.querySelector("#preview-healing-auto-status").textContent = runtime.healingDetectionError
      ?? (runtime.healingDetectedColor ? `Detected ${runtime.healingDetectedColor.toUpperCase()} from the brush area using the original border (${runtime.healingDetectionSource}).`
        : runtime.healingReference?.pending ? "Reading the original image border…"
        : "Click the image: Auto checks the brush area against the original border, then looks for a nearby shade in the same color family.");
    const different = document.querySelector("#preview-healing-keep").value !== document.querySelector("#preview-healing-remove").value;
    const valid = automatic || autoKeep || different;
    document.querySelector("#preview-healing-error").textContent = "Keep color and Remove color must be different.";
    document.querySelector("#preview-healing-error").hidden = valid;
    runtime.syncToolActivation();
    return valid;
  }

  /** Read a positive brush size and recover the last valid value for incomplete input. */
  currentBrushSize() {
    const runtime = this.application;
    const size = Number(document.querySelector('#preview-brush-size').value);
    return Number.isFinite(size) && size >= 1 ? size : runtime.lastBrushSize;
  }

  /** Synchronize size labels and slider mapping without limiting the entered brush size. */
  updateBrushSizeUi(image = this.application.currentPreviewImage()) {
    const runtime = this.application;
    runtime.lastBrushSize = runtime.currentBrushSize();
    const slider = document.querySelector('#preview-brush-size-slider');
    // This is a convenient slider window, not a brush size limit. Numeric entry
    // and Alt-wheel resize expand it as needed, including beyond image dimensions.
    if (!runtime.resizingBrushWithSlider) slider.max = String(Math.max(512, image?.width ?? 0, image?.height ?? 0, Math.min(Number.MAX_VALUE, runtime.lastBrushSize*2)));
    slider.value = String(runtime.lastBrushSize);
  }

  /** Bind cleanup controls after the editor state and required controls are ready. */
  initializeCleanupControls() {
    const runtime = this.application;
    for (const id of ["keep", "remove", "tolerance", "strength"]) {
      document.querySelector(`#preview-healing-${id}`).addEventListener("input", (event) => {
        if (id === "remove" && !document.querySelector("#preview-healing-auto").checked) runtime.healingManualRemove = event.target.value;
        runtime.updateHealingControls();
        if (id === "keep") {
          runtime.healingDetectedColor = null;
          runtime.healingDetectionError = null;
          runtime.prepareHealingReference(runtime.currentPreviewImage());
          runtime.updateHealingControls();
        }
        runtime.scheduleSavePreferences();
      });
    }
    document.querySelector("#preview-healing-auto").addEventListener("change", () => {
      runtime.healingDetectedColor = null;
      runtime.healingDetectionError = null;
      if (!document.querySelector("#preview-healing-auto").checked) document.querySelector("#preview-healing-remove").value = runtime.healingManualRemove;
      else runtime.prepareHealingReference(runtime.currentPreviewImage());
      runtime.updateHealingControls();
      runtime.scheduleSavePreferences();
    });
    for (const id of ["auto-keep", "sample-distance", "recover-transparency"]) {
      document.querySelector(`#preview-healing-${id}`).addEventListener(id === "sample-distance" ? "input" : "change", () => {
        if (id === "auto-keep") {
          runtime.healingDetectedColor = null;
          runtime.healingDetectionError = null;
          runtime.prepareHealingReference(runtime.currentPreviewImage());
        }
        runtime.updateHealingControls();
        runtime.scheduleSavePreferences();
      });
    }
    document.querySelector("#preview-brush-color").addEventListener("input", (event) => {
      runtime.foregroundColor = event.target.value;
      runtime.scheduleSavePreferences();
    });
    document.querySelector("#preview-brush-opacity").addEventListener("input", (event) => {
      document.querySelector("#preview-brush-opacity-value").value = `${event.target.value}%`;
      runtime.scheduleSavePreferences();
    });
    document.querySelector("#preview-brush-size").addEventListener("input", () => {
      runtime.updateBrushSizeUi();
      runtime.updateBrushCursor();
      runtime.scheduleSavePreferences();
    });
    for (const type of ['change', 'blur']) document.querySelector('#preview-brush-size').addEventListener(type, event => {
      event.target.value = String(runtime.currentBrushSize());
      runtime.updateBrushSizeUi();
      runtime.updateBrushCursor();
      runtime.scheduleSavePreferences();
    });
    document.querySelector('#preview-brush-size-slider').addEventListener('input', event => {
      document.querySelector('#preview-brush-size').value = event.target.value;
      // Keep the slider's scale stable while dragging; numeric entry and wheel
      // resizing can expand it immediately, and reaching its end expands on release.
      runtime.resizingBrushWithSlider = true;
      try { document.querySelector('#preview-brush-size').dispatchEvent(new Event('input', {bubbles:true})); }
      finally { runtime.resizingBrushWithSlider = false; }
    });
    document.querySelector('#preview-brush-size-slider').addEventListener('change', event => {
      if (runtime.currentBrushSize() >= Number(event.target.max)) runtime.updateBrushSizeUi();
    });
    document.querySelector("#preview-square-brush").addEventListener("change", () => {
      runtime.updateBrushCursor();
      runtime.scheduleSavePreferences();
    });
    document.querySelector("#preview-brush-feather").addEventListener("input", (event) => {
      document.querySelector("#preview-brush-feather-value").value = `${event.target.value}%`;
      runtime.updateBrushCursor();
      runtime.scheduleSavePreferences();
    });
    document.querySelector("#preview-brush-antialias").addEventListener("change", () => {
      runtime.updateBrushCursor();
      runtime.scheduleSavePreferences();
    });
  }
}
