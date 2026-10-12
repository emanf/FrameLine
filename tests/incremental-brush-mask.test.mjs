import test from 'node:test';
import assert from 'node:assert/strict';
import {IncrementalBrushMask} from '../src/renderer/model/incremental-brush-mask.mjs';
import {brushMask} from '../src/renderer/model/brush-mask.mjs';

const points=[[0,0],[.62,.43],[.31,.76],[.83,.54],[.31,.76],[.62,.43],[1,1]];
const base={tool:'brush',color:'#ff0099',opacity:.4,size:7,shape:'round',antiAlias:true,feather:0,points:[]};
function paste(result,mask,width) {
  if(!mask) return;
  for(let y=0;y<mask.height;y++) result.set(mask.data.subarray(y*mask.width,(y+1)*mask.width),(y+mask.top)*width+mask.left);
}

test('incremental coverage matches complete strokes at every update, including intersections and feather',()=>{
  const width=91,height=75;
  for(const antiAlias of [false,true]) for(const shape of ['round','square']) for(const feather of [0,20,80,100]) {
    const stroke={...base,antiAlias,shape,feather,points:[]},raster=new IncrementalBrushMask(stroke,width,height),output=new Uint8ClampedArray(width*height);
    for(const point of points) {
      stroke.points.push(point);raster.append();paste(output,raster.takeDirtyMask(),width);
      const expected=new Uint8ClampedArray(width*height);paste(expected,brushMask(stroke,width,height),width);
      assert.deepEqual(output,expected,JSON.stringify({antiAlias,shape,feather,point}));
    }
    assert.equal(raster.takeDirtyMask(),null,'an unchanged pointer does not repaint');
  }
});

test('incremental protected masks match full masks without replaying or rebuilding previous coverage',()=>{
  const width=120,height=96,ignored=[{...base,size:15,feather:0,points:[[.2,.4],[.6,.4]]}];
  const stroke={...base,points:[],ignoreStrokes:ignored},raster=new IncrementalBrushMask(stroke,width,height),output=new Uint8ClampedArray(width*height);
  for(const point of points) {
    stroke.points.push(point);raster.append();paste(output,raster.takeDirtyMask(),width);
    const expected=new Uint8ClampedArray(width*height);paste(expected,brushMask(stroke,width,height),width);
    assert.deepEqual(output,expected);
  }
});

test('long repeated paths keep bounded tiles and new-segment work instead of replaying history',()=>{
  const stroke={...base,size:12,points:[[.5,.5]]},raster=new IncrementalBrushMask(stroke,2048,2048);
  raster.append();raster.takeDirtyMask();
  let spanCalls=0;const add=raster.addSpan.bind(raster);raster.addSpan=(...args)=>{spanCalls++;return add(...args);};
  stroke.points.push([.505,.505]);raster.append();const firstCalls=spanCalls;
  raster.takeDirtyMask();
  for(let i=0;i<4000;i++) {stroke.points.push(i%2 ? [.505,.505] : [.5,.5]);raster.append();}
  assert(spanCalls<=firstCalls*4001+200,'only appended segments are scanned');
  assert.equal(raster.pointCount,4002);
  assert.equal(raster.takeDirtyMask(),null,'retracing a completed footprint creates no additional coverage');
  assert(raster.tiles.size<=4,'untouched image tiles have no allocation');
});
