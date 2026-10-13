import { totalFrames, validateProject } from '../../model/project-model.mjs';
import { preserveOriginal } from '../../model/image-effects.mjs';
import {cleanupDefaults,timelineCleanupPlan} from '../../model/timeline-cleanup.mjs';
import {survivingBefore} from '../../model/frame-intervals.mjs';
import { timelineDeletionPlan } from '../../model/timeline-deletion.mjs';

const copy = value => JSON.parse(JSON.stringify(value));

/** Edit whole-frame clips while preserving ordered ranges and grouped history. */
export class TimelineCommands {
  constructor(viewModel) { this.viewModel = viewModel; }

  /** Commit a previewed sampling pattern as one reversible edit, retaining source assets. */
  cleanupTimeline(options, selectedIds = [...this.viewModel.selectedClipIds], expectedRevision = this.viewModel.editRevision, preparedPlan = null) {
    const vm = this.viewModel;
    if (expectedRevision !== vm.editRevision) throw new Error('The timeline changed. Reopen Frame cleanup to review the new result.');
    const plan = preparedPlan ?? timelineCleanupPlan(vm.project,options,selectedIds);
    if (preparedPlan) {
      if (JSON.stringify(plan.options) !== JSON.stringify({...cleanupDefaults,...options})) throw new Error('The preview settings changed. Recalculate the result before applying.');
      validateProject({...vm.project,clips:plan.clips,currentFrame:0,loopStartFrame:0,loopEndFrame:null});
    }
    if (!plan.changed) return false;
    vm.record();
    vm.project.clips = plan.clips;
    if (plan.options.timing !== 'hold') {
      vm.project.currentFrame = survivingBefore(plan.keptFrames,vm.project.currentFrame);
      vm.project.loopStartFrame = survivingBefore(plan.keptFrames,vm.project.loopStartFrame ?? 0);
      if (vm.project.loopEndFrame != null) vm.project.loopEndFrame = survivingBefore(plan.keptFrames,vm.project.loopEndFrame);
    }
    const known = new Set(plan.clips.map(clip => clip.id));
    const selection = [...vm.selectedClipIds].filter(id => known.has(id));
    vm.setSelection(selection.length ? selection : [plan.clips[0].id],
      known.has(vm.selectedClipId) ? vm.selectedClipId : selection[0] ?? plan.clips[0].id);
    vm.previewImageId = null;
    vm.clampCurrentFrame();
    vm.notify();
    return true;
  }

  /** Insert a source-image clip at the requested whole frame. */
  insertImage(imageId, frame) {
    if (!this.viewModel.project.images.some((image) => image.id === imageId)) return;
    this.viewModel.record();
    const clip = { id: crypto.randomUUID(), imageId, durationFrames: this.viewModel.project.defaultDurationFrames };
    this.viewModel.insertClipsAtFrame([clip], frame);
  }

  /** Insert clips at a whole-frame position, splitting a containing clip when necessary. */
  insertClipsAtFrame(added, frame) {
    this.viewModel.previewImageId = null;
    let placedAtFrame = null;
    if (frame === null || !this.viewModel.project.clips.length) {
      placedAtFrame = this.viewModel.totalFrames;
      this.viewModel.project.clips.push(...added);
      this.viewModel.cachedTotalFrames = null;
      this.viewModel.cachedRanges = null;
    } else {
      let elapsed = 0;
      let insertionIndex = this.viewModel.project.clips.length;
      for (let index = 0; index < this.viewModel.project.clips.length; index += 1) {
        const clip = this.viewModel.project.clips[index];
        const end = elapsed + clip.durationFrames;
        if (frame <= elapsed) {
          insertionIndex = index;
          placedAtFrame = elapsed;
          break;
        }
        if (frame < end) {
          placedAtFrame = frame;
          const leftFrames = frame - elapsed;
          const rightFrames = end - frame;
          const replacement = [];
          if (leftFrames > 0) replacement.push({ ...clip, durationFrames: leftFrames });
          replacement.push(...added);
          if (rightFrames > 0) replacement.push({ ...clip, id: crypto.randomUUID(), durationFrames: rightFrames });
          this.viewModel.project.clips.splice(index, 1, ...replacement);
          this.viewModel.selectedClipId = added[0].id;
          this.viewModel.project.currentFrame = placedAtFrame;
          this.viewModel.clampCurrentFrame();
          this.viewModel.notify();
          return;
        }
        elapsed = end;
        if (frame === end) {
          insertionIndex = index + 1;
          placedAtFrame = end;
        }
      }
      if (placedAtFrame === null) placedAtFrame = elapsed;
      this.viewModel.project.clips.splice(insertionIndex, 0, ...added);
    }
    this.viewModel.selectedClipId = added[0].id;
    if (placedAtFrame !== null && this.viewModel.project.clips.length) {
      this.viewModel.project.currentFrame = Math.min(placedAtFrame, this.viewModel.totalFrames - 1);
    }
    this.viewModel.clampCurrentFrame();
    this.viewModel.notify();
  }

