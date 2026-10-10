import { ControllerBase } from '../controller-base.mjs';
import { captureToolSource, matchesToolSource } from '../../model/tool-draft.mjs';
import { cropPixelRect } from '../../model/crop-geometry.mjs';

/** Order transient tool gestures alongside persistent project history. */
export class ToolHistoryController extends ControllerBase {
  /** Capture image identity, source fields, and edit revision with a transient effect draft. */
  createPreviewDraft(image, values) {
    const runtime = this.application;
    return { ...values, imageId: image.id, editRevision: runtime.vm.editRevision,
      source: captureToolSource(runtime.vm.project, image) };
  }

  /** Snapshot current drafts and control values for gesture history. */
  capturePendingTools() {
    const runtime = this.application;
    return {tool:runtime.previewTool, enabled:runtime.previewToolEnabled,
      crop:runtime.previewCropDraft?.crop ? {...runtime.previewCropDraft.crop} : null,
      strokes:runtime.previewPaintDraft?.strokes ?? [],
      outline:runtime.previewOutlineDraft?.outline ? {...runtime.previewOutlineDraft.outline} : null,
      padding:runtime.previewPaddingDraft?.padding ? {...runtime.previewPaddingDraft.padding} : null,
      refine:runtime.previewRefineDraft?.options ? {...runtime.previewRefineDraft.options} : null,
      paddingControls:runtime.previewTool === 'padding' ? {...(runtime.previewPaddingDraft?.padding ?? runtime.paddingValues()), locked:document.querySelector('#preview-padding-lock').checked} : null,
      refineControls:runtime.isProcessorTool(runtime.previewTool) ? {...(runtime.previewRefineDraft?.options ?? runtime.processingOptions(runtime.previewTool))} : null};
  }

  /** Record one changed tool gesture and invalidate its redo branch. */
  recordToolGesture(before) {
    const runtime = this.application;
    const image = runtime.currentPreviewImage();
    if (!image || !before || !runtime.toolEditHistory.record(before, runtime.capturePendingTools(), runtime.vm.historyStateId)) return;
    runtime.toolHistorySource = {imageId:image.id, ...captureToolSource(runtime.vm.project, image)};
    runtime.vm.redoStack = [];
    runtime.syncHistoryButtons();
  }

  /** Enable Undo and Redo only when history is available and no gesture/commit is active. */
  syncHistoryButtons() {
    const runtime = this.application;
    const busy = runtime.previewPaintPointerId !== null || runtime.previewCropDrag !== null || runtime.paddingBusy || runtime.outlineApplyBusy || runtime.refineBusy;
    document.querySelector('#undo').disabled = busy || !(runtime.toolEditHistory.canUndo(runtime.vm.historyStateId) || runtime.vm.canUndo);
    document.querySelector('#redo').disabled = busy || !(runtime.toolEditHistory.canRedo(runtime.vm.historyStateId) || runtime.vm.canRedo);
  }

  /** Restore transient controls and drafts when navigating editor history. */
  restorePendingTools(state) {
    const runtime = this.application;
    const image = runtime.currentPreviewImage();
    if (!image) return;
    runtime.discardPendingToolEdits(false, true);
    runtime.previewTool = state.tool;
    runtime.previewToolEnabled = state.enabled;
    if (state.crop) runtime.previewCropDraft = runtime.createPreviewDraft(image, {crop:{...state.crop}});
    if (state.strokes.length) runtime.previewPaintDraft = runtime.createPreviewDraft(image, {strokes:state.strokes});
    if (state.outline) {
      runtime.previewOutlineDraft = runtime.createPreviewDraft(image, {outline:{...state.outline}});
      for (const [key, value] of Object.entries(state.outline)) {
        document.querySelector(`#preview-outline-${key}`).value = String(key === 'opacity' ? value*100 : value);
      }
      runtime.updateOutlineControlLabels();
      runtime.previewOutlineControls();
    }
    if (state.paddingControls) {
      for (const field of document.querySelectorAll('[data-padding-field]')) field.value = state.paddingControls[field.dataset.paddingField];
      document.querySelector('#preview-padding-lock').checked = state.paddingControls.locked;
      if (state.enabled) void runtime.refreshPaddingPreview();
    }
    if (state.refineControls) {
      runtime.toolControls.write(state.tool, state.refineControls);
      runtime.updateProcessingLabels(state.tool, runtime.processingOptions(state.tool));
      if (state.enabled) runtime.refreshRefinePreview();
    }
    runtime.updatePreviewToolUi();
    runtime.redrawPaintCanvas(image);
    runtime.syncCropFields(image, state.crop ?? image.crop, true);
    runtime.updatePreviewPan();
  }

