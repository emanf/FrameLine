import test from "node:test";
import assert from "node:assert/strict";
import { TimelineViewModel } from "../src/renderer/viewmodel/timeline-view-model.mjs";
import { createProject, validateProject } from "../src/renderer/model/project-model.mjs";
import { exportClipData } from "../src/renderer/model/export-clips.mjs";

globalThis.window = { frameLine: { inspectImages: async paths => paths.map(path => ({ path, name: path, width: 100, height: 80 })) } };
async function sequence() {
  const model = new TimelineViewModel();
  await model.addImages(["a.png", "b.png", "c.png", "d.png", "e.png"]);
  return model;
}
const ids = model => model.project.clips.map(clip => clip.id);

test("Ctrl toggles, Shift selects from a stable anchor, and Ctrl+Shift adds a range", async () => {
  const model = await sequence();
  const [a, b, c, d, e] = ids(model);
  model.markSaved();
  model.selectClip(b);
  model.selectClip(d, { toggle: true });
  assert.deepEqual([...model.selectedClipIds], [b, d]);
  model.selectClip(d, { toggle: true });
  assert.deepEqual([...model.selectedClipIds], [b]);
  model.selectClip(b);
  model.selectClip(e, { range: true });
  assert.deepEqual(model.selectedClips.map(clip => clip.id), [b, c, d, e]);
  model.selectClip(c, { range: true });
  assert.deepEqual(model.selectedClips.map(clip => clip.id), [b, c]);
  model.selectClip(a, { range: true, additive: true });
  assert.deepEqual(model.selectedClips.map(clip => clip.id), [a, b, c]);
  model.focusClip(b);
  assert.equal(model.selectedClips.length, 3, "right-click focus preserves the group");
  model.selectAllClips();
  assert.equal(model.selectedClips.length, 5);
  assert.equal(model.dirty, false, "selection is transient UI state");
});

test("moving nonadjacent selected clips keeps their order and is one undo step", async () => {
  const model = await sequence();
  const [a, b, c, d, e] = ids(model);
  model.selectClip(d);
  model.selectClip(b, { toggle: true });
  const history = model.undoStack.length;
  assert.equal(model.moveSelectedClips(b), false, "dropping on the selection is a no-op");
  model.moveSelectedClips(a, true);
  assert.deepEqual(ids(model), [a, b, d, c, e]);
  assert.equal(model.undoStack.length, history + 1);
  assert.deepEqual(model.selectedClips.map(clip => clip.id), [b, d]);
  model.undo();
  assert.deepEqual(ids(model), [a, b, c, d, e]);
  assert.deepEqual(model.selectedClips.map(clip => clip.id), [b, d]);
  model.redo();
  assert.deepEqual(ids(model), [a, b, d, c, e]);
  model.moveSelectionToEdge(true);
  assert.deepEqual(ids(model), [a, c, e, b, d]);
  validateProject(model.project);
});

test("batch duration and resize dragging update only selected clips with one undo each", async () => {
  const model = await sequence();
  const [a, b, c] = ids(model);
  model.resizeClip(c, 12);
  model.selectClip(a);
  model.selectClip(c, { toggle: true });
  model.resizeSelectedClips(8);
  assert.deepEqual(model.project.clips.map(clip => clip.durationFrames), [8, 24, 8, 24, 24]);
  model.undo();
  assert.deepEqual(model.project.clips.map(clip => clip.durationFrames), [24, 24, 12, 24, 24]);
  const before = model.snapshot();
  const history = model.undoStack.length;
  model.previewResizeSelection(a, 30, before);
  model.previewResizeSelection(a, 36, before);
  assert.deepEqual(model.project.clips.map(clip => clip.durationFrames), [36, 24, 24, 24, 24]);
  model.commitClipResize(before);
  assert.equal(model.undoStack.length, history + 1);
  model.undo();
  assert.deepEqual(model.project.clips.map(clip => clip.durationFrames), [24, 24, 12, 24, 24]);
  model.previewResizeSelection(a, 1, model.snapshot());
  assert.deepEqual(model.project.clips.map(clip => clip.durationFrames), [13, 24, 1, 24, 24], "a shorter selected clip never becomes zero frames");
  assert.equal(model.project.clips.find(clip => clip.id === b).durationFrames, 24);
  validateProject(model.project);
});

