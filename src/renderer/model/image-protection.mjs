import {cropPixelRect} from './crop-geometry.mjs';

/** Describe the translation from stored image pixels to their materialized crop/outline. */
export function workingGeometry(image) {
  const crop = cropPixelRect(image.width,image.height,image.crop);
  const outline = image.outline;
  const padding = !outline || outline.position === 'inside' ? 0
    : (outline.position === 'outside' ? outline.size : Math.ceil(outline.size/2))+Math.ceil((outline.softness ?? 0)*3);
  return {width:crop.width+padding*2,height:crop.height+padding*2,x:padding-crop.x,y:padding-crop.y};
}

/** Keep normalized mask points attached to the same source pixels after a canvas translation. */
export function translateIgnoreStrokes(strokes,from,to,x=0,y=0) {
  return (strokes ?? []).map(stroke => ({...stroke,points:stroke.points.map(([px,py]) => [
    Math.max(0,Math.min(1,(px*from.width+x)/to.width)),
    Math.max(0,Math.min(1,(py*from.height+y)/to.height))])}));
}

/** Obtain the active protection mask in the materialized image's coordinate system. */
export function workingIgnoreStrokes(image) {
  if (image.ignoreEnabled === false || !image.ignoreStrokes?.length) return undefined;
  const geometry = workingGeometry(image);
  return translateIgnoreStrokes(image.ignoreStrokes,image,geometry,geometry.x,geometry.y);
}

/** Locate the immutable original in the current canvas, including older centered expansions. */
export function originalOffset(image,originalDimensions) {
  return image.originalOffset ?? {x:Math.floor((image.width-originalDimensions.width)/2),y:Math.floor((image.height-originalDimensions.height)/2)};
}

/** Expand a proposed crop enough to retain every protected brush footprint. */
export function protectedCrop(image,crop) {
  if (!crop || image.ignoreEnabled === false || !image.ignoreStrokes?.length) return crop;
  const result = {...crop};
  for (const stroke of image.ignoreStrokes) for (const [x,y] of stroke.points) {
    const radius = Math.ceil(stroke.size/2)+1;
    result.left = Math.min(result.left,Math.max(0,x-radius/image.width));
    result.top = Math.min(result.top,Math.max(0,y-radius/image.height));
    result.right = Math.max(result.right,Math.min(1,x+radius/image.width));
    result.bottom = Math.max(result.bottom,Math.min(1,y+radius/image.height));
  }
  return result;
}
