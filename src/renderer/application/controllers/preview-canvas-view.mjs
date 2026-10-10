import { ControllerBase } from '../controller-base.mjs';


/** Render edited images and the pixel grid without changing project data. */
export class PreviewCanvasView extends ControllerBase {
  /** Draw visible grid lines in image space without including them in image processing. */
  updatePreviewPixelGrid(image = this.application.currentPreviewImage()) {
    const runtime = this.application;
    if (image && runtime.previewTool === 'outline' && runtime.previewImageWrap.classList.contains('outline-preview')) {
      const canvas = document.querySelector('#preview-outline-canvas');
      image = {...image, width:canvas.width, height:canvas.height, crop:null};
    }
    if (image && runtime.previewRefineDraft?.imageId === image.id
      && runtime.previewImageWrap.classList.contains('refine-preview')) {
      const canvas = document.querySelector('#preview-refine-canvas');
      image = {...image, width: canvas.width, height: canvas.height, crop: null};
    }
    if (image && runtime.previewImageWrap.classList.contains("padding-preview")) {
      const canvas = document.querySelector("#preview-padding-canvas");
      image = { ...image, width: canvas.width, height: canvas.height, crop: null };
    }
    if (!image || runtime.previewImageWrap.hidden) {
      runtime.previewPixelGrid.hidden = true;
      return;
    }
    const stage = document.querySelector("#preview-stage");
    const gridSize = Number(document.querySelector("#preview-grid-size").value);
    const opacity = Number(document.querySelector("#preview-grid-opacity").value) / 100;
    const stageBounds = stage.getBoundingClientRect();
    const imageBounds = runtime.previewImageWrap.getBoundingClientRect();
    const scaleX = imageBounds.width / image.width;
    const scaleY = imageBounds.height / image.height;
    const displayedCellSize = scaleX * gridSize;
    const visible = runtime.previewGridEnabled && opacity > 0 && displayedCellSize >= 8;
    runtime.previewPixelGrid.hidden = !visible;
    if (!visible) return;
  
    const pixelRatio = window.devicePixelRatio || 1;
    const canvasWidth = Math.round(stage.clientWidth * pixelRatio);
    const canvasHeight = Math.round(stage.clientHeight * pixelRatio);
    if (runtime.previewPixelGrid.width !== canvasWidth || runtime.previewPixelGrid.height !== canvasHeight) {
      runtime.previewPixelGrid.width = canvasWidth;
      runtime.previewPixelGrid.height = canvasHeight;
    }
    runtime.previewPixelGridContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    runtime.previewPixelGridContext.clearRect(0, 0, stage.clientWidth, stage.clientHeight);
    runtime.previewPixelGridContext.strokeStyle = `rgb(0 0 0 / ${opacity})`;
    runtime.previewPixelGridContext.lineWidth = 1;
    const left = Math.max(0, (stageBounds.left - imageBounds.left) / scaleX);
    const right = Math.min(image.width, (stageBounds.right - imageBounds.left) / scaleX);
    const top = Math.max(0, (stageBounds.top - imageBounds.top) / scaleY);
    const bottom = Math.min(image.height, (stageBounds.bottom - imageBounds.top) / scaleY);
    const firstColumn = Math.max(1, Math.ceil(left / gridSize));
    const lastColumn = Math.floor(right / gridSize);
    const firstRow = Math.max(1, Math.ceil(top / gridSize));
    const lastRow = Math.floor(bottom / gridSize);
    const imageLeft = Math.max(0, imageBounds.left - stageBounds.left);
    const imageRight = Math.min(stage.clientWidth, imageBounds.right - stageBounds.left);
    const imageTop = Math.max(0, imageBounds.top - stageBounds.top);
    const imageBottom = Math.min(stage.clientHeight, imageBounds.bottom - stageBounds.top);
    runtime.previewPixelGridContext.save();
    if (image.crop && (runtime.previewTool !== "crop" || !runtime.previewToolEnabled)) {
      runtime.previewPixelGridContext.beginPath();
      runtime.previewPixelGridContext.rect(
        imageBounds.left - stageBounds.left + imageBounds.width * image.crop.left,
        imageBounds.top - stageBounds.top + imageBounds.height * image.crop.top,
        imageBounds.width * (image.crop.right - image.crop.left),
        imageBounds.height * (image.crop.bottom - image.crop.top)
      );
      runtime.previewPixelGridContext.clip();
    }
    runtime.previewPixelGridContext.beginPath();
    for (let column = firstColumn; column <= lastColumn; column++) {
      const x = imageBounds.left - stageBounds.left + column * gridSize * scaleX;
      runtime.previewPixelGridContext.moveTo(x, imageTop);
      runtime.previewPixelGridContext.lineTo(x, imageBottom);
    }
    for (let row = firstRow; row <= lastRow; row++) {
      const y = imageBounds.top - stageBounds.top + row * gridSize * scaleY;
      runtime.previewPixelGridContext.moveTo(imageLeft, y);
      runtime.previewPixelGridContext.lineTo(imageRight, y);
    }
    runtime.previewPixelGridContext.stroke();
    runtime.previewPixelGridContext.restore();
  }

