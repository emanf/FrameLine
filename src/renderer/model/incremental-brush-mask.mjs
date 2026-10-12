import {scanSmoothBrush,BRUSH_SAMPLE_SCALE} from './brush-spans.mjs';
import {pixelRoundStrokeSpans} from './pixel-brush.mjs';
import {featherBrushValues} from './brush-mask.mjs';
import {protectionMask} from './protection-mask.mjs';

const TILE=64,SCALE=BRUSH_SAMPLE_SCALE;
const BIT_COUNTS=Uint8Array.from({length:256},(_,value)=>{
  let count=0;while(value) {count+=value&1;value>>>=1;}return count;
});

/** Retain exact subpixel unions in sparse tiles so stroke cost does not grow with its history. */
export class IncrementalBrushMask {
  constructor(stroke,width,height) {
    this.stroke=stroke;this.width=width;this.height=height;this.pointCount=0;
    this.tiles=new Map();this.protectionTiles=new Map();
    this.sigma=stroke.size*(stroke.feather ?? 0)/100;
    this.apron=Math.ceil(this.sigma*3)+3;
    this.sampleRows=stroke.antiAlias ? SCALE : 1;
    this.bounds=null;this.dirty=null;
  }

  /** Merge a changed footprint without visiting earlier pointer samples. */
  extendBounds(bounds,x,y) {
    if(!bounds) return {left:x,top:y,right:x+1,bottom:y+1};
    bounds.left=Math.min(bounds.left,x);bounds.top=Math.min(bounds.top,y);
    bounds.right=Math.max(bounds.right,x+1);bounds.bottom=Math.max(bounds.bottom,y+1);
    return bounds;
  }

  /** Set sample bits once; repeated paths neither accumulate opacity nor cause additional repainting. */
  addSpan(row,start,end) {
    const scale=this.sampleRows,pixelY=Math.floor(row/scale),sampleY=row%scale;
    if(pixelY<0 || pixelY>=this.height) return;
    const first=Math.max(0,Math.floor(start/scale)),last=Math.min(this.width,Math.ceil(end/scale));
    for(let x=first;x<last;x++) {
      const tileX=Math.floor(x/TILE),tileY=Math.floor(pixelY/TILE),key=tileY*Math.ceil(this.width/TILE)+tileX;
      let tile=this.tiles.get(key);
      if(!tile) {tile=new Uint8Array(TILE*TILE*scale);this.tiles.set(key,tile);}
      const index=((pixelY%TILE)*TILE+x%TILE)*scale+sampleY;
      const a=Math.max(0,start-x*scale),b=Math.min(scale,end-x*scale);
      const bits=((1<<(b-a))-1)<<a,previous=tile[index],next=previous|bits;
      if(previous===next) continue;
      tile[index]=next;this.dirty=this.extendBounds(this.dirty,x,pixelY);this.bounds=this.extendBounds(this.bounds,x,pixelY);
    }
  }

  /** Scan only appended segments, including their connecting endpoint. */
  append(points=this.stroke.points) {
    if(points.length<=this.pointCount) return;
    const chunk={...this.stroke,points:points.slice(Math.max(0,this.pointCount-1))};
    this.pointCount=points.length;
    const region={left:0,top:0,right:this.width,bottom:this.height};
    if(this.stroke.antiAlias) scanSmoothBrush(chunk,this.width,this.height,region,(row,left,right)=>this.addSpan(row,left,right));
    else for(const span of pixelRoundStrokeSpans(chunk,this.width,this.height,region)) this.addSpan(span.y,span.left,span.right);
  }

  /** Read cached coverage at one pixel without allocating storage for untouched image regions. */
  coverage(x,y) {
    const key=Math.floor(y/TILE)*Math.ceil(this.width/TILE)+Math.floor(x/TILE),tile=this.tiles.get(key);
    if(!tile) return 0;
    const index=((y%TILE)*TILE+x%TILE)*this.sampleRows;
    if(this.sampleRows===1) return tile[index] ? 255 : 0;
    let count=0;for(let row=0;row<SCALE;row++) count+=BIT_COUNTS[tile[index+row]];
    return count*255/(SCALE*SCALE);
  }

  /** Cache protection by tile so a long Ignore path is sampled at most once per visited tile. */
  ignored(x,y) {
    if(!this.stroke.ignoreStrokes?.length) return 0;
    const tileX=Math.floor(x/TILE),tileY=Math.floor(y/TILE),key=tileY*Math.ceil(this.width/TILE)+tileX;
    let tile=this.protectionTiles.get(key);
    if(!tile) {
      const left=tileX*TILE,top=tileY*TILE;
      tile=protectionMask(this.stroke.ignoreStrokes,this.width,this.height,{left,top,right:Math.min(this.width,left+TILE),bottom:Math.min(this.height,top+TILE)});
      this.protectionTiles.set(key,tile);
    }
    return tile.data[(y-tile.top)*tile.width+x-tile.left];
  }

  /** Compose a regional mask from cached samples, including the complete feather support. */
  mask(bounds=this.bounds) {
    if(!bounds) return null;
    const spread=this.sigma ? this.apron : 0;
    const left=Math.max(0,bounds.left-spread),top=Math.max(0,bounds.top-spread);
    const right=Math.min(this.width,bounds.right+spread),bottom=Math.min(this.height,bounds.bottom+spread);
    const readLeft=Math.max(0,left-spread),readTop=Math.max(0,top-spread);
    const readRight=Math.min(this.width,right+spread),readBottom=Math.min(this.height,bottom+spread);
    const readWidth=readRight-readLeft,readHeight=readBottom-readTop;
    let values=new Float64Array(readWidth*readHeight);
    for(let y=readTop;y<readBottom;y++) for(let x=readLeft;x<readRight;x++) values[(y-readTop)*readWidth+x-readLeft]=this.coverage(x,y);
    values=featherBrushValues(values,readWidth,readHeight,this.sigma);
    const width=right-left,height=bottom-top,data=new Uint8ClampedArray(width*height);
    for(let y=top;y<bottom;y++) for(let x=left;x<right;x++) {
      const value=Math.max(0,Math.min(255,Math.floor(values[(y-readTop)*readWidth+x-readLeft]+.5)));
      data[(y-top)*width+x-left]=Math.round(value*(255-this.ignored(x,y))/255);
    }
    return {left,top,width,height,data};
  }

  /** Consume only pixels affected since the preceding display update. */
  takeDirtyMask() {
    const dirty=this.dirty;this.dirty=null;return this.mask(dirty);
  }
}
