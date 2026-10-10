import test from 'node:test';
import assert from 'node:assert/strict';
import {imageRenamePlan} from '../src/renderer/model/image-names.mjs';
import {TimelineViewModel} from '../src/renderer/viewmodel/timeline-view-model.mjs';
import {validateProject} from '../src/renderer/model/project-model.mjs';

const images = ['cat10.png','cat2.png','cat1.jpg'].map((name,index)=>({id:String(index),name,path:`/original/${name}`,width:20,height:10}));
const options = changes=>({scope:'all',mode:'sequence',order:'import',letterCase:'keep',baseName:'ImageName',
  separator:'',suffix:'',pattern:'{name}_{number}{ext}',start:1,step:1,padding:'000',preserveExtension:false,makeUnique:true,...changes});
const names = plan=>plan.map(item=>item.name);

test('number formats, start, increment, separators and suffixes support the requested sequences',()=>{
  for (const padding of ['0','00','000']) assert.deepEqual(names(imageRenamePlan(images,options({padding}))),
    [1,2,3].map(number=>'ImageName'+String(number).padStart(padding.length,'0')));
  assert.deepEqual(names(imageRenamePlan(images,options({start:9,step:2,padding:'00',separator:'_',suffix:'_run',preserveExtension:true}))),
    ['ImageName_09_run.png','ImageName_11_run.png','ImageName_13_run.jpg']);
  assert.deepEqual(names(imageRenamePlan(images,options({start:99,padding:'00'}))),['ImageName99','ImageName100','ImageName101']);
  assert.equal(imageRenamePlan(images,options({start:0}))[0].name,'ImageName000');
});

test('custom pattern tokens, extensions, Unicode and case transformations are supported',()=>{
  assert.deepEqual(names(imageRenamePlan(images,options({mode:'pattern',pattern:'{name}_Run-{number}-{index}{ext}',letterCase:'upper'}))),
    ['CAT10_RUN-001-1.PNG','CAT2_RUN-002-2.PNG','CAT1_RUN-003-3.JPG']);
  const named=[{...images[0],name:'Image 001'}];
  assert.deepEqual(names(imageRenamePlan(named,options({mode:'pattern',pattern:'{name}_{number}{ext}'}))),['Image 001_001.png']);
  assert.equal(imageRenamePlan(images,options({baseName:'角色',separator:'-'}))[0].name,'角色-001');
});

test('scope and numbering order do not reorder images or number unselected entries',()=>{
  assert.deepEqual(imageRenamePlan(images,options({scope:'selected'}),['2','0']).map(item=>[item.id,item.name]),[['0','ImageName001'],['2','ImageName002']]);
  assert.deepEqual(imageRenamePlan(images,options({order:'reverse'})).map(item=>item.id),['2','1','0']);
  assert.deepEqual(imageRenamePlan(images,options({order:'name'})).map(item=>item.id),['2','1','0']);
  assert.deepEqual(images.map(image=>image.id),['0','1','2']);
});

test('duplicate handling protects unselected names and respects case and Unicode normalization',()=>{
  const items=[{...images[0],name:'Frame001.png'},images[1],images[2]];
  assert.equal(imageRenamePlan(items,options({scope:'selected',baseName:'frame',preserveExtension:true}),['1'])[0].name,'frame001 (2).png');
  assert.throws(()=>imageRenamePlan(items,options({scope:'selected',baseName:'frame',preserveExtension:true,makeUnique:false}),['1']),/already used/);
  assert.deepEqual(names(imageRenamePlan(images,options({mode:'pattern',pattern:'Same'}))),['Same','Same (2)','Same (3)']);
  const accents=[{...images[0],name:'é001'},images[1]];
  assert.equal(imageRenamePlan(accents,options({scope:'selected',baseName:'e\u0301'}),['1'])[0].name,'e\u0301001 (2)');
});

test('invalid names, tokens and unsafe numbers fail before editing',()=>{
  for (const change of [{padding:''},{padding:'001'},{padding:'0'.repeat(13)},{step:0},{step:1.5},{start:-1},
    {start:Number.MAX_SAFE_INTEGER},{mode:'pattern',pattern:'{unknown}'},{baseName:'../bad'},
    {mode:'pattern',pattern:'NUL.png'},{suffix:'.'},{suffix:' '},{baseName:'a'.repeat(256)}])
    assert.throws(()=>imageRenamePlan(images,options(change)));
  assert.throws(()=>imageRenamePlan(images,options({scope:'selected'}),[]),/Select at least/);
});

test('batch rename is one undo step and preserves asset paths, effects, clips, selection and project validation',()=>{
  const vm=new TimelineViewModel();vm.project.images=structuredClone(images);
  vm.project.images[0].crop={left:.1,top:.1,right:.9,bottom:.9};
  vm.project.clips=images.map((image,index)=>({id:`clip${index}`,imageId:image.id,durationFrames:24}));
  vm.selectImage('0');vm.selectImage('2',{toggle:true});vm.markSaved();
  const before=structuredClone(vm.project);const history=vm.undoStack.length;
  assert.equal(vm.renameImages(options()),3);assert.equal(vm.undoStack.length,history+1);
  assert.equal(vm.dirty,true);assert.deepEqual(vm.project.clips,before.clips);
  assert.deepEqual(vm.project.images.map(image=>image.path),before.images.map(image=>image.path));
  assert.deepEqual(vm.project.images[0].crop,before.images[0].crop);
  assert.deepEqual([...vm.selectedImageIds],['0','2']);validateProject(vm.project);
  vm.undo();assert.deepEqual(vm.project.images,before.images);assert.equal(vm.dirty,false);
  vm.redo();assert.deepEqual(vm.project.images.map(image=>image.name),['ImageName001','ImageName002','ImageName003']);
  const renamed=structuredClone(vm.project);vm.replaceProject(renamed);
  assert.deepEqual(vm.project.images.map(image=>image.name),['ImageName001','ImageName002','ImageName003']);
  const unchanged=vm.undoStack.length;assert.equal(vm.renameImages(options()),0);assert.equal(vm.undoStack.length,unchanged);
  assert.throws(()=>vm.renameImages(options({suffix:'?'})));assert.equal(vm.undoStack.length,unchanged);
});
