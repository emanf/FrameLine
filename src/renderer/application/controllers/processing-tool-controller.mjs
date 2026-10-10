import { ControllerBase } from '../controller-base.mjs';

/** Schedule processed-image previews and commit per-image or batch results. */
export class ProcessingToolController extends ControllerBase {
  /** Read validated control values for a registered processor. */
  refineOptions() { return this.processingOptions('refine'); }
  cleanOptions() { return this.processingOptions('clean'); }
  processingOptions(tool) { return this.application.toolControls.read(tool); }
  /** Synchronize option outputs with their declared unit labels. */
  updateProcessingLabels(tool, options) { this.application.toolControls.write(tool, options); }

  /** Invalidate processor preview jobs, hide their canvas, and reset per-tool progress. */
  clearRefinePreview() {
    const runtime = this.application;
    ++runtime.refinePreviewRequestId;
    ++runtime.refinePreviewGeneration;
    runtime.refinePreviewPending = null;
    if (runtime.refinePreviewTimer !== null) clearTimeout(runtime.refinePreviewTimer);
    runtime.refinePreviewTimer = null;
    runtime.previewRefineDraft = null;
    runtime.previewImageWrap.classList.remove('refine-preview');
    document.querySelector('#preview-refine-canvas').hidden = true;
    for (const {id:tool} of runtime.toolRegistry.processors()) {
      document.querySelector(`#preview-${tool}-status`).textContent = 'Enable to preview. Apply commits changes.';
      runtime.setToolProgress(tool, false);
    }
  }

  /** Fit a processed preview canvas and align its dimensions and pixel grid. */
  layoutRefinePreview(image = this.application.currentPreviewImage()) {
    const runtime = this.application;
    if (!image) return;
    const canvas = document.querySelector('#preview-refine-canvas');
    const stage = document.querySelector('#preview-stage');
    const scale = Math.min(stage.clientWidth / canvas.width, stage.clientHeight / canvas.height);
    runtime.previewImageWrap.style.width = `${canvas.width * scale}px`;
    runtime.previewImageWrap.style.height = `${canvas.height * scale}px`;
    document.querySelector('#preview-crop-overlay').hidden = true;
    document.querySelector('#preview-resolution').textContent = `${canvas.width} × ${canvas.height}`;
    runtime.updatePreviewPixelGrid({...image, width: canvas.width, height: canvas.height, crop: null});
  }

  /** Capture validated active-processor options and replace the pending preview job. */
  refreshRefinePreview() {
    const runtime = this.application;
    const image = runtime.currentPreviewImage();
    if (!image || !runtime.isProcessorTool(runtime.previewTool) || !runtime.previewToolEnabled || runtime.refineBusy) return;
    const tool = runtime.previewTool;
    const options = runtime.processingOptions(tool);
    runtime.updateProcessingLabels(tool, options);
    if (tool === 'clean' && !options.strength || tool === 'refine' && !['clean', 'repair', 'smooth', 'shrink'].some(key => options[key])) {
      runtime.clearRefinePreview();
      runtime.redraw();
      return;
    }
    const draft = runtime.previewRefineDraft = runtime.createPreviewDraft(image, { options, tool });
    const requestId = ++runtime.refinePreviewRequestId;
    runtime.refinePreviewPending = {image, snapshot:structuredClone(image), options, tool, draft, requestId, generation:runtime.refinePreviewGeneration};
    const status = document.querySelector(`#preview-${tool}-status`);
    status.textContent = 'Updating preview…';
    runtime.setToolProgress(tool, true);
    runtime.syncToolActivation();
    runtime.scheduleRefinePreview();
  }

  /** Debounce the newest processor preview without starting overlapping jobs. */
  scheduleRefinePreview() {
    const runtime = this.application;
    if (runtime.refinePreviewRunning || runtime.refinePreviewTimer !== null || !runtime.refinePreviewPending) return;
    runtime.refinePreviewTimer = setTimeout(() => {
      runtime.refinePreviewTimer = null;
      void runtime.runRefinePreview();
    }, 60);
  }

