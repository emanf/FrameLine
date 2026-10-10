import { ControllerBase } from '../controller-base.mjs';


/** Schedule cancellable outline previews and apply current settings. */
export class OutlineToolController extends ControllerBase {
  /** Read current outline parameters with validated size, opacity, placement, and color. */
  outlineOptionsFromControls() {
    const runtime = this.application;
    return {
      color: document.querySelector("#preview-outline-color").value,
      size: Number(document.querySelector("#preview-outline-size").value),
      position: document.querySelector("#preview-outline-position").value,
      softness: Number(document.querySelector("#preview-outline-softness").value),
      opacity: Number(document.querySelector("#preview-outline-opacity").value) / 100
    };
  }

  /** Return the materialized edited source used by both outline preview and Apply. */
  outlinePreviewBase(image) {
    const runtime = this.application;
    // Paint, erasing, Color Cleanup, and crop are applied to the current result.
    // Replacing an unedited baked outline can still use its saved outline source.
    const working = image.paintStrokes?.length || image.crop || image.outline;
    return {
      path:working ? image.path : image.outlineSourcePath ?? image.path,
      dimensions:working ? {width:image.width, height:image.height}
        : image.outlineSourceDimensions ?? {width:image.width, height:image.height}
    };
  }

  /** Invalidate pending outline jobs and cancel their debounce timer. */
  cancelOutlinePreviewRequests() {
    const runtime = this.application;
    ++runtime.outlinePreviewRequestId;
    ++runtime.outlinePreviewGeneration;
    runtime.outlinePreviewPending = null;
    if (runtime.outlinePreviewTimer !== null) clearTimeout(runtime.outlinePreviewTimer);
    runtime.outlinePreviewTimer = null;
  }

  /** Fit the generated outline dimensions into the preview and align the pixel grid. */
  layoutOutlinePreview(image = this.application.currentPreviewImage()) {
    const runtime = this.application;
    if (!image) return;
    const canvas = document.querySelector('#preview-outline-canvas');
    const stage = document.querySelector('#preview-stage');
    const scale = Math.min(stage.clientWidth / canvas.width, stage.clientHeight / canvas.height);
    runtime.previewImageWrap.style.width = `${canvas.width * scale}px`;
    runtime.previewImageWrap.style.height = `${canvas.height * scale}px`;
    runtime.previewImageWrap.classList.remove('crop-preview');
    document.querySelector('#preview-crop-overlay').hidden = true;
    document.querySelector('#preview-resolution').textContent = `${canvas.width} × ${canvas.height}`;
    runtime.updatePreviewPixelGrid({...image, width:canvas.width, height:canvas.height, crop:null});
  }

  /** Retire the outline draft and restore display of the current working image. */
  clearLiveOutlinePreview(restorePath = this.application.currentPreviewImage()?.path) {
    const runtime = this.application;
    runtime.cancelOutlinePreviewRequests();
    runtime.liveOutlinePreviewImageId = null;
    runtime.previewImageWrap.classList.remove('live-outline-preview', 'outline-preview');
    document.querySelector('#preview-outline-canvas').hidden = true;
    const status = document.querySelector('#preview-outline-status');
    status.textContent = 'Enable to preview. Apply commits changes.';
    status.setAttribute('aria-busy', 'false');
    runtime.setToolProgress('outline', false);
    const previewImage = document.querySelector('#preview-image');
    if (restorePath && previewImage.getAttribute('src') !== runtime.localImageUrl(restorePath)) previewImage.src = runtime.localImageUrl(restorePath);
  }

  /** Format outline slider values in their displayed units. */
  updateOutlineControlLabels() {
    const runtime = this.application;
    const outline = runtime.outlineOptionsFromControls();
    document.querySelector("#preview-outline-size-value").value = `${outline.size} px`;
    document.querySelector("#preview-outline-softness-value").value = `${outline.softness} px`;
    document.querySelector("#preview-outline-opacity-value").value = `${Math.round(outline.opacity * 100)}%`;
  }

  /** Capture current outline settings and schedule a revision-safe live preview. */
  previewOutlineControls() {
    const runtime = this.application;
    const image = runtime.currentPreviewImage();
    if (!image || !runtime.previewToolEnabled || runtime.previewTool !== 'outline' || runtime.outlineApplyBusy) return;
    const outline = runtime.outlineOptionsFromControls();
    const draft = runtime.previewOutlineDraft = runtime.createPreviewDraft(image, {outline});
    runtime.liveOutlinePreviewImageId = image.id;
    runtime.previewImageWrap.classList.add('live-outline-preview');
    const requestId = ++runtime.outlinePreviewRequestId;
    runtime.outlinePreviewPending = {image, snapshot:structuredClone(image), outline, draft, requestId, generation:runtime.outlinePreviewGeneration};
    const status = document.querySelector('#preview-outline-status');
    status.textContent = 'Updating preview…';
    status.setAttribute('aria-busy', 'true');
    runtime.setToolProgress('outline', true);
    runtime.scheduleOutlinePreview();
  }

