import { ControllerBase } from '../controller-base.mjs';


/** Route editing shortcuts and track gestures in tool controls. */
export class KeyboardController extends ControllerBase {
  /** Bind keyboard events after the editor state and required controls are ready. */
  initializeKeyboardEvents() {
    const runtime = this.application;
    runtime.historyControlSelector = '[data-tool-field], [data-crop-field], [data-padding-field], [data-refine-field], [data-clean-field], #preview-padding-lock, '
      + '#preview-outline-color, #preview-outline-size, #preview-outline-position, #preview-outline-softness, #preview-outline-opacity';
    for (const type of ['focusin', 'pointerdown', 'keydown']) document.addEventListener(type, event => {
      if (event.target.matches(runtime.historyControlSelector) && runtime.previewToolEnabled) runtime.toolGestureBefore ??= runtime.capturePendingTools();
    }, true);
    for (const type of ['input', 'change']) document.addEventListener(type, event => {
      if (!event.target.matches(runtime.historyControlSelector) || !runtime.previewToolEnabled) return;
      runtime.toolGestureBefore ??= runtime.capturePendingTools();
      if (type === 'change') queueMicrotask(runtime.finishToolControlGesture);
    }, true);
    document.addEventListener('blur', event => {
      if (event.target.matches(runtime.historyControlSelector)) queueMicrotask(runtime.finishToolControlGesture);
    }, true);
    document.addEventListener("keydown", (event) => {
      if (document.querySelector("dialog[open]")) return;
      const typing = event.target.matches("input, select, textarea");
      const command = event.ctrlKey || event.metaKey;
      const listFocused = !typing && (runtime.importImageList.contains(document.activeElement) || document.activeElement === runtime.importImageList);
      const key = event.key.toLowerCase();
      if (listFocused && ((command && ['a', 'c', 'x', 'v', 'd'].includes(key)) || ['Delete', 'Backspace'].includes(event.key))) {
        event.preventDefault();
        if (command && key === 'a') runtime.vm.selectAllImages();
        else runtime.runImageListAction(async () => {
          if (command && key === 'c') { if (runtime.vm.copyImages()) runtime.showSuccess('Copied selected images'); }
          else if (command && key === 'x') runtime.vm.cutImages();
          else if (command && key === 'v') {runtime.vm.pasteImages(runtime.vm.selectedImages.at(-1)?.id ?? runtime.currentPreviewImage()?.id); runtime.fitPreviewImage();}
          else if (command && key === 'd') {runtime.vm.duplicateImages(); runtime.fitPreviewImage();}
          else await runtime.confirmRemoveImages();
        });
        return;
      }
      if (!typing && command && event.key.toLowerCase() === "a") {
        event.preventDefault(); runtime.vm.selectAllClips();
      } else if (!typing && command && event.key.toLowerCase() === "c") {
        event.preventDefault(); if (runtime.vm.copySelected()) runtime.showSuccess(`Copied ${runtime.vm.selectedClips.length} clips`);
      } else if (!typing && command && event.key.toLowerCase() === "x") {
        event.preventDefault(); runtime.stopPlayback(); runtime.vm.cutSelected(); runtime.renderPlayButton();
      } else if (!typing && command && event.key.toLowerCase() === "v") {
        event.preventDefault(); runtime.stopPlayback(); runtime.vm.pasteClips(); runtime.renderPlayButton();
      } else if (!typing && command && event.key.toLowerCase() === "d") {
        event.preventDefault(); runtime.vm.duplicateSelected();
      } else if (!typing && ["Delete", "Backspace"].includes(event.key)) {
        event.preventDefault(); runtime.confirmRemoveClip().catch(runtime.notifyError);
      } else if (!typing && (event.code === "Space" || event.key === " ")) {
        event.preventDefault();
        runtime.togglePlayback();
      } else if (!typing && event.key === "ArrowLeft" && event.shiftKey) {
        event.preventDefault();
        document.querySelector("#previous-image").click();
      } else if (!typing && event.key === "ArrowRight" && event.shiftKey) {
        event.preventDefault();
        document.querySelector("#next-image").click();
      } else if (!typing && event.key === "ArrowLeft") {
        event.preventDefault();
        runtime.vm.setFrame(runtime.vm.project.currentFrame - 1);
      } else if (!typing && event.key === "ArrowRight") {
        event.preventDefault();
        runtime.vm.setFrame(runtime.vm.project.currentFrame + 1);
      } else if (!typing && event.key === "Home") {
        event.preventDefault();
        runtime.vm.setFrame(0);
      } else if (!typing && event.key === "End") {
        event.preventDefault();
        runtime.vm.setFrame(runtime.vm.totalFrames - 1);
      } else if (!typing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        runtime.saveProject();
      } else if (!typing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        runtime.navigateEditHistory(event.shiftKey);
      } else if (!typing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        runtime.navigateEditHistory(true);
      } else if (!typing && event.key === "F11") {
        event.preventDefault();
        window.frameLine.toggleFullscreen().catch(runtime.notifyError);
      } else if (event.key === "Escape") runtime.closeContextMenu();
    });
    document.addEventListener("dragover", (event) => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
    });
    document.addEventListener("drop", (event) => {
      if (!event.target.closest("#image-list, #timeline-scroll")) event.preventDefault();
    });
    document.querySelector("#preview-image").addEventListener("error", () => {
      document.querySelector("#preview-image").hidden = true;
      document.querySelector(".preview-placeholder").hidden = false;
      document.querySelector(".preview-placeholder span").textContent = "Image file is unavailable";
      runtime.notifyError("A source image could not be loaded. Check that the file still exists.");
    });
  }
}