  /** Compose committed and pending paint strokes into the preview canvas. */
  redrawPaintCanvas(image = this.application.currentPreviewImage()) {
    const runtime = this.application;
    runtime.syncToolActivation(image);
    if (!image) {
      runtime.previewCropDraft = null;
      runtime.syncCropControls(null);
      runtime.syncCropFields(null);
      runtime.previewPaintCanvas.width = 1;
      runtime.previewPaintCanvas.height = 1;
      runtime.previewPaintContext.clearRect(0, 0, 1, 1);
      runtime.previewPaintCanvas.hidden = true;
      document.querySelector("#preview-crop-overlay").hidden = true;
      runtime.previewImageWrap.hidden = true;
      return;
    }
    runtime.previewPaintCanvas.hidden = false;
    runtime.previewImageWrap.hidden = false;
    if (runtime.previewTool === 'outline' && runtime.previewOutlineDraft?.imageId === image.id
      && runtime.previewImageWrap.classList.contains('outline-preview')) {
      runtime.layoutOutlinePreview(image);
      return;
    }
    if (runtime.previewTool === "padding" && runtime.previewPaddingDraft?.imageId === image.id
      && runtime.previewImageWrap.classList.contains("padding-preview")) {
      runtime.layoutPaddingPreview(image);
      return;
    }
    if (runtime.previewRefineDraft?.imageId === image.id
      && runtime.previewImageWrap.classList.contains("refine-preview")) {
      runtime.layoutRefinePreview(image);
      return;
    }
    const stage = document.querySelector("#preview-stage");
    const fitScale = Math.min(stage.clientWidth / image.width, stage.clientHeight / image.height);
    runtime.previewImageWrap.style.width = `${Math.max(1, image.width * fitScale)}px`;
    runtime.previewImageWrap.style.height = `${Math.max(1, image.height * fitScale)}px`;
    runtime.updatePreviewCrop(image);
    runtime.updatePreviewPixelGrid(image);
    const strokes = [...(image.paintStrokes ?? []), ...(runtime.previewPaintDraft?.imageId === image.id ? runtime.previewPaintDraft.strokes : [])];
    const hasActiveStroke = runtime.previewPaintStroke?.imageId === image.id;
    const erasesImage = strokes.some((stroke) => ["eraser", "healing"].includes(stroke.tool))
      || (hasActiveStroke && ["eraser", "healing"].includes(runtime.previewPaintStroke.stroke.tool));
    runtime.previewImageWrap.classList.toggle("paint-erases-image", erasesImage);
    if (!strokes.length && !hasActiveStroke) {
      runtime.previewPaintCanvas.hidden = true;
      if (runtime.previewPaintCanvas.width !== 1 || runtime.previewPaintCanvas.height !== 1) {
        runtime.previewPaintCanvas.width = 1;
        runtime.previewPaintCanvas.height = 1;
      }
      runtime.updatePixelPerfectPreview(image, fitScale);
      runtime.syncOutlineControls(image);
      return;
    }
    runtime.previewPaintCanvas.hidden = false;
    if (runtime.previewPaintCanvas.width !== image.width || runtime.previewPaintCanvas.height !== image.height) {
      runtime.previewPaintCanvas.width = image.width;
      runtime.previewPaintCanvas.height = image.height;
    }
    runtime.previewPaintContext.clearRect(0, 0, image.width, image.height);
    runtime.previewPaintContext.drawImage(runtime.completedPaintRaster(image, strokes, erasesImage), 0, 0);
    if (hasActiveStroke) {
      runtime.drawPaintStroke(runtime.previewPaintContext, runtime.previewPaintStroke.stroke, image.width, image.height);
      runtime.paintRenderedPointCount = runtime.previewPaintStroke.stroke.points.length;
      runtime.paintDirtyRegion = null;
    }
    runtime.updatePixelPerfectPreview(image, fitScale);
    runtime.syncOutlineControls(image);
  }

  /** Restore committed outline controls when no live outline draft owns them. */
  syncOutlineControls(image = this.application.currentPreviewImage()) {
    const runtime = this.application;
    if (image && runtime.previewOutlineDraft?.imageId === image.id) return;
    const outline = image?.outlineSettings ?? image?.outline;
    document.querySelector("#preview-outline-color").value = outline?.color ?? "#ffffff";
    document.querySelector("#preview-outline-size").value = String(outline?.size ?? 8);
    document.querySelector("#preview-outline-position").value = outline?.position ?? "center";
    document.querySelector("#preview-outline-softness").value = String(outline?.softness ?? 0);
    document.querySelector("#preview-outline-opacity").value = String(Math.round((outline?.opacity ?? 1) * 100));
    document.querySelector("#preview-outline-size-value").value = `${outline?.size ?? 8} px`;
    document.querySelector("#preview-outline-softness-value").value = `${outline?.softness ?? 0} px`;
    document.querySelector("#preview-outline-opacity-value").value = `${Math.round((outline?.opacity ?? 1) * 100)}%`;
  }

  /** Choose display smoothing according to zoom and the committed raster style. */
  updatePixelPerfectPreview(image = this.application.currentPreviewImage(), fitScale) {
    const runtime = this.application;
    if (!image || runtime.previewImageWrap.hidden) {
      runtime.previewImageWrap.classList.remove("pixel-perfect");
      return;
    }
    const stage = document.querySelector("#preview-stage");
    const scale = fitScale ?? Math.min(stage.clientWidth / image.width, stage.clientHeight / image.height);
    const isPixelStroke = stroke => !stroke.feather && stroke.antiAlias !== true;
    const hasCrispStrokes = [...(image.paintStrokes ?? []), ...(runtime.previewPaintDraft?.imageId === image.id ? runtime.previewPaintDraft.strokes : [])].some(isPixelStroke)
      || (runtime.previewPaintStroke?.imageId === image.id
        && isPixelStroke(runtime.previewPaintStroke.stroke));
    runtime.previewImageWrap.classList.toggle("pixel-perfect", hasCrispStrokes && runtime.previewZoom / 100 * scale >= 1);
  }
}