  /** Debounce the newest outline job while a prior preview is still processing. */
  scheduleOutlinePreview() {
    const runtime = this.application;
    if (runtime.outlinePreviewRunning || runtime.outlinePreviewTimer !== null || !runtime.outlinePreviewPending) return;
    // Throttle instead of debouncing: holding a slider never postpones all work.
    runtime.outlinePreviewTimer = setTimeout(() => {
      runtime.outlinePreviewTimer = null;
      void runtime.runOutlinePreview();
    }, 60);
  }

  /** Process the newest outline request and retire obsolete outputs. */
  async runOutlinePreview() {
    const runtime = this.application;
    const job = runtime.outlinePreviewPending;
    if (!job || runtime.outlinePreviewRunning) return;
    runtime.outlinePreviewPending = null;
    runtime.outlinePreviewRunning = true;
    const {image, snapshot, outline, draft, requestId, generation} = job;
    const current = () => generation === runtime.outlinePreviewGeneration && !runtime.outlineApplyBusy
      && runtime.previewTool === 'outline' && runtime.previewToolEnabled && runtime.isCurrentPreviewDraft(draft);
    const status = document.querySelector('#preview-outline-status');
    let base, result, lease;
    try {
      if (!current()) return;
      if (snapshot.paintStrokes?.length || snapshot.crop || snapshot.outline) {
        lease = await runtime.workingSourceCache.acquire(draft.source, () => runtime.materializeWorkingImage(snapshot));
        base = lease.result;
      } else base = {path:runtime.outlinePreviewBase(snapshot).path, temporary:false};
      if (!current()) return;
      result = await runtime.runImageRequest('previewImageOutline', {path:base.path, outline}, event => {
        if (current()) {
          runtime.setToolProgress('outline', true, event);
          status.textContent = event.message;
        }
      });
      if (!current()) return;
      const source = new Image();
      source.src = runtime.localImageUrl(result.path);
      await source.decode();
      if (!current()) return;
      const canvas = document.querySelector('#preview-outline-canvas');
      canvas.width = result.width; canvas.height = result.height;
      canvas.getContext('2d').drawImage(source, 0, 0);
      canvas.hidden = false;
      runtime.previewImageWrap.classList.add('outline-preview');
      runtime.layoutOutlinePreview(image);
      const ready = requestId === runtime.outlinePreviewRequestId;
      status.textContent = ready ? 'Preview ready. Apply to keep these changes.' : 'Updating preview…';
      status.setAttribute('aria-busy', String(!ready));
      runtime.setToolProgress('outline', !ready);
    } catch (error) {
          if (current() && requestId === runtime.outlinePreviewRequestId && error.code !== 'PREVIEW_SUPERSEDED') {
        runtime.previewImageWrap.classList.remove('outline-preview');
        document.querySelector('#preview-outline-canvas').hidden = true;
        runtime.redrawPaintCanvas();
        status.textContent = `Preview unavailable: ${error.message ?? error}`;
        status.setAttribute('aria-busy', 'false');
        runtime.setToolProgress('outline', false);
      }
    } finally {
      lease?.release();
      const files = [result?.path].filter(Boolean);
      try {
        if (files.length) await window.frameLine.discardProcessedImages(files).catch(error => console.warn('Could not remove outline preview:', error));
      } finally {
        runtime.outlinePreviewRunning = false;
        runtime.scheduleOutlinePreview();
      }
    }
  }

  /** Capture outline scope and settings, then queue a guarded commit of working-image results. */
  async applyOutlineControls() {
    const runtime = this.application;
    const image = runtime.currentPreviewImage();
    if (!image || !runtime.previewToolEnabled || runtime.outlineApplyBusy) return false;
    const outline = runtime.previewOutlineDraft?.outline ?? runtime.outlineOptionsFromControls();
    const targets = document.querySelector("#preview-outline-scope").value === "all"
      ? [...runtime.vm.project.images]
      : [image];
    runtime.cancelOutlinePreviewRequests();
    document.querySelector('#preview-outline-status').textContent = 'Applying outline…';
    document.querySelector('#preview-outline-status').setAttribute('aria-busy', 'true');
    runtime.pendingOutlineApply = {
      revision: ++runtime.outlineApplyRevision,
      editRevision: runtime.vm.editRevision,
      targets: targets.map((target) => ({
        imageId: target.id,
        basePath: target.outlineSourcePath ?? target.path,
        baseDimensions: target.outlineSourceDimensions ?? { width: target.width, height: target.height },
        workingImage: (target.paintStrokes?.length || target.crop || target.outline) ? structuredClone(target) : null
      })),
      outline
    };
    return await runtime.processOutlineApplyQueue();
  }