  /** Close a grouped control gesture and record its before/after snapshots. */
  finishToolControlGesture() {
    const runtime = this.application;
    const before = runtime.toolGestureBefore;
    runtime.toolGestureBefore = null;
    runtime.recordToolGesture(before);
  }

  /** Traverse transient gestures and persistent edits in their user-visible order. */
  navigateEditHistory(redo = false) {
    const runtime = this.application;
    if (runtime.previewPaintPointerId !== null || runtime.previewCropDrag || runtime.paddingBusy || runtime.outlineApplyBusy || runtime.refineBusy) return;
    runtime.finishToolControlGesture();
    runtime.stopPlayback();
    const state = redo ? runtime.toolEditHistory.redo(runtime.vm.historyStateId) : runtime.toolEditHistory.undo(runtime.vm.historyStateId);
    if (state) runtime.restorePendingTools(state);
    else {
      runtime.navigatingHistory = true;
      try { redo ? runtime.vm.redo() : runtime.vm.undo(); }
      finally { runtime.navigatingHistory = false; }
    }
    runtime.syncHistoryButtons();
  }

  /** Validate a draft against the active project and unchanged source-image fields. */
  isCurrentPreviewDraft(draft, image = this.application.currentPreviewImage()) {
    const runtime = this.application;
    return matchesToolSource(draft?.source, runtime.vm.project, image);
  }

  /** Retain drafts across unrelated settings edits and invalidate drafts whose source changed. */
  syncPreviewDrafts() {
    const runtime = this.application;
    const stateChanged = runtime.lastHistoryStateId !== runtime.vm.historyStateId;
    if (stateChanged) {
      if (!runtime.navigatingHistory) runtime.toolEditHistory.redoStack = [];
      runtime.lastHistoryStateId = runtime.vm.historyStateId;
    }
    const drafts = [runtime.previewCropDraft, runtime.previewPaintDraft, runtime.previewOutlineDraft, runtime.previewPaddingDraft,
      runtime.previewRefineDraft, runtime.previewCropDrag, runtime.previewPaintStroke].filter(Boolean);
    const pending = drafts[0];
    if (pending && pending.editRevision !== runtime.vm.editRevision) {
      const image = runtime.vm.project.images.find(item => item.id === pending.imageId);
      // Resizing an earlier clip can move another image under the playhead.
      // Keep editing the draft's asset while an unrelated project edit occurs.
      if (runtime.isCurrentPreviewDraft(pending, image)) runtime.vm.previewImageId = image.id;
    }
    if (runtime.navigatingHistory && stateChanged && runtime.toolHistorySource) {
      const image = runtime.vm.project.images.find(item => item.id === runtime.toolHistorySource.imageId);
      if (matchesToolSource(runtime.toolHistorySource, runtime.vm.project, image)) runtime.vm.previewImageId = image.id;
    }
    const activeImage = runtime.currentPreviewImage();
    if (runtime.toolHistorySource && (runtime.toolHistorySource.imageId !== activeImage?.id
      || !matchesToolSource(runtime.toolHistorySource, runtime.vm.project, activeImage))) {
      const atToolState = [...runtime.toolEditHistory.undoStack, ...runtime.toolEditHistory.redoStack].some(entry => entry.stateId === runtime.vm.historyStateId);
      // When traversing earlier project states, keep undone strokes available for
      // Redo once their source image is restored. A new edit/navigation forks it.
      if (runtime.toolHistorySource.project !== runtime.vm.project || !runtime.navigatingHistory && (stateChanged || atToolState)) {
        runtime.toolEditHistory.clear(); runtime.toolHistorySource = null; runtime.toolGestureBefore = null;
      }
    }
    if (drafts.some(draft => !runtime.isCurrentPreviewDraft(draft, activeImage))) runtime.discardPendingToolEdits(false);
    else {
      // Settings and timeline edits advance the project revision without changing
      // this image. Keep its draft, including gestures and previews still loading.
      for (const draft of drafts) draft.editRevision = runtime.vm.editRevision;
    }
  }

