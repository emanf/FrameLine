import {ImageListCommands} from './commands/image-list-commands.mjs';
import {ImageEffectsCommands} from './commands/image-effects-commands.mjs';
import {TimelineCommands} from './commands/timeline-commands.mjs';
import {SelectionCommands} from './commands/selection-commands.mjs';
import {ProjectSettingsCommands} from './commands/project-settings-commands.mjs';
import { clipRanges, createProject, totalFrames, loopRange, validateProject, validateCrop, validateStroke, validateOutline } from "../model/project-model.mjs";
import { originalImage, preserveOriginal, rebaseImageEdits, workingImageRequest, clearPendingEffects, hasImageEdits } from "../model/image-effects.mjs";
import { imageRenamePlan } from '../model/image-names.mjs';

const copy = (value) => JSON.parse(JSON.stringify(value));

/** Own project state and history; delegate editing operations to focused command classes. */
export class TimelineViewModel {
  /** Inject media operations so editing commands stay independent of Electron and the DOM. */
  constructor(mediaService = globalThis.window?.frameLine) {
    this.mediaService = mediaService;
    this.imageListCommands = new ImageListCommands(this);
    this.imageEffectsCommands = new ImageEffectsCommands(this);
    this.timelineCommands = new TimelineCommands(this);
    this.selectionCommands = new SelectionCommands(this);
    this.projectSettingsCommands = new ProjectSettingsCommands(this);

    this.project = createProject();
    this.selectedClipIds = new Set();
    this.selectionAnchorId = null;
    this.clipboard = null;
    this.imageClipboard = null;
    this.selectedImageIds = new Set();
    this.imageSelectionAnchorId = null;
    this.selectedClipId = null;
    this.previewImageId = null;
    this.zoom = 100;
    this.listeners = new Set();
    this.undoStack = [];
    this.redoStack = [];
    this.snapshotSizes = new WeakMap();
    this.historyByteLimit = 64 * 1024 * 1024;
    this.cachedTotalFrames = null;
    this.cachedRanges = null;
    this.editRevision = 0;
    this.historyStateId = 0;
    this.nextHistoryStateId = 0;
    this.savedState = this.projectState();
  }

  /** Observe project notifications and return an unsubscribe function. */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Drop invalid selections, invalidate derived ranges, and notify subscribed views. */
  notify() {
    const imageIds = new Set(this.project.images.map(image => image.id));
    this.selectedImageIds = new Set([...this.selectedImageIds].filter(id => imageIds.has(id)));
    if (!imageIds.has(this.imageSelectionAnchorId)) this.imageSelectionAnchorId = [...this.selectedImageIds].at(-1) ?? null;
    if (!this.project.images.some(image => image.id === this.previewImageId)) this.previewImageId = null;
    this.cachedTotalFrames = null;
    this.cachedRanges = null;
    const known = new Set(this.project.clips.map(clip => clip.id));
    this.selectedClipIds = new Set([...this.selectedClipIds].filter(id => known.has(id)));
    if (!this.selectedClipIds.has(this._selectedClipId)) this._selectedClipId = [...this.selectedClipIds].at(-1) ?? null;
    if (!known.has(this.selectionAnchorId)) this.selectionAnchorId = this._selectedClipId;
    for (const listener of this.listeners) listener();
  }

  /** Capture persistent fields and selection state for bounded history storage. */
  snapshot() {
    const serialized = JSON.stringify({
      historyStateId: this.historyStateId,
      name: this.project.name,
      selectedClipIds: [...this.selectedClipIds],
      selectedClipId: this.selectedClipId,
      selectionAnchorId: this.selectionAnchorId,
      selectedImageIds: [...this.selectedImageIds],
      imageSelectionAnchorId: this.imageSelectionAnchorId,
      fps: this.project.fps,
      defaultDurationFrames: this.project.defaultDurationFrames,
      playbackSpeed: this.project.playbackSpeed,
      loopEnabled: this.project.loopEnabled,
      loopStartFrame: this.project.loopStartFrame,
      loopEndFrame: this.project.loopEndFrame,
      images: this.project.images,
      clips: this.project.clips
    });
    const snapshot = JSON.parse(serialized);
    this.snapshotSizes.set(snapshot, serialized.length * 2);
    return snapshot;
  }

