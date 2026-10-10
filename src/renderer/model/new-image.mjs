export const IMAGE_SIZE_PRESETS = [
  { label: "Square · 256 × 256", width: 256, height: 256 },
  { label: "Square · 512 × 512", width: 512, height: 512 },
  { label: "Square · 1024 × 1024", width: 1024, height: 1024 },
  { label: "Standard · 640 × 480", width: 640, height: 480 },
  { label: "HD · 1280 × 720", width: 1280, height: 720 },
  { label: "Full HD · 1920 × 1080", width: 1920, height: 1080 },
  { label: "Portrait · 1080 × 1920", width: 1080, height: 1920 },
  { label: "4K · 3840 × 2160", width: 3840, height: 2160 }
];

export function validateNewImageOptions({ width, height, count, transparent, color }) {
  width = Number(width);
  height = Number(height);
  count = Number(count);
  if (![width, height].every(value => Number.isInteger(value) && value >= 1 && value <= 8192)) {
    throw new Error("Width and height must be whole numbers from 1 to 8192 pixels.");
  }
  if (width * height > 32_000_000) throw new Error("Each image can contain up to 32 million pixels. Reduce its width or height.");
  if (!Number.isInteger(count) || count < 1 || count > 1000) throw new Error("Image count must be a whole number from 1 to 1000.");
  if (width * height * count > 256_000_000) throw new Error("This batch is too large. Reduce the image count or dimensions (up to 256 million pixels per batch).");
  if (!/^#[a-f\d]{6}$/i.test(color)) throw new Error("Choose a valid background color.");
  return { width, height, count, transparent: Boolean(transparent), color: color.toLowerCase() };
}

export function cornerBackground(samples) {
  // Require three agreeing opaque corners. A foreground detail in one corner
  // must not turn a common background into a blend of unrelated colors.
  const opaque = samples.filter(sample => sample[3] >= 240);
  let best = [];
  for (const sample of opaque) {
    const group = opaque.filter(other => sample.slice(0, 3).every((value, channel) => Math.abs(value - other[channel]) <= 24));
    if (group.length > best.length) best = group;
  }
  if (best.length < 3) return { transparent: true, color: "#ffffff", detected: false };
  const rgb = [0, 1, 2].map(channel => Math.round(best.reduce((sum, sample) => sum + sample[channel], 0) / best.length));
  return { transparent: false, color: `#${rgb.map(value => value.toString(16).padStart(2, "0")).join("")}`, detected: true };
}
