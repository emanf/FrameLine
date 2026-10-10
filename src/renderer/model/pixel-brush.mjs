// Filled integer ellipse: odd and even diameters stay symmetric and occupy
// exactly the requested number of pixels. No partially covered edge pixels.
export function circleStampSpans(diameter) {
  if (!Number.isFinite(diameter)) throw new Error('Brush size must be finite.');
  const size = Math.max(1, Math.round(diameter));
  const rows = new Map();
  const span = (left, right, y) => {
    if (y < 0 || y >= size || left > right) return;
    const previous = rows.get(y);
    rows.set(y, [Math.min(left, previous?.[0] ?? left), Math.max(right, previous?.[1] ?? right)]);
  };
  let x0 = 0, x1 = size - 1;
  const a = size - 1, b = size - 1, odd = b % 2;
  let y0 = Math.floor((b + 1) / 2), y1 = y0 - odd;
  let dx = 4 * (1 - a) * b * b;
  let dy = 4 * (odd + 1) * a * a;
  let error = dx + dy + odd * a * a;
  const stepY = 8 * a * a, stepX = 8 * b * b;
  do {
    span(x0, x1, y0); span(x0, x1, y1);
    const twice = 2 * error;
    if (twice <= dy) { y0++; y1--; dy += stepY; error += dy; }
    if (twice >= dx || 2 * error > dy) { x0++; x1--; dx += stepX; error += dx; }
  } while (x0 <= x1);
  while (y0 - y1 < b) {
    span(x0 - 1, x1 + 1, y0++); span(x0 - 1, x1 + 1, y1--);
  }
  return [...rows].sort((a, b) => a[0] - b[0]).map(([y, [left, right]]) => ({ y, left, right: right + 1 }));
}

export function pixelRoundStrokeSpans(stroke, width, height, region = {left:0, top:0, right:width, bottom:height}) {
  const size = Math.max(1, Math.round(stroke.size));
  if (size >= 2 * Math.hypot(width, height) + 2 && stroke.points.length) {
    return Array.from({length:height}, (_, y) => ({y,left:0,right:width}));
  }
  const stamp = stroke.shape === 'square'
    ? Array.from({length:size}, (_, y) => ({y, left:0, right:size}))
    : circleStampSpans(size);
  const offset = Math.floor(size / 2);
  const rows = new Map();
  const add = (x, y) => {
    for (const span of stamp) {
      const row = y - offset + span.y;
      const left = Math.max(region.left, x - offset + span.left);
      const right = Math.min(region.right, x - offset + span.right);
      if (row < region.top || row >= region.bottom || left >= right) continue;
      const intervals = rows.get(row) ?? [];
      const last = intervals.at(-1);
      if (last && left <= last[1] && right >= last[0]) {
        last[0] = Math.min(last[0], left); last[1] = Math.max(last[1], right);
      } else intervals.push([left, right]);
      rows.set(row, intervals);
    }
  };
  const points = stroke.points.map(([x, y]) => [Math.min(width - 1, Math.floor(x * width)), Math.min(height - 1, Math.floor(y * height))]);
  points.forEach((point, index) => {
    const previous = points[index - 1] ?? point;
    if (Math.max(point[0],previous[0]) + size < region.left || Math.min(point[0],previous[0]) - size >= region.right
      || Math.max(point[1],previous[1]) + size < region.top || Math.min(point[1],previous[1]) - size >= region.bottom) return;
    const steps = Math.max(Math.abs(point[0] - previous[0]), Math.abs(point[1] - previous[1]), 1);
    for (let step = index ? 1 : 0; step <= steps; step++) {
      add(Math.round(previous[0] + (point[0] - previous[0]) * step / steps), Math.round(previous[1] + (point[1] - previous[1]) * step / steps));
    }
  });
  const result = [];
  for (const [y, intervals] of rows) {
    intervals.sort((a, b) => a[0] - b[0]);
    let current = null;
    for (const [left, right] of intervals) {
      if (current && left <= current.right) current.right = Math.max(current.right, right);
      else { current = { y, left, right }; result.push(current); }
    }
  }
  return result;
}