  /** Retire oldest snapshots until both count and estimated byte limits are satisfied. */
  trimHistory() {
    const size = () => [...this.undoStack, ...this.redoStack]
      .reduce((sum, snapshot) => sum + (this.snapshotSizes.get(snapshot) ?? JSON.stringify(snapshot).length * 2), 0);
    while (this.undoStack.length + this.redoStack.length > 1
      && (this.undoStack.length + this.redoStack.length > 100 || size() > this.historyByteLimit)) {
      if (this.undoStack.length > 1 || this.redoStack.length <= 1) this.undoStack.shift();
      else this.redoStack.shift();
    }
  }

  /** Capture the pre-edit snapshot, advance revision/state IDs, and replace the redo branch. */
  record() {
    this.editRevision += 1;
    this.cachedTotalFrames = null;
    this.cachedRanges = null;
    this.undoStack.push(this.snapshot());
    this.historyStateId = ++this.nextHistoryStateId;
    this.redoStack = [];
    this.trimHistory();
  }

  get totalFrames() {
    this.cachedTotalFrames ??= totalFrames(this.project);
    return this.cachedTotalFrames;
  }
  get ranges() {
    this.cachedRanges ??= clipRanges(this.project);
    return this.cachedRanges;
  }
  get previewImage() {
    if (this.previewImageId) return this.project.images.find(image => image.id === this.previewImageId);
    const range = this.ranges.find(({ startFrame, endFrame }) => this.project.currentFrame >= startFrame && this.project.currentFrame < endFrame);
    return range && this.project.images.find(image => image.id === range.clip.imageId);
  }

  /** @see ImageListCommands.selectImage */
  selectImage(imageId, { toggle = false, range = false, additive = false } = {}) { return this.imageListCommands.selectImage(imageId, {toggle, range, additive}); }

  get selectedImages() { return this.project.images.filter(image => this.selectedImageIds.has(image.id)); }

  /** @see ImageListCommands.renameImages */
  renameImages(options) { return this.imageListCommands.renameImages(options); }

  /** @see ImageListCommands.focusImage */
  focusImage(imageId) { return this.imageListCommands.focusImage(imageId); }

  /** @see ImageListCommands.selectAllImages */
  selectAllImages() { return this.imageListCommands.selectAllImages(); }

  /** @see ImageListCommands.captureImages */
  captureImages(imageIds = [...this.selectedImageIds]) { return this.imageListCommands.captureImages(imageIds); }

  /** @see ImageListCommands.copyImages */
  copyImages(imageIds) { return this.imageListCommands.copyImages(imageIds); }

  /** @see ImageListCommands.cutImages */
  cutImages(imageIds = [...this.selectedImageIds]) { return this.imageListCommands.cutImages(imageIds); }

  /** @see ImageListCommands.pasteImages */
  pasteImages(afterImageId = null) { return this.imageListCommands.pasteImages(afterImageId); }

  /** @see ImageListCommands.duplicateImages */
  duplicateImages(imageIds = [...this.selectedImageIds]) { return this.imageListCommands.duplicateImages(imageIds); }

  /** @see ImageListCommands.insertImageCopies */
  insertImageCopies(payload, afterImageId) { return this.imageListCommands.insertImageCopies(payload, afterImageId); }

