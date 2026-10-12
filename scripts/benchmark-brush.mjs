import {performance} from 'node:perf_hooks';
import {brushMask} from '../src/renderer/model/brush-mask.mjs';
import {IncrementalBrushMask} from '../src/renderer/model/incremental-brush-mask.mjs';

/** Compare historical whole-path repainting with cached coverage on identical long strokes. */
const width=1280,height=960;
const points=Array.from({length:2400},(_,i)=>{
  const angle=i*.018;
  return [.5+Math.cos(angle)*(.29+i*.000007),.5+Math.sin(angle)*(.3+i*.000006)];
});
const median=values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
for(const feather of [0,30]) {
  const stroke={size:32,shape:'round',antiAlias:true,feather,points:[]};
  const raster=new IncrementalBrushMask(stroke,width,height);
  const timings={regional:[],whole:[],cached:[]};
  for(let i=0;i<points.length;i++) {
    stroke.points.push(points[i]);
    const start=performance.now();raster.append();raster.takeDirtyMask();
    if(i<points.length-20) continue;
    timings.cached.push(performance.now()-start);
    const [x,y]=points[i],radius=stroke.size/2+Math.ceil(stroke.size*feather/100*3)+3;
    const region={left:Math.max(0,Math.floor(x*width-radius)),top:Math.max(0,Math.floor(y*height-radius)),
      right:Math.min(width,Math.ceil(x*width+radius)),bottom:Math.min(height,Math.ceil(y*height+radius))};
    let began=performance.now();brushMask(stroke,width,height,region);timings.regional.push(performance.now()-began);
    began=performance.now();brushMask(stroke,width,height);timings.whole.push(performance.now()-began);
  }
  console.log(JSON.stringify({width,height,size:32,feather,points:points.length,medianMs:{
    previousBrush:Number(median(timings.regional).toFixed(3)),previousIgnoreRecover:Number(median(timings.whole).toFixed(3)),
    cachedCoverage:Number(median(timings.cached).toFixed(3))}}));
}