  /** Process the newest image-adjustment preview and release temporary output. */
  async runRefinePreview() {
    const runtime = this.application;
    const job = runtime.refinePreviewPending;
    if (!job || runtime.refinePreviewRunning) return;
    runtime.refinePreviewPending = null;
    runtime.refinePreviewRunning = true;
    const {image, snapshot, options, tool, draft, requestId, generation} = job;
    const current = () => generation === runtime.refinePreviewGeneration && !runtime.refineBusy && runtime.previewTool === tool
      && runtime.previewToolEnabled && runtime.isCurrentPreviewDraft(draft);
    const status = document.querySelector(`#preview-${tool}-status`);
    let result;
    try {
      if (!current()) return;
      result = await runtime.toolRegistry.get(tool).process(snapshot, options, {preview:true, onProgress:event => {
        if (current()) { runtime.setToolProgress(tool, true, event); status.textContent=event.message; }
      }});
      if (!current()) return;
      const source = new Image();
      source.src = runtime.localImageUrl(result.path);
      await source.decode();
      if (!current()) return;
      const canvas = document.querySelector('#preview-refine-canvas');
      canvas.width = result.width;
      canvas.height = result.height;
      canvas.getContext('2d').drawImage(source, 0, 0);
      canvas.hidden = false;
      runtime.previewImageWrap.classList.add('refine-preview');
      runtime.layoutRefinePreview(image);
      const ready = requestId === runtime.refinePreviewRequestId;
      status.textContent = ready ? 'Preview ready. Apply to keep these changes.' : 'Updating preview…';
      runtime.setToolProgress(tool, !ready);
    } catch (error) {
      if (current() && requestId === runtime.refinePreviewRequestId && error.code !== 'PREVIEW_SUPERSEDED') {
        runtime.previewImageWrap.classList.remove('refine-preview');
        document.querySelector('#preview-refine-canvas').hidden = true;
        runtime.redrawPaintCanvas();
        status.textContent = `Preview unavailable: ${error.message ?? error}`;
        runtime.setToolProgress(tool, false);
      }
    } finally {
      try {
        if (result) await window.frameLine.discardProcessedImages([result.path]).catch(error => console.warn('Could not remove edge preview:', error));
      } finally {
        runtime.refinePreviewRunning = false;
        runtime.scheduleRefinePreview();
      }
    }
  }

  /** Commit processed images to the project after validating the edit revision. */
  async applyRefineEdges() {
    const runtime = this.application;
    const image = runtime.currentPreviewImage();
    if (!image || !runtime.previewToolEnabled || !runtime.previewRefineDraft || runtime.refineBusy) return false;
    if (runtime.paddingBusy || runtime.outlineApplyBusy || runtime.backgroundEditBusy || runtime.pendingOutlineApply) {
      runtime.notifyError('Wait for the image operation to finish before refining edges.');
      return false;
    }
    const options = {...runtime.previewRefineDraft.options};
    const tool = runtime.previewTool;
    const title = `Applying ${runtime.toolRegistry.get(tool).name}`;
    const all = document.querySelector(`#preview-${tool}-scope`).value === 'all';
    const targets = structuredClone(all ? runtime.vm.project.images : [image]);
    const revision = runtime.vm.editRevision;
    const outputs = [];
    let committed = false;
    runtime.refineBusy = true;
    ++runtime.refinePreviewRequestId;
    ++runtime.refinePreviewGeneration;
    runtime.refinePreviewPending = null;
    runtime.setToolProgress(tool, false);
    if (runtime.refinePreviewTimer !== null) clearTimeout(runtime.refinePreviewTimer);
    runtime.refinePreviewTimer = null;
    runtime.syncToolActivation();
    const progress = runtime.showOperationProgress(title, 'Preparing images…', targets.length);
    try {
      for (const [index, target] of targets.entries()) {
        if (revision !== runtime.vm.editRevision) return false;
        progress.update(index, `${title}: ${target.name}…`);
        outputs.push({imageId: target.id, ...await runtime.toolRegistry.get(tool).process(target, options, {onProgress:event => {
          progress.update(index + event.current / event.total, event.message);
        }})});
        if (revision !== runtime.vm.editRevision) return false;
        progress.update(index + 1, `Processed ${target.name}`);
      }
      runtime.discardPendingToolEdits(false);
      committed = runtime.vm.setWorkingImageResults(outputs, revision);
      if (committed) runtime.showSuccess(`${runtime.toolRegistry.get(tool).name} for ${all ? 'all images' : image.name}`);
    } catch (error) {
      runtime.notifyError(error);
    } finally {
      progress.close();
      runtime.refineBusy = false;
      runtime.syncToolActivation();
      if (!committed) {
        if (outputs.length) await window.frameLine.discardProcessedImages(outputs.map(output => output.path)).catch(runtime.notifyError);
        runtime.refreshRefinePreview();
      }
    }
    return committed;
  }

  /** Bind processor events once when its schema-generated panel is mounted. */
  bindProcessingTool(tool) {
    const runtime = this.application;
    for (const field of document.querySelectorAll(`[data-tool-id="${tool.id}"]`)) {
      field.addEventListener('input', () => {
        runtime.updateProcessingLabels(tool.id, runtime.processingOptions(tool.id));
        runtime.refreshRefinePreview(); runtime.scheduleSavePreferences();
      });
    }
    document.getElementById(`preview-${tool.id}-apply`).addEventListener('click', () => tool.apply());
    document.getElementById(`preview-${tool.id}-discard`).addEventListener('click', () => tool.discard());
    document.getElementById(`preview-${tool.id}-scope`).addEventListener('change', () => runtime.syncToolActivation());
  }

  /** Attach processing events after preferences and project state have been initialized. */
  initializeProcessingControls() {
    for (const tool of this.application.toolRegistry.processors()) this.bindProcessingTool(tool);
  }
}