  /** Inspect a replacement asset and update the requested clip without accepting stale results. */
  async replaceClipWithImage(clipId, paths) {
    const clip = this.viewModel.project.clips.find((item) => item.id === clipId);
    if (!paths.length || !clip) return;
    const revision = this.viewModel.editRevision;
    const [detail] = await this.viewModel.mediaService.inspectImages(paths);
    if (!detail || revision !== this.viewModel.editRevision || !this.viewModel.project.clips.includes(clip)) return;
    this.viewModel.record();
    const image = {
      id: crypto.randomUUID(),
      path: detail.path,
      name: detail.name,
      width: detail.width,
      height: detail.height
    };
    preserveOriginal(image);
    const oldImageId = clip.imageId;
    const oldImageIndex = this.viewModel.project.images.findIndex((item) => item.id === oldImageId);
    const oldImageIsShared = this.viewModel.project.clips.some((item) => item.id !== clipId && item.imageId === oldImageId);
    if (oldImageIsShared || oldImageIndex < 0) this.viewModel.project.images.splice(oldImageIndex < 0 ? this.viewModel.project.images.length : oldImageIndex + 1, 0, image);
    else this.viewModel.project.images.splice(oldImageIndex, 1, image);
    clip.imageId = image.id;
    this.viewModel.selectedClipId = clipId;
    this.viewModel.notify();
  }

  /** Move a clip or selected group relative to a target clip. */
  moveClip(sourceClipId, targetClipId, after = false) {
    if (sourceClipId === targetClipId) return;
    const from = this.viewModel.project.clips.findIndex((clip) => clip.id === sourceClipId);
    const target = this.viewModel.project.clips.findIndex((clip) => clip.id === targetClipId);
    if (from < 0 || target < 0) return;
    this.viewModel.record();
    const [clip] = this.viewModel.project.clips.splice(from, 1);
    let destination = this.viewModel.project.clips.findIndex((item) => item.id === targetClipId);
    if (after) destination += 1;
    this.viewModel.project.clips.splice(destination, 0, clip);
    const imageOrder = [...new Set(this.viewModel.project.clips.map((item) => item.imageId))];
    const images = new Map(this.viewModel.project.images.map((image) => [image.id, image]));
    this.viewModel.project.images = [...imageOrder.map((id) => images.get(id)), ...this.viewModel.project.images.filter((image) => !imageOrder.includes(image.id))];
    this.viewModel.clampCurrentFrame();
    this.viewModel.notify();
  }

  /** Reorder the selected clips as a stable group with one undo step. */
  moveSelectedClips(targetClipId, after = false) {
    const selected = this.viewModel.selectedClips;
    if (!selected.length || this.viewModel.selectedClipIds.has(targetClipId)) return false;
    const remaining = this.viewModel.project.clips.filter(clip => !this.viewModel.selectedClipIds.has(clip.id));
    const target = remaining.findIndex(clip => clip.id === targetClipId);
    if (target < 0) return false;
    const ordered = [...remaining];
    ordered.splice(target + (after ? 1 : 0), 0, ...selected);
    if (ordered.every((clip, index) => clip.id === this.viewModel.project.clips[index].id)) return false;
    this.viewModel.record();
    this.viewModel.project.clips = ordered;
    const imageOrder = [...new Set(ordered.map(clip => clip.imageId))];
    const images = new Map(this.viewModel.project.images.map(image => [image.id, image]));
    this.viewModel.project.images = [...imageOrder.map(id => images.get(id)), ...this.viewModel.project.images.filter(image => !imageOrder.includes(image.id))];
    this.viewModel.clampCurrentFrame();
    this.viewModel.notify();
    return true;
  }

  /** Move selected clips to the beginning or end of the sequence. */
  moveSelectionToEdge(toEnd) {
    const selected = this.viewModel.selectedClips;
    const remaining = this.viewModel.project.clips.filter(clip => !this.viewModel.selectedClipIds.has(clip.id));
    if (!selected.length || !remaining.length) return false;
    return this.viewModel.moveSelectedClips(toEnd ? remaining.at(-1).id : remaining[0].id, toEnd);
  }

