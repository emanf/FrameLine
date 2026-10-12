import test from 'node:test';
import assert from 'node:assert/strict';
import {TimelineViewModel} from '../src/renderer/viewmodel/timeline-view-model.mjs';
import {createProject,validateProject} from '../src/renderer/model/project-model.mjs';

function sequence() {
  const vm = new TimelineViewModel();
  vm.replaceProject({...createProject(),images:[{id:'image',path:'/image.png',name:'Image',width:32,height:32}],
    clips:Array.from({length:5},(_,i)=>({id:`clip-${i}`,imageId:'image',durationFrames:i+1}))});
  return vm;
}
test('Reverse changes only selected slots and keeps IDs, durations, source assets and selection',()=>{
  const vm = sequence(), source = structuredClone(vm.project.images);
  vm.setSelection(['clip-0','clip-2','clip-4'],'clip-2');
  vm.reverseSelected();
  assert.deepEqual(vm.project.clips.map(clip=>[clip.id,clip.durationFrames]),[['clip-4',5],['clip-1',2],['clip-2',3],['clip-3',4],['clip-0',1]]);
  assert.equal(vm.totalFrames,15);
  assert.deepEqual(vm.project.images,source);
  assert.deepEqual([...vm.selectedClipIds],['clip-0','clip-2','clip-4']);
  assert.equal(vm.selectedClipId,'clip-2'); validateProject(vm.project);
  assert.equal(vm.undoStack.length,1);
  vm.undo(); assert.deepEqual(vm.project.clips.map(clip=>clip.id),['clip-0','clip-1','clip-2','clip-3','clip-4']);
  vm.redo(); assert.equal(vm.project.clips[0].id,'clip-4');
});
test('Reverse can reverse the whole animation and does not record empty/single selections',()=>{
  const vm = sequence();
  assert.equal(vm.reverseSelected(),false);
  vm.setSelection([]); assert.equal(vm.reverseSelected(),false);
  assert.equal(vm.undoStack.length,0);
  vm.selectAllClips(); assert.equal(vm.reverseSelected(),true);
  assert.deepEqual(vm.project.clips.map(clip=>clip.id),['clip-4','clip-3','clip-2','clip-1','clip-0']);
});
