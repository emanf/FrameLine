/** Map a screen position into the image, snapping pixel brushes to stable pixel centers. */
export function brushImagePoint(clientX, clientY, bounds, width, height, pixel = false) {
  const point = [Math.max(0,Math.min(1,(clientX-bounds.left)/bounds.width)),
    Math.max(0,Math.min(1,(clientY-bounds.top)/bounds.height))];
  return pixel ? point.map((value,index) => {
    const length = index ? height : width;
    return (pixelIndex(value,length)+.5)/length;
  }) : point;
}

/** Resolve exact pixel boundaries without letting floating-point scaling select a neighbor. */
function pixelIndex(normalized, length) {
  const position = normalized*length, nearest = Math.round(position);
  return Math.max(0,Math.min(length-1,Math.floor(Math.abs(position-nearest) < 1e-7 ? nearest : position)));
}

/** Return the cursor's core footprint in image pixels, matching odd/even raster stamp placement. */
export function brushFootprint(point, size, width, height, pixel) {
  const diameter = pixel ? Math.max(1,Math.round(size)) : size;
  const left = pixel ? pixelIndex(point[0],width)-Math.floor(diameter/2) : point[0]*width-diameter/2;
  const top = pixel ? pixelIndex(point[1],height)-Math.floor(diameter/2) : point[1]*height-diameter/2;
  return {left,top,width:diameter,height:diameter};
}
