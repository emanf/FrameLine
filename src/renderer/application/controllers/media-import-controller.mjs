import { ControllerBase } from '../controller-base.mjs';
import { requestNewImageOptions } from '../../view/create-image-dialog.mjs';

/** Import media into the project while reporting progress. */
export class MediaImportController extends ControllerBase {
  /** Import ordered image/video inputs with progress and reject results for a replaced project. */
  async importPaths(paths, frame = null, listPosition = null) {
    const runtime = this.application;
    try {
      const importProject = runtime.vm.project;
      let insertionFrame = frame;
      let insertionListPosition = listPosition;
      let pendingImagePaths = [];
      const flushImageBatch = async () => {
        if (!pendingImagePaths.length) return;
        const imported = await runtime.withOperationProgress('Importing images', 'Copying and reading images…',
          progress => runtime.vm.addImages(pendingImagePaths, insertionFrame, insertionFrame === null ? insertionListPosition : null,
            event => progress.update(event.current / event.total, event.message)));
        if (!imported || runtime.vm.project !== importProject) return false;
        runtime.lastAddedImage = { project: runtime.vm.project, id: imported.images.at(-1).id };
        if (insertionFrame !== null) insertionFrame += runtime.vm.project.defaultDurationFrames * imported.images.length;
        if (insertionFrame === null) insertionListPosition = { imageId: imported.images.at(-1).id, after: true };
        pendingImagePaths = [];
      };
      for (const mediaPath of paths) {
        if (runtime.vm.project !== importProject) return;
        const extension = mediaPath.split(".").at(-1).toLowerCase();
        if (["mp4", "mov", "m4v", "avi", "mkv", "webm", "wmv", "mpeg", "mpg", "m4p", "3gp", "ts", "mts", "m2ts", "flv"].includes(extension)) {
          if (await flushImageBatch() === false) return;
          const options = await runtime.requestVideoImportOptions(mediaPath);
          if (!options || runtime.vm.project !== importProject) return;
          const filename = mediaPath.split(/[\\/]/).at(-1);
          const progress = runtime.showOperationProgress("Importing video frames", `Extracting frames from ${filename}…`);
          let result;
          try {
            await new Promise((resolve) => requestAnimationFrame(resolve));
            result = await window.frameLine.importVideo(mediaPath, { fps: runtime.vm.project.fps, ...options });
          } finally {
            progress.close();
          }
          if (runtime.vm.project !== importProject) return;
          const imported = runtime.vm.addVideoFrames(result.images, insertionFrame, insertionFrame === null ? insertionListPosition : null);
          runtime.lastAddedImage = { project: runtime.vm.project, id: imported.images.at(-1).id };
          if (insertionFrame !== null) insertionFrame += result.images.reduce((sum, image) => sum + (image.duration_frames ?? 1), 0);
          if (insertionFrame === null) insertionListPosition = { imageId: imported.images.at(-1).id, after: true };
        } else {
          pendingImagePaths.push(mediaPath);
        }
      }
      await flushImageBatch();
      if (paths.length) {
        if (runtime.vm.project === importProject && runtime.lastAddedImage?.project === importProject) runtime.fitPreviewImage();
        runtime.toast.classList.remove("visible");
      }
    } catch (error) {
      runtime.notifyError(error);
    }
  }

  /** Choose media files and import them through the shared workflow. */
  async chooseAndImport() {
    const runtime = this.application;
    try {
      await runtime.importPaths(await window.frameLine.chooseMedia());
    } catch (error) {
      runtime.notifyError(error);
    }
  }

  /** Resolve the Import or Create action and collect its chosen inputs. */
  async chooseAddImages() {
    const runtime = this.application;
    if (runtime.addImagesBusy) return;
    runtime.addImagesBusy = true;
    try {
      const choice = await runtime.requestMessage({ title: "Add Images", message: "Import images or video, or create empty images to draw on.", actions: [
        { label: "Cancel", value: "cancel" },
        { label: "Import media", value: "import", primary: true },
        { label: "Create empty images", value: "create" }
      ] });
      if (choice.action === "import") await runtime.chooseAndImport();
      else if (choice.action === "create") await runtime.createEmptyImages();
    } catch (error) {
      runtime.notifyError(error);
    } finally {
      runtime.addImagesBusy = false;
    }
  }

  /** Create named transparent/solid source assets from validated dimensions and batch count. */
  async createEmptyImages() {
    const runtime = this.application;
    if (!await runtime.resolvePendingToolEdits()) return;
    const project = runtime.vm.project;
    const reference = (runtime.lastAddedImage?.project === project && project.images.find(image => image.id === runtime.lastAddedImage.id)) || project.images.at(-1);
    const options = await requestNewImageOptions(reference);
    if (!options || runtime.vm.project !== project) return;
    const revision = runtime.vm.editRevision;
    const canvas = document.createElement("canvas");
    const progress = runtime.showOperationProgress("Creating images", "Preparing empty images…", options.count);
    const details = [];
    const highestNumber = project.images.reduce((highest, image) => {
      const match = /^Image (\d+)(?:\.png)?$/i.exec(image.name);
      const number = match ? Number(match[1]) : 0;
      return Number.isSafeInteger(number) ? Math.max(highest, number) : highest;
    }, 0);
    let committed = false;
    try {
      await new Promise(resolve => requestAnimationFrame(resolve));
      canvas.width = options.width;
      canvas.height = options.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("The image is too large to create. Try smaller dimensions.");
      if (!options.transparent) {
        context.fillStyle = options.color;
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      const png = await runtime.encodeCanvasImage(canvas);
      canvas.width = canvas.height = 0;
      for (let index = 0; index < options.count; index++) {
        if (runtime.vm.editRevision !== revision || runtime.vm.project !== project) return;
        const result = await window.frameLine.storeWorkingImage(png);
        details.push({ ...result, name: `Image ${String(highestNumber + index + 1).padStart(3, '0')}` });
        progress.update(index + 1, `Created image ${index + 1} of ${options.count}`);
      }
      if (runtime.vm.editRevision !== revision || runtime.vm.project !== project) return;
      const added = runtime.vm.addImageDetails(details, null, null, null);
      committed = true;
      runtime.lastAddedImage = { project: runtime.vm.project, id: added.images.at(-1).id };
      runtime.fitPreviewImage();
      runtime.showSuccess(`Created ${options.count} empty ${options.count === 1 ? "image" : "images"}`);
    } finally {
      progress.close();
      if (!committed && details.length) await window.frameLine.discardProcessedImages(details.map(image => image.path));
    }
  }
}
