import test from 'node:test';
import assert from 'node:assert/strict';
import { TimelineViewModel } from '../src/renderer/viewmodel/timeline-view-model.mjs';
import { createProject, validateProject } from '../src/renderer/model/project-model.mjs';

globalThis.window = {frameLine:{inspectImages:async paths => paths.map(path => ({path, name:path, width:100, height:80}))}};

async function sequence() {
  const model = new TimelineViewModel();
  await model.addImages(['a.png', 'b.png', 'c.png', 'd.png', 'e.png']);
  return model;
}
const names = model => model.project.images.map(image => image.name);
const stroke = {tool:'brush', color:'#123456', size:4, opacity:0.5, shape:'round', feather:0, antiAlias:true, points:[[0.5,0.5]]};

test('import-list Ctrl/Shift selection and right-click focus preserve the group without editing the project', async () => {
  const model = await sequence();
  const [a,b,c,d,e] = model.project.images.map(image => image.id);
  model.markSaved();
  const history = model.undoStack.length;
  model.selectImage(b);
  model.selectImage(d, {toggle:true});
  assert.deepEqual(model.selectedImages.map(image => image.id), [b,d]);
  model.focusImage(b);
  assert.deepEqual(model.selectedImages.map(image => image.id), [b,d]);
  assert.equal(model.previewImage.id, b);
  model.selectImage(d, {toggle:true});
  assert.deepEqual(model.selectedImages.map(image => image.id), [b]);
  model.selectImage(b);
  model.selectImage(e, {range:true});
  assert.deepEqual(model.selectedImages.map(image => image.id), [b,c,d,e]);
  model.selectImage(a, {range:true, additive:true});
  assert.equal(model.selectedImages.length, 5);
  model.selectImage(c);
  model.selectAllImages();
  assert.equal(model.selectedImages.length, 5);
  assert.equal(model.previewImage.id, c);
  assert.equal(model.undoStack.length, history);
  assert.equal(model.dirty, false);
});

test('image clipboard preserves applied edits, originals, and every linked clip with independent IDs and data', async () => {
  const model = await sequence();
  const [a,b,,d] = model.project.images;
  model.addPaintStroke(b.id, stroke);
  model.setImageCrop(b.id, {left:0.1, top:0.2, right:0.9, bottom:0.8});
  model.resizeClip(model.project.clips[1].id, 3);
  model.insertImage(b.id, model.totalFrames);
  model.resizeClip(model.project.clips.at(-1).id, 7);
  model.selectImage(b.id);
  model.selectImage(d.id, {toggle:true});
  model.copySelected();
  const clipClipboard = structuredClone(model.clipboard);
  const history = model.undoStack.length;
  const oldClips = model.project.clips.map(clip => clip.id);
  assert.equal(model.copyImages(), true);
  assert.equal(model.undoStack.length, history, 'copy is not an edit');
  const copied = structuredClone(model.imageClipboard);
  model.project.images[1].paintStrokes[0].color = '#ff0000';
  assert.equal(model.pasteImages(a.id), true);
  const [newB,newD] = model.selectedImages;
  assert.deepEqual(names(model), ['a.png','b.png','d.png','b.png','c.png','d.png','e.png']);
  assert.notEqual(newB.id, b.id);
  assert.notEqual(newD.id, d.id);
  assert.deepEqual({...newB, id:b.id}, copied.images[0]);
  assert.deepEqual(model.project.clips.filter(clip => clip.imageId === newB.id).map(clip => clip.durationFrames), [3,7]);
  assert.deepEqual(model.project.clips.filter(clip => clip.imageId === newD.id).map(clip => clip.durationFrames), [24]);
  assert.equal(new Set(model.project.clips.map(clip => clip.id)).size, 9);
  assert.deepEqual(model.project.clips.filter(clip => oldClips.includes(clip.id)).map(clip => clip.id), oldClips,
    'inserting assets leaves existing clip order and IDs intact');
  assert.deepEqual(model.clipboard, clipClipboard, 'the image clipboard is separate from clip copy/paste');
  assert.equal(model.undoStack.length, history + 1);
  validateProject(model.project);
  model.undo();
  assert.deepEqual(names(model), ['a.png','b.png','c.png','d.png','e.png']);
  assert.deepEqual(model.selectedImages.map(image => image.id), [b.id,d.id]);
  model.redo();
  assert.deepEqual(model.selectedImages.map(image => image.id), [newB.id,newD.id]);
  const saved = structuredClone(model.project);
  model.replaceProject(saved);
  validateProject(model.project);
  assert.deepEqual(model.project.images.find(image => image.id === newB.id).paintStrokes, [stroke]);
});

