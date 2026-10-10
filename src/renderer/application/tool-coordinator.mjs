import { ToolRegistry } from '../tools/tool-registry.mjs';
import { builtinToolClasses } from '../tools/builtin/index.mjs';
import { ToolControlsView } from '../view/tool-controls-view.mjs';
import { ToolToolbarView } from '../view/tool-toolbar-view.mjs';
import { workingImageRequest, hasImageEdits } from '../model/image-effects.mjs';

/** Own tool discovery and expose only the editor services needed by tool plugins. */
export class ToolCoordinator {
  constructor(application) {
    this.application = application;
    this.registry = new ToolRegistry();
    this.installedIds = new Set();
    this.controls = new ToolControlsView(this.registry);
    this.toolbar = new ToolToolbarView(this.registry);
    application.toolRegistry = this.registry;
    application.toolControls = this.controls;
    application.isProcessorTool = id => Boolean(this.registry.get(id)?.isProcessor);
    application.isFeatureTool = id => Boolean(this.registry.get(id)?.requiresEnable);
    for (const Tool of builtinToolClasses) this.register(Tool);
  }

  /** Instantiate and validate a tool before mounting its controls. */
  register(Tool, manifest) {
    const runtime = this.application;
    const context = Object.freeze({
      select: id => this.select(id),
      action: id => this.action(id),
      command: name => {
        if (!['applyCrop','applyOutlineControls','applyPadding','applyPaintDraft'].includes(name)) throw new Error('Unknown tool command.');
        return name === 'applyCrop' ? runtime.applyCrop(document.querySelector('#preview-crop-scope').value === 'all') : runtime[name]();
      },
      discard: () => runtime.discardPendingToolEdits(),
      applyProcessor: () => runtime.applyRefineEdges(),
      process: (id, image, options, task) => this.process(id, image, options, task),
      reportError: error => runtime.notifyError(error),
      currentImage: () => structuredClone(runtime.currentPreviewImage()),
      materializeImage: image => runtime.materializeWorkingImage(image),
      loadImage: async image => { const source = new Image(); source.src = runtime.localImageUrl(image.path); await source.decode(); return source; },
      storeCanvas: canvas => runtime.storeCanvasImage(canvas),
      previewCanvas: canvas => this.previewCanvas(canvas),
      commitCanvas: canvas => this.commitCanvas(canvas),
      mountPanel: panel => {
        if (!(panel instanceof HTMLElement)) throw new Error('Tool panels must be HTML elements.');
        panel.id = `preview-${Tool.definition.id}-controls`; panel.hidden = true;
        document.querySelector('#preview-brush-controls').before(panel);
      },
      releaseImages: paths => window.frameLine.discardProcessedImages(paths)
    });
    const tool = new Tool(context);
    if (manifest && (tool.id !== manifest.id || tool.definition.buttonId)) throw new Error('Installed tools must use the manifest ID and their default button ID.');
    this.registry.register(tool);
    try {
      this.controls.mount(tool); this.toolbar.mount(tool);
      if (manifest) { this.installedIds.add(tool.id); tool.mount(); }
      return tool;
    } catch (error) {
      this.registry.tools.delete(tool.id); this.installedIds.delete(tool.id); this.controls.models.delete(tool.id);
      if (manifest) {
        document.getElementById(tool.buttonId)?.remove();
        document.getElementById(`preview-${tool.id}-controls`)?.remove();
      }
      try { tool.dispose(); } catch (disposeError) { console.warn(disposeError); }
      throw error;
    }
  }

  /** Load each installed module independently so one broken plugin cannot stop the editor. */
  async loadPlugins() {
    const runtime = this.application;
    if (!window.frameLine.listToolPlugins) return;
    try {
      const {plugins, errors = []} = await window.frameLine.listToolPlugins();
      for (const manifest of plugins) {
        try {
          const module = await import(manifest.entryURL);
          const tool = this.register(module.default, manifest);
          if (tool.isProcessor) {
            this.controls.write(tool.id, runtime.savedPreferences.toolOptions?.[tool.id]);
            runtime.bindProcessingTool(tool);
          }
        } catch (error) { errors.push(`${manifest.id}: ${error.message}`); }
      }
      runtime.updatePreviewToolUi();
      if (errors.length) runtime.notifyError(`Some tools could not be loaded:\n${errors.join('\n')}`);
    } catch (error) { console.warn('Tool discovery unavailable:', error); }
  }

  /** Send normalized image coordinates to installed tools before built-in pointer handling. */
  dispatchPointer(method, event) {
    const runtime = this.application;
    const tool = this.registry.get(runtime.previewTool);
    if (!this.installedIds.has(tool?.id) || !runtime.previewToolEnabled || event.button === 2 || runtime.previewPanPointerId !== null) return false;
    const bounds = runtime.previewImageWrap.getBoundingClientRect();
    const image = runtime.currentPreviewImage();
    if (!image || !bounds.width || !bounds.height) return false;
    const normalize = sample => ({x:(sample.clientX-bounds.left)/bounds.width, y:(sample.clientY-bounds.top)/bounds.height, pressure:sample.pressure});
    try {
      const consumed = tool[method]({...normalize(event), pointerId:event.pointerId, button:event.button,
        cancelled:event.type === 'pointercancel', shiftKey:event.shiftKey, ctrlKey:event.ctrlKey, altKey:event.altKey,
        samples:(event.getCoalescedEvents?.() ?? []).map(normalize)});
      if (consumed === true) {
        event.preventDefault();
        if (method === 'pointerDown') runtime.previewStage.setPointerCapture(event.pointerId);
        if (method === 'pointerUp' && runtime.previewStage.hasPointerCapture(event.pointerId)) runtime.previewStage.releasePointerCapture(event.pointerId);
      }
      return consumed === true;
    } catch (error) { runtime.notifyError(error); return false; }
  }