  /** @see ImageListCommands.moveImagesToEdge */
  moveImagesToEdge(toEnd, imageIds = [...this.selectedImageIds]) { return this.imageListCommands.moveImagesToEdge(toEnd, imageIds); }
  get selectedRange() { return this.ranges.find(({ clip }) => clip.id === this.selectedClipId) ?? null; }
  get selectedClipId() { return this._selectedClipId; }
  set selectedClipId(id) {
    this._selectedClipId = id;
    this.selectedClipIds = new Set(id ? [id] : []);
    this.selectionAnchorId = id;
  }
  get selectedClips() { return this.project.clips.filter(clip => this.selectedClipIds.has(clip.id)); }
  get selectedRanges() { return this.ranges.filter(({ clip }) => this.selectedClipIds.has(clip.id)); }

  /** @see SelectionCommands.setSelection */
  setSelection(ids, activeId = ids.at(-1), anchorId = activeId) { return this.selectionCommands.setSelection(ids, activeId, anchorId); }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  /** Serialize persistent project content while excluding playhead navigation. */
  projectState(project = this.project) {
    const { currentFrame, ...content } = project;
    return JSON.stringify(content);
  }

  get dirty() { return this.projectState() !== this.savedState; }
  /** Remember the exact saved content used for subsequent dirty-state checks. */
  markSaved(project = this.project) { this.savedState = this.projectState(project); }

  /** @see ImageListCommands.addImages */
  async addImages(paths, insertFrame = null, listPosition = null, onProgress) { return this.imageListCommands.addImages(paths, insertFrame, listPosition, onProgress); }

  /** @see ImageListCommands.addVideoFrames */
  addVideoFrames(details, insertFrame = null, listPosition = null) { return this.imageListCommands.addVideoFrames(details, insertFrame, listPosition); }

  /** @see ImageEffectsCommands.addPaintStroke */
  addPaintStroke(imageId, stroke) { return this.imageEffectsCommands.addPaintStroke(imageId, stroke); }

  /** @see ImageEffectsCommands.addPaintStrokes */
  addPaintStrokes(imageId, strokes, {separateUndoSteps = false} = {}) { return this.imageEffectsCommands.addPaintStrokes(imageId, strokes, {separateUndoSteps}); }

  /** @see ImageEffectsCommands.removeImageBackground */
  async removeImageBackground(imageId, options, currentResult = null) { return this.imageEffectsCommands.removeImageBackground(imageId, options, currentResult); }

  /** @see ImageEffectsCommands.processImageBackground */
  async processImageBackground(imageId, options, currentResult = null) { return this.imageEffectsCommands.processImageBackground(imageId, options, currentResult); }

  /** @see ImageEffectsCommands.resetImageBackground */
  resetImageBackground(imageId) { return this.imageEffectsCommands.resetImageBackground(imageId); }

  /** @see ImageEffectsCommands.clearImageEffects */
  clearImageEffects(imageId, applyToAll = false) { return this.imageEffectsCommands.clearImageEffects(imageId, applyToAll); }

  /** @see ImageEffectsCommands.setImageBackgroundResults */
  setImageBackgroundResults(results, expectedRevision = this.editRevision) { return this.imageEffectsCommands.setImageBackgroundResults(results, expectedRevision); }

  /** @see ImageEffectsCommands.setWorkingImageResults */
  setWorkingImageResults(results, expectedRevision = this.editRevision, backgroundRemoval = false) { return this.imageEffectsCommands.setWorkingImageResults(results, expectedRevision, backgroundRemoval); }

  /** @see ImageEffectsCommands.setImageOutlineResults */
  setImageOutlineResults(results, record = true, expectedRevision = this.editRevision) { return this.imageEffectsCommands.setImageOutlineResults(results, record, expectedRevision); }

  /** @see ImageEffectsCommands.resetImageOutline */
  resetImageOutline(imageIds) { return this.imageEffectsCommands.resetImageOutline(imageIds); }

  /** @see ImageEffectsCommands.setImageCrop */
  setImageCrop(imageId, crop, applyToAll = false) { return this.imageEffectsCommands.setImageCrop(imageId, crop, applyToAll); }

  /** @see ImageListCommands.addImageDetails */
  addImageDetails(details, durations, insertFrame, listPosition) { return this.imageListCommands.addImageDetails(details, durations, insertFrame, listPosition); }

