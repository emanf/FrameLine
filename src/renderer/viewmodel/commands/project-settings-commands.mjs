import { totalFrames, loopRange, validateProject } from '../../model/project-model.mjs';

const copy = value => JSON.parse(JSON.stringify(value));

/** Validate project settings and replace project state through a single notification path. */
export class ProjectSettingsCommands {
  constructor(viewModel) { this.viewModel = viewModel; }

  /** Validate and commit project FPS without converting existing frame durations. */
  setFps(fps) {
    if (!Number.isFinite(fps) || fps <= 0 || fps > 240) throw new Error("FPS must be greater than 0 and no more than 240.");
    if (fps === this.viewModel.project.fps) return;
    this.viewModel.record();
    this.viewModel.project.fps = fps;
    this.viewModel.notify();
  }

  /** Commit a valid project title only when its value changes. */
  setProjectName(name) {
    if (typeof name !== "string") return false;
    const nextName = name.trim() || "Untitled project";
    if (nextName === this.viewModel.project.name) return false;
    this.viewModel.record();
    this.viewModel.project.name = nextName;
    this.viewModel.notify();
    return true;
  }

  /** Validate the default duration for new image clips in whole frames. */
  setDefaultDuration(frames) {
    if (!Number.isSafeInteger(frames) || frames < 1 || frames === this.viewModel.project.defaultDurationFrames) return;
    this.viewModel.record();
    this.viewModel.project.defaultDurationFrames = frames;
    this.viewModel.notify();
  }

  /** Commit playback speed while retaining timeline durations. */
  setSpeed(speed) {
    if (!Number.isFinite(speed) || speed <= 0 || speed > 16) throw new Error("Playback speed must be greater than 0 and no more than 16×.");
    if (speed === this.viewModel.project.playbackSpeed) return;
    this.viewModel.record();
    this.viewModel.project.playbackSpeed = speed;
    this.viewModel.notify();
  }

  /** Enable or disable looping as a persistent project setting. */
  setLoop(enabled) {
    if (typeof enabled !== "boolean" || enabled === this.viewModel.project.loopEnabled) return;
    this.viewModel.record();
    this.viewModel.project.loopEnabled = enabled;
    this.viewModel.notify();
  }

  /** Clamp inclusive Start/End loop bounds; preview updates defer history recording. */
  setLoopRange(startFrame, endFrame, preview = false) {
    if (!this.viewModel.totalFrames || !Number.isSafeInteger(startFrame) || !Number.isSafeInteger(endFrame)) return false;
    const bounds = loopRange({ loopStartFrame: startFrame, loopEndFrame: endFrame }, this.viewModel.totalFrames);
    const end = bounds.endFrame === this.viewModel.totalFrames ? null : bounds.endFrame;
    if (bounds.startFrame === this.viewModel.project.loopStartFrame && end === this.viewModel.project.loopEndFrame) return false;
    if (preview) this.viewModel.editRevision += 1;
    else this.viewModel.record();
    this.viewModel.project.loopStartFrame = bounds.startFrame;
    this.viewModel.project.loopEndFrame = end;
    this.viewModel.notify();
    return true;
  }

  /** Commit changed loop bounds from a completed range-handle gesture. */
  commitLoopRange(snapshot) {
    if (snapshot.loopStartFrame === this.viewModel.project.loopStartFrame && snapshot.loopEndFrame === this.viewModel.project.loopEndFrame) return;
    this.viewModel.editRevision += 1;
    this.viewModel.undoStack.push(snapshot);
    this.viewModel.historyStateId = ++this.viewModel.nextHistoryStateId;
    this.viewModel.redoStack = [];
    this.viewModel.trimHistory();
    this.viewModel.notify();
  }

  /** Update timeline zoom without changing the project history. */
  setZoom(zoom) {
    this.viewModel.zoom = Math.round(Math.max(1, Math.min(5000, zoom)) * 10) / 10;
    this.viewModel.notify();
  }

  /** Keep playback and loop bounds valid after timeline edits. */
  clampCurrentFrame() {
    const range = loopRange(this.viewModel.project, this.viewModel.totalFrames);
    this.viewModel.project.loopStartFrame = range.startFrame;
    this.viewModel.project.loopEndFrame = !this.viewModel.totalFrames || this.viewModel.project.loopEndFrame == null ? null : range.endFrame;
    this.viewModel.project.currentFrame = this.viewModel.totalFrames
      ? Math.max(0, Math.min(this.viewModel.project.currentFrame, this.viewModel.totalFrames - 1))
      : 0;
  }

  /** Validate a candidate before resetting selection, history, and cached frame ranges. */
  replaceProject(candidate) {
    validateProject(candidate);
    this.viewModel.historyStateId = ++this.viewModel.nextHistoryStateId;
    this.viewModel.previewImageId = null;
    this.viewModel.editRevision += 1;
    this.viewModel.cachedTotalFrames = null;
    this.viewModel.cachedRanges = null;
    this.viewModel.project = copy(candidate);
    this.viewModel.selectedImageIds = new Set();
    this.viewModel.imageSelectionAnchorId = null;
    this.viewModel.project.name ??= "Untitled project";
    this.viewModel.project.playbackSpeed = Number.isFinite(this.viewModel.project.playbackSpeed) && this.viewModel.project.playbackSpeed > 0 ? this.viewModel.project.playbackSpeed : 1;
    this.viewModel.project.loopEnabled = this.viewModel.project.loopEnabled !== false;
    this.viewModel.clampCurrentFrame();
    this.viewModel.selectedClipId = this.viewModel.ranges.find(({ startFrame, endFrame }) =>
      this.viewModel.project.currentFrame >= startFrame && this.viewModel.project.currentFrame < endFrame)?.clip.id
      ?? this.viewModel.project.clips[0]?.id
      ?? null;
    this.viewModel.undoStack = [];
    this.viewModel.redoStack = [];
    this.viewModel.markSaved();
    this.viewModel.notify();
  }
}