  /** Display a custom tool's full-image canvas as an uncommitted draft. */
  previewCanvas(source) {
    const runtime = this.application;
    const image = runtime.currentPreviewImage();
    if (!image) return;
    runtime.previewRefineDraft = runtime.createPreviewDraft(image, {options:{}, tool:runtime.previewTool});
    const canvas = document.querySelector('#preview-refine-canvas');
    canvas.width = source.width; canvas.height = source.height;
    canvas.getContext('2d').drawImage(source,0,0); canvas.hidden = false;
    runtime.previewImageWrap.classList.add('refine-preview'); runtime.layoutRefinePreview(image);
  }

  /** Commit a custom canvas as one history step, rejecting stale asynchronous results. */
  async commitCanvas(canvas) {
    const runtime = this.application;
    const image = runtime.currentPreviewImage();
    if (!image || runtime.refineBusy) return false;
    const revision = runtime.vm.editRevision;
    runtime.refineBusy = true; runtime.syncToolActivation();
    const progress = runtime.showOperationProgress('Applying tool', 'Saving image…');
    let result, committed = false;
    try {
      result = await runtime.storeCanvasImage(canvas);
      if (revision !== runtime.vm.editRevision || image.id !== runtime.currentPreviewImage()?.id) return false;
      runtime.discardPendingToolEdits(false);
      committed = runtime.vm.setWorkingImageResults([{...result,imageId:image.id}], revision);
      return committed;
    } finally {
      runtime.refineBusy = false; progress.close(); runtime.syncToolActivation();
      if (result && !committed) await window.frameLine.discardProcessedImages([result.path]);
    }
  }

  /** Guard tool navigation against active processing and unresolved changes. */
  async select(id) {
    const runtime = this.application;
    if (runtime.toolSwitchBusy) return;
    if (runtime.paddingBusy || runtime.outlineApplyBusy || runtime.refineBusy) { runtime.notifyError('Wait for the image operation to finish before switching tools.'); return; }
    runtime.toolSwitchBusy = true;
    try {
      if (!await runtime.resolvePendingToolEdits()) return;
      this.registry.get(runtime.previewTool).deactivate();
      runtime.discardPendingToolEdits(false); runtime.stopPlayback();
      runtime.previewTool = runtime.previewTool === id ? 'hand' : id;
      runtime.previewToolEnabled = !runtime.isFeatureTool(runtime.previewTool);
      runtime.redrawPaintCanvas(); runtime.updatePreviewToolUi();
      runtime.prepareHealingReference(runtime.currentPreviewImage()); runtime.scheduleSavePreferences();
    } finally { runtime.toolSwitchBusy = false; }
  }

  /** Route registered processors through their declared backend or installed Python module. */
  process(id, image, options, {preview = false, onProgress} = {}) {
    const runtime = this.application;
    const tool = this.registry.get(id);
    const method = tool.definition[preview ? 'previewMethod' : 'applyMethod'];
    return runtime.runImageRequest(method ?? 'processToolImage', {
      ...workingImageRequest(image), options, ...(method ? {} : {toolId:id, preview})
    }, onProgress);
  }

  /** Execute immediate tools after resolving pending edits. */
  async action(id) {
    const runtime = this.application;
    if (id === 'background') {
      if (!await runtime.resolvePendingToolEdits()) return;
      const image = runtime.currentPreviewImage();
      if (!image) return;
      try { await runtime.removeBackground(image.id); } catch (error) { runtime.notifyError(error); }

    } else if (id === 'clear') {
      if (!await runtime.resolvePendingToolEdits()) return;
      const image = runtime.currentPreviewImage();
      if (!image || !runtime.vm.project.images.some(hasImageEdits)) return;
      const revision = runtime.vm.editRevision;
      const choice = await runtime.requestMessage({
        title: "Clear image effects",
        message: "Restore the imported original and clear all image edits. You can undo this change.",
        scope: { value: hasImageEdits(image) ? "current" : "all", options: [
          { label: "This image", value: "current" }, { label: "All images", value: "all" }
        ] },
        actions: [{ label: "Cancel", value: "cancel" }, { label: "Clear", value: "clear", primary: true }]
      });
      if (choice.action !== "clear" || revision !== runtime.vm.editRevision) return;
      const applyToAll = choice.scope === "all";
      runtime.previewCropDraft = null;
      if (applyToAll || runtime.liveOutlinePreviewImageId === image.id) {
        runtime.outlineApplyRevision += 1;
        runtime.pendingOutlineApply = null;
        runtime.previewOutlineDraft = null;
        runtime.clearLiveOutlinePreview(image.path);
      }
      if (runtime.vm.clearImageEffects(image.id, applyToAll)) runtime.showSuccess(applyToAll ? "Restored original images and cleared all image effects" : `Cleared image effects for ${image.name}`);

    }
  }
}
