
import { preserveOriginal } from '../../model/image-effects.mjs';
import { imageRenamePlan } from '../../model/image-names.mjs';

const copy = value => JSON.parse(JSON.stringify(value));

/** Manage source assets, list selection, clipboard copies, and import placement. */
export class ImageListCommands {
  constructor(viewModel) { this.viewModel = viewModel; }

  /** Update source-list selection using toggle, range, or additive semantics. */
  selectImage(imageId, { toggle = false, range = false, additive = false } = {}) {
    if (!this.viewModel.project.images.some(image => image.id === imageId)) return false;
    if (range) {
      const anchor = this.viewModel.imageSelectionAnchorId ?? imageId;
      const from = this.viewModel.project.images.findIndex(image => image.id === anchor);
      const to = this.viewModel.project.images.findIndex(image => image.id === imageId);
      const ids = this.viewModel.project.images.slice(Math.min(from < 0 ? to : from, to), Math.max(from, to) + 1).map(image => image.id);
      this.viewModel.selectedImageIds = new Set(additive ? [...this.viewModel.selectedImageIds, ...ids] : ids);
      this.viewModel.imageSelectionAnchorId = anchor;
    } else if (toggle) {
      if (this.viewModel.selectedImageIds.has(imageId)) this.viewModel.selectedImageIds.delete(imageId);
      else this.viewModel.selectedImageIds.add(imageId);
      this.viewModel.imageSelectionAnchorId = imageId;
    } else {
      this.viewModel.selectedImageIds = new Set([imageId]);
      this.viewModel.imageSelectionAnchorId = imageId;
    }
    const clipRange = this.viewModel.ranges.find(({ clip }) => clip.imageId === imageId);
    this.viewModel.selectedClipId = clipRange?.clip.id ?? null;
    if (clipRange) this.viewModel.project.currentFrame = clipRange.startFrame;
    // Navigation only: assets without timeline clips must also be editable.
    this.viewModel.previewImageId = imageId;
    this.viewModel.notify();
    return true;
  }

  /** Validate a batch naming plan and rename its assets with one undo step. */
  renameImages(options) {
    const plan = imageRenamePlan(this.viewModel.project.images, options, [...this.viewModel.selectedImageIds]);
    if (plan.every(item=>item.name === item.oldName)) return 0;
    this.viewModel.record();
    const names = new Map(plan.map(item=>[item.id,item.name]));
    this.viewModel.project.images = this.viewModel.project.images.map(image=>names.has(image.id) ? {...image,name:names.get(image.id)} : image);
    this.viewModel.notify();
    return plan.filter(item=>item.name !== item.oldName).length;
  }

  /** Activate a source image for preview without requiring a timeline clip. */
  focusImage(imageId) {
    if (!this.viewModel.selectedImageIds.has(imageId)) return this.viewModel.selectImage(imageId);
    const selection = new Set(this.viewModel.selectedImageIds);
    const anchor = this.viewModel.imageSelectionAnchorId;
    // Select the preview and its clip while retaining the import-list group.
    const range = this.viewModel.ranges.find(({ clip }) => clip.imageId === imageId);
    this.viewModel.selectedClipId = range?.clip.id ?? null;
    if (range) this.viewModel.project.currentFrame = range.startFrame;
    this.viewModel.previewImageId = imageId;
    this.viewModel.selectedImageIds = selection;
    this.viewModel.imageSelectionAnchorId = anchor;
    this.viewModel.notify();
    return true;
  }

  /** Select every source-list item without recording a persistent edit. */
  selectAllImages() {
    this.viewModel.selectedImageIds = new Set(this.viewModel.project.images.map(image => image.id));
    this.viewModel.imageSelectionAnchorId ??= this.viewModel.project.images[0]?.id ?? null;
    this.viewModel.notify();
  }

  /** Clone valid requested image assets for clipboard operations. */
  captureImages(imageIds = [...this.viewModel.selectedImageIds]) {
    const ids = new Set(imageIds);
    return copy({ images: this.viewModel.project.images.filter(image => ids.has(image.id)),
      clips: this.viewModel.project.clips.filter(clip => ids.has(clip.imageId)) });
  }

  /** Store source-image copies in the image clipboard without changing the project. */
  copyImages(imageIds) {
    const payload = this.viewModel.captureImages(imageIds);
    if (!payload.images.length) return false;
    this.viewModel.imageClipboard = payload;
    return true;
  }

  /** Capture selected assets, then remove them and their clips as one edit. */
  cutImages(imageIds = [...this.viewModel.selectedImageIds]) {
    if (!this.viewModel.copyImages(imageIds)) return false;
    return this.viewModel.removeImages(imageIds);
  }

