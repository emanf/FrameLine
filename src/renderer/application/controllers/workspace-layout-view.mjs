import { ControllerBase } from '../controller-base.mjs';


/** Resize workspace panels and persist their dimensions. */
export class WorkspaceLayoutView extends ControllerBase {
  /** Bind a panel drag handle with size limits and saved layout dimensions. */
  configurePanelResizer(selector, direction, panel) {
    const runtime = this.application;
    const handle = document.querySelector(selector);
    const root = document.documentElement;
    const workspace = document.querySelector(".workspace");
    const main = document.querySelector("main");
    let pointerId = null;
  
    const currentSize = () => {
      if (panel === "image") return workspace.querySelector(".image-panel").getBoundingClientRect().width;
      if (panel === "properties") return workspace.querySelector(".properties-panel").getBoundingClientRect().width;
      return document.querySelector(".timeline-panel").getBoundingClientRect().height;
    };
    const bounds = () => {
      if (panel === "image") {
        const otherWidth = workspace.querySelector(".properties-panel").getBoundingClientRect().width;
        return { min: 135, max: Math.max(135, workspace.clientWidth - otherWidth - 180 - 32) };
      }
      if (panel === "properties") {
        const otherWidth = workspace.querySelector(".image-panel").getBoundingClientRect().width;
        return { min: 160, max: Math.max(160, workspace.clientWidth - otherWidth - 180 - 32) };
      }
      return { min: 160, max: Math.max(160, main.clientHeight - 18 - 8 - 180) };
    };
    const setSize = (size) => {
      const limits = bounds();
      const clamped = Math.max(limits.min, Math.min(limits.max, size));
      if (panel === "image") root.style.setProperty("--image-panel-width", `${clamped}px`);
      else if (panel === "properties") root.style.setProperty("--properties-panel-width", `${clamped}px`);
      else root.style.setProperty("--timeline-height", `${clamped}px`);
      handle.setAttribute("aria-valuenow", String(Math.round(clamped)));
    };
    const pointSize = (event) => {
      if (direction === "horizontal") return main.getBoundingClientRect().bottom - 9 - event.clientY;
      if (panel === "image") return event.clientX - workspace.getBoundingClientRect().left;
      return workspace.getBoundingClientRect().right - event.clientX;
    };
  
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      pointerId = event.pointerId;
      handle.setPointerCapture(pointerId);
      handle.classList.add("dragging");
    });
    handle.addEventListener("pointermove", (event) => {
      if (event.pointerId === pointerId) setSize(pointSize(event));
    });
    const stopResize = (event) => {
      if (event.pointerId !== pointerId) return;
      pointerId = null;
      handle.classList.remove("dragging");
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      runtime.scheduleSavePreferences();
    };
    handle.addEventListener("pointerup", stopResize);
    handle.addEventListener("pointercancel", stopResize);
    handle.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      const delta = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -10 : 10;
      setSize(currentSize() + delta);
      runtime.scheduleSavePreferences();
    });
    setSize(currentSize());
  }

  /** Bind layout resizers after the editor state and required controls are ready. */
  initializeLayoutResizers() {
    const runtime = this.application;
    runtime.configurePanelResizer("#image-panel-resizer", "vertical", "image");
    runtime.configurePanelResizer("#properties-panel-resizer", "vertical", "properties");
    runtime.configurePanelResizer("#timeline-resizer", "horizontal", "timeline");
    runtime.rulerRenderFrame = null;
    document.querySelector("#timeline-scroll").addEventListener("scroll", () => {
      if (runtime.rulerRenderFrame !== null) return;
      runtime.rulerRenderFrame = requestAnimationFrame(() => {
        runtime.rulerRenderFrame = null;
        runtime.view.renderRuler(runtime.vm.totalFrames, 4 * runtime.vm.zoom / 100);
        runtime.view.renderVisibleClips();
      });
    }, { passive: true });
    document.querySelector("#image-list").addEventListener("wheel", (event) => {
      event.stopPropagation();
    }, { passive: true });
    document.querySelector("#timeline-scroll").addEventListener("wheel", (event) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const scale = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? runtime.scroll.clientWidth
          : 1;
      const maxScroll = runtime.scroll.scrollWidth - runtime.scroll.clientWidth;
      const nextScroll = Math.max(0, Math.min(maxScroll, runtime.scroll.scrollLeft + event.deltaY * scale));
      if (nextScroll === runtime.scroll.scrollLeft) return;
      event.preventDefault();
      runtime.scroll.scrollLeft = nextScroll;
    }, { passive: false });
    document.querySelector("#ruler").addEventListener("click", (event) => {
      runtime.scroll.focus({preventScroll:true});
      runtime.vm.setFrame(Math.floor((event.clientX - document.querySelector("#timeline-content").getBoundingClientRect().left) / (4 * runtime.vm.zoom / 100)));
    });
    document.querySelector("#track").addEventListener("click", (event) => {
      if (!event.target.closest('#loop-range')) runtime.scroll.focus({preventScroll:true});
      if (!event.target.closest(".timeline-clip, .clip-resize, #loop-range")) runtime.setCurrentFrameFromPointer(event);
    });
  }
}
