import { circleStampSpans } from './pixel-brush.mjs';

const rgbFromHex = color => [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16));
const distance = (a, b) => Math.max(...a.map((value, channel) => Math.abs(value - b[channel])));

// The original's perimeter supplies the background endpoint, before cropping,
// removal, padding, or strokes can replace it with transparent/foreground pixels.
export function detectHealingBorderColor(data, keepColor) {
  const keep = keepColor ? rgbFromHex(keepColor) : null;
  const bins = new Map();
  let visible = 0;
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = data[offset + 3];
    if (alpha < 240) continue;
    visible++;
    const color = [...data.slice(offset, offset + 3)];
    if (keep && distance(color, keep) <= 16) continue;
    const key = (color[0] >> 4) * 256 + (color[1] >> 4) * 16 + (color[2] >> 4);
    const bin = bins.get(key) ?? { weight: 0, sum: [0, 0, 0] };
    bin.weight++;
    color.forEach((value, index) => bin.sum[index] += value);
    bins.set(key, bin);
  }
  if (visible < data.length / 4 * .25 || !bins.size) return null;
  const peak = [...bins.values()].sort((a, b) => b.weight - a.weight)[0];
  const center = peak.sum.map(value => value / peak.weight);
  const group = [...bins.values()].filter(bin => distance(bin.sum.map(value => value / bin.weight), center) <= 24);
  const support = group.reduce((sum, bin) => sum + bin.weight, 0);
  if (support / visible < .55) return null;
  return { color: [0, 1, 2].map(channel => Math.round(group.reduce((sum, bin) => sum + bin.sum[channel], 0) / support)), source: 'original border' };
}

function hsv(color) {
  const [r, g, b] = color.map(value => value / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  let hue = 0;
  if (delta) {
    hue = max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    hue = (hue * 60 + 360) % 360;
  }
  return { hue, saturation: max ? delta / max : 0, value: max };
}

export function detectHealingRemoveColor(data, width, height, keepColor, brush, reference) {
  if (!reference || !brush || !Number.isFinite(brush.x) || !Number.isFinite(brush.y)
    || !Number.isFinite(brush.size) || brush.size <= 0) return null;
  const keep = keepColor ? rgbFromHex(keepColor) : null;
  const direction = keep ? keep.map((value, index) => value - reference[index]) : [0,0,0];
  const denominator = direction.reduce((sum, value) => sum + value * value, 0);
  if (keep && !denominator) return null;
  const samples = [];
  const radius = brush.size / 2;
  const hardSize = Math.max(1, Math.round(brush.size));
  const centerX = Math.min(width - 1, Math.floor(brush.x)), centerY = Math.min(height - 1, Math.floor(brush.y));
  const hardLeft = centerX - Math.floor(hardSize / 2), hardTop = centerY - Math.floor(hardSize / 2);
  const pixelBrush = brush.antiAlias === false || (brush.antiAlias === undefined && brush.feather === 0);
  const hardRows = pixelBrush && brush.shape !== 'square' ? circleStampSpans(hardSize) : null;
  for (let y = Math.max(0, Math.floor(brush.y - radius)); y < Math.min(height, Math.ceil(brush.y + radius)); y++) {
    for (let x = Math.max(0, Math.floor(brush.x - radius)); x < Math.min(width, Math.ceil(brush.x + radius)); x++) {
      const offset = (y * width + x) * 4;
      if (data[offset + 3] < 8) continue;
      const color = [...data.slice(offset, offset + 3)];
      if (keep && distance(color, keep) <= 16) continue;
      let coverage = 0;
      if (pixelBrush) {
        const row = hardRows?.[y - hardTop];
        const inside = hardRows ? row && x >= hardLeft + row.left && x < hardLeft + row.right
          : x >= hardLeft && x < hardLeft + hardSize && y >= hardTop && y < hardTop + hardSize;
        coverage = inside ? 16 : 0;
      } else {
        // Subpixel sampling respects soft round/square footprints.
        for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
          const dx = x + (sx + .5) / 4 - brush.x;
          const dy = y + (sy + .5) / 4 - brush.y;
          if (brush.shape === 'square' ? Math.abs(dx) <= radius && Math.abs(dy) <= radius : dx * dx + dy * dy <= radius * radius) coverage++;
        }
      }
      if (coverage) samples.push({ color, weight: coverage / 16 * data[offset + 3] / 255 });
    }
  }
  if (!samples.length) return null;
  if (samples.some(sample => distance(sample.color, reference) <= 12)) return { color: [...reference], source: 'background match' };
  // A darker mixed edge is not a new background. Retain the original endpoint
  // so the cleanup formula recovers foreground opacity instead of erasing it.
  const tolerance = Math.min(48, Math.max(8, Number(brush.tolerance) || 0));
  if (keep && samples.some(({ color }) => {
    const alpha = color.reduce((sum, value, channel) => sum + (value - reference[channel]) * direction[channel], 0) / denominator;
    return alpha >= 0 && alpha < .99 && distance(color, reference.map((value, channel) => value + alpha * direction[channel])) <= tolerance;
  })) return { color: [...reference], source: 'background mixture' };
  // For colors outside that mixture, prefer the original color family before
  // brightness. This handles changed illumination without choosing a bright
  // foreground detail of an unrelated hue.
  const base = hsv(reference);
  const candidates = samples.map(sample => {
    const value = hsv(sample.color);
    const hueDifference = Math.min(Math.abs(base.hue - value.hue), 360 - Math.abs(base.hue - value.hue));
    const related = base.saturation < .12 ? value.saturation < .18 : value.saturation >= .12 && hueDifference <= 30;
    return { ...sample, related, score: base.saturation < .12 ? Math.abs(base.value - value.value)
      : hueDifference / 30 + Math.abs(base.saturation - value.saturation) * .5 + Math.abs(base.value - value.value) * .25 };
  }).filter(sample => sample.related).sort((a, b) => a.score - b.score || b.weight - a.weight);
  return candidates.length ? { color: keep ? candidates[0].color : [...reference], source: keep ? 'nearest background shade' : 'background color family' } : null;
}

