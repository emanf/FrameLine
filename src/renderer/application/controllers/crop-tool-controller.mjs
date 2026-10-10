import { ControllerBase } from '../controller-base.mjs';
import { cropPixelRect, cropFromPixelRect } from '../../model/crop-geometry.mjs';

/** Coordinate pixel crop fields, handles, and committed crop commands. */
export class CropToolController extends ControllerBase {
  /** Position crop handles and distinguish a pending crop from the committed display crop. */
  updatePreviewCrop(image = this.application.currentPreviewImage()) {
    const runtime = this.application;
    const overlay = document.querySelector("#preview-crop-overlay");
    if (!image) {
      overlay.hidden = true;
      runtime.previewImageWrap.classList.remove("crop-preview");
      runtime.previewCropDraft = null;
      runtime.syncCropControls(null);
      runtime.syncCropFields(null);
      return;
    }
    if (runtime.previewCropDraft && (runtime.previewCropDraft.imageId !== image.id || runtime.previewCropDraft.editRevision !== runtime.vm.editRevision)) {
      runtime.previewCropDraft = null;
    }
    const crop = runtime.previewCropDrag?.imageId === image.id
      ? runtime.previewCropDrag.crop
      : runtime.previewCropDraft?.crop ?? image.crop ?? { left: 0, top: 0, right: 1, bottom: 1 };
    const left = crop.left;
    const top = crop.top;
    const right = crop.right;
    const bottom = crop.bottom;
    runtime.previewImageWrap.style.setProperty("--crop-left", `${left * 100}%`);
    runtime.previewImageWrap.style.setProperty("--crop-top", `${top * 100}%`);
    runtime.previewImageWrap.style.setProperty("--crop-right", `${(1 - right) * 100}%`);
    runtime.previewImageWrap.style.setProperty("--crop-bottom", `${(1 - bottom) * 100}%`);
    const frame = overlay.querySelector(".crop-frame");
    frame.style.left = `${left * 100}%`;
    frame.style.top = `${top * 100}%`;
    frame.style.width = `${(right - left) * 100}%`;
    frame.style.height = `${(bottom - top) * 100}%`;
    const editingCrop = runtime.previewTool === "crop" && runtime.previewToolEnabled;
    overlay.hidden = !editingCrop;
    runtime.previewImageWrap.classList.toggle("crop-preview", !editingCrop && Boolean(image.crop));
    runtime.syncCropControls(image);
    runtime.syncCropFields(image, crop);
  }

  /** Show exact pixel bounds, retaining incomplete focused input until validation finishes. */
  syncCropFields(image, crop, force = false) {
    const runtime = this.application;
    const rect = image ? cropPixelRect(image.width, image.height, crop) : null;
    document.querySelector("#preview-crop-dimensions").textContent = image
      ? `Image: ${image.width} × ${image.height} px` : "Image size: —";
    for (const field of document.querySelectorAll("[data-crop-field]")) {
      const key = field.dataset.cropField;
      field.disabled = !image || !runtime.previewToolEnabled || runtime.previewTool !== "crop";
      field.max = image ? ({ x: image.width - 1, y: image.height - 1, width: image.width - rect.x, height: image.height - rect.y })[key] : "";
      if (force || document.activeElement !== field || field.dataset.imageId !== image?.id) {
        field.value = rect ? rect[key] : "";
      }
      field.dataset.imageId = image?.id ?? "";
    }
  }

  /** Enable crop Apply and Reset according to pending edits and the selected batch scope. */
  syncCropControls(image = this.application.currentPreviewImage()) {
    const runtime = this.application;
    const active = runtime.previewTool === "crop" && runtime.previewToolEnabled;
    const hasCrop = Boolean(image && (runtime.previewCropDraft?.imageId === image.id || image.crop));
    document.querySelector("#preview-crop-apply").disabled = !active || !hasCrop;
    const resetAll = document.querySelector("#preview-crop-scope").value === "all";
    document.querySelector("#preview-crop-reset").disabled = !image || runtime.paddingBusy || runtime.outlineApplyBusy || runtime.refineBusy || !(resetAll
      ? runtime.previewCropDraft || runtime.vm.project.images.some((item) => item.crop)
      : hasCrop);
  }

