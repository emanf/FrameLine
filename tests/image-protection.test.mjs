import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {brushMask} from '../src/renderer/model/brush-mask.mjs';
import {protectionMask,recoverPixels} from '../src/renderer/model/protection-mask.mjs';
import {workingIgnoreStrokes,protectedCrop} from '../src/renderer/model/image-protection.mjs';
import {rebaseImageEdits} from '../src/renderer/model/image-effects.mjs';
import {createProject,validateProject} from '../src/renderer/model/project-model.mjs';
import {TimelineViewModel} from '../src/renderer/viewmodel/timeline-view-model.mjs';

const mark={tool:'brush',color:'#ffffff',opacity:1,size:4,shape:'square',antiAlias:false,feather:0,points:[[.5,.5]]};
const image=()=>({id:'image',name:'Image',path:'source.png',width:20,height:20});
const project=()=>({...createProject(),images:[image()],clips:[{id:'clip',imageId:'image',durationFrames:1}]});

test('Ignore gestures, enabled state and Clear are independently undoable and portable',() => {
  const vm=new TimelineViewModel({});vm.project=project();
  vm.addIgnoreStroke('image',mark);vm.addIgnoreStroke('image',{...mark,points:[[.2,.2]]});
  assert.equal(vm.project.images[0].ignoreStrokes.length,2);
  vm.undo();assert.equal(vm.project.images[0].ignoreStrokes.length,1);
  vm.redo();assert.equal(vm.project.images[0].ignoreStrokes.length,2);
  vm.setIgnoreState('image',false);assert.equal(workingIgnoreStrokes(vm.project.images[0]),undefined);
  vm.undo();assert.equal(workingIgnoreStrokes(vm.project.images[0]).length,2);
  assert.doesNotThrow(()=>validateProject(JSON.parse(JSON.stringify(vm.project))));
  vm.clearImageEffects('image');assert.equal(vm.project.images[0].ignoreStrokes,undefined);
  vm.undo();assert.equal(vm.project.images[0].ignoreStrokes.length,2);
  const before=vm.undoStack.length;
  assert.throws(()=>vm.addIgnoreStroke('image',{...mark,ignoreStrokes:[mark]}),/Ignore/);
  assert.equal(vm.undoStack.length,before);
});

test('protection and original alignment follow asymmetric padding and materialized crop',() => {
  const edited={...image(),ignoreStrokes:[structuredClone(mark)],crop:{left:.25,top:.1,right:1,bottom:1}};
  const transformed=workingIgnoreStrokes(edited)[0].points[0];
  assert.deepEqual(transformed,[(10-5)/15,(10-2)/18]);
  const vm=new TimelineViewModel({});vm.project={...project(),images:[edited]};
  vm.setWorkingImageResults([{imageId:'image',path:'crop.png',width:15,height:18}]);
  assert.deepEqual(vm.project.images[0].originalOffset,{x:-5,y:-2});
  rebaseImageEdits(vm.project.images[0],24,25,{x:7,y:3});
  assert.deepEqual(vm.project.images[0].originalOffset,{x:2,y:1});
  assert.deepEqual(vm.project.images[0].ignoreStrokes[0].points[0],[12/24,11/25]);
  vm.undo();assert.deepEqual(vm.project.images[0].crop,{left:.25,top:.1,right:1,bottom:1});
});

test('crop retains protected footprints and disabled protection allows the requested crop',() => {
  const source={...image(),ignoreStrokes:[{...mark,points:[[.1,.1]]}]};
  const crop={left:.5,top:.5,right:1,bottom:1};
  assert.deepEqual(protectedCrop(source,crop),{left:0,top:0,right:1,bottom:1});
  assert.deepEqual(protectedCrop({...source,ignoreEnabled:false},crop),crop);
});

test('regional protection matches full masks and JavaScript/Pillow masked strokes agree',() => {
  for(const antiAlias of [false,true]) for(const shape of ['square','round']) {
    const marks=[{...mark,antiAlias,shape,points:[[.51,.48],[.7,.3]]}];
    const mask=protectionMask(marks,20,20),regional=protectionMask(marks,20,20,{left:7,top:4,right:16,bottom:15});
    for(let y=0;y<regional.height;y++) for(let x=0;x<regional.width;x++) assert.equal(regional.data[y*regional.width+x],mask.data[(y+4)*20+x+7]);
    const stroke={...mark,size:15,shape,antiAlias,ignoreStrokes:marks};
    const raster=brushMask(stroke,20,20),full=new Uint8Array(400);
    for(let y=0;y<raster.height;y++) full.set(raster.data.subarray(y*raster.width,(y+1)*raster.width),(y+raster.top)*20+raster.left);
    const result=spawnSync('python',['-c',"import sys,json;sys.path.insert(0,'backend');from brush_mask import brush_mask;s=json.loads(sys.stdin.read());print(json.dumps(list(brush_mask(s,20,20).tobytes())))"],{input:JSON.stringify(stroke),encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);assert.deepEqual([...full],JSON.parse(result.stdout));
  }
});

test('Recover preserves untouched pixels and restores transparent and partially covered RGBA',() => {
  const current=Uint8ClampedArray.from([255,0,0,255,255,0,0,255,255,0,0,255]);
  const original=Uint8ClampedArray.from([0,40,200,255,17,22,33,0,0,0,255,128]);
  recoverPixels(current,original,Uint8Array.from([0,255,128]));
  assert.deepEqual([...current.subarray(0,4)],[255,0,0,255]);
  assert.deepEqual([...current.subarray(4,8)],[17,22,33,0]);
  assert.deepEqual([...current.subarray(8)],[169,0,86,191]);
});
