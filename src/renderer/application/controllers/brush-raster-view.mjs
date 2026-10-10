import { ControllerBase } from '../controller-base.mjs';
import { healPixelData } from '../../model/healing-brush.mjs';
import { brushMask } from '../../model/brush-mask.mjs';
import { pixelRoundStrokeSpans } from '../../model/pixel-brush.mjs';

/** Render incremental brush masks and color cleanup strokes into preview canvases. */
export class BrushRasterView extends ControllerBase {
  /** Blend cleanup corrections into covered pixels using foreground/background mixture recovery. */
  applyHealingPixels(context, pixels, mask, stroke, left, top) {
    const runtime = this.application;
    if (!stroke.autoKeep) return healPixelData(pixels.data, mask.data, stroke);
    // Live regional redraws contain parts of the current stroke. Sample its
    // immutable completed base so dragging cannot use its own repaired pixels.
    const referenceContext = runtime.previewPaintStroke?.stroke === stroke && runtime.paintRasterCache ? runtime.paintRasterCache.context : context;
    const padding = (stroke.sampleDistance ?? 24) + 1;
    const x = Math.max(0, left-padding), y = Math.max(0, top-padding);
    const right = Math.min(context.canvas.width, left+pixels.width+padding);
    const bottom = Math.min(context.canvas.height, top+pixels.height+padding);
    const reference = referenceContext.getImageData(x, y, right-x, bottom-y);
    healPixelData(pixels.data, mask.data, stroke, {width:pixels.width, height:pixels.height,
      reference:{data:reference.data, width:reference.width, height:reference.height, left:left-x, top:top-y}});
  }

  /** Rasterize a stroke mask and blend the selected painting operation. */
  drawPaintStroke(context, stroke, width, height, region = null) {
    const runtime = this.application;
    if (!stroke.points.length) return;
    if (typeof stroke.antiAlias === 'boolean') {
      const mask = brushMask(stroke, width, height, region);
      if (!mask.width || !mask.height) return;
      const layer = document.createElement('canvas');
      layer.width = mask.width; layer.height = mask.height;
      const layerContext = layer.getContext('2d');
      const pixels = layerContext.createImageData(mask.width, mask.height);
      const color = stroke.tool === 'eraser' ? [255,255,255]
        : [1,3,5].map(index => parseInt(stroke.color.slice(index,index+2),16));
      for (let i = 0; i < mask.data.length; i++) {
        pixels.data.set(color, i*4);
        pixels.data[i*4+3] = stroke.tool === 'brush' ? Math.floor(mask.data[i]*stroke.opacity+.5) : mask.data[i];
      }
      if (stroke.tool === 'healing') {
        const source = context.getImageData(mask.left, mask.top, mask.width, mask.height);
        runtime.applyHealingPixels(context, source, pixels, stroke, mask.left, mask.top);
        if (region) context.putImageData(source, mask.left, mask.top, region.left-mask.left, region.top-mask.top,
          region.right-region.left, region.bottom-region.top);
        else context.putImageData(source, mask.left, mask.top);
      } else {
        layerContext.putImageData(pixels, 0, 0);
        context.save();
        if (region) {
          context.beginPath(); context.rect(region.left, region.top, region.right-region.left, region.bottom-region.top);
          context.clip();
        }
        context.globalAlpha = 1; context.filter = 'none';
        context.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
        context.drawImage(layer, mask.left, mask.top);
        context.restore();
      }
      return;
    }
  
    if (stroke.tool === "healing") {
      let left = width, top = height, right = 0, bottom = 0;
      const padding = stroke.size / 2 + stroke.size * (stroke.feather ?? 0) / 100 * 3 + 2;
      for (const [x, y] of stroke.points) {
        left = Math.min(left, x * width - padding); top = Math.min(top, y * height - padding);
        right = Math.max(right, x * width + padding); bottom = Math.max(bottom, y * height + padding);
      }
      left = Math.max(0, Math.floor(left)); top = Math.max(0, Math.floor(top));
      right = Math.min(width, Math.ceil(right)); bottom = Math.min(height, Math.ceil(bottom));
      if (right <= left || bottom <= top) return;
      const maskCanvas = document.createElement("canvas");
      maskCanvas.width = right - left; maskCanvas.height = bottom - top;
      const maskContext = maskCanvas.getContext("2d");
      maskContext.translate(-left, -top);
      runtime.drawPaintStroke(maskContext, { ...stroke, tool: "brush", color: "#ffffff", opacity: 1 }, width, height);
      const pixels = context.getImageData(left, top, maskCanvas.width, maskCanvas.height);
      const mask = maskContext.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
      runtime.applyHealingPixels(context, pixels, mask, stroke, left, top);
      context.putImageData(pixels, left, top);
      return;
    }
    context.save();
    context.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
    context.globalAlpha = stroke.tool === "eraser" ? 1 : stroke.opacity;
    context.filter = stroke.feather ? `blur(${stroke.size * stroke.feather / 100}px)` : "none";
    context.strokeStyle = stroke.color;
    context.fillStyle = stroke.color;
    if (stroke.shape !== 'square' && !stroke.feather) {
      context.globalAlpha = stroke.tool === 'eraser' ? 1 : Math.round(stroke.opacity * 255) / 255;
      context.beginPath();
      for (const {y, left, right} of pixelRoundStrokeSpans(stroke, width, height)) context.rect(left, y, right - left, 1);
      // Fill the union once, so overlapping stamps do not accumulate opacity.
      context.fill();
      context.restore();
      return;
    }
    if (stroke.shape === "square" && !stroke.feather) {
      const pixelWidth = Math.max(1, Math.round(stroke.size));
      const points = stroke.points.map(([x, y]) => [
        Math.min(width - 1, Math.floor(x * width)),
        Math.min(height - 1, Math.floor(y * height))
      ]);
      const pixelPoints = [];
      for (const [index, point] of points.entries()) {
        const previous = points[index - 1] ?? point;
        const steps = Math.max(Math.abs(point[0] - previous[0]), Math.abs(point[1] - previous[1]), 1);
        for (let step = index === 0 ? 0 : 1; step <= steps; step++) {
          const x = Math.round(previous[0] + (point[0] - previous[0]) * step / steps);
          const y = Math.round(previous[1] + (point[1] - previous[1]) * step / steps);
          pixelPoints.push([x, y]);
        }
      }
      const offset = Math.floor(pixelWidth / 2);
      for (const [x, y] of pixelPoints) {
        context.fillRect(x - offset, y - offset, pixelWidth, pixelWidth);
      }
      context.restore();
      return;
    }
    context.lineWidth = stroke.size;
    context.lineCap = stroke.shape === "square" ? "square" : "round";
    context.lineJoin = stroke.shape === "square" ? "bevel" : "round";
    const first = stroke.points[0];
    context.beginPath();
    context.moveTo(first[0] * width, first[1] * height);
    for (const point of stroke.points.slice(1)) context.lineTo(point[0] * width, point[1] * height);
    if (stroke.points.length === 1) {
      if (stroke.shape === "square") {
        context.fillRect(first[0] * width - stroke.size / 2, first[1] * height - stroke.size / 2, stroke.size, stroke.size);
      } else {
        context.arc(first[0] * width, first[1] * height, stroke.size / 2, 0, Math.PI * 2);
        context.fill();
      }
    } else {
      context.stroke();
    }
    context.restore();
  }

