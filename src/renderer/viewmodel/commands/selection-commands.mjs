import { totalFrames } from '../../model/project-model.mjs';

/** Track active timeline clips, range selection, and the current frame. */
export class SelectionCommands {
  constructor(viewModel) { this.viewModel = viewModel; }

  /** Validate selected clip IDs and set the active clip and stable selection anchor. */
  setSelection(ids, activeId = ids.at(-1), anchorId = activeId) {
    const known = new Set(this.viewModel.project.clips.map(clip => clip.id));
    this.viewModel.selectedClipIds = new Set(ids.filter(id => known.has(id)));
    this.viewModel._selectedClipId = this.viewModel.selectedClipIds.has(activeId) ? activeId : [...this.viewModel.selectedClipIds].at(-1) ?? null;
    this.viewModel.selectionAnchorId = known.has(anchorId) ? anchorId : this.viewModel._selectedClipId;
  }

  /** Update timeline selection using toggle, range, or additive semantics. */
  selectClip(clipId, { toggle = false, range = false, additive = false } = {}) {
    if (this.viewModel.project.clips.some((clip) => clip.id === clipId)) {
      this.viewModel.previewImageId = null;
      if (range) {
        const anchor = this.viewModel.selectionAnchorId ?? this.viewModel.selectedClipId ?? clipId;
        const from = this.viewModel.project.clips.findIndex(clip => clip.id === anchor);
        const to = this.viewModel.project.clips.findIndex(clip => clip.id === clipId);
        const ids = this.viewModel.project.clips.slice(Math.min(from < 0 ? to : from, to), Math.max(from, to) + 1).map(clip => clip.id);
        this.viewModel.setSelection(additive ? [...this.viewModel.selectedClipIds, ...ids] : ids, clipId, anchor);
      } else if (toggle) {
        const ids = new Set(this.viewModel.selectedClipIds);
        if (ids.has(clipId)) ids.delete(clipId);
        else ids.add(clipId);
        this.viewModel.setSelection([...ids], clipId, clipId);
      } else this.viewModel.selectedClipId = clipId;
      this.viewModel.notify();
    }
  }

  /** Select a known clip and position the playhead at its start. */
  focusClip(clipId) {
    this.viewModel.previewImageId = null;
    if (this.viewModel.selectedClipIds.has(clipId)) { this.viewModel._selectedClipId = clipId; this.viewModel.notify(); }
    else this.viewModel.selectClip(clipId);
  }

  /** Select every timeline clip without recording a persistent project edit. */
  selectAllClips() {
    this.viewModel.setSelection(this.viewModel.project.clips.map(clip => clip.id), this.viewModel.selectedClipId ?? this.viewModel.project.clips[0]?.id);
    this.viewModel.notify();
  }

  /** Clamp the playhead to a whole frame and optionally notify views. */
  setFrame(frame, notify = true) {
    this.viewModel.previewImageId = null;
    this.viewModel.project.currentFrame = this.viewModel.totalFrames ? Math.max(0, Math.min(this.viewModel.totalFrames - 1, Math.floor(frame))) : 0;
    if (notify) this.viewModel.notify();
  }
}
