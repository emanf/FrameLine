import { ControllerBase } from '../controller-base.mjs';
import { cropPixelRect, cropFromPixelRect } from '../../model/crop-geometry.mjs';

/** Capture pointer gestures and coalesced samples for painting and panning. */
export class BrushInputController extends ControllerBase {
  /** Append coalesced pointer samples in image coordinates for a smooth captured stroke. */
  appendPaintSamples(event) {
    const runtime = this.application;
    const image = runtime.currentPreviewImage();
    if (!runtime.previewPaintStroke || !image) return;
    const bounds = runtime.paintPointerBounds ??= runtime.previewImageWrap.getBoundingClientRect();
    const {stroke} = runtime.previewPaintStroke;
    const samples = event.getCoalescedEvents?.() ?? [];
    // The dispatch event can include a final position beyond the coalesced list.
    for (const sample of [...samples, event]) {
      const point = [Math.max(0, Math.min(1, (sample.clientX-bounds.left)/bounds.width)),
        Math.max(0, Math.min(1, (sample.clientY-bounds.top)/bounds.height))];
      const last = stroke.points.at(-1);
      if (Math.hypot((point[0]-last[0])*image.width, (point[1]-last[1])*image.height) < .01) continue;
      stroke.points.push(point);
    }
    if (stroke.points.length === runtime.paintRenderedPointCount) return;
    const padding = stroke.size/2 + Math.ceil(stroke.size*(stroke.feather ?? 0)/100*3) + 3;
    const region = {left:image.width, top:image.height, right:0, bottom:0};
    for (const [x,y] of stroke.points.slice(Math.max(0,runtime.paintRenderedPointCount-1))) {
      region.left = Math.max(0, Math.min(region.left, Math.floor(x*image.width-padding)));
      region.top = Math.max(0, Math.min(region.top, Math.floor(y*image.height-padding)));
      region.right = Math.min(image.width, Math.max(region.right, Math.ceil(x*image.width+padding)));
      region.bottom = Math.min(image.height, Math.max(region.bottom, Math.ceil(y*image.height+padding)));
    }
    runtime.paintDirtyRegion = region;
  }

  /** Promote completed paint gestures to persistent strokes with one undo step per gesture. */
  applyPaintDraft() {
    const runtime = this.application;
    if (!runtime.previewPaintDraft) return false;
    const draft = runtime.previewPaintDraft;
    runtime.previewPaintDraft = null;
    runtime.toolEditHistory.clear(); runtime.toolHistorySource = null;
    // Applying preserves the release-per-stroke history users had in the preview.
    return runtime.vm.addPaintStrokes(draft.imageId, draft.strokes, {separateUndoSteps:true});
  }

