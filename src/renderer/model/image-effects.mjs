import {workingIgnoreStrokes,translateIgnoreStrokes,originalOffset} from './image-protection.mjs';

/** Keep edits, protection, and original pixels aligned when an effect translates the canvas. */
export function rebaseImageEdits(image, width, height, translation) {
  const dx = translation?.x ?? Math.floor((width - image.width) / 2);
  const dy = translation?.y ?? Math.floor((height - image.height) / 2);
  const original=originalImage(image),offset=originalOffset(image,original.dimensions);
  if(image.ignoreStrokes?.length) image.ignoreStrokes=translateIgnoreStrokes(image.ignoreStrokes,image,{width,height},dx,dy);
  image.originalOffset={x:offset.x+dx,y:offset.y+dy};
  const clamp = (value) => Math.max(0, Math.min(1, value));
  for (const stroke of image.paintStrokes ?? []) {
    if(stroke.ignoreStrokes) stroke.ignoreStrokes=translateIgnoreStrokes(stroke.ignoreStrokes,image,{width,height},dx,dy);
    stroke.points = stroke.points.map(([x, y]) => [
      clamp((x * image.width + dx) / width),
      clamp((y * image.height + dy) / height)
    ]);
  }
  if (image.crop) {
    const crop = image.crop;
    const left = clamp((crop.left * image.width + dx) / width);
    const top = clamp((crop.top * image.height + dy) / height);
    const right = clamp((crop.right * image.width + dx) / width);
    const bottom = clamp((crop.bottom * image.height + dy) / height);
    // A crop entirely within removed padding resolves to the closest pixel.
    image.crop = {
      left: Math.min(left, 1 - 1 / width),
      top: Math.min(top, 1 - 1 / height),
      right: Math.max(right, Math.min(left, 1 - 1 / width) + 1 / width),
      bottom: Math.max(bottom, Math.min(top, 1 - 1 / height) + 1 / height)
    };
  }
  image.width = width;
  image.height = height;
}

export function originalImage(image) {
  // Older projects did not store an immutable original. In their known baked
  // outline -> background sequence, sourcePath points into image-outlines.
  const outlinedSource = image.outlineSourcePath && /[\\/]image-outlines[\\/]/i.test(image.sourcePath ?? "");
  return {
    path: image.originalPath ?? (outlinedSource ? image.outlineSourcePath : image.sourcePath)
      ?? image.outlineSourcePath ?? image.path,
    dimensions: image.originalDimensions ?? image.outlineSourceDimensions
      ?? { width: image.width, height: image.height }
  };
}

export function preserveOriginal(image) {
  const original = originalImage(image);
  image.originalPath ??= original.path;
  image.originalDimensions ??= { ...original.dimensions };
}

export function workingImageRequest(image) {
  return {
    path: image.path,
    paint_strokes: image.paintStrokes ?? [],
    crop: image.crop,
    outline: image.outline,
    effect_ignore:workingIgnoreStrokes(image)
  };
}

export function clearPendingEffects(image) {
  for (const key of ["paintStrokes", "crop", "outline", "outlineSourcePath", "outlineSourceDimensions", "outlineSettings"]) {
    delete image[key];
  }
}

export function hasImageEdits(image) {
  if (!image) return false;
  const original = originalImage(image);
  return Boolean(image.ignoreStrokes?.length || image.sourcePath || image.paintStrokes?.length || image.crop || image.outline || image.outlineSourcePath
    || image.path !== original.path || image.width !== original.dimensions.width || image.height !== original.dimensions.height);
}

