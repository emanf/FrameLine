import {brushMask} from './brush-mask.mjs';

/** Rasterize the union of protection marks, optionally restricted to a dirty paint region. */
export function protectionMask(strokes,width,height,region={left:0,top:0,right:width,bottom:height}) {
  const left=Math.max(0,region.left),top=Math.max(0,region.top),right=Math.min(width,region.right),bottom=Math.min(height,region.bottom);
  const result={left,top,width:right-left,height:bottom-top,data:new Uint8ClampedArray((right-left)*(bottom-top))};
  for (const stroke of strokes ?? []) {
    const mask=brushMask({...stroke,feather:0,antiAlias:stroke.antiAlias ?? true},width,height,region);
    for(let y=Math.max(top,mask.top);y<Math.min(bottom,mask.top+mask.height);y++) {
      for(let x=Math.max(left,mask.left);x<Math.min(right,mask.left+mask.width);x++) {
        const index=(y-top)*result.width+x-left;
        result.data[index]=Math.max(result.data[index],mask.data[(y-mask.top)*mask.width+x-mask.left]);
      }
    }
  }
  return result;
}

/** Restore original RGBA through brush coverage, blending soft boundaries in premultiplied color. */
export function recoverPixels(current,original,coverage) {
  for(let i=0;i<coverage.length;i++) {
    const amount=coverage[i]/255;
    if(!amount) continue;
    const offset=i*4;
    if(amount===1) {current.set(original.subarray(offset,offset+4),offset);continue;}
    const beforeAlpha=current[offset+3]/255,originalAlpha=original[offset+3]/255;
    const alpha=beforeAlpha*(1-amount)+originalAlpha*amount;
    for(let channel=0;channel<3;channel++) current[offset+channel]=alpha
      ? Math.round((current[offset+channel]*beforeAlpha*(1-amount)+original[offset+channel]*originalAlpha*amount)/alpha) : 0;
    current[offset+3]=Math.round(alpha*255);
  }
}