  /** @see TimelineCommands.insertImage */
  insertImage(imageId, frame) { return this.timelineCommands.insertImage(imageId, frame); }

  /** @see TimelineCommands.insertClipsAtFrame */
  insertClipsAtFrame(added, frame) { return this.timelineCommands.insertClipsAtFrame(added, frame); }

  /** @see TimelineCommands.replaceClipWithImage */
  async replaceClipWithImage(clipId, paths) { return this.timelineCommands.replaceClipWithImage(clipId, paths); }

  /** @see ImageListCommands.reorderImages */
  reorderImages(sourceImageId, targetImageId, after = false) { return this.imageListCommands.reorderImages(sourceImageId, targetImageId, after); }

  /** @see TimelineCommands.moveClip */
  moveClip(sourceClipId, targetClipId, after = false) { return this.timelineCommands.moveClip(sourceClipId, targetClipId, after); }

  /** @see TimelineCommands.moveSelectedClips */
  moveSelectedClips(targetClipId, after = false) { return this.timelineCommands.moveSelectedClips(targetClipId, after); }

  /** @see TimelineCommands.moveSelectionToEdge */
  moveSelectionToEdge(toEnd) { return this.timelineCommands.moveSelectionToEdge(toEnd); }

  /** @see TimelineCommands.resizeSelectedClips */
  resizeSelectedClips(frames) { return this.timelineCommands.resizeSelectedClips(frames); }

  /** @see TimelineCommands.resizeClip */
  resizeClip(clipId, frames) { return this.timelineCommands.resizeClip(clipId, frames); }

  /** @see TimelineCommands.previewResizeClip */
  previewResizeClip(clipId, frames) { return this.timelineCommands.previewResizeClip(clipId, frames); }

  /** @see TimelineCommands.previewResizeSelection */
  previewResizeSelection(clipId, frames, snapshot) { return this.timelineCommands.previewResizeSelection(clipId, frames, snapshot); }

  /** @see TimelineCommands.commitClipResize */
  commitClipResize(snapshot) { return this.timelineCommands.commitClipResize(snapshot); }

  /** @see TimelineCommands.replaceClipImage */
  replaceClipImage(clipId, imageId) { return this.timelineCommands.replaceClipImage(clipId, imageId); }

  /** @see TimelineCommands.splitSelected */
  splitSelected() { return this.timelineCommands.splitSelected(); }

  /** @see TimelineCommands.duplicateSelected */
  duplicateSelected() { return this.timelineCommands.duplicateSelected(); }

  /** @see TimelineCommands.deleteSelected */
  deleteSelected() { return this.timelineCommands.deleteSelected(); }

  /** @see TimelineCommands.deleteClipsRelativeTo */
  deleteClipsRelativeTo(clipId, side) { return this.timelineCommands.deleteClipsRelativeTo(clipId, side); }

  /** @see TimelineCommands.copySelected */
  copySelected() { return this.timelineCommands.copySelected(); }

  /** @see TimelineCommands.cutSelected */
  cutSelected() { return this.timelineCommands.cutSelected(); }

  /** @see TimelineCommands.pasteClips */
  pasteClips(frame = this.project.currentFrame) { return this.timelineCommands.pasteClips(frame); }

  /** @see ImageListCommands.removeImage */
  removeImage(imageId) { return this.imageListCommands.removeImage(imageId); }

  /** @see ImageListCommands.removeImages */
  removeImages(imageIds = [...this.selectedImageIds]) { return this.imageListCommands.removeImages(imageIds); }

  /** @see ImageListCommands.clearImages */
  clearImages() { return this.imageListCommands.clearImages(); }

  /** @see SelectionCommands.selectClip */
  selectClip(clipId, { toggle = false, range = false, additive = false } = {}) { return this.selectionCommands.selectClip(clipId, {toggle, range, additive}); }

  /** @see SelectionCommands.focusClip */
  focusClip(clipId) { return this.selectionCommands.focusClip(clipId); }

