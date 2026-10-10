import { ControllerBase } from '../controller-base.mjs';


/** Synchronize tool buttons, controls, and Enable state. */
export class ToolPanelView extends ControllerBase {
  /** Synchronize registered tool selection, control panels, and active-tool labels. */
  updatePreviewToolUi() {
    const runtime = this.application;
    for (const {id:tool, buttonId:id} of runtime.toolRegistry.selectable()) {
      const button = document.querySelector(`#${id}`);
      button.classList.toggle("selected", runtime.previewTool === tool);
      button.setAttribute("aria-pressed", String(runtime.previewTool === tool));
    }
    document.querySelector('#preview-tool-name').textContent = runtime.toolRegistry.get(runtime.previewTool).name.toUpperCase();
    document.querySelector("#preview-hand-options").hidden = runtime.previewTool !== "hand";
    document.querySelector("#preview-crop-controls").hidden = runtime.previewTool !== "crop";
    document.querySelector("#preview-outline-controls").hidden = runtime.previewTool !== "outline";
    document.querySelector("#preview-padding-controls").hidden = runtime.previewTool !== "padding";
    for (const tool of runtime.toolRegistry.selectable()) {
      const panel = document.getElementById(`preview-${tool.id}-controls`);
      if (panel) panel.hidden = runtime.previewTool !== tool.id;
    }
    const colorControls = document.querySelector("#preview-brush-controls");
    colorControls.hidden = !["brush", "eraser", "healing"].includes(runtime.previewTool);
    document.querySelector("#preview-healing-controls").hidden = runtime.previewTool !== "healing";
    document.querySelector("#preview-brush-color-field").hidden = runtime.previewTool !== "brush";
    document.querySelector("#preview-brush-opacity-field").hidden = runtime.previewTool !== "brush";
    document.querySelector("#preview-square-brush-option").hidden = !["brush", "healing"].includes(runtime.previewTool);
    document.querySelector("#preview-brush-feather-value").value = `${document.querySelector("#preview-brush-feather").value}%`;
    document.querySelector("#preview-brush-color").value = runtime.foregroundColor;
    runtime.syncToolActivation();
    runtime.updatePreviewCrop();
    runtime.updateBrushCursor();
  }

  /** Enable controls according to the active tool, source image, and processing state. */
  syncToolActivation(image = this.application.currentPreviewImage()) {
    const runtime = this.application;
    runtime.syncHistoryButtons();
    for (const tool of runtime.toolRegistry.values()) {
      if (tool.id !== 'clear' && tool.definition.mode !== 'pointer') document.getElementById(tool.buttonId).disabled = !image;
    }
    runtime.updateBrushSizeUi(image);
    const checkbox = document.querySelector("#preview-tool-enabled");
    document.querySelector("#preview-feature-enable").hidden = !runtime.isFeatureTool(runtime.previewTool);
    checkbox.checked = runtime.previewToolEnabled;
    checkbox.disabled = !image || runtime.paddingBusy || runtime.outlineApplyBusy || runtime.refineBusy;
    checkbox.setAttribute("aria-label", `Enable ${runtime.previewTool} tool`);
    checkbox.dataset.tooltip = "Enable live preview. Apply commits changes and turns preview off; unchecking discards pending changes.";
    for (const [tool, panel] of [["crop", "crop"], ["outline", "outline"], ["padding", "padding"], ...runtime.toolRegistry.processors().map(tool => [tool.id, tool.id]), ["brush", "brush"]]) {
      const active = runtime.previewToolEnabled && image && (runtime.previewTool === tool || tool === "brush" && ["eraser", "healing"].includes(runtime.previewTool));
      for (const control of document.querySelectorAll(`#preview-${panel}-controls input, #preview-${panel}-controls select, #preview-${panel}-controls button`)) {
        control.disabled = !active || runtime.paddingBusy || runtime.outlineApplyBusy || runtime.refineBusy;
      }
    }
    runtime.syncCropControls(image);
    for (const kind of ["crop", "outline", "padding", ...runtime.toolRegistry.processors().map(tool => tool.id)]) {
      document.querySelector(`#preview-${kind}-scope`).disabled = !image || runtime.paddingBusy || runtime.outlineApplyBusy || runtime.refineBusy;
    }
    const resetOutlines = document.querySelector("#preview-outline-scope").value === "all"
      ? runtime.vm.project.images.some(item => item.outlineSourcePath) : image?.outlineSourcePath;
    document.querySelector("#preview-outline-reset").disabled = !image || runtime.paddingBusy || runtime.outlineApplyBusy || runtime.refineBusy
      || !(resetOutlines || runtime.previewOutlineDraft?.imageId === image.id);
    const paintActive = ["brush", "eraser", "healing"].includes(runtime.previewTool);
    const paintPending = Boolean(image && runtime.previewPaintDraft?.imageId === image.id && runtime.previewPaintDraft.strokes.length);
    document.querySelector("#preview-paint-apply").disabled = !paintActive || !paintPending;
    document.querySelector("#preview-paint-discard").disabled = !paintActive || !paintPending;
    document.querySelector("#preview-stage").classList.toggle("painting", paintActive);
    document.querySelector("#preview-stage").classList.toggle("hand-tool", runtime.previewTool === 'hand');
    document.querySelector("#preview-healing-remove").disabled = !image || runtime.previewTool !== "healing"
      || document.querySelector("#preview-healing-auto").checked || runtime.paddingBusy || runtime.outlineApplyBusy || runtime.refineBusy;
    document.querySelector("#preview-healing-keep").disabled = !image || runtime.previewTool !== "healing"
      || document.querySelector("#preview-healing-auto-keep").checked || runtime.paddingBusy || runtime.outlineApplyBusy || runtime.refineBusy;
    const refinePending = image && runtime.previewRefineDraft?.imageId === image.id && runtime.previewRefineDraft.editRevision === runtime.vm.editRevision;
    for (const {id:tool} of runtime.toolRegistry.processors()) {
      document.querySelector(`#preview-${tool}-apply`).disabled = runtime.previewTool !== tool || !refinePending || !runtime.previewToolEnabled || runtime.refineBusy || runtime.paddingBusy || runtime.outlineApplyBusy;
      document.querySelector(`#preview-${tool}-discard`).disabled = runtime.previewTool !== tool || !refinePending || runtime.refineBusy || runtime.paddingBusy || runtime.outlineApplyBusy;
    }
  }

  /** Bind enable control after the editor state and required controls are ready. */
  initializeEnableControl() {
    const runtime = this.application;
    document.querySelector("#preview-tool-enabled").addEventListener("change", event => {
      if (runtime.paddingBusy || runtime.outlineApplyBusy || runtime.refineBusy) { runtime.syncToolActivation(); return; }
      if (!runtime.currentPreviewImage() || !runtime.isFeatureTool(runtime.previewTool)) { runtime.syncToolActivation(); return; }
      const enabled = event.target.checked;
      const before = runtime.capturePendingTools();
      runtime.stopPlayback();
      runtime.discardPendingToolEdits(false, true);
      runtime.previewToolEnabled = enabled;
      runtime.updatePreviewToolUi();
      runtime.redrawPaintCanvas();
      if (enabled && runtime.previewTool === "outline") runtime.previewOutlineControls();
      if (enabled && runtime.previewTool === "padding") void runtime.refreshPaddingPreview();
      if (enabled && runtime.isProcessorTool(runtime.previewTool)) runtime.refreshRefinePreview();
      runtime.toolRegistry.get(runtime.previewTool).enabledChanged(enabled);
      runtime.recordToolGesture(before);
    });
  }
}
