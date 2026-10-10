import { ControllerBase } from '../controller-base.mjs';
import { exportClipData } from '../../model/export-clips.mjs';

/** Prepare scoped exports and follow export-task events. */
export class ExportController extends ControllerBase {
  /** Follow a cancellable export and resolve its completion result. */
  async runExportTask(command, request, title, message) {
    const runtime = this.application;
    const taskId = crypto.randomUUID();
    const dialog = document.querySelector("#operation-progress-dialog");
    const progress = runtime.showOperationProgress(title, message);
    const cancelButton = document.querySelector("#operation-progress-cancel");
    cancelButton.hidden = false;
    cancelButton.disabled = false;
    cancelButton.textContent = "Cancel export";
    let unsubscribe;
    try {
      return await new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error, result) => {
          if (settled) return;
          settled = true;
          unsubscribe?.();
          cancelButton.removeEventListener("click", cancel);
          progress.close();
          if (error) reject(error);
          else resolve(result);
        };
        const cancel = () => {
          cancelButton.disabled = true;
          cancelButton.textContent = "Cancelling…";
          window.frameLine.cancelExport(taskId).catch((error) => {
            cancelButton.disabled = false;
            cancelButton.textContent = "Cancel export";
            runtime.notifyError(error);
          });
        };
        cancelButton.addEventListener("click", cancel);
        unsubscribe = window.frameLine.onExportEvent((channel, payload) => {
          if (payload.taskId !== taskId) return;
          if (channel === "export:progress") {
            const progressElement = document.querySelector("#operation-progress");
            progressElement.max = payload.total;
            progressElement.value = payload.current;
            document.querySelector("#operation-progress-value").textContent =
              `${payload.current} / ${payload.total}`;
            document.querySelector("#operation-progress-message").textContent = payload.message;
          } else if (channel === "export:complete") finish(null, payload.result);
          else if (channel === "export:cancelled") finish(Object.assign(new Error("Export cancelled."), { code: "EXPORT_CANCELLED" }));
          else if (channel === "export:error") finish(new Error(payload.message));
        });
        window.frameLine.startExport(taskId, command, request).catch((error) => finish(error));
      });
    } finally {
      if (dialog.open) dialog.close();
      cancelButton.hidden = true;
      cancelButton.disabled = false;
      cancelButton.textContent = "Cancel export";
    }
  }

  /** Build export-ready clips for the chosen timeline scope, preserving committed image effects. */
  projectClipData() {
    const runtime = this.application;
    return exportClipData(runtime.vm.project, document.querySelector("#export-scope").value, [...runtime.vm.selectedClipIds]);
  }

  /** Bind export events after the editor state and required controls are ready. */
  initializeExportEvents() {
    const runtime = this.application;
    document.querySelector("#export-gif").addEventListener("click", async () => {
      try {
        const format = document.querySelector("#export-format").value;
        const clips = runtime.projectClipData();
        const scope = document.querySelector("#export-scope").value;
        if (scope !== "all" && !clips.length) { runtime.notifyError(scope === "selected" ? "Select timeline clips before exporting." : "Add timeline clips before exporting the Start–End range."); return; }
        if (format === "sources") {
          if (!runtime.vm.project.images.length) { runtime.notifyError("Import source images before exporting."); return; }
          const output = await window.frameLine.chooseExportDirectory();
          if (!output) return;
          const result = await runtime.runExportTask("export_images", {
            mode: "sources", output,
            images: runtime.vm.project.images.filter(image => scope === "all" || clips.some(clip => clip.image_id === image.id)).map((image) => ({ ...image, paint_strokes: image.paintStrokes ?? [], crop: image.crop, outline: image.outline }))
          }, "Exporting source images", `Exporting ${runtime.vm.project.images.length} images…`);
          runtime.showSuccess(`Exported ${result.files} source images`);
          return;
        }
        if (!runtime.vm.project.clips.length) { runtime.notifyError("Add images to the frame line before exporting."); return; }
        if (format.startsWith("sheet-")) {
          const output = await window.frameLine.chooseSheetPath();
          if (!output) return;
          const result = await runtime.runExportTask("export_sheet", {
            output,
            mode: format === "sheet-frames" ? "frames" : "clips",
            clips: runtime.projectClipData()
          }, "Creating contact sheet", "Preparing contact sheet…");
          runtime.showSuccess(`Exported contact sheet with ${result.images} thumbnails`);
        } else if (format === "gif") {
          const output = await window.frameLine.chooseExportPath("gif");
          if (!output) return;
          await runtime.runExportTask("export_gif", {
            output, fps: runtime.vm.project.fps, playback_speed: runtime.vm.project.playbackSpeed,
            loop_enabled: runtime.vm.project.loopEnabled, clips: runtime.projectClipData()
          }, "Exporting GIF", "Preparing GIF…");
          runtime.showSuccess(`Exported ${output}`);
        } else if (["mp4", "mov", "webm", "avi", "mkv"].includes(format)) {
          const output = await window.frameLine.chooseExportPath(format);
          if (!output) return;
          await runtime.runExportTask("export_video", {
            output,
            format,
            fps: runtime.vm.project.fps,
            playback_speed: runtime.vm.project.playbackSpeed,
            clips: runtime.projectClipData()
          }, `Exporting ${format.toUpperCase()} video`, "Preparing video…");
          runtime.showSuccess(`Exported ${output}`);
        } else {
          const output = await window.frameLine.chooseExportDirectory();
          if (!output) return;
          const result = await runtime.runExportTask("export_images", {
            mode: "frames", output, fps: runtime.vm.project.fps, clips: runtime.projectClipData()
          }, "Exporting timeline frames", `Exporting ${runtime.vm.totalFrames} frames…`);
          runtime.showSuccess(`Exported ${result.files} timeline frames`);
        }
      } catch (error) {
        if (error.code !== "EXPORT_CANCELLED") runtime.notifyError(error);
      }
    });
  }
}
