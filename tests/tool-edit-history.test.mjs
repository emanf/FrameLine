import test from 'node:test';
import assert from 'node:assert/strict';
import {ToolEditHistory} from '../src/renderer/model/tool-edit-history.mjs';
import {TimelineViewModel} from '../src/renderer/viewmodel/timeline-view-model.mjs';

test('pending tool gestures undo and redo in order around project settings', () => {
  const vm = new TimelineViewModel(), history = new ToolEditHistory();
  const empty = {strokes:[]}, first = {strokes:['first']}, second = {strokes:['first','second']};
  const initial = vm.historyStateId;
  history.record(empty,first,initial);
  vm.setFps(12);
  const settings = vm.historyStateId;
  history.record(first,second,settings);
  assert.deepEqual(history.undo(settings),first);
  assert.equal(history.canUndo(settings),false);
  vm.undo();
  assert.equal(vm.historyStateId,initial);
  assert.deepEqual(history.undo(vm.historyStateId),empty);
  assert.deepEqual(history.redo(vm.historyStateId),first);
  assert.equal(history.canRedo(vm.historyStateId),false);
  vm.redo();
  assert.equal(vm.historyStateId,settings);
  assert.deepEqual(history.redo(vm.historyStateId),second);
});

test('new gestures replace the redo branch, no-op gestures leave history intact', () => {
  const history = new ToolEditHistory(2);
  history.record({n:0},{n:1},0);
  history.record({n:1},{n:2},0);
  history.undo(0);
  assert.equal(history.record({n:1},{n:1},0),false);
  assert.equal(history.canRedo(0),true);
  history.record({n:1},{n:3},0);
  assert.equal(history.canRedo(0),false);
  assert.deepEqual(history.undo(0),{n:1});
  assert.deepEqual(history.undo(0),{n:0});
});

test('project history state IDs survive repeated undo and redo and never leak into saved projects', () => {
  const vm = new TimelineViewModel();
  vm.setFps(12);
  const state = vm.historyStateId;
  for(let i=0;i<3;i++) { vm.undo(); vm.redo(); assert.equal(vm.historyStateId,state); }
  vm.undo(); vm.setFps(18);
  assert.notEqual(vm.historyStateId,state);
  assert.equal('historyStateId' in vm.project,false);
});

test('Apply can retain a separate undo step per completed paint stroke with a single render notification', () => {
  const vm = new TimelineViewModel();
  vm.addImageDetails([{path:'C:/test.png',name:'test',width:24,height:24}],[24]);
  const imageId = vm.project.images[0].id;
  const stroke = {tool:'brush',color:'#ff0000',size:3,opacity:.5,shape:'round',feather:0,antiAlias:true,points:[[.2,.2],[.6,.6]]};
  let renders = 0;
  vm.subscribe(() => renders++);
  vm.addPaintStrokes(imageId, [stroke,{...stroke,color:'#0000ff'}],{separateUndoSteps:true});
  assert.equal(renders,1);
  assert.equal(vm.project.images[0].paintStrokes.length,2);
  vm.undo(); assert.equal(vm.project.images[0].paintStrokes.length,1);
  vm.undo(); assert.equal(vm.project.images[0].paintStrokes,undefined);
  vm.redo(); assert.equal(vm.project.images[0].paintStrokes.length,1);
  vm.redo(); assert.equal(vm.project.images[0].paintStrokes.length,2);
});