test('asset Cut/Delete removes every associated clip as one undoable action and Paste works in a new project', async () => {
  const model = await sequence();
  const [a,b,,d] = model.project.images;
  model.insertImage(b.id, model.totalFrames);
  model.selectImage(b.id);
  model.selectImage(d.id, {toggle:true});
  const history = model.undoStack.length;
  model.cutImages();
  assert.deepEqual(names(model), ['a.png','c.png','e.png']);
  assert.equal(model.project.clips.length, 3);
  assert(!model.project.clips.some(clip => [b.id,d.id].includes(clip.imageId)));
  assert.equal(model.undoStack.length, history + 1);
  assert.equal(model.selectedImageIds.size, 0);
  model.undo();
  assert.deepEqual(model.selectedImages.map(image => image.id), [b.id,d.id]);
  assert.equal(model.project.clips.length, 6);
  model.redo();
  model.pasteImages(a.id);
  assert.equal(model.project.images.length, 5);
  assert.equal(model.project.clips.length, 6);
  validateProject(model.project);
  model.replaceProject(createProject());
  model.pasteImages();
  assert.deepEqual(names(model), ['b.png','d.png']);
  assert.equal(model.project.clips.length, 3);
  assert.equal(model.totalFrames, 72);
  validateProject(model.project);
});

test('Duplicate clones assets without overwriting the clipboard, including assets with no timeline clip', async () => {
  const model = await sequence();
  model.selectImage(model.project.images[0].id);
  model.copyImages();
  const clipboard = structuredClone(model.imageClipboard);
  const orphan = model.project.images[2];
  model.selectClip(model.project.clips[2].id);
  model.deleteSelected();
  model.selectImage(orphan.id);
  const history = model.undoStack.length;
  model.duplicateImages();
  const duplicate = model.selectedImages[0];
  assert.notEqual(duplicate.id, orphan.id);
  assert.equal(model.project.images.indexOf(duplicate), 3);
  assert.equal(model.project.clips.find(clip => clip.imageId === duplicate.id).durationFrames, 24);
  assert.deepEqual(model.imageClipboard, clipboard);
  assert.equal(model.undoStack.length, history + 1);
  model.undo();
  assert(!model.project.images.some(image => image.id === duplicate.id));
  assert(model.project.images.some(image => image.id === orphan.id));
  validateProject(model.project);
});

test('moving an import-list group follows asset order with all its clips and empty actions are no-ops', async () => {
  const model = await sequence();
  model.selectImage(model.project.images[1].id);
  model.selectImage(model.project.images[3].id, {toggle:true});
  const history = model.undoStack.length;
  model.moveImagesToEdge(false);
  assert.deepEqual(names(model), ['b.png','d.png','a.png','c.png','e.png']);
  assert.deepEqual(model.project.clips.map(clip => model.project.images.find(image => image.id === clip.imageId).name), names(model));
  assert.equal(model.undoStack.length, history + 1);
  model.undo();
  model.moveImagesToEdge(true);
  assert.deepEqual(names(model), ['a.png','c.png','e.png','b.png','d.png']);
  model.undo();
  assert.deepEqual(names(model), ['a.png','b.png','c.png','d.png','e.png']);
  const empty = new TimelineViewModel();
  for (const action of ['copyImages','cutImages','pasteImages','duplicateImages','removeImages']) assert.equal(empty[action](), false);
  assert.equal(empty.undoStack.length, 0);
});
