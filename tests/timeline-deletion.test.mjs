import test from 'node:test';
import assert from 'node:assert/strict';
import { TimelineViewModel } from '../src/renderer/viewmodel/timeline-view-model.mjs';
import { createProject, loopRange, validateProject } from '../src/renderer/model/project-model.mjs';

function sequence() {
  const model = new TimelineViewModel();
  const images = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id, path: `${id}.png`, name: id, width: 100, height: 80 }));
  model.replaceProject({ ...createProject(), images,
    clips: [4, 8, 12, 16, 20].map((durationFrames, i) => ({ id: images[i].id, imageId: images[i].id, durationFrames })) });
  return model;
}

test('timeline Delete and Cut rebase each loop boundary by removed duration before it', () => {
  for (const command of ['deleteSelected', 'cutSelected']) {
    for (const [removed, expected, playhead] of [
      [['a'], [16, 51], 46],
      [['b', 'd'], [12, 31], 26],
      [['c'], [12, 43], 38],
      [['d'], [20, 39], 34],
      [['e'], [20, 40], 39],
      [['a', 'b'], [8, 43], 38]
    ]) {
      const model = sequence();
      model.setLoopRange(20, 55);
      model.setSelection(removed);
      model.setFrame(50);
      model.markSaved();
      const history = model.undoStack.length;
      let notifications = 0;
      model.subscribe(() => notifications++);
      assert.equal(model[command](), true);
      assert.deepEqual(loopRange(model.project), { startFrame: expected[0], endFrame: expected[1] }, `${command}: ${removed}`);
      assert.equal(model.project.currentFrame, playhead);
      if (!removed.includes('e')) assert.equal(model.previewImage.id, 'e', 'playhead keeps the surviving content');
      assert.equal(model.project.images.length, 5, 'timeline deletion retains imported assets');
      assert.equal(model.undoStack.length, history + 1);
      assert.equal(notifications, 1);
      validateProject(model.project);
      model.undo();
      assert.deepEqual(loopRange(model.project), { startFrame: 20, endFrame: 55 });
      assert.deepEqual(model.project.clips.map(clip => clip.id), ['a', 'b', 'c', 'd', 'e']);
      assert.deepEqual([...model.selectedClipIds], removed);
      assert.equal(model.dirty, false);
      model.redo();
      assert.deepEqual(loopRange(model.project), { startFrame: expected[0], endFrame: expected[1] });
      validateProject(model.project);
    }
  }
});

test('deletion after the loop leaves its boundaries and surviving playhead unchanged', () => {
  const model = sequence();
  model.setLoopRange(4, 12);
  model.setFrame(8);
  model.setSelection(['d', 'e']);
  model.deleteSelected();
  assert.deepEqual(loopRange(model.project), { startFrame: 4, endFrame: 12 });
  assert.equal(model.project.currentFrame, 8);
  validateProject(model.project);
});

test('removed loop endpoints collapse to a valid range and automatic End stays automatic', () => {
  const model = sequence();
  model.setLoopRange(6, 10);
  model.selectClip('b');
  model.setFrame(8);
  model.deleteSelected();
  assert.deepEqual(loopRange(model.project), { startFrame: 4, endFrame: 5 });
  assert.equal(model.project.currentFrame, 4);
  validateProject(model.project);
  model.undo();
  model.setLoopRange(20, 60);
  model.setSelection(['a', 'd']);
  model.deleteSelected();
  assert.equal(model.project.loopStartFrame, 16);
  assert.equal(model.project.loopEndFrame, null);
  assert.equal(loopRange(model.project).endFrame, 40);
  model.selectAllClips();
  model.deleteSelected();
  assert.deepEqual(loopRange(model.project), { startFrame: 0, endFrame: 0 });
  assert.equal(model.project.loopEndFrame, null);
  assert.equal(model.project.currentFrame, 0);
  validateProject(model.project);
  model.undo();
  assert.deepEqual(loopRange(model.project), { startFrame: 16, endFrame: 40 });
});

test('Import Delete and Cut rebase every clip referencing the removed images', () => {
  for (const command of ['removeImages', 'cutImages']) {
    const model = sequence();
    model.project.clips.push({ id: 'b-copy', imageId: 'b', durationFrames: 5 });
    model.notify();
    model.setLoopRange(20, 63);
    model.setFrame(50);
    const history = model.undoStack.length;
    model[command](['b', 'd']);
    assert.deepEqual(model.project.clips.map(clip => clip.id), ['a', 'c', 'e']);
    assert.deepEqual(loopRange(model.project), { startFrame: 12, endFrame: 36 });
    assert.equal(model.project.currentFrame, 26);
    assert.equal(model.previewImage.id, 'e');
    assert.equal(model.undoStack.length, history + 1);
    validateProject(model.project);
    model.undo();
    assert.deepEqual(loopRange(model.project), { startFrame: 20, endFrame: 63 });
    assert.equal(model.project.clips.at(-1).id, 'b-copy');
    model.redo();
    assert.deepEqual(loopRange(model.project), { startFrame: 12, endFrame: 36 });
    validateProject(model.project);
  }
});

test('deleting an unreferenced imported image leaves loop markers unchanged', () => {
  const model = sequence();
  model.selectClip('a');
  model.deleteSelected();
  model.setLoopRange(10, 30);
  model.setFrame(25);
  model.removeImage('a');
  assert.deepEqual(loopRange(model.project), { startFrame: 10, endFrame: 30 });
  assert.equal(model.project.currentFrame, 25);
  assert.equal(model.removeImages(['missing']), false);
  validateProject(model.project);
});