// Solve C = alpha * keep + (1 - alpha) * remove in RGB space.
// Projection finds the closest mixture; tolerance rejects unrelated colors.
export function healPixelData(data, mask, stroke, area = {width:data.length / 4, height:1}) {
  if (stroke.autoKeep === true) return healAutoPixelData(data, mask, stroke, area);
  const parse = color => [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16));
  const keep = parse(stroke.color);
  const remove = parse(stroke.backgroundColor);
  const direction = keep.map((channel, index) => channel - remove[index]);
  const denominator = direction.reduce((sum, channel) => sum + channel * channel, 0);
  if (!denominator) throw new Error("Color Cleanup Keep color and Remove color must be different.");
  for (let offset = 0; offset < data.length; offset += 4) {
    const coverage = mask[offset + 3] / 255 * stroke.opacity;
    const oldAlpha = data[offset + 3];
    if (!coverage || !oldAlpha) continue;
    let numerator = 0;
    for (let channel = 0; channel < 3; channel++) numerator += (data[offset + channel] - remove[channel]) * direction[channel];
    const alpha = Math.max(0, Math.min(1, numerator / denominator));
    let error = 0;
    for (let channel = 0; channel < 3; channel++) error = Math.max(error, Math.abs(data[offset + channel] - (remove[channel] + alpha * direction[channel])));
    if (error > stroke.tolerance) continue;
    const remaining = 1 - coverage + coverage * alpha;
    for (let channel = 0; channel < 3; channel++) {
      // Interpolate premultiplied colors when feather or strength is partial.
      data[offset + channel] = remaining ? Math.round((data[offset + channel] * (1 - coverage) + keep[channel] * coverage * alpha) / remaining) : keep[channel];
    }
    data[offset + 3] = Math.round(oldAlpha * remaining);
  }
}

