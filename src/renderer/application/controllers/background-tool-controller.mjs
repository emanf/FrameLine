import { ControllerBase } from '../controller-base.mjs';


/** Apply background removal to current edited images with batch history. */
export class BackgroundToolController extends ControllerBase {
  /** Materialize current edits and process selected background-removal settings as a guarded batch. */
  async removeBackground(imageId) {
    const runtime = this.application;
    const image = runtime.vm.project.images.find((item) => item.id === imageId);
    if (!image || runtime.backgroundEditBusy) return;
    if (runtime.outlineApplyBusy || runtime.pendingOutlineApply || runtime.refineBusy) throw new Error("Wait for the image operation to finish before removing a background.");
    const revision = runtime.vm.editRevision;
    runtime.backgroundEditBusy = true;
    const button = document.querySelector("#preview-remove-background");
    button.disabled = true;
    let currentResult;
    let progress;
    try {
      currentResult = await runtime.withOperationProgress('Preparing image', 'Preparing your current edits…',
        () => runtime.materializeWorkingImage(structuredClone(image)));
      if (revision !== runtime.vm.editRevision) return;
      const selection = await runtime.requestBackgroundOptions(image, currentResult);
      if (!selection || revision !== runtime.vm.editRevision) return;
      const targets = selection.all ? [...runtime.vm.project.images] : [image];
      const results = [];
      let committed = false;
      progress = runtime.showOperationProgress(
        selection.all ? "Removing backgrounds" : "Removing background",
        `Processing ${image.name}…`, targets.length
      );
      try {
      for (const [index, target] of targets.entries()) {
        const input = target.id === image.id ? currentResult : await runtime.materializeWorkingImage(structuredClone(target));
        try {
          progress.update(index, `Processing ${target.name}…`);
          const result = await runtime.runImageRequest('removeBackground', {...selection.options,path:input.path}, event => {
            progress.update(index + event.current / event.total, event.message);
          });
          results.push({...result,imageId:target.id});
          if (revision !== runtime.vm.editRevision) return;
          if (selection.all) progress.update(index + 1, `Processed ${target.name}`);
        } finally {
          if (input !== currentResult && input.temporary) await window.frameLine.discardProcessedImages([input.path]);
        }
      }
      committed = runtime.vm.setImageBackgroundResults(results, revision);
      if (!committed) return;
      } finally {
        if (!committed && results.length) await window.frameLine.discardProcessedImages(results.map(result=>result.path));
      }
      runtime.showSuccess(selection.all ? `Removed backgrounds from ${targets.length} images` : `Background removed from ${image.name}`);
    } finally {
      progress?.close();
      try {
        if (currentResult?.temporary) await window.frameLine.discardProcessedImages([currentResult.path]);
      } finally {
        runtime.backgroundEditBusy = false;
        button.disabled = !runtime.currentPreviewImage();
      }
    }
  }
}
