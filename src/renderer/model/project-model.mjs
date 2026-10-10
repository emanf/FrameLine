export const DEFAULT_FPS = 24;
export const DEFAULT_DURATION = 24;

export function createProject() {
  return {
    version: 1,
    name: "Untitled project",
    fps: DEFAULT_FPS,
    defaultDurationFrames: DEFAULT_DURATION,
    playbackSpeed: 1,
    loopEnabled: true,
    loopStartFrame: 0,
    loopEndFrame: null,
    currentFrame: 0,
    images: [],
    clips: []
  };
}

export function totalFrames(project) {
  return project.clips.reduce((sum, clip) => sum + clip.durationFrames, 0);
}

// End is an exclusive frame boundary; null follows the end of the timeline.
export function loopRange(project, frames = totalFrames(project)) {
  if (!frames) return { startFrame: 0, endFrame: 0 };
  const startFrame = Math.max(0, Math.min(frames - 1, project.loopStartFrame ?? 0));
  const endFrame = Math.max(startFrame + 1, Math.min(frames, project.loopEndFrame ?? frames));
  return { startFrame, endFrame };
}

export function clipRanges(project) {
  let start = 0;
  return project.clips.map((clip) => {
    const range = { clip, startFrame: start, endFrame: start + clip.durationFrames };
    start = range.endFrame;
    return range;
  });
}

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0;
const color = (value) => typeof value === "string" && /^#[a-f\d]{6}$/i.test(value);
const between = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;

export function validateCrop(crop) {
  if (crop == null) return;
  if (!object(crop) || !between(crop.left, 0, 1) || !between(crop.top, 0, 1)
    || !between(crop.right, 0, 1) || !between(crop.bottom, 0, 1)
    || crop.left >= crop.right || crop.top >= crop.bottom) {
    throw new Error("Crop bounds must be normalized and have positive width and height.");
  }
}

export function validateOutline(outline) {
  if (outline == null) return;
  if (!object(outline) || !positiveInteger(outline.size) || outline.size > 100
    || !["inside", "center", "outside"].includes(outline.position ?? "center")
    || !between(outline.softness ?? 0, 0, 20) || !between(outline.opacity ?? 1, 0, 1)
    || !color(outline.color ?? "#ffffff")) {
    throw new Error("Project contains invalid outline settings.");
  }
}

export function validateStroke(stroke) {
  if (!object(stroke) || !["brush", "eraser", "healing"].includes(stroke.tool)
    || !Number.isFinite(stroke.size) || stroke.size <= 0
    || !["round", "square"].includes(stroke.shape ?? "round")
    || !Number.isInteger(stroke.feather ?? 0) || !between(stroke.feather ?? 0, 0, 100)
    || (stroke.antiAlias !== undefined && typeof stroke.antiAlias !== 'boolean')
    || !Array.isArray(stroke.points) || !stroke.points.length
    || stroke.points.some((point) => !Array.isArray(point) || point.length !== 2
      || !point.every((value) => between(value, 0, 1)))
    || (["brush", "healing"].includes(stroke.tool) && (!color(stroke.color) || !between(stroke.opacity, 0, 1)))
    || (stroke.tool === "healing" && (!color(stroke.backgroundColor)
      || (stroke.autoKeep !== true && stroke.color.toLowerCase() === stroke.backgroundColor.toLowerCase())
      || (stroke.autoKeep !== undefined && typeof stroke.autoKeep !== 'boolean')
      || (stroke.recoverTransparency !== undefined && typeof stroke.recoverTransparency !== 'boolean')
      || (stroke.sampleDistance !== undefined && (!Number.isInteger(stroke.sampleDistance) || !between(stroke.sampleDistance, 1, 128)))
      || !Number.isInteger(stroke.tolerance) || !between(stroke.tolerance, 0, 255)))) {
    throw new Error("Project contains an invalid paint stroke.");
  }
}

function validateDimensions(dimensions) {
  if (!object(dimensions) || !positiveInteger(dimensions.width) || !positiveInteger(dimensions.height)) {
    throw new Error("Source image dimensions must be positive whole numbers.");
  }
}

export function validateProject(candidate) {
  if (!candidate || candidate.version !== 1 || !Array.isArray(candidate.images) || !Array.isArray(candidate.clips)) {
    throw new Error("This file is not a supported FrameLine project.");
  }
  if (!Number.isFinite(candidate.fps) || candidate.fps <= 0 || candidate.fps > 240) {
    throw new Error("Project FPS must be greater than zero and no more than 240.");
  }
  if (!Number.isSafeInteger(candidate.currentFrame) || candidate.currentFrame < 0) {
    throw new Error("Project current frame must be a non-negative whole number.");
  }
  if (!positiveInteger(candidate.defaultDurationFrames)) {
    throw new Error("Project default duration must be a positive whole number of frames.");
  }
  if (candidate.name !== undefined && typeof candidate.name !== "string") throw new Error("Invalid project name.");
  if (candidate.playbackSpeed !== undefined && (!Number.isFinite(candidate.playbackSpeed)
    || candidate.playbackSpeed <= 0 || candidate.playbackSpeed > 16)) {
    throw new Error("Playback speed must be greater than zero and no more than 16×.");
  }
  if (candidate.loopEnabled !== undefined && typeof candidate.loopEnabled !== "boolean") throw new Error("Invalid project loop setting.");
  const imageIds = new Set();
  for (const image of candidate.images) {
    if (!object(image) || typeof image.id !== "string" || !image.id || imageIds.has(image.id)
      || typeof image.path !== "string" || !image.path || typeof image.name !== "string") {
      throw new Error("Project contains an invalid or duplicate source image.");
    }
    validateDimensions(image);
    for (const key of ["sourcePath", "outlineSourcePath", "originalPath"]) {
      if (image[key] !== undefined && (typeof image[key] !== "string" || !image[key])) throw new Error("Invalid original image path.");
    }
    for (const key of ["outlineSourceDimensions", "originalDimensions"]) {
      if (image[key] !== undefined) validateDimensions(image[key]);
    }
    if (image.paintStrokes !== undefined) {
      if (!Array.isArray(image.paintStrokes)) throw new Error("Project contains invalid paint strokes.");
      image.paintStrokes.forEach(validateStroke);
    }
    validateCrop(image.crop);
    validateOutline(image.outline);
    validateOutline(image.outlineSettings);
    imageIds.add(image.id);
  }
  const clipIds = new Set();
  for (const clip of candidate.clips) {
    if (!object(clip) || typeof clip.id !== "string" || !clip.id || clipIds.has(clip.id) || !imageIds.has(clip.imageId)) {
      throw new Error("Project contains an invalid timeline clip.");
    }
    if (!positiveInteger(clip.durationFrames)) {
      throw new Error("Timeline clip durations must be positive whole numbers of frames.");
    }
    clipIds.add(clip.id);
  }
  if (!Number.isSafeInteger(totalFrames(candidate))) throw new Error("Project timeline is too long.");
  const frames = totalFrames(candidate);
  const start = candidate.loopStartFrame ?? 0;
  const end = candidate.loopEndFrame ?? frames;
  if ((candidate.loopStartFrame !== undefined && !Number.isSafeInteger(candidate.loopStartFrame))
    || start < 0 || start > Math.max(0, frames - 1)
    || (candidate.loopEndFrame != null && (!Number.isSafeInteger(candidate.loopEndFrame) || end <= start || end > frames))) {
    throw new Error("Loop bounds must be whole frames within the timeline, with End after Start.");
  }
  return candidate;
}