  /** Move the requested crop edges within normalized bounds while retaining at least one pixel. */
  resizeCrop(crop, handle, dx, dy, minWidth, minHeight) {
    const runtime = this.application;
    const next = { ...crop };
    if (handle.includes("w")) next.left = Math.max(0, Math.min(crop.right - minWidth, crop.left + dx));
    if (handle.includes("e")) next.right = Math.min(1, Math.max(crop.left + minWidth, crop.right + dx));
    if (handle.includes("n")) next.top = Math.max(0, Math.min(crop.bottom - minHeight, crop.top + dy));
    if (handle.includes("s")) next.bottom = Math.min(1, Math.max(crop.top + minHeight, crop.bottom + dy));
    return next;
  }

  /** Commit a normalized crop to the current image or all images and turn live preview off. */
  applyCrop(applyToAll) {
    const runtime = this.application;
    const image = runtime.currentPreviewImage();
    if (!image || !runtime.previewToolEnabled) return false;
    const crop = runtime.previewCropDraft?.imageId === image.id ? runtime.previewCropDraft.crop : image.crop;
    if (!crop) return false;
    runtime.previewCropDraft = null;
    runtime.previewToolEnabled = false;
    if (runtime.vm.setImageCrop(image.id, crop, applyToAll)) {
      runtime.showSuccess(applyToAll ? "Applied crop to all images" : `Applied crop to ${image.name}`);
    }
    runtime.updatePreviewCrop(image);
    runtime.syncToolActivation(image);
    return true;
  }

  /** Bind crop fields after the editor state and required controls are ready. */
  initializeCropFields() {
    const runtime = this.application;
    for (const field of document.querySelectorAll("[data-crop-field]")) {
      const edit = (force = false) => {
        const image = runtime.currentPreviewImage();
        if (!image || !runtime.previewToolEnabled) return;
        const current = runtime.previewCropDraft?.imageId === image.id ? runtime.previewCropDraft.crop : image.crop;
        const rect = cropPixelRect(image.width, image.height, current);
        if (field.value !== "" && Number.isFinite(field.valueAsNumber)) {
          rect[field.dataset.cropField] = field.valueAsNumber;
          runtime.previewCropDraft = runtime.createPreviewDraft(image, { crop: cropFromPixelRect(image.width, image.height, rect) });
        }
        runtime.updatePreviewCrop(image);
        if (force) runtime.syncCropFields(image, runtime.previewCropDraft?.crop ?? image.crop, true);
      };
      field.addEventListener("input", () => edit());
      field.addEventListener("change", () => edit(true));
      field.addEventListener("blur", () => {
        const image = runtime.currentPreviewImage();
        runtime.syncCropFields(image, image && runtime.previewCropDraft?.imageId === image.id ? runtime.previewCropDraft.crop : image?.crop, true);
      });
      field.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          edit(true);
          field.blur();
        }
      });
    }
    document.querySelector("#preview-crop-apply").addEventListener("click", () => {
      runtime.applyCrop(document.querySelector("#preview-crop-scope").value === "all");
    });
    document.querySelector("#preview-crop-scope").addEventListener("change", () => runtime.syncCropControls());
    document.querySelector("#preview-crop-reset").addEventListener("click", () => {
      const image = runtime.currentPreviewImage();
      if (!image || runtime.outlineApplyBusy || runtime.paddingBusy || runtime.refineBusy) return;
      const before = runtime.capturePendingTools();
      const applyToAll = document.querySelector("#preview-crop-scope").value === "all";
      runtime.previewCropDraft = null;
      runtime.previewToolEnabled = false;
      if (runtime.vm.setImageCrop(image.id, null, applyToAll)) {
        runtime.showSuccess(applyToAll ? "Reset crop for all images" : `Reset crop for ${image.name}`);
      }
      else runtime.recordToolGesture(before);
      runtime.updatePreviewCrop(image);
      runtime.syncToolActivation(image);
    });
  }
}
