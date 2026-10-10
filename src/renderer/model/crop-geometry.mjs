const FULL_CROP = { left: 0, top: 0, right: 1, bottom: 1 };

// Normalized coordinates can land just beside an integer through floating point arithmetic.
function pixelEdge(value) {
  const nearest = Math.round(value);
  return Math.abs(value - nearest) < 1e-7 ? nearest : value;
}

export function cropPixelRect(width, height, crop = FULL_CROP) {
  const x = Math.floor(pixelEdge(crop.left * width));
  const y = Math.floor(pixelEdge(crop.top * height));
  return {
    x, y,
    width: Math.ceil(pixelEdge(crop.right * width)) - x,
    height: Math.ceil(pixelEdge(crop.bottom * height)) - y,
  };
}

export function cropFromPixelRect(width, height, rect) {
  const clamp = (value, min, max) => Math.max(min, Math.min(max, Math.round(value)));
  const x = clamp(rect.x, 0, width - 1);
  const y = clamp(rect.y, 0, height - 1);
  const cropWidth = clamp(rect.width, 1, width - x);
  const cropHeight = clamp(rect.height, 1, height - y);
  return { left: x / width, top: y / height, right: (x + cropWidth) / width, bottom: (y + cropHeight) / height };
}
