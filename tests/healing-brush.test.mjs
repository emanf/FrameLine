import test from "node:test";
import assert from "node:assert/strict";
import { healPixelData, detectHealingRemoveColor, detectHealingBorderColor } from "../src/renderer/model/healing-brush.mjs";
import { validateStroke } from "../src/renderer/model/project-model.mjs";

const stroke = { tool: "healing", color: "#000000", backgroundColor: "#04f404", tolerance: 2,
  opacity: 1, size: 3, shape: "round", feather: 0, points: [[0.5, 0.5]] };
function heal(pixels, options = {}, coverage = 255) {
  const data = new Uint8ClampedArray(pixels.flat());
  const mask = new Uint8ClampedArray(pixels.flatMap(() => [255, 255, 255, coverage]));
  healPixelData(data, mask, { ...stroke, ...options });
  return [...data];
}

test("healing recovers about 30% black from the user's green mixture", () => {
  assert.deepEqual(heal([[3, 170, 3, 255]]), [0, 0, 0, 77]);
  assert.deepEqual(heal([[3, 170, 3, 128]]), [0, 0, 0, 39]);
});

test("healing resolves arbitrary keep/remove colors and skips unrelated pixels", () => {
  assert.deepEqual(heal([[102, 150, 56, 255]], {color:"#f01e50", backgroundColor:"#0ae628", tolerance:0}), [240, 30, 80, 102]);
  assert.deepEqual(heal([[0, 0, 255, 255]], {tolerance:8}), [0, 0, 255, 255]);
  assert.deepEqual(heal([[4, 244, 4, 255], [0, 0, 0, 101], [3, 170, 3, 0]]),
    [0, 0, 0, 0, 0, 0, 0, 101, 3, 170, 3, 0]);
});

test("healing blends partial strength with premultiplied color and obeys brush coverage", () => {
  assert.deepEqual(heal([[0, 170, 0, 255]], {backgroundColor:"#00ff00", opacity:.5}), [0, 128, 0, 170]);
  assert.deepEqual(heal([[0, 170, 0, 255]], {backgroundColor:"#00ff00"}, 128), [0, 127, 0, 170]);
  assert.deepEqual(heal([[3, 170, 3, 255]], {}, 0), [3, 170, 3, 255]);
});

test("repeating a full healing stroke preserves healed transparency", () => {
  const first = heal([[3, 170, 3, 255]]);
  assert.deepEqual(heal([first]), first);
});

test("project validation rejects ambiguous colors and invalid healing settings", () => {
  validateStroke(stroke);
  for (const change of [{backgroundColor:"#000000"}, {backgroundColor:"green"}, {tolerance:-1},
    {tolerance:256}, {tolerance:2.5}, {opacity:1.1}, {color:null}]) {
    assert.throws(() => validateStroke({...stroke, ...change}), /invalid paint stroke/);
  }
});

function pixels(width, height, pixel) {
  return new Uint8ClampedArray(Array.from({length:width * height}, (_, index) => pixel(index % width, Math.floor(index / width))).flat());
}

test("Auto detection obeys the exact hard circle stamp when feather is zero", () => {
  const data=pixels(3,3,(x,y)=>x!==1&&y!==1?[4,244,4,255]:[0,0,0,255]);
  const brush={x:1.8,y:1.8,size:3,shape:'round',feather:0};
  assert.equal(detectHealingRemoveColor(data,3,3,'#000000',brush,[4,244,4]),null, 'pixels outside the hard cross stamp cannot supply Remove color');
  data.set([4,244,4,255],(1*3+1)*4);
  assert.deepEqual(detectHealingRemoveColor(data,3,3,'#000000',brush,[4,244,4]).color,[4,244,4]);
});

test("auto Remove color searches the clicked footprint using a background reference", () => {
  const data = pixels(32,32,(x,y) => x>=10 && x<22 && y>=10 && y<22 ? [30,40,240,255] : [4,244,4,255]);
  assert.deepEqual(detectHealingRemoveColor(data,32,32,'#000000',{x:16,y:16,size:5,shape:'round'},[30,40,240]),
    {color:[30,40,240],source:'background match'});
  assert.equal(detectHealingRemoveColor(data,32,32,'#000000',{x:16,y:16,size:5,shape:'round'},[4,244,4]),null);
  assert.deepEqual(detectHealingRemoveColor(data,32,32,'#000000',{x:4,y:4,size:5,shape:'square'},[4,244,4]).color,[4,244,4]);
});

test("brush size and shape constrain automatic color sampling", () => {
  const data = pixels(32,32,() => [4,244,4,255]);
  for(let y=14;y<18;y++) for(let x=14;x<18;x++) data.set([30,40,240,255],(y*32+x)*4);
  assert.equal(detectHealingRemoveColor(data,32,32,'#000000',{x:16,y:16,size:2,shape:'square'},[4,244,4]),null);
  assert.deepEqual(detectHealingRemoveColor(data,32,32,'#000000',{x:16,y:16,size:12,shape:'square'},[4,244,4]).color,[4,244,4]);
  const corners = pixels(9,9,()=>[0,0,0,255]);
  corners.set([30,40,240,255],(4*9+4)*4);
  for(const [x,y] of [[1,1],[7,1],[1,7],[7,7]]) corners.set([4,244,4,255],(y*9+x)*4);
  assert.deepEqual(detectHealingRemoveColor(corners,9,9,'#000000',{x:4.5,y:4.5,size:7,shape:'round'},[30,40,240]).color,[30,40,240]);
  assert.equal(detectHealingRemoveColor(corners,9,9,'#000000',{x:4.5,y:4.5,size:7,shape:'round'},[4,244,4]),null);
  assert.deepEqual(detectHealingRemoveColor(corners,9,9,'#000000',{x:4.5,y:4.5,size:7,shape:'square'},[4,244,4]).color,[4,244,4]);
});