  /** Reverse selected clips in their existing slots, leaving unselected clips untouched. */
  reverseSelected() {
    const selected = this.viewModel.selectedClips;
    if (selected.length < 2) return false;
    this.viewModel.record();
    const reversed = [...selected].reverse();
    let index = 0;
    this.viewModel.project.clips = this.viewModel.project.clips.map(clip =>
      this.viewModel.selectedClipIds.has(clip.id) ? reversed[index++] : clip);
    this.viewModel.clampCurrentFrame();
    this.viewModel.notify();
    return true;
  }

  /** Set positive whole-frame durations for the selected clips as one edit. */
  resizeSelectedClips(frames) {
    if (!Number.isSafeInteger(frames) || frames < 1) return false;
    const selected = this.viewModel.selectedClips;
    if (!selected.length || selected.every(clip => clip.durationFrames === frames)) return false;
    this.viewModel.record();
    for (const clip of selected) clip.durationFrames = frames;
    this.viewModel.clampCurrentFrame();
    this.viewModel.notify();
    return true;
  }

  /** Validate and commit one clip duration in whole frames. */
  resizeClip(clipId, frames) {
    if (!Number.isInteger(frames) || frames < 1) return;
    const clip = this.viewModel.project.clips.find((item) => item.id === clipId);
    if (!clip || clip.durationFrames === frames) return;
    this.viewModel.record();
    clip.durationFrames = frames;
    this.viewModel.clampCurrentFrame();
    this.viewModel.notify();
  }

  /** Update a transient resize duration without creating another history snapshot. */
  previewResizeClip(clipId, frames) {
    if (!Number.isInteger(frames) || frames < 1) return;
    const clip = this.viewModel.project.clips.find((item) => item.id === clipId);
    if (!clip || clip.durationFrames === frames) return;
    this.viewModel.editRevision += 1;
    this.viewModel.cachedTotalFrames = null;
    this.viewModel.cachedRanges = null;
    clip.durationFrames = frames;
    this.viewModel.clampCurrentFrame();
    this.viewModel.notify();
  }

  /** Apply a resize delta to the captured selected durations in whole frames. */
  previewResizeSelection(clipId, frames, snapshot) {
    if (!Number.isSafeInteger(frames) || frames < 1) return;
    const selected = new Set(snapshot.selectedClipIds ?? [clipId]);
    const originals = snapshot.clips.filter(clip => selected.has(clip.id));
    const source = originals.find(clip => clip.id === clipId);
    if (!source) return;
    const shortest = originals.reduce((minimum, clip) => Math.min(minimum, clip.durationFrames), Infinity);
    const delta = Math.max(frames - source.durationFrames, 1 - shortest);
    const durations = new Map(originals.map(clip => [clip.id, clip.durationFrames + delta]));
    if (this.viewModel.project.clips.every(clip => !durations.has(clip.id) || clip.durationFrames === durations.get(clip.id))) return;
    this.viewModel.editRevision += 1;
    this.viewModel.cachedTotalFrames = this.viewModel.cachedRanges = null;
    for (const clip of this.viewModel.project.clips) if (durations.has(clip.id)) clip.durationFrames = durations.get(clip.id);
    this.viewModel.clampCurrentFrame();
    this.viewModel.notify();
  }

  /** Record a completed resize gesture only if its captured state changed. */
  commitClipResize(snapshot) {
    if (JSON.stringify(snapshot.clips) === JSON.stringify(this.viewModel.project.clips)) return;
    this.viewModel.editRevision += 1;
    this.viewModel.undoStack.push(snapshot);
    this.viewModel.historyStateId = ++this.viewModel.nextHistoryStateId;
    this.viewModel.redoStack = [];
    this.viewModel.trimHistory();
    this.viewModel.notify();
  }

  /** Replace the image reference of a clip with a known source asset. */
  replaceClipImage(clipId, imageId) {
    const clip = this.viewModel.project.clips.find((item) => item.id === clipId);
    if (!clip || !this.viewModel.project.images.some((image) => image.id === imageId) || clip.imageId === imageId) return;
    this.viewModel.record();
    clip.imageId = imageId;
    this.viewModel.notify();
  }

