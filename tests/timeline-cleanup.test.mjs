import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,validateProject} from '../src/renderer/model/project-model.mjs';
import {timelineCleanupPlan,parseFrameList} from '../src/renderer/model/timeline-cleanup.mjs';
import {TimelineViewModel} from '../src/renderer/viewmodel/timeline-view-model.mjs';
import {TimelineCleanupViewModel} from '../src/renderer/viewmodel/timeline-cleanup-view-model.mjs';
import {mergeIntervals,intersectIntervals,subtractIntervals} from '../src/renderer/model/frame-intervals.mjs';

function project(count = 21, duration = 1) {
  return {...createProject(),images:Array.from({length:count},(_,i)=>({id:`image-${i}`,path:`/image-${i}.png`,name:`Image ${i+1}`,width:32,height:32})),
    clips:Array.from({length:count},(_,i)=>({id:`clip-${i}`,imageId:`image-${i}`,durationFrames:Array.isArray(duration) ? duration[i] : duration}))};
}
const numbers = plan => plan.kept.flatMap(([a,b])=>Array.from({length:b-a},(_,i)=>a+i+1));

test('every fifth clip keeps 1, 6, 11, 16, 21 without mutating the source',()=>{
  const source = project(), before = structuredClone(source);
  const plan = timelineCleanupPlan(source);
  assert.deepEqual(numbers(plan),[1,6,11,16,21]);
  assert.equal(plan.removedUnits,16);
  assert.deepEqual(source,before);
});

test('odd/even, remove inversion, offsets and repeating groups have one-based positions',()=>{
  assert.deepEqual(numbers(timelineCleanupPlan(project(8),{action:'remove',mode:'odd'})),[2,4,6,8]);
  assert.deepEqual(numbers(timelineCleanupPlan(project(8),{mode:'even'})),[2,4,6,8]);
  assert.deepEqual(numbers(timelineCleanupPlan(project(8),{every:3,offset:2})),[2,5,8]);
  assert.deepEqual(numbers(timelineCleanupPlan(project(10),{mode:'groups',keep:2,skip:3})),[1,2,6,7]);
  assert.equal(timelineCleanupPlan(project(10),{every:1}).changed,false);
});

test('custom lists merge duplicates and support inclusive and stepped ranges',()=>{
  assert.deepEqual(parseFrameList('1, 3-6, 4; 8-12:2',12),[[0,1],[2,6],[7,8],[9,10],[11,12]]);
  assert.deepEqual(numbers(timelineCleanupPlan(project(12),{mode:'custom',custom:'1, 3-6, 8-12:2'})),[1,3,4,5,6,8,10,12]);
  for (const text of ['0','2-1','13','1-4:0','1.5','1-two']) assert.throws(()=>parseFrameList(text,12));
});

test('target counts and percentages sample evenly across sparse selected clips',()=>{
  const source = project(10), selected = [0,2,5,7,9].map(i=>`clip-${i}`);
  assert.deepEqual(numbers(timelineCleanupPlan(source,{scope:'selected',mode:'count',count:3},selected)),[1,2,4,5,6,7,9,10]);
  assert.deepEqual(numbers(timelineCleanupPlan(project(11),{mode:'count',count:4})),[1,4,8,11]);
  assert.deepEqual(numbers(timelineCleanupPlan(project(10),{mode:'percent',percent:30})),[1,6,10]);
  assert.throws(()=>timelineCleanupPlan(source,{mode:'count',count:11}),/cannot exceed/);
});

test('range and selection scopes retain all outside positions and support relative numbering',()=>{
  const source = project(10);
  assert.deepEqual(numbers(timelineCleanupPlan(source,{scope:'custom',from:3,to:8,every:3})),[1,2,4,7,9,10]);
  assert.deepEqual(numbers(timelineCleanupPlan(source,{scope:'custom',from:3,to:8,every:3,numbering:'scope'})),[1,2,3,6,9,10]);
  const selected = ['clip-2','clip-5','clip-8'];
  assert.deepEqual(numbers(timelineCleanupPlan(source,{scope:'selected',every:2,numbering:'scope'},selected)),[1,2,3,4,5,7,8,9,10]);
  source.loopStartFrame = 2; source.loopEndFrame = 8;
  assert.deepEqual(numbers(timelineCleanupPlan(source,{scope:'range',every:3})),[1,2,4,7,9,10]);
});

test('manual keep/remove exceptions override patterns, with explicit removal taking priority',()=>{
  assert.deepEqual(numbers(timelineCleanupPlan(project(10),{every:5,keepFirst:true,keepLast:true,include:'3-4',exclude:'1, 4'})),[3,6,10]);
  assert.deepEqual(numbers(timelineCleanupPlan(project(10),{scope:'custom',from:3,to:8,every:3,exclude:'1, 4'})),[1,2,7,9,10]);
});

