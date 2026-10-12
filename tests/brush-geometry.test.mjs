import test from 'node:test';
import assert from 'node:assert/strict';
import {brushImagePoint,brushFootprint} from '../src/renderer/model/brush-geometry.mjs';
import {brushMask} from '../src/renderer/model/brush-mask.mjs';

test('fractional zoom boundaries choose the same pixel for cursor and paint',() => {
  const width = 720, height = 920, bounds = {left:0,top:0,width:633.6,height:809.6};
  const point = brushImagePoint(11.44,17.6,bounds,width,height,true);
  const footprint = brushFootprint(point,1,width,height,true);
  assert.deepEqual(footprint,{left:13,top:20,width:1,height:1});
  const mask = brushMask({size:1,shape:'square',feather:0,antiAlias:false,points:[point]},width,height);
  const painted = [];
  for(let y=0;y<mask.height;y++) for(let x=0;x<mask.width;x++) if(mask.data[y*mask.width+x]) painted.push([x+mask.left,y+mask.top]);
  assert.deepEqual(painted,[[13,20]]);
});

test('odd and even square footprints match their raster stamps across zoom, pan and image edges',() => {
  for (const size of [1,2,3,4,9]) for (const scale of [.4,1,1.7,8]) for (const position of [[0,0],[5.001,7.999],[15,12]]) {
    const width=16,height=13,bounds={left:271.35,top:-19.25,width:width*scale,height:height*scale};
    const point = brushImagePoint(bounds.left+position[0]*scale,bounds.top+position[1]*scale,bounds,width,height,true);
    const rect = brushFootprint(point,size,width,height,true);
    const mask = brushMask({size,shape:'square',feather:0,antiAlias:false,points:[point]},width,height);
    for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
      const value = x>=mask.left && x<mask.left+mask.width && y>=mask.top && y<mask.top+mask.height
        ? mask.data[(y-mask.top)*mask.width+x-mask.left] : 0;
      assert.equal(value,x>=rect.left && x<rect.left+rect.width && y>=rect.top && y<rect.top+rect.height ? 255 : 0);
    }
  }
});

test('anti-aliased brushes retain continuous coordinates and fractional footprints',() => {
  const point = brushImagePoint(42.3,37.2,{left:10,top:20,width:80,height:60},40,30);
  const rect = brushFootprint(point,1,40,30,false);
  assert.equal(rect.left,point[0]*40-.5);
  assert.equal(rect.top,point[1]*30-.5);
  assert.notEqual(point[0]*40%1,.5);
});
