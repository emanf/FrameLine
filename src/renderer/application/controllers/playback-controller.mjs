import { ControllerBase } from '../controller-base.mjs';
import { advancePlayback } from '../../model/playback-clock.mjs';
import { loopRange } from '../../model/project-model.mjs';

/** Advance whole-frame playback while preserving the preview viewport. */
export class PlaybackController extends ControllerBase {
  /** Convert a timeline pointer position into a clamped whole-frame playhead position. */
  setCurrentFrameFromPointer(event) {
    const runtime = this.application;
    const rect = document.querySelector("#timeline-content").getBoundingClientRect();
    const px = 4 * runtime.vm.zoom / 100;
    runtime.vm.setFrame(Math.floor((event.clientX - rect.left) / px));
  }

  /** Advance playback using elapsed time and fractional frame carry without resetting the viewport. */
  playbackTick(timestamp) {
    const runtime = this.application;
    runtime.animationFrameId = null;
    if (!runtime.playing) return;
    if (runtime.lastTick !== null) {
      const result = advancePlayback(runtime.vm.project, runtime.vm.totalFrames, timestamp - runtime.lastTick, runtime.frameRemainder);
      runtime.frameRemainder = result.fractionalFrame;
      const previousFrame = runtime.vm.project.currentFrame;
      runtime.vm.setFrame(result.currentFrame, false);
      runtime.view.updateFrame(runtime.vm, runtime.frameRemainder);
      if (runtime.vm.project.currentFrame !== previousFrame) runtime.syncActivePreviewImage();
      if (result.stopped) {
        runtime.playing = false;
        runtime.lastTick = null;
        runtime.view.updateFrame(runtime.vm);
        runtime.renderPlayButton();
        return;
      }
    }
    runtime.lastTick = timestamp;
    runtime.animationFrameId = requestAnimationFrame(runtime.playbackTick);
  }

  /** Cancel the playback animation request and clear its timing accumulator. */
  stopPlayback() {
    const runtime = this.application;
    runtime.playing = false;
    runtime.lastTick = null;
    if (runtime.animationFrameId !== null) cancelAnimationFrame(runtime.animationFrameId);
    runtime.animationFrameId = null;
  }

  /** Resolve pending edits and toggle playback within the project loop range. */
  togglePlayback() {
    const runtime = this.application;
    if (runtime.playing) {
      runtime.stopPlayback();
    } else if (runtime.vm.totalFrames) {
      runtime.vm.setFrame(runtime.vm.project.currentFrame);
      if (runtime.vm.project.loopEnabled) {
        const range = loopRange(runtime.vm.project, runtime.vm.totalFrames);
        if (runtime.vm.project.currentFrame < range.startFrame || runtime.vm.project.currentFrame >= range.endFrame) runtime.vm.setFrame(range.startFrame);
      }
      if (!runtime.vm.project.loopEnabled && runtime.vm.project.currentFrame >= runtime.vm.totalFrames - 1) runtime.vm.setFrame(0, false);
      runtime.playing = true;
      runtime.lastTick = performance.now();
      runtime.frameRemainder = 0;
      runtime.animationFrameId = requestAnimationFrame(runtime.playbackTick);
    }
    runtime.renderPlayButton();
  }

  /** Select the timeline clip containing the specified frame. */
  selectAtFrame(frame) {
    const runtime = this.application;
    const range = runtime.vm.ranges.find(({ startFrame, endFrame }) => frame >= startFrame && frame < endFrame);
    if (!range) return;
    runtime.vm.selectClip(range.clip.id);
    runtime.vm.setFrame(frame);
  }

  /** Bind playback events after the editor state and required controls are ready. */
  initializePlaybackEvents() {
    const runtime = this.application;
    document.querySelector("#import-images").addEventListener("click", runtime.chooseAddImages);
    document.querySelector("#empty-import").addEventListener("click", runtime.chooseAddImages);
  }
}
