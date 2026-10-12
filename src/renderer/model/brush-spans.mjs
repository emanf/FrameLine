/** Shared eight-by-eight scan conversion for complete and incremental smooth brush masks. */
export const BRUSH_SAMPLE_SCALE = 8;

/** Emit covered subpixel row intervals, clipped to an integer image-space region. */
export function scanSmoothBrush(stroke,imageWidth,imageHeight,region,emit) {
  const {left,top,right,bottom}=region,width=right-left,height=bottom-top,SCALE=BRUSH_SAMPLE_SCALE;
  const addSpan=(row,start,end)=>{
    const a=Math.max(0,Math.ceil((start-left)*SCALE-.5));
    const b=Math.min(width*SCALE,Math.ceil((end-left)*SCALE-.5));
    if(a<b) emit(row+top*SCALE,a+left*SCALE,b+left*SCALE);
  };
  const points=stroke.points.map(([x,y])=>[x*imageWidth,y*imageHeight]);
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
}