// Nearest clean samples propagate only through visible pixels. The source is
// frozen for the entire stroke evaluation, so one repaired strand cannot seed another.
export function autoKeepField(data, width, height, remove, sampleDistance, tolerance = 24) {
  const count = width * height, owners = new Int32Array(count).fill(-1);
  const distances = new Uint16Array(count), queue = [];
  const contrast = new Uint8Array(count);
  const base = hsv(remove);
  let head = 0;
  const matches = (pixel, donor) => {
    let denominator = 0, numerator = 0;
    for (let c = 0; c < 3; c++) {
      const direction = data[donor*4+c]-remove[c];
      denominator += direction*direction;
      numerator += (data[pixel*4+c]-remove[c])*direction;
    }
    if (!denominator) return false;
    const alpha = numerator/denominator;
    if (alpha < 0 || alpha >= .995) return false;
    for (let c = 0; c < 3; c++) if (Math.abs(data[pixel*4+c]-(remove[c]+alpha*(data[donor*4+c]-remove[c]))) > Math.max(8, Math.min(32,tolerance))) return false;
    return true;
  };
  for (let i = 0; i < count; i++) {
    const offset = i * 4;
    contrast[i] = Math.max(Math.abs(data[offset]-remove[0]), Math.abs(data[offset+1]-remove[1]), Math.abs(data[offset+2]-remove[2]));
  }
  for (let i = 0; i < count; i++) {
    if (data[i*4+3] < 191 || contrast[i] < 24) continue;
    const color = hsv([data[i*4], data[i*4+1], data[i*4+2]]);
    const hueDifference = Math.min(Math.abs(base.hue-color.hue), 360-Math.abs(base.hue-color.hue));
    if (base.saturation >= .12 && color.saturation >= .12 && hueDifference <= 30) continue;
    const x = i % width, y = Math.floor(i / width);
    let peak = true;
    for (let dy = -1; dy <= 1 && peak; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (x+dx < 0 || x+dx >= width || y+dy < 0 || y+dy >= height) continue;
      const other = (y+dy)*width+x+dx;
      if (data[other*4+3] >= 191 && contrast[other] > contrast[i]+8) {
        const direction = [0,1,2].map(channel => data[other*4+channel]-remove[channel]);
        const denominator = direction.reduce((sum,value) => sum+value*value,0);
        const alpha = direction.reduce((sum,value,channel) => sum+(data[i*4+channel]-remove[channel])*value,0)/denominator;
        if (alpha >= 0 && alpha < 1 && Math.max(...direction.map((value,channel) => Math.abs(data[i*4+channel]-(remove[channel]+alpha*value)))) <= 8) {
          peak = false; break;
        }
      }
    }
    if (peak) { owners[i] = i; queue.push(i); }
  }
  while (head < queue.length) {
    const i = queue[head++];
    if (distances[i] >= sampleDistance) continue;
    const x = i % width, y = Math.floor(i / width);
    for (const other of [x ? i-1 : -1, x+1 < width ? i+1 : -1, y ? i-width : -1, y+1 < height ? i+width : -1]) {
      if (other < 0 || !data[other*4+3] || owners[other] === owners[i]) continue;
      if (owners[other] !== -1 && !(contrast[owners[i]] > contrast[owners[other]]+8 && matches(other,owners[i]))) continue;
      if (owners[other] === -1 && !matches(other,owners[i])) continue;
      owners[other] = owners[i]; distances[other] = distances[i]+1; queue.push(other);
    }
  }
  return owners;
}

function healAutoPixelData(data, mask, stroke, area) {
  const remove = rgbFromHex(stroke.backgroundColor);
  const reference = area.reference ?? {data:new Uint8ClampedArray(data), width:area.width, height:area.height, left:0, top:0};
  const owners = autoKeepField(reference.data, reference.width, reference.height, remove, stroke.sampleDistance ?? 24, stroke.tolerance);
  for (let offset = 0; offset < data.length; offset += 4) {
    const strength = mask[offset+3] / 255 * stroke.opacity;
    if (!strength || !data[offset+3]) continue;
    const i = offset / 4;
    const source = (Math.floor(i / area.width) + reference.top)*reference.width + i%area.width + reference.left;
    const donor = owners[source];
    let alpha = 0, keep = remove;
    if (distance([data[offset],data[offset+1],data[offset+2]], remove) > Math.min(8, stroke.tolerance)) {
      if (donor < 0) continue;
      keep = [reference.data[donor*4],reference.data[donor*4+1],reference.data[donor*4+2]];
      const direction = keep.map((value, channel) => value-remove[channel]);
      const denominator = direction.reduce((sum,value) => sum+value*value,0);
      if (!denominator) continue;
      alpha = Math.max(0,Math.min(1, direction.reduce((sum,value,channel) => sum+(data[offset+channel]-remove[channel])*value,0)/denominator));
      let error = 0;
      for (let channel = 0; channel < 3; channel++) error = Math.max(error,Math.abs(data[offset+channel]-(remove[channel]+alpha*direction[channel])));
      if (error > stroke.tolerance || alpha >= .995) continue;
    }
    const coverage = stroke.recoverTransparency === false && alpha > 0 ? 1 : alpha;
    const remaining = 1-strength+strength*coverage;
    for (let channel = 0; channel < 3; channel++) data[offset+channel] = remaining
      ? Math.round((data[offset+channel]*(1-strength)+keep[channel]*strength*coverage)/remaining) : keep[channel];
    data[offset+3] = Math.round(data[offset+3]*remaining);
  }
}