  /** Split the active clip at the current frame into two positive-duration clips. */
  splitSelected() {
    const range = this.viewModel.selectedRange;
    if (!range || this.viewModel.project.currentFrame <= range.startFrame || this.viewModel.project.currentFrame >= range.endFrame) return;
    this.viewModel.record();
    const left = this.viewModel.project.currentFrame - range.startFrame;
    const right = range.clip.durationFrames - left;
    const index = this.viewModel.project.clips.findIndex((clip) => clip.id === range.clip.id);
    this.viewModel.project.clips.splice(index, 1,
      { ...range.clip, durationFrames: left },
      { ...range.clip, id: crypto.randomUUID(), durationFrames: right });
    this.viewModel.notify();
  }

  /** Clone selected clips with new IDs and keep their sequence order. */
  duplicateSelected() {
    const selected = this.viewModel.selectedClips;
    if (!selected.length) return;
    this.viewModel.record();
    const index = this.viewModel.project.clips.findIndex(clip => clip.id === selected.at(-1).id);
    const duplicates = selected.map(clip => ({ ...clip, id: crypto.randomUUID() }));
    this.viewModel.project.clips.splice(index + 1, 0, ...duplicates);
    this.viewModel.setSelection(duplicates.map(clip => clip.id));
    this.viewModel.clampCurrentFrame();
    this.viewModel.notify();
  }

  /** Remove selected timeline clips and retain their source assets. */
  deleteSelected() {
    const index = this.viewModel.project.clips.findIndex(clip => this.viewModel.selectedClipIds.has(clip.id));
    if (index < 0) return false;
    const plan = timelineDeletionPlan(this.viewModel.project, clip => this.viewModel.selectedClipIds.has(clip.id));
    this.viewModel.record();
    Object.assign(this.viewModel.project, plan);
    this.viewModel.selectedClipId = this.viewModel.project.clips[Math.min(index, this.viewModel.project.clips.length - 1)]?.id ?? null;
    this.viewModel.clampCurrentFrame();
    this.viewModel.notify();
    return true;
  }

  /** Delete clips before or after a target and rebase playback range and selection. */
  deleteClipsRelativeTo(clipId, side) {
    const index = this.viewModel.project.clips.findIndex(clip => clip.id === clipId);
    if (index < 0 || !["before", "after"].includes(side)) return false;
    const before = side === "before";
    if (before ? index === 0 : index === this.viewModel.project.clips.length - 1) return false;
    const plan = timelineDeletionPlan(this.viewModel.project, (_clip, clipIndex) => before ? clipIndex < index : clipIndex > index);
    this.viewModel.record();
    Object.assign(this.viewModel.project, plan);
    this.viewModel.selectedClipId = clipId;
    this.viewModel.previewImageId = null;
    this.viewModel.clampCurrentFrame();
    this.viewModel.notify();
    return true;
  }

  /** Capture selected clips and their asset references in the timeline clipboard. */
  copySelected() {
    const clips = this.viewModel.selectedClips;
    if (!clips.length) return false;
    const imageIds = new Set(clips.map(clip => clip.imageId));
    this.viewModel.clipboard = copy({ clips, images: this.viewModel.project.images.filter(image => imageIds.has(image.id)) });
    return true;
  }

  /** Copy selected timeline clips, then remove them through the shared delete command. */
  cutSelected() {
    if (!this.viewModel.copySelected()) return false;
    return this.viewModel.deleteSelected();
  }

  /** Insert clipboard clips at the requested frame with new identities. */
  pasteClips(frame = this.viewModel.project.currentFrame) {
    if (!this.viewModel.clipboard?.clips.length) return false;
    this.viewModel.record();
    const imageMap = new Map();
    for (const source of this.viewModel.clipboard.images) {
      const existing = this.viewModel.project.images.find(image => image.id === source.id && JSON.stringify(image) === JSON.stringify(source));
      const image = existing ?? { ...copy(source), id: crypto.randomUUID() };
      if (!existing) this.viewModel.project.images.push(image);
      imageMap.set(source.id, image.id);
    }
    const clips = this.viewModel.clipboard.clips.map(clip => ({ ...clip, id: crypto.randomUUID(), imageId: imageMap.get(clip.imageId) }));
    const insertionFrame = Math.max(0, Math.min(this.viewModel.totalFrames, Math.floor(frame)));
    this.viewModel.cachedTotalFrames = null;
    this.viewModel.cachedRanges = null;
    this.viewModel.insertClipsAtFrame(clips, insertionFrame);
    this.viewModel.setSelection(clips.map(clip => clip.id), clips[0].id);
    this.viewModel.notify();
    return true;
  }
}