  /** Insert image clipboard copies after the requested list item. */
  pasteImages(afterImageId = null) {
    return this.viewModel.insertImageCopies(this.viewModel.imageClipboard, afterImageId);
  }

  /** Create new asset and clip identities for the requested source images. */
  duplicateImages(imageIds = [...this.viewModel.selectedImageIds]) {
    const payload = this.viewModel.captureImages(imageIds);
    return this.viewModel.insertImageCopies(payload, payload.images.at(-1)?.id ?? null);
  }

  /** Insert cloned assets with fresh IDs while retaining original/edit references. */
  insertImageCopies(payload, afterImageId) {
    if (!payload?.images.length) return false;
    const images = payload.images.map(image => ({...copy(image), id:crypto.randomUUID()}));
    const imageMap = new Map(payload.images.map((source, index) => [source.id, images[index].id]));
    const clips = payload.images.flatMap(source => {
      const linked = payload.clips.filter(clip => clip.imageId === source.id);
      return (linked.length ? linked : [{durationFrames:this.viewModel.project.defaultDurationFrames}])
        .map(clip => ({...copy(clip), id:crypto.randomUUID(), imageId:imageMap.get(source.id)}));
    });
    this.viewModel.record();
    const targetIndex = this.viewModel.project.images.findIndex(image => image.id === afterImageId);
    this.viewModel.project.images.splice(targetIndex < 0 ? this.viewModel.project.images.length : targetIndex + 1, 0, ...images);
    const targetClips = this.viewModel.project.clips.map((clip, index) => clip.imageId === afterImageId ? index : -1).filter(index => index >= 0);
    const insertionIndex = targetClips.length ? targetClips.at(-1) + 1 : this.viewModel.project.clips.length;
    this.viewModel.project.clips.splice(insertionIndex, 0, ...clips);
    this.viewModel.selectedImageIds = new Set(images.map(image => image.id));
    this.viewModel.imageSelectionAnchorId = images[0].id;
    this.viewModel.setSelection(clips.map(clip => clip.id), clips[0].id);
    this.viewModel.previewImageId = images[0].id;
    this.viewModel.project.currentFrame = this.viewModel.ranges.find(({clip}) => clip.id === clips[0].id)?.startFrame ?? 0;
    this.viewModel.clampCurrentFrame();
    this.viewModel.notify();
    return true;
  }

  /** Move selected source-list items to the beginning or end without changing their relative order. */
  moveImagesToEdge(toEnd, imageIds = [...this.viewModel.selectedImageIds]) {
    const ids = new Set(imageIds);
    const selected = this.viewModel.project.images.filter(image => ids.has(image.id));
    const remaining = this.viewModel.project.images.filter(image => !ids.has(image.id));
    if (!selected.length || !remaining.length) return false;
    const ordered = toEnd ? [...remaining, ...selected] : [...selected, ...remaining];
    if (ordered.every((image, index) => image.id === this.viewModel.project.images[index].id)) return false;
    this.viewModel.record();
    this.viewModel.project.images = ordered;
    const byImage = new Map();
    for (const clip of this.viewModel.project.clips) {
      if (!byImage.has(clip.imageId)) byImage.set(clip.imageId, []);
      byImage.get(clip.imageId).push(clip);
    }
    this.viewModel.project.clips = ordered.flatMap(image => byImage.get(image.id) ?? []);
    this.viewModel.clampCurrentFrame();
    this.viewModel.notify();
    return true;
  }

  /** Inspect imported media through the injected service, then add valid assets and timeline clips. */
  async addImages(paths, insertFrame = null, listPosition = null, onProgress) {
    if (!paths.length) return;
    const project = this.viewModel.project;
    const details = await this.viewModel.mediaService.inspectImages(paths, onProgress);
    if (project !== this.viewModel.project) return;
    return this.viewModel.addImageDetails(details, null, insertFrame, listPosition);
  }

  /** Insert decoded video frames as one-frame clips. */
  addVideoFrames(details, insertFrame = null, listPosition = null) {
    return this.viewModel.addImageDetails(details, details.map((detail) => detail.duration_frames ?? 1), insertFrame, listPosition);
  }

