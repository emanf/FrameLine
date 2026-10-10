import { ControllerBase } from '../controller-base.mjs';
import { initializeLoopControls } from '../../view/loop-range-controls.mjs';

/** Coordinate project notifications and preview rendering. */
export class EditorCoordinator extends ControllerBase {
  /** Return the active source image or the image under the current playhead. */
  currentPreviewImage() {
    const runtime = this.application;
    return runtime.vm.previewImage;
  }

  /** Invalidate source-dependent previews and refresh the viewport when the active image changes. */
  syncActivePreviewImage() {
    const runtime = this.application;
    runtime.syncPreviewDrafts();
    const activeImage = runtime.currentPreviewImage();
    runtime.prepareHealingReference(activeImage);
    const imagePath = activeImage?.path ?? null;
    if (activeImage?.id !== runtime.liveOutlinePreviewImageId && runtime.liveOutlinePreviewImageId !== null) {
      runtime.clearLiveOutlinePreview(activeImage?.path);
    }
    if (imagePath === runtime.previewPanImagePath && activeImage?.id === runtime.previewPanImageId) return;
    runtime.previewPanImagePath = imagePath;
    runtime.previewPanImageId = activeImage?.id ?? null;
    runtime.redrawPaintCanvas(activeImage);
    runtime.updatePreviewPan();
  }

  /** Render the project, synchronize drafts, and preserve the current preview viewport. */
  redraw() {
    const runtime = this.application;
    runtime.syncPreviewDrafts();
    runtime.view.render(runtime.vm);
    runtime.syncActivePreviewImage();
    runtime.redrawPaintCanvas(runtime.currentPreviewImage());
    runtime.updatePreviewPan();
    if (runtime.playing) runtime.view.updateFrame(runtime.vm, runtime.frameRemainder);
    runtime.renderPlayButton();
    if (runtime.backgroundEditBusy) document.querySelector("#preview-remove-background").disabled = true;
    runtime.syncToolActivation();
  }

  /** Bind project events after the editor state and required controls are ready. */
  initializeProjectEvents() {
    const runtime = this.application;
    runtime.vm.subscribe(runtime.redraw);
    runtime.redraw();
    runtime.setPreviewZoom(runtime.previewZoom);
    initializeLoopControls(runtime.vm, () => { runtime.stopPlayback(); runtime.renderPlayButton(); });
  }
}