test("batch delete and duplicate preserve clip IDs, selection, and a single undo step", async () => {
  const model = await sequence();
  const original = ids(model);
  model.selectClip(original[1]);
  model.selectClip(original[3], { toggle: true });
  const history = model.undoStack.length;
  model.deleteSelected();
  assert.deepEqual(ids(model), [original[0], original[2], original[4]]);
  assert.equal(model.undoStack.length, history + 1);
  model.undo();
  assert.deepEqual(ids(model), original);
  assert.deepEqual(model.selectedClips.map(clip => clip.id), [original[1], original[3]]);
  model.duplicateSelected();
  assert.equal(model.selectedClips.length, 2);
  assert.deepEqual(model.selectedClips.map(clip => clip.imageId), [model.project.images[1].id, model.project.images[3].id]);
  assert.equal(new Set(ids(model)).size, 7);
  model.undo();
  assert.deepEqual(ids(model), original);
  assert.equal(model.selectedClips.length, 2);
});

test("deleting before/after a clicked clip ignores multi-selection and is one undoable edit", async () => {
  for (const side of ["before", "after"]) {
    const model = await sequence();
    const original = ids(model);
    const images = structuredClone(model.project.images);
    model.selectClip(original[1]);
    model.selectClip(original[2], { toggle: true });
    model.selectClip(original[4], { toggle: true });
    model.focusClip(original[2]);
    model.markSaved();
    const history = model.undoStack.length;
    let notifications = 0;
    model.subscribe(() => notifications++);
    assert.equal(model.deleteClipsRelativeTo(original[2], side), true);
    const expected = side === "before" ? original.slice(2) : original.slice(0, 3);
    assert.deepEqual(ids(model), expected);
    assert.deepEqual(model.project.images, images, "all import assets survive");
    assert.deepEqual([...model.selectedClipIds], [original[2]], "keep and select the clicked clip");
    assert.equal(model.totalFrames, 72);
    assert.equal(model.undoStack.length, history + 1);
    assert.equal(notifications, 1);
    assert.equal(model.dirty, true);
    validateProject(model.project);
    model.undo();
    assert.deepEqual(ids(model), original);
    assert.deepEqual(model.selectedClips.map(clip => clip.id), [original[1], original[2], original[4]]);
    assert.equal(model.selectedClipId, original[2]);
    assert.equal(model.dirty, false);
    model.redo();
    assert.deepEqual(ids(model), expected);
    assert.deepEqual(model.project.images, images);
    assert.equal(model.selectedClipId, original[2]);
    validateProject(model.project);
  }
});

test("deleting leading clips rebases the playhead and loop using whole frame durations", async () => {
  const model = await sequence();
  const original = ids(model);
  [4, 8, 12, 16, 20].forEach((duration, index) => model.resizeClip(original[index], duration));
  model.setLoopRange(20, 55);
  model.setFrame(40);
  const previewId = model.previewImage.id;
  model.deleteClipsRelativeTo(original[2], "before");
  assert.deepEqual(model.project.clips.map(clip => clip.durationFrames), [12, 16, 20]);
  assert.equal(model.totalFrames, 48);
  assert.equal(model.project.currentFrame, 28);
  assert.equal(model.previewImage.id, previewId, "surviving playhead content stays visible");
  assert.equal(model.project.loopStartFrame, 8);
  assert.equal(model.project.loopEndFrame, 43);
  model.undo();
  assert.equal(model.project.loopStartFrame, 20);
  assert.equal(model.project.loopEndFrame, 55);
  model.setFrame(50);
  model.deleteClipsRelativeTo(original[2], "after");
  assert.equal(model.totalFrames, 24);
  assert.equal(model.project.currentFrame, 23);
  assert.equal(model.project.loopStartFrame, 20);
  assert.equal(model.project.loopEndFrame, 24);
  validateProject(model.project);
});

test("boundary deletion preserves the clicked clip and clamps fully removed loop ranges", async () => {
  const model = await sequence();
  const original = ids(model);
  model.setLoopRange(12, 36);
  model.setFrame(10);
  model.deleteClipsRelativeTo(original.at(-1), "before");
  assert.deepEqual(ids(model), [original.at(-1)]);
  assert.equal(model.project.currentFrame, 0);
  assert.equal(model.project.loopStartFrame, 0);
  assert.equal(model.project.loopEndFrame, 1);
  validateProject(model.project);
  model.undo();
  model.setLoopRange(100, 119);
  model.deleteClipsRelativeTo(original[0], "after");
  assert.deepEqual(ids(model), [original[0]]);
  assert.equal(model.project.loopStartFrame, 23);
  assert.equal(model.project.loopEndFrame, 24);
  validateProject(model.project);
  model.undo();
  model.project.loopEndFrame = null;
  model.deleteClipsRelativeTo(original[1], "before");
  assert.equal(model.project.loopEndFrame, null, "automatic End still follows the timeline");
  validateProject(model.project);
});

