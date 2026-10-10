import {brushMask} from '../../model/brush-mask.mjs';

/** Capture protected areas as normalized brush strokes and render their red overlay. */
export class BackgroundIgnoreBrushView {
  constructor(session) { this.session = session; }

  /** Rasterize a protected segment into the translucent red overlay. */
  renderIgnoreSegment(stroke) {
    const session = this.session;
    const mask = brushMask({...stroke, size:stroke.size * Math.min(session.ignoreOverlay.width, session.ignoreOverlay.height),
      antiAlias:false, feather:0, shape:'round'}, session.ignoreOverlay.width, session.ignoreOverlay.height);
    if (!mask.width || !mask.height) return;
    const context = session.ignoreOverlay.getContext('2d');
    const pixels = context.getImageData(mask.left, mask.top, mask.width, mask.height);
    for (let i = 0; i < mask.data.length; i++) if (mask.data[i]) {
      pixels.data.set([255, 55, 65, 56], i * 4);
    }
    context.putImageData(pixels, mask.left, mask.top);
    
  }

  /** Flush queued protection segments and cancel their pending animation frame. */
  flushIgnoreOverlay() {
    const session = this.session;
    if (session.ignoreRenderFrame !== null) cancelAnimationFrame(session.ignoreRenderFrame);
    session.ignoreRenderFrame = null;
    for (const stroke of session.ignorePending.splice(0)) session.renderIgnoreSegment(stroke);
    
  }

  /** Convert a pointer position into normalized source-image coordinates. */
  ignorePoint(event) {
    const session = this.session;
    const bounds = session.preview.getBoundingClientRect();
    if (!session.preview.naturalWidth || !bounds.width || !bounds.height) return null;
    return [(event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height];
    
  }

  /** Position the protection brush footprint over the visible image. */
  updateIgnorePointer(event) {
    const session = this.session;
    const point = session.ignorePoint(event);
    const inside = point && point.every(value => value >= 0 && value < 1);
    session.ignoreCursor.hidden = !session.ignoreEnabled || !inside || Boolean(session.runtime.backgroundPreviewDrag);
    if (session.ignoreCursor.hidden) return;
    const bounds = session.previewFrame.getBoundingClientRect();
    const diameter = Number(session.ignoreSize.value) * session.preview.getBoundingClientRect().width / session.preview.naturalWidth;
    Object.assign(session.ignoreCursor.style, {left:`${event.clientX-bounds.left-session.previewFrame.clientLeft}px`,
      top:`${event.clientY-bounds.top-session.previewFrame.clientTop}px`, width:`${diameter}px`, height:`${diameter}px`});
    
  }

  /** Append and queue a captured normalized point, clipping release outside the image. */
  appendIgnorePoint(event) {
    const session = this.session;
    const point = session.ignorePoint(event);
    if (!point) return;
    // Keep captured strokes on the image boundary, including release outside.
    point[0] = Math.max(0, Math.min(1, point[0]));
    point[1] = Math.max(0, Math.min(1, point[1]));
    const previous = session.ignoreGesture.last;
    session.ignoreGesture.stroke.points.push(point);
    session.ignorePending.push({size:session.ignoreGesture.stroke.size, points:previous ? [previous, point] : [point]});
    session.ignoreGesture.last = point;
    if (session.ignoreRenderFrame === null) session.ignoreRenderFrame = requestAnimationFrame(session.flushIgnoreOverlay);
    
  }

  /** Capture a protection stroke and invalidate processing while it is being painted. */
  startIgnoreStroke(event) {
    const session = this.session;
    if (!session.ignoreEnabled || event.button !== 0 || session.ignoreGesture || session.runtime.backgroundPreviewDrag) return;
    const point = session.ignorePoint(event);
    if (!point || point.some(value => value < 0 || value >= 1)) return;
    event.preventDefault();
    clearTimeout(session.runtime.backgroundPreviewTimer);
    session.runtime.backgroundPreviewRequestId++;
    session.previewStatusText.textContent = 'Painting ignored areas… Release to update the preview. Changes are not applied.';
    session.previewProgress.hidden = true;
    session.previewStatus.setAttribute('aria-busy', 'false');
    session.ignoreSize.value = String(Math.round(session.runtime.clampNumber(session.ignoreSize.value, 1, 100000, 40)));
    const stroke = {size:Number(session.ignoreSize.value) / Math.min(session.ignoreOverlay.width, session.ignoreOverlay.height), points:[]};
    session.ignoreStrokes.push(stroke);
    session.ignoreGesture = {pointerId:event.pointerId, stroke, last:null};
    session.previewFrame.setPointerCapture(event.pointerId);
    session.appendIgnorePoint(event);
    session.updateIgnorePointer(event);
    session.ignoreUndo.disabled = session.ignoreClear.disabled = false;
    
  }

  /** Append coalesced pointer samples to the active protection gesture. */
  moveIgnoreStroke(event) {
    const session = this.session;
    if (!session.ignoreGesture || event.pointerId !== session.ignoreGesture.pointerId) return;
    for (const point of event.getCoalescedEvents?.().length ? event.getCoalescedEvents() : [event]) session.appendIgnorePoint(point);
    
  }

  /** Flush the overlay, release capture, and schedule removal using completed protection marks. */
  finishIgnoreStroke(event) {
    const session = this.session;
    if (!session.ignoreGesture || event.pointerId !== session.ignoreGesture.pointerId) return;
    if (event.type !== 'pointercancel') session.appendIgnorePoint(event);
    session.flushIgnoreOverlay();
    session.ignoreGesture = null;
    if (session.previewFrame.hasPointerCapture(event.pointerId)) session.previewFrame.releasePointerCapture(event.pointerId);
    session.scheduleBackgroundPreview();
    
  }

  /** Toggle protection painting and synchronize its controls and sampling mode. */
  toggleIgnoreBrush() {
    const session = this.session;
    session.ignoreEnabled = !session.ignoreEnabled;
    session.ignoreButton.setAttribute('aria-pressed', String(session.ignoreEnabled));
    session.ignoreControls.hidden = !session.ignoreEnabled;
    session.ignoreCursor.hidden = true;
    session.syncMethod();
    
  }

  /** Remove the most recent protection stroke or clear every mark, then refresh removal. */
  resetIgnoreMarks(event) {
    const session = this.session;
    if (session.ignoreGesture) return;
    session.flushIgnoreOverlay();
    if (event.currentTarget === session.ignoreUndo) session.ignoreStrokes.pop();
    else session.ignoreStrokes = [];
    session.ignoreOverlay.getContext('2d').clearRect(0, 0, session.ignoreOverlay.width, session.ignoreOverlay.height);
    for (const stroke of session.ignoreStrokes) session.renderIgnoreSegment(stroke);
    session.ignoreUndo.disabled = session.ignoreClear.disabled = !session.ignoreStrokes.length;
    session.scheduleBackgroundPreview();
    
  }

  /** Hide the protection footprint when leaving its drawable surface. */
  hideIgnoreCursor() {
    const session = this.session;session.ignoreCursor.hidden = true;
  }
}
