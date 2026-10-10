import { ControllerBase } from '../controller-base.mjs';


/** Bind timeline selection, timing controls, and drag operations. */
export class TimelineInputController extends ControllerBase {
  /** Confirm deleting selected timeline clips without deleting their source assets. */
  async confirmRemoveClip(clipId = this.application.vm.selectedClipId) {
    const runtime = this.application;
    const clip = runtime.vm.project.clips.find((item) => item.id === clipId);
    if (!clip) return;
    if (!runtime.vm.selectedClipIds.has(clipId)) runtime.vm.selectClip(clipId);
    const ids = [...runtime.vm.selectedClipIds];
    const image = runtime.vm.project.images.find((item) => item.id === clip.imageId);
    const name = image ? ` "${image.name}"` : "";
    const revision = runtime.vm.editRevision;
    const multiple = ids.length > 1;
    if (await runtime.confirmAction(multiple ? "Remove selected clips" : "Remove clip", multiple ? `Remove all ${ids.length} selected timeline clips?` : `Remove this timeline clip${name}?`, "Remove") && revision === runtime.vm.editRevision) {
      runtime.vm.setSelection(ids, clipId);
      runtime.vm.deleteSelected();
    }
  }

  /** Capture selected clip durations and a timeline drag origin for whole-frame resizing. */
  beginResize(event) {
    const runtime = this.application;
    const handle = event.target.closest(".clip-resize");
    if (!handle) return;
    event.preventDefault();
    event.stopPropagation();
    const clip = runtime.vm.project.clips.find((item) => item.id === handle.dataset.clipId);
    if (!clip) return;
    runtime.stopPlayback(); runtime.renderPlayButton();
    if (!runtime.vm.selectedClipIds.has(clip.id)) runtime.vm.selectClip(clip.id);
    runtime.resizeState = {
      clipId: clip.id,
      snapshot: runtime.vm.snapshot(),
      initialFrame: runtime.vm.project.currentFrame,
      pointerId: event.pointerId,
      initialWidth: clip.durationFrames * (4 * runtime.vm.zoom / 100),
      initialX: event.clientX,
      frames: clip.durationFrames
    };
    document.documentElement.classList.add("timeline-resizing");
    runtime.view.clipsElement.setPointerCapture(event.pointerId);
  }

  /** Commit a completed clip-resize gesture as a single history operation. */
  finishResize(event) {
    const runtime = this.application;
    if (!runtime.resizeState || event.pointerId !== runtime.resizeState.pointerId) return;
    const { snapshot, initialFrame } = runtime.resizeState;
    runtime.resizeState = null;
    document.documentElement.classList.remove("timeline-resizing");
    if (event.type === "pointercancel") {
      runtime.vm.applySnapshot(snapshot);
      runtime.vm.setFrame(initialFrame);
    }
    else runtime.vm.commitClipResize(snapshot);
    if (runtime.view.clipsElement.hasPointerCapture(event.pointerId)) {
      runtime.view.clipsElement.releasePointerCapture(event.pointerId);
    }
  }

