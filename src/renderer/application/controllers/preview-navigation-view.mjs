import { ControllerBase } from '../controller-base.mjs';
import { cropPixelRect } from '../../model/crop-geometry.mjs';
import {brushImagePoint,brushFootprint} from '../../model/brush-geometry.mjs';

/** Maintain preview zoom, pan, and brush cursor geometry. */
export class PreviewNavigationView extends ControllerBase {
  /** Show the active brush footprint over the drawable area without hiding the native pointer. */
  updateBrushCursor(clientX = this.application.brushCursorPosition?.x, clientY = this.application.brushCursorPosition?.y) {
    const runtime = this.application;
    if (clientX !== undefined && clientY !== undefined) runtime.brushCursorPosition = { x: clientX, y: clientY };
    if (clientX === undefined || clientY === undefined || !runtime.previewToolEnabled || !["brush", "eraser", "healing",'ignore','recover'].includes(runtime.previewTool) || runtime.previewImageWrap.hidden) {
      runtime.previewBrushCursor.hidden = true;
      return;
    }
    const bounds = runtime.paintPointerBounds ?? runtime.previewImageWrap.getBoundingClientRect();
    if (clientX < bounds.left || clientX > bounds.right || clientY < bounds.top || clientY > bounds.bottom) {
      runtime.previewBrushCursor.hidden = true;
      return;
    }
    const image = runtime.currentPreviewImage();
    if (!image) {
      runtime.previewBrushCursor.hidden = true;
      return;
    }
    const crop = cropPixelRect(image.width, image.height, image.crop);
    const pixelX = (clientX - bounds.left) / bounds.width * image.width;
    const pixelY = (clientY - bounds.top) / bounds.height * image.height;
    if (pixelX < crop.x || pixelX >= crop.x + crop.width || pixelY < crop.y || pixelY >= crop.y + crop.height) {
      runtime.previewBrushCursor.hidden = true;
      return;
    }
    const stageBounds = document.querySelector("#preview-stage").getBoundingClientRect();
    const size = runtime.currentBrushSize();
    const squareBrush = ["brush", "healing",'ignore','recover'].includes(runtime.previewTool) && document.querySelector("#preview-square-brush").checked;
    const pixelBrush = !document.querySelector("#preview-brush-antialias").checked;
    runtime.previewBrushCursor.classList.toggle("square", squareBrush);
    const point = brushImagePoint(clientX,clientY,bounds,image.width,image.height,pixelBrush);
    const footprint = brushFootprint(point,size,image.width,image.height,pixelBrush);
    const scaleX = bounds.width/image.width, scaleY = bounds.height/image.height;
    runtime.previewBrushCursor.style.width = `${footprint.width*scaleX}px`;
    runtime.previewBrushCursor.style.height = `${footprint.height*scaleY}px`;
    runtime.previewBrushCursor.style.left = `${bounds.left+(footprint.left+footprint.width/2)*scaleX-stageBounds.left}px`;
    runtime.previewBrushCursor.style.top = `${bounds.top+(footprint.top+footprint.height/2)*scaleY-stageBounds.top}px`;
    runtime.previewBrushCursor.hidden = false;
  }

  /** Set bounded preview zoom and persist the resulting viewport preference. */
  setPreviewZoom(zoom) {
    const runtime = this.application;
    runtime.previewZoom = Math.round(Math.max(runtime.MIN_PREVIEW_ZOOM, Math.min(runtime.MAX_PREVIEW_ZOOM, zoom)) * 10) / 10;
    document.querySelector("#preview-stage").style.setProperty("--preview-zoom", String(runtime.previewZoom / 100));
    document.querySelector("#preview-zoom-label").textContent = `${runtime.previewZoom.toFixed(1)}%`;
    runtime.updatePreviewPan();
    runtime.updateBrushCursor();
    runtime.scheduleSavePreferences();
  }

  /** Center the active image with a small viewing margin and reset preview pan. */
  fitPreviewImage() {
    const runtime = this.application;
    const image = runtime.currentPreviewImage();
    const stage = document.querySelector('#preview-stage');
    runtime.previewPanX = 0;
    runtime.previewPanY = 0;
    let zoom = 90;
    if (image && stage.clientWidth && stage.clientHeight) {
      const crop = cropPixelRect(image.width, image.height, image.crop);
      const baseScale = Math.min(stage.clientWidth / image.width, stage.clientHeight / image.height);
      const fittedScale = Math.min(stage.clientWidth * .9 / crop.width, stage.clientHeight * .9 / crop.height);
      zoom = runtime.clampNumber(fittedScale / baseScale * 100, runtime.MIN_PREVIEW_ZOOM, runtime.MAX_PREVIEW_ZOOM, 90);
      runtime.previewPanX = (image.width / 2 - crop.x - crop.width / 2) * baseScale * zoom / 100;
      runtime.previewPanY = (image.height / 2 - crop.y - crop.height / 2) * baseScale * zoom / 100;
    }
    runtime.setPreviewZoom(zoom);
  }

  /** Apply zoom and pan transforms while retaining access beyond image boundaries. */
  updatePreviewPan() {
    const runtime = this.application;
    runtime.paintPointerBounds = null;
    const stage = document.querySelector("#preview-stage");
    // Panning stays free even beyond the canvas. Frame changes preserve the
    // chosen viewport; only FIT or opening/adding an image recenters it.
    stage.style.setProperty("--preview-pan-x", `${runtime.previewPanX}px`);
    stage.style.setProperty("--preview-pan-y", `${runtime.previewPanY}px`);
    stage.classList.toggle("zoomed-image", !runtime.previewImageWrap.hidden && runtime.previewZoom > 100);
    runtime.updatePreviewPixelGrid();
    runtime.updatePixelPerfectPreview();
    runtime.updateBrushCursor();
  }
}
