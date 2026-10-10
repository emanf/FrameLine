/** Manage modal preview fitting, background display, zoom, and panning. */
export class BackgroundNavigationView {
  constructor(session) { this.session = session; }

  /** Close the preview-background popup and reset its accessible toggle. */
  closeBackgroundPopover() {
    const session = this.session;
    session.previewBackgroundPopover.hidden = true;
    session.previewBackgroundToggle.setAttribute('aria-expanded', 'false');
    
  }

  /** Toggle the inspection-background popup on click. */
  toggleBackgroundPopover() {
    const session = this.session;
    session.previewBackgroundPopover.hidden = !session.previewBackgroundPopover.hidden;
    session.previewBackgroundToggle.setAttribute('aria-expanded', String(!session.previewBackgroundPopover.hidden));
    
  }

  /** Close the background popup after a pointer-down outside its control. */
  dismissBackgroundPopover(event) {
    const session = this.session;
    if (!session.previewBackgroundControl.contains(event.target)) session.closeBackgroundPopover();
    
  }

  /** Close an open background popup on Escape and restore toggle focus. */
  escapeBackgroundPopover(event) {
    const session = this.session;
    if (event.key !== 'Escape' || session.previewBackgroundPopover.hidden) return;
    event.preventDefault();
    event.stopPropagation();
    session.closeBackgroundPopover();
    session.previewBackgroundToggle.focus();
    
  }

  /** Apply zoom and pan equally to the image and protection overlay. */
  updatePreviewTransform() {
    const session = this.session;
    session.preview.style.setProperty("--background-preview-scale", String(session.runtime.backgroundPreviewZoom));
    session.preview.style.setProperty("--background-preview-x", `${session.runtime.backgroundPreviewPan.x}px`);
    session.preview.style.setProperty("--background-preview-y", `${session.runtime.backgroundPreviewPan.y}px`);
    for (const property of ['--background-preview-scale', '--background-preview-x', '--background-preview-y']) {
      session.ignoreOverlay.style.setProperty(property, session.preview.style.getPropertyValue(property));
    }
    session.ignoreCursor.hidden = true;
    
  }

  /** Restore centered modal zoom/pan and refit the preview. */
  resetPreviewView() {
    const session = this.session;
    session.runtime.backgroundPreviewZoom = 1; session.runtime.backgroundPreviewPan = {x:0,y:0};
    session.fitPreview(); session.updatePreviewTransform();
    
  }

  /** Update the ignore cursor or captured pan from a pointer position. */
  updatePreviewPoint(event) {
    const session = this.session;
    session.updateIgnorePointer(event);
    if (!session.runtime.backgroundPreviewDrag || event.pointerId !== session.runtime.backgroundPreviewDrag.pointerId) return;
    session.runtime.backgroundPreviewDrag.currentX = event.clientX;
    session.runtime.backgroundPreviewDrag.currentY = event.clientY;
    if (session.runtime.backgroundPreviewPanFrame !== null) return;
    session.runtime.backgroundPreviewPanFrame = requestAnimationFrame(() => {
      session.runtime.backgroundPreviewPanFrame = null;
      if (!session.runtime.backgroundPreviewDrag) return;
      session.runtime.backgroundPreviewPan = {
        x: session.runtime.backgroundPreviewDrag.x + session.runtime.backgroundPreviewDrag.currentX - session.runtime.backgroundPreviewDrag.clientX,
        y: session.runtime.backgroundPreviewDrag.y + session.runtime.backgroundPreviewDrag.currentY - session.runtime.backgroundPreviewDrag.clientY
      };
      session.updatePreviewTransform();
    });
    
  }

  /** Capture a preview-panning gesture without consuming active ignore-brush input. */
  startPreviewPan(event) {
    const session = this.session;
    if (event.button !== 2 || session.ignoreGesture) return;
    event.preventDefault();
    session.runtime.backgroundPreviewDrag = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY,
      x: session.runtime.backgroundPreviewPan.x,
      y: session.runtime.backgroundPreviewPan.y
    };
    session.previewFrame.setPointerCapture(event.pointerId);
    session.previewFrame.style.cursor = "grabbing";
    
  }

  /** Release captured modal pan and cancel its scheduled transform update. */
  stopPreviewPan(event) {
    const session = this.session;
    if (!session.runtime.backgroundPreviewDrag || event.pointerId !== session.runtime.backgroundPreviewDrag.pointerId) return;
    if (session.runtime.backgroundPreviewPanFrame !== null) {
      cancelAnimationFrame(session.runtime.backgroundPreviewPanFrame);
      session.runtime.backgroundPreviewPanFrame = null;
    }
    session.runtime.backgroundPreviewPan = {
      x: session.runtime.backgroundPreviewDrag.x + event.clientX - session.runtime.backgroundPreviewDrag.clientX,
      y: session.runtime.backgroundPreviewDrag.y + event.clientY - session.runtime.backgroundPreviewDrag.clientY
    };
    session.updatePreviewTransform();
    session.runtime.backgroundPreviewDrag = null;
    session.previewFrame.style.cursor = session.ignoreEnabled || session.method.value === "sample" ? "crosshair" : "grab";
    if (session.previewFrame.hasPointerCapture(event.pointerId)) session.previewFrame.releasePointerCapture(event.pointerId);
    
  }

  /** Suppress the native menu on the modal preview surface. */
  preventPreviewContextMenu(event) {
    const session = this.session;
    return event.preventDefault();

  }

  /** Show a solid inspection background without modifying processed pixels. */
  setPreviewBackgroundColor() {
    const session = this.session;
    session.previewFrame.style.setProperty("--background-preview-color", session.previewColor.value);
    document.querySelector('#background-preview-color-value').value = session.previewColor.value;
    session.previewFrame.classList.add("solid-background");
    session.previewTransparent.checked = false;
    
  }

  /** Switch the modal inspection background back to transparency. */
  setPreviewTransparent() {
    const session = this.session;
    session.previewFrame.classList.toggle("solid-background", !session.previewTransparent.checked);
    
  }

  /** Zoom around the pointer or resize an active ignore brush with Alt-wheel. */
  zoomPreview(event) {
    const session = this.session;
    event.preventDefault();
    if (session.ignoreGesture) return;
    if (session.ignoreEnabled && event.altKey) {
      const size = session.runtime.clampNumber(session.ignoreSize.value, 1, 100000, 40);
      const step = Math.max(1, Math.round(size * .1));
      session.ignoreSize.value = String(Math.min(100000, Math.max(1, Math.round(size + (event.deltaY < 0 ? step : -step)))));
      session.updateIgnorePointer(event);
      return;
    }
    const bounds = session.previewFrame.getBoundingClientRect();
    const cursorX = event.clientX - bounds.left - bounds.width / 2;
    const cursorY = event.clientY - bounds.top - bounds.height / 2;
    const oldZoom = session.runtime.backgroundPreviewZoom;
    session.runtime.backgroundPreviewZoom = Math.max(
      session.runtime.MIN_BACKGROUND_PREVIEW_ZOOM,
      Math.min(session.runtime.MAX_BACKGROUND_PREVIEW_ZOOM, oldZoom * 1.1 ** (-event.deltaY / 100))
    );
    const ratio = session.runtime.backgroundPreviewZoom / oldZoom;
    session.runtime.backgroundPreviewPan = {
      x: cursorX - (cursorX - session.runtime.backgroundPreviewPan.x) * ratio,
      y: cursorY - (cursorY - session.runtime.backgroundPreviewPan.y) * ratio
    };
    session.updatePreviewTransform();
    
  }
}
