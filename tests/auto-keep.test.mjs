import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { healPixelData, detectHealingBorderColor, detectHealingRemoveColor } from "../src/renderer/model/healing-brush.mjs";
import { validateStroke } from "../src/renderer/model/project-model.mjs";

const defaults = {tool:"healing", color:"#000000", backgroundColor:"#00f000", opacity:1, tolerance:1,
  autoKeep:true, sampleDistance:24, recoverTransparency:true, size:3, shape:"round", feather:0, antiAlias:false, points:[[.5,.5]]};
function fixture(background = [0,240,0], colors = [[0,0,0],[120,30,10],[240,200,80]]) {
  const width = 9, height = colors.length;
  const source = colors.flatMap(color => Array.from({length:width}, (_,x) => [...(x<3 ? color : x<6 ? color.map((value,c)=>(value+background[c])/2) : background),255]).flat());
  const mask = Array.from({length:width*height}, (_,i) => [0,0,0,i%width>=3 && i%width<6 ? 255 : 0]).flat();
  const stroke = {...defaults, backgroundColor:'#'+background.map(c => c.toString(16).padStart(2,'0')).join('')};
  return {width,height,source,mask,stroke};
}
function heal(input, options = {}) {
  const data = new Uint8ClampedArray(input.source);
  healPixelData(data,new Uint8ClampedArray(input.mask),{...input.stroke,...options},{width:input.width,height:input.height});
  return Array.from(data);
}
const pixel = (data,x,y,width=9) => data.slice((y*width+x)*4,(y*width+x+1)*4);

test("Auto Keep recovers dark, shadow and highlight hair colors without a manual Keep", () => {
  const input = fixture(), result = heal(input);
  for (const [y,color] of [[0,[0,0,0]],[1,[120,30,10]],[2,[240,200,80]]]) {
    for (let x=3;x<6;x++) assert.deepEqual(pixel(result,x,y),[...color,128]);
    assert.deepEqual(pixel(result,0,y),pixel(input.source,0,y),"clean interior remains unchanged");
    assert.deepEqual(pixel(result,8,y),pixel(input.source,8,y),"outside the stroke remains unchanged");
  }
  assert.deepEqual(heal({...input,source:result}),result,"cleaned strands do not lose opacity on repetition");
});

test("Auto Keep supports white, black and arbitrary colored Remove endpoints", () => {
  for (const background of [[255,255,255],[0,0,0],[20,100,240],[240,20,80]]) {
    const color = background[0]===255 ? [31,31,31] : background[0]===0 ? [220,20,40] : [80,20,160];
    const input = fixture(background,[color]), result = heal(input);
    for (let x=3;x<6;x++) {
      assert.deepEqual(pixel(result,x,0).slice(0,3),color);
      assert(Math.abs(pixel(result,x,0)[3]-128)<=1);
    }
  }
});

test("Auto Keep preserves existing opacity on request and blends strength in premultiplied color", () => {
  const input = fixture([0,240,0],[[120,30,10]]);
  const preserved = heal(input,{recoverTransparency:false});
  assert.deepEqual(pixel(preserved,4,0),[120,30,10,255]);
  assert.deepEqual(pixel(heal(input,{opacity:.5}),4,0),[80,100,7,191]);
  for (let x=3;x<6;x++) input.source[x*4+3]=128;
  assert.deepEqual(pixel(heal(input),4,0),[120,30,10,64]);
  assert.deepEqual(pixel(heal(input,{recoverTransparency:false}),4,0),[120,30,10,128]);
});

test("Auto Keep respects sample distance, transparent gaps, brush coverage and uncertain colors", () => {
  const input = fixture([0,240,0],[[120,30,10]]);
  const short = heal(input,{sampleDistance:1});
  assert.deepEqual(pixel(short,3,0),[120,30,10,128]);
  assert.deepEqual(pixel(short,5,0),pixel(input.source,5,0));
  for(let x=2;x<4;x++) input.source[x*4+3]=0;
  assert.deepEqual(pixel(heal(input),4,0),pixel(input.source,4,0),"samples cannot cross air");
  const unknown=fixture([0,240,0],[[0,120,0]]);
  assert.deepEqual(heal(unknown),unknown.source,"no reliable clean endpoint means no color replacement");
});

test("expanded regional previews match full-frame evaluation", () => {
  const input=fixture(), expected=heal(input);
  const x=4,y=1;
  const data=new Uint8ClampedArray(pixel(input.source,x,y));
  healPixelData(data,new Uint8ClampedArray([0,0,0,255]),input.stroke,{width:1,height:1,
    reference:{data:new Uint8ClampedArray(input.source),width:input.width,height:input.height,left:x,top:y}});
  assert.deepEqual(Array.from(data),pixel(expected,x,y));
});