  /** Reuse the rasterized completed strokes until their source or stroke list changes. */
  completedPaintRaster(image, strokes, erasesImage) {
    const runtime = this.application;
    const decoded = runtime.view.getDecodedPreviewImage(image.path);
    const element = document.querySelector('#preview-image');
    const source = decoded ?? (element.src === runtime.localImageUrl(image.path) && element.complete && element.naturalWidth ? element : null);
    const cache = runtime.paintRasterCache;
    const canAppend = cache && cache.path === image.path && cache.width === image.width && cache.height === image.height
      && cache.erasesImage === erasesImage && cache.source === source
      && cache.strokes.length <= strokes.length && cache.strokes.every((stroke, index) => stroke === strokes[index]);
    if (!canAppend) {
      const canvas = document.createElement('canvas');
      canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d');
      if (erasesImage && source) context.drawImage(source, 0, 0, image.width, image.height);
      runtime.paintRasterCache = {canvas, context, path:image.path, width:image.width, height:image.height, source, erasesImage, strokes:[]};
    }
    for (const stroke of strokes.slice(runtime.paintRasterCache.strokes.length)) {
      runtime.drawPaintStroke(runtime.paintRasterCache.context, stroke, image.width, image.height);
    }
    runtime.paintRasterCache.strokes = strokes;
    return runtime.paintRasterCache.canvas;
  }

  /** Repaint the dirty region with the current stroke and preserve its exact release result. */
  repaintActiveStroke() {
    const runtime = this.application;
    const image = runtime.currentPreviewImage();
    if (!image || !runtime.previewPaintStroke || !runtime.paintRasterCache || !runtime.paintDirtyRegion) return;
    const region = runtime.paintDirtyRegion;
    runtime.paintDirtyRegion = null;
    runtime.previewPaintContext.clearRect(region.left, region.top, region.right-region.left, region.bottom-region.top);
    runtime.previewPaintContext.drawImage(runtime.paintRasterCache.canvas, region.left, region.top, region.right-region.left, region.bottom-region.top,
      region.left, region.top, region.right-region.left, region.bottom-region.top);
    runtime.drawPaintStroke(runtime.previewPaintContext, runtime.previewPaintStroke.stroke, image.width, image.height, region);
    runtime.paintRenderedPointCount = runtime.previewPaintStroke.stroke.points.length;
  }
}