  /** Process captured outline jobs, commit one batch edit, and release stale outputs. */
  async processOutlineApplyQueue() {
    const runtime = this.application;
    if (runtime.outlineApplyBusy) return false;
    runtime.outlineApplyBusy = true;
    runtime.syncToolActivation();
    let applied = false;
    const button = document.querySelector("#preview-outline-apply");
    button.textContent = "Applying…";
    try {
      while (runtime.pendingOutlineApply) {
        const job = runtime.pendingOutlineApply;
        runtime.pendingOutlineApply = null;
        const outputPaths = [];
        let committed = false;
        const progress = runtime.showOperationProgress('Applying outline', 'Preparing edited images…', job.targets.length);
        try {
          await new Promise(resolve => requestAnimationFrame(resolve));
          const results = [];
          for (const [index, target] of job.targets.entries()) {
            progress.update(index, `Preparing ${target.workingImage?.name ?? 'image'}…`);
            const base = target.workingImage ? await runtime.materializeWorkingImage(target.workingImage)
              : { path: target.basePath, ...target.baseDimensions, temporary: false };
            if (base.temporary) outputPaths.push(base.path);
            const result = await runtime.runImageRequest('applyImageOutline', { path: base.path, outline: job.outline }, event => {
              progress.update(index + event.current / event.total, event.message);
            });
            outputPaths.push(result.path);
            if (job.revision !== runtime.outlineApplyRevision || job.editRevision !== runtime.vm.editRevision) break;
            results.push({
              imageId: target.imageId,
              path: result.path,
              width: result.width,
              height: result.height,
              basePath: base.path,
              baseDimensions: { width: base.width, height: base.height },
              bakedEdits: Boolean(target.workingImage),
              outline: job.outline
            });
            progress.update(index + 1, `Outlined image ${index + 1} of ${job.targets.length}`);
          }
          if (job.revision !== runtime.outlineApplyRevision || runtime.pendingOutlineApply) continue;
          if (job.editRevision !== runtime.vm.editRevision) {
            runtime.previewOutlineDraft = null;
            runtime.clearLiveOutlinePreview(runtime.currentPreviewImage()?.path);
            continue;
          }
          runtime.clearLiveOutlinePreview(null);
          const draft = runtime.previewOutlineDraft;
          runtime.previewOutlineDraft = null;
          committed = runtime.vm.setImageOutlineResults(results, true, job.editRevision);
          if (!committed) runtime.previewOutlineDraft = draft;
          applied = committed;
          if (committed) runtime.previewToolEnabled = false;
        } catch (error) {
          runtime.notifyError(error);
        } finally {
          progress.close();
          if (!committed && outputPaths.length) {
            await window.frameLine.discardProcessedImages(outputPaths).catch(runtime.notifyError);
          }
        }
      }
    } finally {
      runtime.outlineApplyBusy = false;
      button.textContent = "Apply outline";
      runtime.updatePreviewToolUi();
      if (runtime.pendingOutlineApply) void runtime.processOutlineApplyQueue();
      else if (!applied && runtime.previewOutlineDraft && runtime.previewToolEnabled) runtime.previewOutlineControls();
    }
    return applied;
  }

  /** Bind outline controls after the editor state and required controls are ready. */
  initializeOutlineControls() {
    const runtime = this.application;
    for (const selector of [
      "#preview-outline-color",
      "#preview-outline-size",
      "#preview-outline-position",
      "#preview-outline-softness",
      "#preview-outline-opacity"
    ]) {
      const control = document.querySelector(selector);
      let inputSinceChange = false;
      control.addEventListener("input", () => {
        runtime.updateOutlineControlLabels();
        inputSinceChange = true;
        runtime.previewOutlineControls();
      });
      control.addEventListener("change", () => {
        if (!inputSinceChange) runtime.previewOutlineControls();
        inputSinceChange = false;
      });
    }
    runtime.outlineApplyRevision = 0;
    runtime.pendingOutlineApply = null;
    document.querySelector("#preview-outline-apply").addEventListener("click", () => {
      runtime.applyOutlineControls();
    });
    document.querySelector("#preview-outline-scope").addEventListener("change", () => runtime.syncToolActivation());
    document.querySelector("#preview-outline-reset").addEventListener("click", () => {
      const image = runtime.currentPreviewImage();
      if (!image || runtime.outlineApplyBusy || runtime.paddingBusy || runtime.refineBusy) return;
      const before = runtime.capturePendingTools();
      runtime.outlineApplyRevision += 1;
      runtime.pendingOutlineApply = null;
      runtime.previewOutlineDraft = null;
      if (runtime.liveOutlinePreviewImageId === image.id) runtime.clearLiveOutlinePreview(image.path);
      const imageIds = document.querySelector("#preview-outline-scope").value === "all"
        ? runtime.vm.project.images.map((item) => item.id)
        : [image.id];
      runtime.previewToolEnabled = false;
      if (runtime.vm.resetImageOutline(imageIds)) runtime.showSuccess(imageIds.length > 1 ? "Removed outlines from all images" : `Removed outline from ${image.name}`);
      else runtime.recordToolGesture(before);
      runtime.redrawPaintCanvas();
    });
  }
}