test("Auto Keep project fields are validated while old manual strokes remain valid", () => {
  validateStroke(defaults);
  validateStroke({...defaults,color:defaults.backgroundColor});
  for(const change of [{autoKeep:'yes'},{recoverTransparency:1},{sampleDistance:0},{sampleDistance:129},{sampleDistance:2.5}]) {
    assert.throws(()=>validateStroke({...defaults,...change}),/invalid paint stroke/);
  }
});

test("cropped preview sampling agrees with full-image sampling at edges and across color bands", () => {
  const width=48,height=32,source=new Uint8ClampedArray(width*height*4);
  const background=[0,240,0], palette=[[120,30,10],[40,60,160],[200,180,60],[0,0,0]];
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const keep=palette[Math.floor(y/8)], alpha=x<10?1:x<24?(24-x)/14:0;
    source.set([...keep.map((v,c)=>Math.round(v*alpha+background[c]*(1-alpha))),255],(y*width+x)*4);
  }
  const stroke={...defaults,tolerance:4,sampleDistance:12};
  for(const [left,top,right,bottom] of [[9,0,16,3],[14,6,22,11],[17,15,23,18],[8,28,21,32]]) {
    const mask=new Uint8ClampedArray(source.length),full=new Uint8ClampedArray(source);
    for(let y=top;y<bottom;y++) for(let x=left;x<right;x++) mask[(y*width+x)*4+3]=255;
    healPixelData(full,mask,stroke,{width,height});
    const x=Math.max(0,left-13),y=Math.max(0,top-13),w=Math.min(width,right+13)-x,h=Math.min(height,bottom+13)-y;
    const reference=new Uint8ClampedArray(w*h*4),target=new Uint8ClampedArray((right-left)*(bottom-top)*4);
    for(let row=0;row<h;row++) reference.set(source.slice(((y+row)*width+x)*4,((y+row)*width+x+w)*4),row*w*4);
    for(let row=top;row<bottom;row++) target.set(source.slice((row*width+left)*4,(row*width+right)*4),(row-top)*(right-left)*4);
    const targetMask=new Uint8ClampedArray(target.length);for(let i=3;i<targetMask.length;i+=4)targetMask[i]=255;
    healPixelData(target,targetMask,stroke,{width:right-left,height:bottom-top,reference:{data:reference,width:w,height:h,left:left-x,top:top-y}});
    for(let row=top;row<bottom;row++) assert.deepEqual(Array.from(target.slice((row-top)*(right-left)*4,(row-top+1)*(right-left)*4)),
      Array.from(full.slice((row*width+left)*4,(row*width+right)*4)));
  }
});

test("automatic Remove color can use the original border without excluding a manual Keep color", () => {
  const border=new Uint8ClampedArray(Array.from({length:8},()=>[0,0,0,255]).flat());
  assert.deepEqual(detectHealingBorderColor(border,null).color,[0,0,0]);
  const input=fixture();
  const result=detectHealingRemoveColor(new Uint8ClampedArray(input.source),9,3,null,
    {x:4,y:1,size:1,shape:'square',antiAlias:false,feather:0,tolerance:1},[0,240,0]);
  assert.deepEqual(result.color,[0,240,0],"mixed strands retain the original background endpoint");
});

test("renderer and Pillow Auto Keep produce the same multicolor, opacity and coverage results", () => {
  const cases=[fixture(),fixture([255,255,255],[[31,31,31]]),fixture([0,0,0],[[220,20,40]]),
    fixture([20,100,240],[[80,20,160]])];
  cases.push({...fixture(),stroke:{...defaults,opacity:.5}});
  cases.push({...fixture(),stroke:{...defaults,recoverTransparency:false}});
  const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const script="import json,sys;sys.path.insert(0,sys.argv[1]);from PIL import Image;from healing_brush import heal_image;cases=json.load(sys.stdin);out=[]\nfor c in cases:\n image=Image.frombytes('RGBA',(c['width'],c['height']),bytes(c['source']));mask=Image.frombytes('RGBA',image.size,bytes(c['mask'])).getchannel('A');out.append(list(heal_image(image,mask,c['stroke']).tobytes()))\nprint(json.dumps(out))";
  const result=spawnSync(process.env.PYTHON || (process.platform==='win32'?'python':'python3'),['-c',script,path.join(root,'backend')],
    {input:JSON.stringify(cases),encoding:'utf8',windowsHide:true,timeout:30000});
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout),cases.map(input=>heal(input)));
});
