import { ControllerBase } from '../controller-base.mjs';
import { workingImageRequest } from '../../model/image-effects.mjs';
import { cropPixelRect } from '../../model/crop-geometry.mjs';

/** Materialize working edits and manage image-processing requests. */
export class ImageProcessingService extends ControllerBase {
  /** Encode a local file path as a renderer-safe file URL. */
  localImageUrl(filePath) {
    const runtime = this.application;
    const normalized = filePath.replace(/\\/g, "/");
    const encoded = normalized.split("/").map((part) => encodeURIComponent(part).replace(/%3A/gi, ":")).join("/");
    return normalized.startsWith("/") ? `file://${encoded}` : `file:///${encoded}`;
  }

  /** Build an owned image containing the current crop, outline, and paint data. */
  async materializeWorkingImage(image) {
    const runtime = this.application;
    if (!image.paintStrokes?.length && !image.crop && !image.outline) {
      return { path: image.path, width: image.width, height: image.height, temporary: false };
    }
    await new Promise(resolve => requestAnimationFrame(resolve));
    // Preserve the exact canvas brush rendering when passing the working image
    // to another tool. Zoom, checkerboards and tool overlays are excluded.
    if (image.outline) {
      return { ...await window.frameLine.renderCurrentImage(workingImageRequest(image)), temporary: true };
    }
    const source = new Image();
    source.src = runtime.localImageUrl(image.path);
    await source.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    context.drawImage(source, 0, 0, image.width, image.height);
    let lastYield = performance.now();
    for (const stroke of image.paintStrokes ?? []) {
      runtime.drawPaintStroke(context, stroke, image.width, image.height);
      if (performance.now() - lastYield > 16) {
        await new Promise(resolve => requestAnimationFrame(resolve));
        lastYield = performance.now();
      }
    }
    let result = canvas;
    if (image.crop) {
      const rect = cropPixelRect(image.width, image.height, image.crop);
      result = document.createElement("canvas");
      result.width = rect.width;
      result.height = rect.height;
      result.getContext("2d").drawImage(canvas, rect.x, rect.y, result.width, result.height, 0, 0, result.width, result.height);
    }
    return { ...await runtime.storeCanvasImage(result), temporary: true };
  }

  /** Encode a canvas as binary PNG asynchronously and reject an unsuccessful encoder result. */
  async encodeCanvasImage(canvas) {
    const runtime = this.application;
    const blob = await new Promise((resolve, reject) => canvas.toBlob(result => {
      if (result) resolve(result);
      else reject(new Error('Could not encode the image. Try smaller dimensions.'));
    }, 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  }

  /** Send an encoded canvas to the host and receive an owned working-image result. */
  async storeCanvasImage(canvas) {
    const runtime = this.application;
    return window.frameLine.storeWorkingImage(await runtime.encodeCanvasImage(canvas));
  }

  /** Show determinate processing progress or an indeterminate busy bar for a tool. */
  setToolProgress(tool, busy, event) {
    const runtime = this.application;
    const bar = document.querySelector(`#preview-${tool}-progress`);
    if (!bar) return;
    bar.hidden = !busy;
    bar.setAttribute('aria-busy', String(busy));
    if (busy && event?.total > 0) {
      bar.max = event.total;
      bar.value = event.current;
    } else bar.removeAttribute('value');
  }

  /** Correlate progress events with a single preload request and unsubscribe on completion. */
  async runImageRequest(method, request, onProgress) {
    const runtime = this.application;
    const operationId = crypto.randomUUID();
    const unsubscribe = window.frameLine.onImageProgress(event => {
      if (event.operationId === operationId) onProgress?.(event);
    });
    try { return await window.frameLine[method]({...request, operationId}); }
    finally { unsubscribe(); }
  }

  /** Show the operation dialog during an asynchronous action and always close it afterward. */
  async withOperationProgress(title, message, action) {
    const runtime = this.application;
    const progress = runtime.showOperationProgress(title, message);
    try {
      await new Promise(resolve => requestAnimationFrame(resolve));
      return await action(progress);
    } finally { progress.close(); }
  }
}
