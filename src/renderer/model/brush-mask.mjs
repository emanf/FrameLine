import { pixelRoundStrokeSpans } from './pixel-brush.mjs';

// Eight samples per axis give edge coverage without a blur or a bright halo.
// Keep this scan converter and the feather filter in sync with brush_mask.py.
const SCALE = 8;

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
    const addSpan = (y, start, end) => {
      const a = Math.max(0, Math.ceil((start - left) * SCALE - .5));
      const b = Math.min(width * SCALE, Math.ceil((end - left) * SCALE - .5));
      if (a >= b) return;
      const intervals = rows.get(y) ?? [];
      intervals.push([a, b]); rows.set(y, intervals);
    };
    const radius = stroke.size / 2;
    const addCircle = (cx, cy) => {
      if (cx + radius < left || cx - radius > right || cy + radius < top || cy - radius > bottom) return;
      const first = Math.max(0, Math.ceil((cy - radius - top) * SCALE - .5));
      const last = Math.min(height * SCALE, Math.ceil((cy + radius - top) * SCALE - .5));
      for (let row = first; row < last; row++) {
        const dy = top + (row + .5) / SCALE - cy;
        const dx = Math.sqrt(Math.max(0, radius * radius - dy * dy));
        addSpan(row, cx - dx, cx + dx);
      }
    };
    const addPolygon = vertices => {
      if (Math.max(...vertices.map(p => p[0])) < left || Math.min(...vertices.map(p => p[0])) > right) return;
      const first = Math.max(0, Math.ceil((Math.min(...vertices.map(p => p[1])) - top) * SCALE - .5));
      const last = Math.min(height * SCALE, Math.ceil((Math.max(...vertices.map(p => p[1])) - top) * SCALE - .5));
      for (let row = first; row < last; row++) {
        const y = top + (row + .5) / SCALE;
        const intersections = [];
        for (let i = 0; i < vertices.length; i++) {
          const a = vertices[i], b = vertices[(i + 1) % vertices.length];
          if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
            intersections.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
          }
        }
        if (intersections.length) addSpan(row, Math.min(...intersections), Math.max(...intersections));
      }
    };
    for (let i = 0; i < points.length; i++) {
      const [x, y] = points[i];
      if (stroke.shape === 'square') {
        addPolygon([[x-radius,y-radius],[x+radius,y-radius],[x+radius,y+radius],[x-radius,y+radius]]);
      } else addCircle(x, y);
      if (!i) continue;
      const [px, py] = points[i - 1], dx = x - px, dy = y - py;
      if (!dx && !dy) continue;
      if (stroke.shape === 'square') {
        // Sweeping an axis-aligned square: join its four corresponding edges.
        const corners = [[-radius,-radius],[radius,-radius],[radius,radius],[-radius,radius]];
        for (let c = 0; c < 4; c++) {
          const a = corners[c], b = corners[(c + 1) % 4];
          addPolygon([[px+a[0],py+a[1]],[px+b[0],py+b[1]],[x+b[0],y+b[1]],[x+a[0],y+a[1]]]);
        }
      } else {
        const length = Math.hypot(dx, dy), ox = -dy * radius / length, oy = dx * radius / length;
        addPolygon([[px+ox,py+oy],[x+ox,y+oy],[x-ox,y-oy],[px-ox,py-oy]]);
      }
    }
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
  return {left, top, width, height, data:Uint8ClampedArray.from(values, value => Math.max(0, Math.min(255, Math.floor(value + .5))))};
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