  /** Insert validated asset details and create clips with specified whole-frame durations. */
  addImageDetails(details, durations, insertFrame, listPosition) {
    if (!details.length) return;
    this.viewModel.record();
    const images = details.map((detail) => ({
      id: crypto.randomUUID(),
      path: detail.path,
      name: detail.name,
      width: detail.width,
      height: detail.height
    }));
    images.forEach(preserveOriginal);
    const added = images.map((image, index) => ({
      id: crypto.randomUUID(),
      imageId: image.id,
      durationFrames: durations ? durations[index] : this.viewModel.project.defaultDurationFrames
    }));
    if (listPosition && insertFrame === null) {
      const targetIndex = this.viewModel.project.images.findIndex((image) => image.id === listPosition.imageId);
      const insertionIndex = targetIndex < 0
        ? this.viewModel.project.images.length
        : targetIndex + (listPosition.after ? 1 : 0);
      this.viewModel.project.images.splice(insertionIndex, 0, ...images);
      const clipsByImage = new Map();
      for (const clip of [...this.viewModel.project.clips, ...added]) {
        if (!clipsByImage.has(clip.imageId)) clipsByImage.set(clip.imageId, []);
        clipsByImage.get(clip.imageId).push(clip);
      }
      this.viewModel.project.clips = this.viewModel.project.images.flatMap((image) => clipsByImage.get(image.id) ?? []);
      this.viewModel.selectedClipId = added[0].id;
      const range = this.viewModel.ranges.find(({ clip }) => clip.id === added[0].id);
      this.viewModel.project.currentFrame = range?.startFrame ?? 0;
      this.viewModel.clampCurrentFrame();
      this.viewModel.notify();
      return { images, clips: added };
    }
    this.viewModel.project.images.push(...images);
    this.viewModel.insertClipsAtFrame(added, insertFrame);
    return { images, clips: added };
  }

  /** Move source-list assets around a target while preserving group order. */
  reorderImages(sourceImageId, targetImageId, after = false) {
    if (sourceImageId === targetImageId) return;
    const from = this.viewModel.project.images.findIndex((image) => image.id === sourceImageId);
    const target = this.viewModel.project.images.findIndex((image) => image.id === targetImageId);
    if (from < 0 || target < 0) return;
    this.viewModel.record();
    const [image] = this.viewModel.project.images.splice(from, 1);
    let destination = this.viewModel.project.images.findIndex((item) => item.id === targetImageId);
    if (after) destination += 1;
    this.viewModel.project.images.splice(destination, 0, image);
    const byImage = new Map();
    for (const clip of this.viewModel.project.clips) {
      if (!byImage.has(clip.imageId)) byImage.set(clip.imageId, []);
      byImage.get(clip.imageId).push(clip);
    }
    const ordered = this.viewModel.project.images.flatMap((item) => byImage.get(item.id) ?? []);
    const known = new Set(ordered.map((clip) => clip.id));
    this.viewModel.project.clips = [...ordered, ...this.viewModel.project.clips.filter((clip) => !known.has(clip.id))];
    this.viewModel.clampCurrentFrame();
    this.viewModel.notify();
  }

  /** Remove one asset and its referenced clips through the shared batch command. */
  removeImage(imageId) {
    return this.viewModel.removeImages([imageId]);
  }

  /** Remove requested source assets and referenced clips, then clamp playback and selection. */
  removeImages(imageIds = [...this.viewModel.selectedImageIds]) {
    const ids = new Set(imageIds);
    const imageIndex = this.viewModel.project.images.findIndex(image => ids.has(image.id));
    if (imageIndex < 0) return false;
    const removedClipIndexes = this.viewModel.project.clips
      .map((clip, index) => ids.has(clip.imageId) ? index : -1)
      .filter((index) => index >= 0);
    this.viewModel.record();
    this.viewModel.project.images = this.viewModel.project.images.filter(image => !ids.has(image.id));
    this.viewModel.project.clips = this.viewModel.project.clips.filter(clip => !ids.has(clip.imageId));
    if (!this.viewModel.project.clips.some((clip) => clip.id === this.viewModel.selectedClipId)) {
      const nextIndex = removedClipIndexes.length
        ? Math.min(removedClipIndexes[0], this.viewModel.project.clips.length - 1)
        : 0;
      this.viewModel.selectedClipId = this.viewModel.project.clips[nextIndex]?.id ?? null;
    }
    this.viewModel.clampCurrentFrame();
    this.viewModel.notify();
    return true;
  }

  /** Remove every source asset and clip as a single persistent edit. */
  clearImages() {
    if (!this.viewModel.project.images.length) return;
    this.viewModel.record();
    this.viewModel.project.images = [];
    this.viewModel.project.clips = [];
    this.viewModel.selectedClipId = null;
    this.viewModel.clampCurrentFrame();
    this.viewModel.notify();
  }
}