  /** Bind pointer events after the editor state and required controls are ready. */
  initializePointerEvents() {
    const runtime = this.application;
    runtime.previewStage = document.querySelector("#preview-stage");
    runtime.previewStage.addEventListener("pointerdown", (event) => {
      if (runtime.previewImageWrap.hidden) return;
      if (event.button === 2) {
        event.preventDefault();
        runtime.previewPanPointerId = event.pointerId;
        runtime.previewPanStart = { x: event.clientX, y: event.clientY, panX: runtime.previewPanX, panY: runtime.previewPanY };
        runtime.previewStage.setPointerCapture(event.pointerId);
        runtime.previewStage.classList.add("panning");
        return;
      }
      if (!runtime.previewToolEnabled) return;
      if (runtime.tools.dispatchPointer('pointerDown', event)) return;
      if (runtime.previewTool === "crop") {
        const handle = event.target.closest("[data-crop-handle]");
        const image = runtime.currentPreviewImage();
        if (event.button !== 0 || !handle || !image) return;
        event.preventDefault();
        const initialCrop = runtime.previewCropDraft?.imageId === image.id ? runtime.previewCropDraft.crop
          : image.crop ?? { left: 0, top: 0, right: 1, bottom: 1 };
        runtime.previewCropDrag = runtime.createPreviewDraft(image, {
          historyBefore: runtime.capturePendingTools(),
          pointerId: event.pointerId,
          handle: handle.dataset.cropHandle,
          initialCrop: { ...initialCrop },
          crop: { ...initialCrop },
          startX: event.clientX,
          startY: event.clientY
        });
        runtime.previewStage.setPointerCapture(event.pointerId);
        return;
      }
      if (["brush", "eraser", "healing"].includes(runtime.previewTool)) {
        if (event.button !== 0) return;
        if (runtime.previewTool === "healing" && !runtime.updateHealingControls()) return;
        const image = runtime.currentPreviewImage();
        if (!image) return;
        const bounds = runtime.previewImageWrap.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) return;
        const point = [
          Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
          Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height))
        ];
        const stroke = {
          tool: runtime.previewTool,
          color: runtime.foregroundColor,
          opacity: Number(document.querySelector("#preview-brush-opacity").value) / 100,
          size: runtime.currentBrushSize(),
          shape: ["brush", "healing"].includes(runtime.previewTool) && document.querySelector("#preview-square-brush").checked ? "square" : "round",
          feather: Number(document.querySelector("#preview-brush-feather").value),
          antiAlias: document.querySelector("#preview-brush-antialias").checked,
          points: [point]
        };
        if (runtime.previewTool === "healing") {
          stroke.color = document.querySelector("#preview-healing-keep").value;
          stroke.autoKeep = document.querySelector("#preview-healing-auto-keep").checked;
          if (stroke.autoKeep) {
            stroke.sampleDistance = Number(document.querySelector("#preview-healing-sample-distance").value);
            stroke.recoverTransparency = document.querySelector("#preview-healing-recover-transparency").checked;
          }
          if (document.querySelector('#preview-healing-auto').checked && !runtime.detectHealingColorAtBrush(image, stroke)) return;
          stroke.backgroundColor = document.querySelector("#preview-healing-remove").value;
          stroke.opacity = Number(document.querySelector("#preview-healing-strength").value) / 100;
          stroke.tolerance = Number(document.querySelector("#preview-healing-tolerance").value);
        }
        event.preventDefault();
        runtime.previewPaintStroke = runtime.createPreviewDraft(image, { stroke, historyBefore:runtime.capturePendingTools() });
        runtime.paintPointerBounds = bounds;
        runtime.previewPaintPointerId = event.pointerId;
        runtime.previewStage.setPointerCapture(event.pointerId);
        runtime.previewStage.focus({preventScroll:true});
        runtime.redrawPaintCanvas(image);
        return;
      }
      if (runtime.previewTool !== "hand") return;
      if (event.button !== 0) return;
      event.preventDefault();
      runtime.previewPanPointerId = event.pointerId;
      runtime.previewPanStart = { x: event.clientX, y: event.clientY, panX: runtime.previewPanX, panY: runtime.previewPanY };
      runtime.previewStage.setPointerCapture(event.pointerId);
      runtime.previewStage.classList.add("panning");
    });
    runtime.previewStage.addEventListener("wheel", (event) => {
      if (runtime.previewImageWrap.hidden) return;
      event.preventDefault();
      if (event.altKey && ['brush', 'eraser', 'healing'].includes(runtime.previewTool)) {
        if (!event.deltaY) return;
        const field = document.querySelector('#preview-brush-size');
        const delta = event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? runtime.previewStage.clientHeight : 1);
        const steps = Math.max(1, Math.round(Math.abs(delta) / 100));
        const size = Math.max(1, runtime.currentBrushSize() + (delta < 0 ? steps : -steps));
        if (Number.isFinite(size)) field.value = String(size);
        runtime.updateBrushCursor(event.clientX, event.clientY);
        field.dispatchEvent(new Event('input', {bubbles:true}));
        return;
      }
      const bounds = runtime.previewStage.getBoundingClientRect();
      const cursorX = event.clientX - bounds.left - bounds.width / 2;
      const cursorY = event.clientY - bounds.top - bounds.height / 2;
      const oldScale = runtime.previewZoom / 100;
      const newZoom = Math.max(runtime.MIN_PREVIEW_ZOOM, Math.min(runtime.MAX_PREVIEW_ZOOM, runtime.previewZoom * 1.1 ** (-event.deltaY / 100)));
      const newScale = newZoom / 100;
      runtime.previewPanX = cursorX - (cursorX - runtime.previewPanX) * newScale / oldScale;
      runtime.previewPanY = cursorY - (cursorY - runtime.previewPanY) * newScale / oldScale;
      runtime.setPreviewZoom(newZoom);
    }, { passive: false });
    runtime.previewStage.addEventListener("pointermove", (event) => {
      if (runtime.tools.dispatchPointer('pointerMove', event)) return;
      if (runtime.previewPaintPointerId !== null) runtime.brushCursorPosition = {x:event.clientX, y:event.clientY};
      else runtime.updateBrushCursor(event.clientX, event.clientY);
      if (event.pointerId === runtime.previewCropDrag?.pointerId) {
        const bounds = runtime.previewImageWrap.getBoundingClientRect();
        const dx = (event.clientX - runtime.previewCropDrag.startX) / bounds.width;
        const dy = (event.clientY - runtime.previewCropDrag.startY) / bounds.height;
        const image = runtime.vm.project.images.find((item) => item.id === runtime.previewCropDrag.imageId);
        if (!image) return;
        const crop = runtime.resizeCrop(
          runtime.previewCropDrag.initialCrop,
          runtime.previewCropDrag.handle,
          dx,
          dy,
          1 / image.width,
          1 / image.height
        );
        runtime.previewCropDrag.crop = cropFromPixelRect(image.width, image.height, cropPixelRect(image.width, image.height, crop));
        runtime.updatePreviewCrop(runtime.currentPreviewImage());
        return;
      }
      if (event.pointerId === runtime.previewPaintPointerId && runtime.previewPaintStroke) {
        runtime.appendPaintSamples(event);
        if (runtime.previewPaintFrame === null) runtime.previewPaintFrame = requestAnimationFrame(() => {
          runtime.previewPaintFrame = null;
          runtime.repaintActiveStroke();
          runtime.updateBrushCursor();
        });
        return;
      }
      if (event.pointerId !== runtime.previewPanPointerId || !runtime.previewPanStart) return;
      runtime.previewPanX = runtime.previewPanStart.panX + event.clientX - runtime.previewPanStart.x;
      runtime.previewPanY = runtime.previewPanStart.panY + event.clientY - runtime.previewPanStart.y;
      runtime.updatePreviewPan();
    });
    runtime.previewStage.addEventListener("pointerleave", () => {
      runtime.brushCursorPosition = null;
      if (runtime.previewPaintPointerId === null) runtime.previewBrushCursor.hidden = true;
    });
    runtime.stopPreviewPan = (event) => {
      if (runtime.tools.dispatchPointer('pointerUp', event)) return;
      if (event.pointerId === runtime.previewCropDrag?.pointerId) {
        const drag = runtime.previewCropDrag;
        runtime.previewCropDrag = null;
        if (event.type !== "pointercancel" && drag.editRevision === runtime.vm.editRevision) {
          runtime.previewCropDraft = runtime.createPreviewDraft(runtime.currentPreviewImage(), { crop: drag.crop });
          runtime.recordToolGesture(drag.historyBefore);
        }
        runtime.updatePreviewCrop(runtime.currentPreviewImage());
        if (runtime.previewStage.hasPointerCapture(event.pointerId)) runtime.previewStage.releasePointerCapture(event.pointerId);
        return;
      }
      if (event.pointerId === runtime.previewPaintPointerId) {
        const { stroke, historyBefore } = runtime.previewPaintStroke;
        if (event.type !== 'pointercancel') { runtime.appendPaintSamples(event); runtime.repaintActiveStroke(); }
        if (runtime.previewPaintFrame !== null) cancelAnimationFrame(runtime.previewPaintFrame);
        runtime.previewPaintFrame = null;
        runtime.previewPaintPointerId = null;
        runtime.previewPaintStroke = null;
        if (event.type !== "pointercancel") {
          runtime.previewPaintDraft ??= runtime.createPreviewDraft(runtime.currentPreviewImage(), { strokes: [] });
          runtime.previewPaintDraft.strokes = [...runtime.previewPaintDraft.strokes, stroke];
          // The regional preview already contains the exact completed stroke.
          // Promote it to the cached base rather than rasterizing the path again.
          if (runtime.paintRasterCache) {
            runtime.paintRasterCache.context.clearRect(0, 0, runtime.paintRasterCache.width, runtime.paintRasterCache.height);
            runtime.paintRasterCache.context.drawImage(runtime.previewPaintCanvas, 0, 0);
            runtime.paintRasterCache.strokes = [...runtime.paintRasterCache.strokes, stroke];
          }
          runtime.recordToolGesture(historyBefore);
        }
        if (runtime.previewStage.hasPointerCapture(event.pointerId)) runtime.previewStage.releasePointerCapture(event.pointerId);
        runtime.redrawPaintCanvas(runtime.currentPreviewImage());
        runtime.paintPointerBounds = null;
        runtime.paintDirtyRegion = null;
        return;
      }
      if (event.pointerId !== runtime.previewPanPointerId) return;
      runtime.previewPanPointerId = null;
      runtime.previewPanStart = null;
      runtime.previewStage.classList.remove("panning");
      if (runtime.previewStage.hasPointerCapture(event.pointerId)) runtime.previewStage.releasePointerCapture(event.pointerId);
    };
    runtime.previewStage.addEventListener("pointerup", runtime.stopPreviewPan);
    runtime.previewStage.addEventListener("pointercancel", runtime.stopPreviewPan);
  }
}