  /** Bind timeline settings after the editor state and required controls are ready. */
  initializeTimelineSettings() {
    const runtime = this.application;
    document.querySelector("#speed-select").addEventListener("change", async (event) => {
      const select = event.currentTarget;
      let speed = Number(select.value);
      if (select.value === "add") {
        const value = await runtime.requestCustomNumber({
          title: "Custom playback speed",
          label: "Playback speed multiplier",
          value: runtime.vm.project.playbackSpeed,
          min: 0,
          max: 16,
          errorMessage: "Enter a playback speed greater than 0 and no more than 16×."
        });
        if (value === null) { runtime.redraw(); return; }
        speed = value;
        if (!runtime.customPlaybackSpeeds.includes(speed)) runtime.customPlaybackSpeeds.push(speed);
        runtime.addCustomSelectValue(select, speed, "×");
      }
      try {
        runtime.vm.setSpeed(speed);
        runtime.scheduleSavePreferences();
      } catch (error) { runtime.notifyError(error); runtime.redraw(); }
    });
    document.querySelector("#default-duration").addEventListener("change", (event) => {
      const frames = Number(event.target.value);
      if (Number.isInteger(frames) && frames > 0) {
        runtime.vm.setDefaultDuration(frames);
        runtime.scheduleSavePreferences();
      }
      else { runtime.notifyError("Default image duration must be a positive whole number of frames."); runtime.redraw(); }
    });
    document.querySelector("#clip-frames").addEventListener("change", (event) => {
      const frames = Number(event.target.value);
      if (Number.isSafeInteger(frames) && frames > 0) runtime.vm.resizeSelectedClips(frames);
      else { runtime.notifyError("Clip duration must be a positive whole number of frames."); runtime.redraw(); }
    });
    document.querySelector("#clip-seconds").addEventListener("change", (event) => {
      const seconds = Number(event.target.value);
      if (Number.isFinite(seconds) && seconds > 0) runtime.vm.resizeSelectedClips(Math.max(1, Math.round(seconds * runtime.vm.project.fps)));
      else { runtime.notifyError("Duration must be greater than zero seconds."); runtime.redraw(); }
    });
    document.querySelector("#clear-images").addEventListener("click", async () => {
      const count = runtime.vm.project.images.length;
      const revision = runtime.vm.editRevision;
      if (count && await runtime.confirmAction("Clear imported images", `Remove all ${count} imported ${count === 1 ? "image" : "images"} and their timeline clips?`, "Remove all") && revision === runtime.vm.editRevision) {
        runtime.vm.clearImages();
      }
    });
    runtime.setTimelineZoom = (zoom) => {
      runtime.vm.setZoom(zoom);
      runtime.scheduleSavePreferences();
    };
    document.querySelector("#zoom-slider").addEventListener("input", (event) => runtime.setTimelineZoom(Number(event.target.value)));
    document.querySelector("#zoom-out").addEventListener("click", () => runtime.setTimelineZoom(Math.max(1, Math.round(runtime.vm.zoom / 1.25))));
    document.querySelector("#zoom-in").addEventListener("click", () => runtime.setTimelineZoom(Math.min(5000, Math.max(runtime.vm.zoom + 1, Math.round(runtime.vm.zoom * 1.25)))));
    document.querySelector("#preview-zoom-out").addEventListener("click", () => runtime.setPreviewZoom(Math.max(runtime.MIN_PREVIEW_ZOOM, runtime.previewZoom / 1.25)));
    document.querySelector("#preview-zoom-in").addEventListener("click", () => runtime.setPreviewZoom(Math.min(runtime.MAX_PREVIEW_ZOOM, runtime.previewZoom * 1.25)));
    document.querySelector("#preview-zoom-fit").addEventListener("click", runtime.fitPreviewImage);
  }

  /** Bind clip resize after the editor state and required controls are ready. */
  initializeClipResize() {
    const runtime = this.application;
    document.querySelector("#clips").addEventListener("pointerdown", runtime.beginResize, true);
    document.addEventListener("pointermove", (event) => {
      if (!runtime.resizeState || runtime.resizeState.initialX === undefined) return;
      const frameWidth = 4 * runtime.vm.zoom / 100;
      const frames = Math.max(1, Math.round((runtime.resizeState.initialWidth + event.clientX - runtime.resizeState.initialX) / frameWidth));
      if (frames === runtime.resizeState.frames) return;
      runtime.resizeState.frames = frames;
      runtime.vm.previewResizeSelection(runtime.resizeState.clipId, frames, runtime.resizeState.snapshot);
    });
    document.addEventListener("pointerup", runtime.finishResize);
    document.addEventListener("pointercancel", runtime.finishResize);
    window.frameLine.enableCloseGuard().catch(runtime.notifyError);
  }
}
