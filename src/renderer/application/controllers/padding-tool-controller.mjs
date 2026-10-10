import { ControllerBase } from '../controller-base.mjs';
import { matchesToolSource } from '../../model/tool-draft.mjs';

/** Preview linked or independent padding and preserve edited pixels. */
export class PaddingToolController extends ControllerBase {
  /** Read whole-pixel padding values for each side. */
  paddingValues() {
    const runtime = this.application;
    return Object.fromEntries([...document.querySelectorAll("[data-padding-field]")].map(field =>
      [field.dataset.paddingField, Math.max(0, Math.min(4096, Math.round(Number(field.value) || 0)))]));
  }

  /** Fit padded image dimensions and align its preview grid and resolution label. */
  layoutPaddingPreview(image = this.application.currentPreviewImage()) {
    const runtime = this.application;
    if (!image) return;
    const canvas = document.querySelector("#preview-padding-canvas");
    const stage = document.querySelector("#preview-stage");
    const scale = Math.min(stage.clientWidth / canvas.width, stage.clientHeight / canvas.height);
    runtime.previewImageWrap.style.width = `${canvas.width * scale}px`;
    runtime.previewImageWrap.style.height = `${canvas.height * scale}px`;
    document.querySelector("#preview-crop-overlay").hidden = true;
    document.querySelector("#preview-resolution").textContent = `${canvas.width} × ${canvas.height}`;
    runtime.updatePreviewPixelGrid({ ...image, width: canvas.width, height: canvas.height, crop: null });
  }

