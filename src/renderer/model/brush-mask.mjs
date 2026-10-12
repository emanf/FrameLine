import { pixelRoundStrokeSpans } from './pixel-brush.mjs';
import {protectionMask} from './protection-mask.mjs';
import {scanSmoothBrush,BRUSH_SAMPLE_SCALE} from './brush-spans.mjs';

// Eight samples per axis give edge coverage without a blur or a bright halo.
// Keep this scan converter and the feather filter in sync with brush_mask.py.
const SCALE = BRUSH_SAMPLE_SCALE;

export function brushMask(stroke, imageWidth, imageHeight, region = null) {
  const sigma = stroke.size * (stroke.feather ?? 0) / 100;
  const padding = stroke.size / 2 + Math.ceil(sigma * 3) + 3;
  const points = stroke.points.map(([x, y]) => [x * imageWidth, y * imageHeight]);
  let left = imageWidth, top = imageHeight, right = 0, bottom = 0;
  for (const [x, y] of points) {
    left = Math.min(left, Math.floor(x - padding)); top = Math.min(top, Math.floor(y - padding));
    right = Math.max(right, Math.ceil(x + padding)); bottom = Math.max(bottom, Math.ceil(y + padding));
  }
  left = Math.max(0, left); top = Math.max(0, top);
  right = Math.min(imageWidth, right); bottom = Math.min(imageHeight, bottom);
  if (region) {
    // Include the complete filter support around a requested repaint area.
    // Samples outside this apron cannot affect any pixel inside the area.
    const apron = Math.ceil(sigma * 3) + 3;
    left = Math.max(left, region.left - apron); top = Math.max(top, region.top - apron);
    right = Math.min(right, region.right + apron); bottom = Math.min(bottom, region.bottom + apron);
  }
  const width = Math.max(0, right - left), height = Math.max(0, bottom - top);
  let values = new Float64Array(width * height);
  if (!width || !height) return {left, top, width, height, data:new Uint8ClampedArray()};
  if (!stroke.antiAlias) {
    for (const span of pixelRoundStrokeSpans(stroke, imageWidth, imageHeight, {left, top, right, bottom})) {
      if (span.y < top || span.y >= bottom) continue;
      values.fill(255, (span.y - top) * width + Math.max(left, span.left) - left,
        (span.y - top) * width + Math.min(right, span.right) - left);
    }
  } else {
    const rows = new Map();
    scanSmoothBrush(stroke,imageWidth,imageHeight,{left,top,right,bottom},(row,a,b)=>{
      const intervals=rows.get(row-top*SCALE) ?? [];
      intervals.push([a-left*SCALE,b-left*SCALE]);rows.set(row-top*SCALE,intervals);
    });
    for (const [row, intervals] of rows) {
      intervals.sort((a,b) => a[0]-b[0]);
      const merged = [];
      for (const [a,b] of intervals) {
        const previous = merged.at(-1);
        if (previous && a <= previous[1]) previous[1] = Math.max(previous[1], b);
        else merged.push([a,b]);
      }
      const offset = Math.floor(row / SCALE) * width;
      for (const [a,b] of merged) {
        for (let x = Math.floor(a / SCALE); x < Math.ceil(b / SCALE); x++) {
          values[offset+x] += (Math.min(b,(x+1)*SCALE) - Math.max(a,x*SCALE)) * 255 / (SCALE*SCALE);
        }
      }
    }
  }
  values = featherBrushValues(values,width,height,sigma);
  const data=Uint8ClampedArray.from(values,value=>Math.max(0,Math.min(255,Math.floor(value+.5))));
  if(stroke.ignoreStrokes?.length) {
    const ignored=protectionMask(stroke.ignoreStrokes,imageWidth,imageHeight,{left,top,right,bottom});
    for(let i=0;i<data.length;i++) data[i]=Math.round(data[i]*(255-ignored.data[i])/255);
  }
  return {left,top,width,height,data};
}

/** Apply the same separable feather filter to full masks and cached regional coverage. */
export function featherBrushValues(values,width,height,sigma) {
  if (sigma) {
    // Three box filters approximate a Gaussian in linear time, independent of
    // brush radius. Transparent samples beyond the image prevent edge smearing.
    let low = Math.floor(Math.sqrt(4 * sigma * sigma + 1));
    if (!(low % 2)) low--;
    low = Math.max(1, low);
    const count = Math.round((12*sigma*sigma - 3*low*low - 12*low - 9) / (-4*low-4));
    for (let pass = 0; pass < 3; pass++) {
      const radius = ((pass < count ? low : low + 2) - 1) / 2;
      if (radius) {
        values = boxBlur(values, width, height, radius, false);
        values = boxBlur(values, width, height, radius, true);
      }
    }
  }
  return values;
}

function boxBlur(values, width, height, radius, vertical) {
  const result = new Float64Array(values.length), divisor = radius * 2 + 1;
  const lines = vertical ? width : height, length = vertical ? height : width;
  const stride = vertical ? width : 1;
  for (let line = 0; line < lines; line++) {
    const base = vertical ? line : line * width;
    let sum = 0;
    for (let p = 0; p <= Math.min(radius, length-1); p++) sum += values[base+p*stride];
    for (let p = 0; p < length; p++) {
      result[base+p*stride] = sum / divisor;
      if (p-radius >= 0) sum -= values[base+(p-radius)*stride];
      if (p+radius+1 < length) sum += values[base+(p+radius+1)*stride];
    }
  }
  return result;
}