test('clip sampling preserves held durations; frame sampling trims holds in whole frames',()=>{
  const source = project(3,[5,2,4]);
  const clips = timelineCleanupPlan(source,{every:2});
  assert.deepEqual(clips.clips.map(clip=>clip.durationFrames),[5,4]);
  const frames = timelineCleanupPlan(source,{unit:'frames',every:3});
  assert.deepEqual(numbers(frames),[1,4,7,10]);
  assert.deepEqual(frames.clips.map(clip=>clip.durationFrames),[2,1,1]);
  source.loopStartFrame = 2; source.loopEndFrame = 7;
  const scoped = timelineCleanupPlan(source,{unit:'frames',scope:'range',mode:'even',action:'remove'});
  assert.deepEqual(numbers(scoped),[1,2,3,5,7,8,9,10,11]);
});

test('holding retained images preserves total timing and fills leading/trailing removed frames',()=>{
  const source = project(3,[5,2,4]);
  const plan = timelineCleanupPlan(source,{every:2,offset:2,timing:'hold'});
  assert.deepEqual(plan.clips.map(clip=>[clip.id,clip.durationFrames]),[['clip-1',11]]);
  assert.equal(plan.frames,11);
  const sameClip = timelineCleanupPlan(project(1,100),{unit:'frames',every:5,timing:'hold'});
  assert.equal(sameClip.changed,false,'sampling a single held image with preserved timing has no visible effect');
});

test('invalid or empty results never become an applicable edit',()=>{
  for (const options of [{every:0},{offset:0},{scope:'selected'},{scope:'custom',from:5,to:2},
    {mode:'custom',custom:''},{mode:'percent',percent:NaN},{action:'remove',every:1},{unit:'seconds'}]) {
    assert.throws(()=>timelineCleanupPlan(project(10),options));
  }
  assert.throws(()=>timelineCleanupPlan(project(0)),/Add clips/);
});

test('cleanup commits one history step, rebases playhead/loop, preserves assets and restores with Undo/Redo',()=>{
  const vm = new TimelineViewModel(); vm.replaceProject(project(10,2));
  vm.project.currentFrame = 12; vm.project.loopStartFrame = 4; vm.project.loopEndFrame = 14;
  vm.setSelection(['clip-1','clip-4','clip-8'],'clip-1');
  const originals = structuredClone(vm.project.images);
  vm.cleanupTimeline({every:3});
  assert.equal(vm.undoStack.length,1);
  assert.equal(vm.project.currentFrame,4);
  assert.equal(vm.project.loopStartFrame,2);
  assert.equal(vm.project.loopEndFrame,6);
  assert.deepEqual(vm.project.images,originals);
  validateProject(vm.project);
  vm.undo(); assert.equal(vm.project.clips.length,10); assert.equal(vm.project.loopStartFrame,4); assert.equal(vm.project.loopEndFrame,14);
  vm.redo(); assert.equal(vm.project.clips.length,4); validateProject(vm.project);
});

test('stale previews are rejected and no-op patterns do not add history',()=>{
  const vm = new TimelineViewModel(); vm.replaceProject(project(10));
  assert.equal(vm.cleanupTimeline({every:1}),false); assert.equal(vm.undoStack.length,0);
  const revision = vm.editRevision;
  vm.resizeClip('clip-0',2);
  assert.throws(()=>vm.cleanupTimeline({every:5},[],revision),/timeline changed/);
  assert.equal(vm.project.clips.length,10);
});

test('prepared plans preserve surviving multi-selection and reject mismatched options',()=>{
  const vm = new TimelineViewModel(); vm.replaceProject(project(10));
  vm.setSelection(['clip-1','clip-3','clip-6'],'clip-1');
  const options = {every:3}, plan = timelineCleanupPlan(vm.project,options);
  assert.throws(()=>vm.cleanupTimeline({every:2},[],vm.editRevision,plan),/preview settings changed/);
  assert.equal(vm.undoStack.length,0);
  vm.cleanupTimeline(options,[],vm.editRevision,plan);
  assert.deepEqual([...vm.selectedClipIds],['clip-3','clip-6']);
  assert.equal(vm.selectedClipId,'clip-3');
  assert.equal(vm.undoStack.length,1);
});

test('preview pages stay bounded even for a billion-frame held image',()=>{
  const source = project(1,1_000_000_000);
  const preview = new TimelineCleanupViewModel(source,[]);
  preview.update({unit:'frames',every:1});
  assert.deepEqual(preview.plan.kept,[[0,1_000_000_000]]);
  assert.equal(preview.previewItems().length,48);
  preview.page = preview.pages-1;
  assert.equal(preview.previewItems().at(-1).number,1_000_000_000);
});

test('interval operations agree with individual positions for overlapping masks',()=>{
  const source = mergeIntervals([[0,5],[4,8],[10,15]]), removed = mergeIntervals([[2,6],[12,20]]);
  assert.deepEqual(intersectIntervals(source,removed),[[2,6],[12,15]]);
  assert.deepEqual(subtractIntervals(source,removed),[[0,2],[6,8],[10,12]]);
});