  /** Build the pending padding preview without changing the project image. */
  async refreshPaddingPreview() {
    const runtime = this.application;
    const image = runtime.currentPreviewImage();
    if (!image || !runtime.previewToolEnabled || runtime.previewTool !== "padding") return;
    const padding = runtime.paddingValues();
    const revision = ++runtime.paddingPreviewRevision;
    if (!Object.values(padding).some(Boolean)) {
      runtime.setToolProgress('padding', false);
      runtime.previewPaddingDraft = null;
      runtime.previewImageWrap.classList.remove("padding-preview");
      document.querySelector("#preview-padding-canvas").hidden = true;
      runtime.redraw();
      return;
    }
    const draft = runtime.previewPaddingDraft = runtime.createPreviewDraft(image, { padding });
    runtime.setToolProgress('padding', true);
    if (!matchesToolSource(runtime.paddingPreviewSource?.source, runtime.vm.project, image)) {
      const snapshot = structuredClone(image);
      runtime.paddingPreviewSource = { source: draft.source, promise: (async () => {
        const current = await runtime.materializeWorkingImage(snapshot);
        try {
          const source = new Image();
          source.src = runtime.localImageUrl(current.path);
          await source.decode();
          return source;
        } finally {
          if (current.temporary) await window.frameLine.discardProcessedImages([current.path]);
        }
      })() };
    }
    try {
      const source = await runtime.paddingPreviewSource.promise;
      if (revision !== runtime.paddingPreviewRevision || runtime.previewPaddingDraft !== draft || !runtime.isCurrentPreviewDraft(draft)) return;
      const width = source.naturalWidth + padding.left + padding.right;
      const height = source.naturalHeight + padding.top + padding.bottom;
      if (width > 32767 || height > 32767 || width * height > 100000000) throw new Error("Use smaller padding values for this image.");
      const canvas = document.querySelector("#preview-padding-canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(source, padding.left, padding.top);
      canvas.hidden = false;
      runtime.previewImageWrap.classList.add("padding-preview");
      runtime.layoutPaddingPreview(image);
    } catch (error) {
      if (revision === runtime.paddingPreviewRevision) runtime.notifyError(error);
    } finally {
      if (revision === runtime.paddingPreviewRevision) runtime.setToolProgress('padding', false);
    }
  }

  /** Commit padded images as one project-history operation. */
  async applyPadding() {
    const runtime = this.application;
    const image = runtime.currentPreviewImage();
    if (!image || !runtime.previewToolEnabled || runtime.paddingBusy) return false;
    if (runtime.backgroundEditBusy || runtime.outlineApplyBusy || runtime.pendingOutlineApply || runtime.refineBusy) {
      runtime.notifyError(new Error("Wait for the image operation to finish before adding padding."));
      return false;
    }
    const padding = Object.fromEntries([...document.querySelectorAll("[data-padding-field]")].map(field => {
      const value = Math.max(0, Math.min(4096, Math.round(Number(field.value) || 0)));
      field.value = value;
      return [field.dataset.paddingField, value];
    }));
    if (!Object.values(padding).some(Boolean)) { runtime.discardPendingToolEdits(); return true; }
    const applyToAll = document.querySelector("#preview-padding-scope").value === "all";
    const targets = structuredClone(applyToAll ? runtime.vm.project.images : [image]);
    const revision = runtime.vm.editRevision;
    const outputs = [];
    let committed = false;
    runtime.paddingBusy = true;
    runtime.syncToolActivation();
    const button = document.querySelector("#preview-padding-apply");
    button.disabled = true;
    const progress = runtime.showOperationProgress("Adding padding", "Preparing images…", targets.length);
    try {
      for (const [index, target] of targets.entries()) {
        progress.update(index, `Adding padding to ${target.name}…`);
        const current = await runtime.materializeWorkingImage(target);
        try {
          if (revision !== runtime.vm.editRevision) return false;
          const width = current.width + padding.left + padding.right;
          const height = current.height + padding.top + padding.bottom;
          if (width > 32767 || height > 32767 || width * height > 100000000) {
            throw new Error(`Padding makes ${target.name} too large. Use smaller values.`);
          }
          const source = new Image();
          source.src = runtime.localImageUrl(current.path);
          await source.decode();
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Could not create the padded image.");
          context.drawImage(source, padding.left, padding.top);
          outputs.push({ imageId: target.id, ...await runtime.storeCanvasImage(canvas) });
          if (revision !== runtime.vm.editRevision) return false;
          progress.update(index + 1, `Added padding to ${target.name}`);
        } finally {
          if (current.temporary) await window.frameLine.discardProcessedImages([current.path]);
        }
      }
      runtime.discardPendingToolEdits(false);
      committed = runtime.vm.setWorkingImageResults(outputs, revision);
      if (committed) runtime.showSuccess(applyToAll ? "Added padding to all images" : `Added padding to ${image.name}`);
    } catch (error) {
      runtime.notifyError(error);
    } finally {
      progress.close();
      runtime.paddingBusy = false;
      runtime.syncToolActivation();
      if (!committed && outputs.length) await window.frameLine.discardProcessedImages(outputs.map(output => output.path)).catch(runtime.notifyError);
    }
    return committed;
  }

  /** Bind padding controls after the editor state and required controls are ready. */
  initializePaddingControls() {
    const runtime = this.application;
    runtime.lastPaddingSide = "left";
    for (const field of document.querySelectorAll("[data-padding-field]")) {
      const edit = () => {
        if (field.value === "") return;
        runtime.lastPaddingSide = field.dataset.paddingField;
        const value = runtime.paddingValues()[runtime.lastPaddingSide];
        if (document.querySelector("#preview-padding-lock").checked) {
          for (const other of document.querySelectorAll("[data-padding-field]")) if (other !== field) other.value = value;
        }
        void runtime.refreshPaddingPreview();
      };
      field.addEventListener("input", edit);
      field.addEventListener("change", () => { field.value = runtime.paddingValues()[field.dataset.paddingField]; edit(); });
    }
    document.querySelector("#preview-padding-lock").addEventListener("change", event => {
      if (event.target.checked) {
        const padding = runtime.paddingValues();
        const value = padding[runtime.lastPaddingSide];
        const changed = Object.values(padding).some(side => side !== value);
        for (const field of document.querySelectorAll("[data-padding-field]")) field.value = value;
        if (changed) void runtime.refreshPaddingPreview();
      }
    });
    document.querySelector("#preview-padding-apply").addEventListener("click", runtime.applyPadding);
  }
}