test("local detection ignores Keep colors, transparent RGB, and isolated outliers", () => {
  const data = pixels(16,16,(x,y)=>x<8 ? [0,0,0,255] : [4,244,4,128]);
  data.set([16,255,16,255],(9*16+9)*4);
  data.set([255,0,255,0],(10*16+10)*4);
  assert.deepEqual(detectHealingRemoveColor(data,16,16,'#000000',{x:8,y:8,size:16,shape:'square'},[4,244,4]).color,[4,244,4]);
});

test("local detection rejects empty or Keep-only areas and uses the reference to resolve competing colors", () => {
  const brush={x:8,y:8,size:16,shape:'square'};
  assert.equal(detectHealingRemoveColor(pixels(16,16,()=>[4,244,4,0]),16,16,'#000000',brush,[4,244,4]),null);
  assert.equal(detectHealingRemoveColor(pixels(16,16,()=>[0,0,0,255]),16,16,'#000000',brush,[4,244,4]),null);
  assert.deepEqual(detectHealingRemoveColor(pixels(16,16,x=>x<8?[4,244,4,255]:[30,40,240,255]),16,16,'#000000',brush,[4,244,4]).color,[4,244,4]);
  assert.equal(detectHealingRemoveColor(pixels(16,16,()=>[4,244,4,255]),16,16,'#000000',brush,null),null);
});

test("local detection supports arbitrary Keep colors, one-pixel brushes and clipped footprints", () => {
  const data=pixels(1,5,(_,y)=>y===2?[240,20,60,255]:[30,40,240,255]);
  assert.deepEqual(detectHealingRemoveColor(data,1,5,'#f0143c',{x:.5,y:.5,size:1,shape:'round'},[30,40,240]).color,[30,40,240]);
  assert.equal(detectHealingRemoveColor(data,1,5,'#f0143c',{x:.5,y:2.5,size:1,shape:'round'},[30,40,240]),null);
  assert.deepEqual(detectHealingRemoveColor(data,1,5,'#f0143c',{x:0,y:0,size:1,shape:'round'},[30,40,240]).color,[30,40,240]);
  assert.equal(detectHealingRemoveColor(data,1,5,'#f0143c',{x:-5,y:-5,size:1,shape:'round'},[30,40,240]),null);
});

test("original perimeter detection handles compression and rejects transparent or competing borders", () => {
  const border=pixels(100,1,x=>x<85?[4+x%3,244-x%3,4,255]:[240,30,80,255]);
  assert.deepEqual(detectHealingBorderColor(border,'#000000'),{color:[5,243,4],source:'original border'});
  assert.equal(detectHealingBorderColor(pixels(100,1,()=>[4,244,4,0]),'#000000'),null);
  assert.equal(detectHealingBorderColor(pixels(100,1,x=>x<50?[4,244,4,255]:[30,40,240,255]),'#000000'),null);
  assert.equal(detectHealingBorderColor(pixels(100,1,x=>x<80?[0,0,0,255]:[4,244,4,255]),'#000000'),null);
  assert.equal(detectHealingBorderColor(pixels(100,1,x=>x<10?[4,244,4,255]:[0,0,0,0]),'#000000'),null);
  assert.deepEqual(detectHealingBorderColor(pixels(100,1,()=>[255,255,255,255]),'#f0143c').color,[255,255,255]);
});

test("Auto keeps the original endpoint for darker mixtures and recovers foreground opacity", () => {
  const data=pixels(4,4,()=>[3,170,3,255]);
  const result=detectHealingRemoveColor(data,4,4,'#000000',{x:2,y:2,size:4,shape:'square',tolerance:1},[4,244,4]);
  assert.deepEqual(result,{color:[4,244,4],source:'background mixture'});
  const remove='#'+result.color.map(value=>value.toString(16).padStart(2,'0')).join('');
  assert.deepEqual(heal([[3,170,3,255]],{backgroundColor:remove}),[0,0,0,77]);
  assert.deepEqual(heal([[3,170,3,128]],{backgroundColor:remove}),[0,0,0,39]);
  assert.deepEqual(detectHealingRemoveColor(pixels(1,1,()=>[102,150,56,255]),1,1,'#f01e50',
    {x:.5,y:.5,size:1,shape:'square',tolerance:0},[10,230,40]).color,[10,230,40]);
});

test("nearest-shade fallback prefers background color family across brightness changes for arbitrary hues", () => {
  for(const reference of [[120,20,30],[20,120,30],[20,30,120],[120,60,180],[20,120,120],[120,120,120]]) {
    const changed=reference.map(value=>value+50);
    const data=pixels(8,8,x=>x===0?[...changed,255]:[240,240,20,255]);
    const result=detectHealingRemoveColor(data,8,8,'#000000',{x:4,y:4,size:8,shape:'square',tolerance:0},reference);
    assert.deepEqual(result,{color:changed,source:'nearest background shade'});
  }
});