  /** @see SelectionCommands.selectAllClips */
  selectAllClips() { return this.selectionCommands.selectAllClips(); }

  /** @see SelectionCommands.setFrame */
  setFrame(frame, notify = true) { return this.selectionCommands.setFrame(frame, notify); }

  /** @see ProjectSettingsCommands.setFps */
  setFps(fps) { return this.projectSettingsCommands.setFps(fps); }

  /** @see ProjectSettingsCommands.setProjectName */
  setProjectName(name) { return this.projectSettingsCommands.setProjectName(name); }

  /** @see ProjectSettingsCommands.setDefaultDuration */
  setDefaultDuration(frames) { return this.projectSettingsCommands.setDefaultDuration(frames); }

  /** @see ProjectSettingsCommands.setSpeed */
  setSpeed(speed) { return this.projectSettingsCommands.setSpeed(speed); }

  /** @see ProjectSettingsCommands.setLoop */
  setLoop(enabled) { return this.projectSettingsCommands.setLoop(enabled); }

  /** @see ProjectSettingsCommands.setLoopRange */
  setLoopRange(startFrame, endFrame, preview = false) { return this.projectSettingsCommands.setLoopRange(startFrame, endFrame, preview); }

  /** @see ProjectSettingsCommands.commitLoopRange */
  commitLoopRange(snapshot) { return this.projectSettingsCommands.commitLoopRange(snapshot); }

  /** @see ProjectSettingsCommands.setZoom */
  setZoom(zoom) { return this.projectSettingsCommands.setZoom(zoom); }

  /** Restore the previous persistent snapshot and retain the current state for Redo. */
  undo() {
    if (!this.canUndo) return;
    this.redoStack.push(this.snapshot());
    this.applySnapshot(this.undoStack.pop());
    this.trimHistory();
  }

  /** Restore a previously undone snapshot and retain the current state for Undo. */
  redo() {
    if (!this.canRedo) return;
    this.undoStack.push(this.snapshot());
    this.applySnapshot(this.redoStack.pop());
    this.trimHistory();
  }

  /** Restore validated history fields and notify views after clamping playback bounds. */
  applySnapshot(snapshot) {
    this.historyStateId = snapshot.historyStateId ?? ++this.nextHistoryStateId;
    this.previewImageId = null;
    this.editRevision += 1;
    this.cachedTotalFrames = null;
    this.cachedRanges = null;
    this.project.name = snapshot.name ?? this.project.name;
    this.project.fps = snapshot.fps;
    this.project.defaultDurationFrames = snapshot.defaultDurationFrames;
    this.project.playbackSpeed = snapshot.playbackSpeed ?? this.project.playbackSpeed;
    this.project.loopEnabled = snapshot.loopEnabled ?? this.project.loopEnabled;
    this.project.loopStartFrame = snapshot.loopStartFrame ?? 0;
    this.project.loopEndFrame = snapshot.loopEndFrame ?? null;
    this.project.images = snapshot.images;
    this.project.clips = snapshot.clips;
    this.selectedImageIds = new Set(snapshot.selectedImageIds ?? []);
    this.imageSelectionAnchorId = snapshot.imageSelectionAnchorId ?? null;
    if (snapshot.selectedClipIds) this.setSelection(snapshot.selectedClipIds, snapshot.selectedClipId, snapshot.selectionAnchorId);
    else if (!this.project.clips.some((clip) => clip.id === this.selectedClipId)) {
      this.selectedClipId = this.project.clips[0]?.id ?? null;
    }
    this.clampCurrentFrame();
    this.notify();
  }

  /** @see ProjectSettingsCommands.clampCurrentFrame */
  clampCurrentFrame() { return this.projectSettingsCommands.clampCurrentFrame(); }

  /** @see ProjectSettingsCommands.replaceProject */
  replaceProject(candidate) { return this.projectSettingsCommands.replaceProject(candidate); }
}