  /** Detect uncommitted image changes requiring Apply, Discard, or Cancel before navigation. */
  hasPendingToolEdits() {
    const runtime = this.application;
    const image = runtime.currentPreviewImage();
    if (!image) return false;
    const valid = draft => draft?.imageId === image.id && draft.editRevision === runtime.vm.editRevision;
    const cropChanged = valid(runtime.previewCropDraft) && JSON.stringify(cropPixelRect(image.width, image.height, runtime.previewCropDraft.crop))
      !== JSON.stringify(cropPixelRect(image.width, image.height, image.crop));
    return Boolean(cropChanged || valid(runtime.previewPaintDraft) && runtime.previewPaintDraft.strokes.length
      || valid(runtime.previewOutlineDraft) || valid(runtime.previewPaddingDraft) && Object.values(runtime.previewPaddingDraft.padding).some(Boolean)
      || valid(runtime.previewRefineDraft));
  }

  /** Cancel previews, clear drafts and captured pointers, and restore the committed display. */
  discardPendingToolEdits(render = true, preserveHistory = false) {
    const runtime = this.application;
    runtime.workingSourceCache.clear();
    void window.frameLine.cancelImagePreview().catch(error => console.warn('Could not stop obsolete preview:', error));
    if (!preserveHistory) {
      runtime.toolEditHistory.clear(); runtime.toolHistorySource = null; runtime.toolGestureBefore = null;
    }
    runtime.previewToolEnabled = !runtime.isFeatureTool(runtime.previewTool);
    const stage = document.querySelector("#preview-stage");
    for (const pointerId of [runtime.previewCropDrag?.pointerId, runtime.previewPaintPointerId]) {
      if (pointerId != null && stage.hasPointerCapture(pointerId)) stage.releasePointerCapture(pointerId);
    }
    runtime.previewCropDrag = null;
    runtime.previewPaintPointerId = null;
    runtime.previewPaintStroke = null;
    runtime.paintPointerBounds = null;
    runtime.paintDirtyRegion = null;
    if (runtime.previewPaintFrame !== null) cancelAnimationFrame(runtime.previewPaintFrame);
    runtime.previewPaintFrame = null;
    runtime.previewCropDraft = null;
    runtime.previewPaintDraft = null;
    runtime.previewOutlineDraft = null;
    runtime.previewPaddingDraft = null;
    runtime.clearRefinePreview();
    runtime.paddingPreviewSource = null;
    runtime.paddingPreviewRevision += 1;
    runtime.previewImageWrap.classList.remove("padding-preview");
    document.querySelector("#preview-padding-canvas").hidden = true;
    runtime.setToolProgress('padding', false);
    runtime.clearLiveOutlinePreview(runtime.currentPreviewImage()?.path);
    const image = runtime.currentPreviewImage();
    document.querySelector("#preview-resolution").textContent = image ? `${image.width} × ${image.height}` : "NO IMAGE";
    if (render) { runtime.redrawPaintCanvas(); runtime.updatePreviewPan(); }
  }

  /** Resolve Apply, Discard, or Cancel before navigation changes the editing source. */
  async resolvePendingToolEdits() {
    const runtime = this.application;
    if (!runtime.hasPendingToolEdits()) return true;
    const revision = runtime.vm.editRevision;
    const imageId = runtime.currentPreviewImage()?.id;
    const result = await runtime.requestMessage({ title: "Apply tool changes?",
      message: `Apply the pending ${runtime.previewTool === 'healing' ? 'Color Cleanup Brush' : runtime.previewTool === 'refine' ? 'Refine Edges' : runtime.previewTool === 'clean' ? 'Clean Pixels' : runtime.previewTool} changes before continuing? Discard restores the image from before these changes.`,
      actions: [{ label: "Cancel", value: "cancel" }, { label: "Discard", value: "discard" },
        { label: "Apply", value: "apply", primary: true }] });
    if (result.action === "cancel" || revision !== runtime.vm.editRevision || imageId !== runtime.currentPreviewImage()?.id) return false;
    if (result.action === "discard") { runtime.discardPendingToolEdits(); return true; }
    return await runtime.toolRegistry.get(runtime.previewTool).apply();
  }

  /** Bind paint actions after the editor state and required controls are ready. */
  initializePaintActions() {
    const runtime = this.application;
    document.querySelector("#preview-paint-apply").addEventListener("click", runtime.applyPaintDraft);
    document.querySelector("#preview-paint-discard").addEventListener("click", () => runtime.discardPendingToolEdits());
  }
}