test("deleting on an empty side or with invalid input leaves history and selection unchanged", async () => {
  const model = await sequence();
  const original = ids(model);
  const before = model.snapshot();
  const history = model.undoStack.length;
  model.markSaved();
  for (const [clipId, side] of [[original[0], "before"], [original.at(-1), "after"], ["missing", "before"], [original[2], "invalid"]]) {
    assert.equal(model.deleteClipsRelativeTo(clipId, side), false);
    assert.deepEqual(model.snapshot(), before);
    assert.equal(model.undoStack.length, history);
    assert.equal(model.dirty, false);
  }
  const empty = new TimelineViewModel();
  assert.equal(empty.deleteClipsRelativeTo("missing", "after"), false);
  assert.equal(empty.canUndo, false);
});

test("Cut/Paste works for a group, remains undoable, and can paste into a new project", async () => {
  const model = await sequence();
  const original = ids(model);
  model.selectClip(original[1]);
  model.selectClip(original[3], { toggle: true });
  model.cutSelected();
  assert.equal(model.project.clips.length, 3);
  model.undo();
  assert.deepEqual(ids(model), original);
  model.redo();
  model.pasteClips(24);
  assert.equal(model.project.clips.length, 5);
  assert.deepEqual(model.project.clips.map(clip => model.project.images.find(image => image.id === clip.imageId).name), ["a.png", "b.png", "d.png", "c.png", "e.png"]);
  assert.equal(model.selectedClips.length, 2);
  assert.equal(model.project.images.length, 5, "pasting unchanged sources reuses them");
  model.undo();
  assert.equal(model.project.clips.length, 3);
  model.replaceProject(createProject());
  model.pasteClips();
  assert.equal(model.project.images.length, 2);
  assert.equal(model.project.clips.length, 2);
  assert.equal(model.totalFrames, 48);
  validateProject(model.project);
});

test("Paste inside a clip splits it at the playhead and preserves copied edit data", async () => {
  const model = await sequence();
  const image = model.project.images[1];
  model.setImageCrop(image.id, { left: 0.1, top: 0, right: 0.9, bottom: 1 });
  model.selectClip(model.project.clips[1].id);
  model.copySelected();
  model.setImageCrop(image.id, null);
  model.pasteClips(10);
  assert.deepEqual(model.project.clips.slice(0, 3).map(clip => clip.durationFrames), [10, 24, 14]);
  const pasted = model.project.images.find(item => item.id === model.selectedClips[0].imageId);
  assert.notEqual(pasted.id, image.id);
  assert.equal(pasted.crop.left, 0.1);
  assert.equal(model.totalFrames, 144);
  validateProject(model.project);
});

test("exports trim clips exactly to Start–End and preserve selected order and image effects", async () => {
  const model = await sequence();
  model.project.images[1].crop = { left: 0.1, top: 0, right: 0.8, bottom: 1 };
  model.setLoopRange(12, 60);
  const range = exportClipData(model.project, "range");
  assert.deepEqual(range.map(clip => clip.duration_frames), [12, 24, 12]);
  assert.equal(range.reduce((sum, clip) => sum + clip.duration_frames, 0), 48);
  assert.deepEqual(range[1].crop, model.project.images[1].crop);
  assert.equal(exportClipData(model.project).reduce((sum, clip) => sum + clip.duration_frames, 0), 120);
  const selected = exportClipData(model.project, "selected", [model.project.clips[3].id, model.project.clips[1].id]);
  assert.deepEqual(selected.map(clip => clip.path), ["b.png", "d.png"]);
  assert.equal(exportClipData(model.project, "selected").length, 0);
  model.setLoopRange(24, 25);
  assert.deepEqual(exportClipData(model.project, "range").map(clip => clip.duration_frames), [1]);
  assert.deepEqual(exportClipData(createProject(), "range"), []);
});
