import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { brushMask } from '../src/renderer/model/brush-mask.mjs';
import { validateStroke } from '../src/renderer/model/project-model.mjs';

const dot = {tool:'brush',color:'#0000ff',opacity:1,size:5,shape:'round',feather:0,antiAlias:true,points:[[.5,.5]]};
function mask(stroke, width=24, height=20) {
  const region = brushMask(stroke, width, height), data = new Uint8Array(width*height);
  for (let y=0; y<region.height; y++) data.set(region.data.subarray(y*region.width,(y+1)*region.width),(y+region.top)*width+region.left);
  return data;
}

test('renderer and Python brush masks use the same coverage fixtures', () => {
  const cases = JSON.parse(readFileSync(new URL('./fixtures/brush-masks.json',import.meta.url)));
  for (const entry of cases) assert.equal(createHash('sha256').update(mask(entry)).digest('hex'), entry.hash, entry.name);
});

test('anti-aliasing smooths only the boundary, independently of feather', () => {
  const smooth = mask(dot), pixel = mask({...dot,antiAlias:false});
  assert(smooth.some(a => a>0 && a<255));
  assert.equal(smooth[10*24+12],255, 'the hard brush interior remains opaque');
  assert.deepEqual([...new Set(pixel)].sort((a,b)=>a-b),[0,255]);
  for (const antiAlias of [true,false]) assert(mask({...dot,antiAlias,feather:35}).some(a => a>0 && a<255));
});

test('smooth strokes keep fractional positions while pixel strokes snap', () => {
  const shifted = {...dot,points:[[.51,.52]]};
  assert.notDeepEqual(mask(dot), mask(shifted));
  assert.deepEqual(mask({...dot,antiAlias:false}),mask({...shifted,antiAlias:false}));
});

test('one stroke covers intersections and retraced paths only once for both shapes and modes', () => {
  for (const shape of ['round','square']) for (const antiAlias of [true,false]) for (const feather of [0,40]) {
    const forward = {...dot,shape,antiAlias,feather,points:[[.2,.2],[.7,.6]]};
    assert.deepEqual(mask(forward),mask({...forward,points:[...forward.points,forward.points[0],forward.points[1]]}));
  }
});

test('a one-pixel hard brush stays connected and masks clip to the image', () => {
  const line = mask({...dot,size:1,antiAlias:false,points:[[0,0],[1,1]]},5,5);
  for(let i=0;i<5;i++) assert.equal(line[i*5+i],255);
  for (const antiAlias of [true,false]) {
    const region = brushMask({...dot,antiAlias,points:[[0,0],[1,1]]},7,6);
    assert.equal(region.left,0); assert.equal(region.top,0);
    assert.equal(region.width,7); assert.equal(region.height,6);
  }
});

test('stroke validation supports saved booleans and legacy strokes, rejects malformed anti-aliasing', () => {
  validateStroke(dot); validateStroke({...dot,antiAlias:false});
  const legacy = {...dot}; delete legacy.antiAlias; validateStroke(legacy);
  for (const value of [null,0,1,'true',{},[]]) assert.throws(()=>validateStroke({...dot,antiAlias:value}),/invalid paint stroke/);
});

test('regional brush repaints match the complete mask, including feather and intersections', () => {
  const width=180, height=140;
  for (const shape of ['round','square']) for (const antiAlias of [true,false]) for (const feather of [0,20,80,100]) {
    const stroke = {...dot,size:9,shape,antiAlias,feather,points:[[0,0],[.8,.4],[.4,.8],[.6,.1],[.8,.4],[1,1]]};
    const full = mask(stroke,width,height);
    for (const region of [{left:45,top:35,right:70,bottom:60},{left:0,top:0,right:12,bottom:14},
      {left:160,top:125,right:180,bottom:140}]) {
      const partial = brushMask(stroke,width,height,region);
      for (let y=region.top;y<region.bottom;y++) for(let x=region.left;x<region.right;x++) {
        const value = x<partial.left || x>=partial.left+partial.width || y<partial.top || y>=partial.top+partial.height ? 0
          : partial.data[(y-partial.top)*partial.width+x-partial.left];
        assert.equal(value,full[y*width+x],JSON.stringify({shape,antiAlias,feather,x,y}));
      }
    }
  }
});
