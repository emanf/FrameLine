import { loopRange } from "../model/project-model.mjs";

export function initializeLoopControls(vm, stopPlayback) {
  const lane = document.querySelector("#loop-range");
  const scroll = document.querySelector("#timeline-scroll");
  let drag = null;
  let animationFrame = null;

  const update = () => {
    if (!drag) return;
    const px = 4 * vm.zoom / 100;
    const contentLeft = document.querySelector("#timeline-content").getBoundingClientRect().left;
    const boundary = drag.boundary + Math.round((drag.clientX - contentLeft - drag.initialX) / px);
    const range = loopRange(vm.project, vm.totalFrames);
    if (drag.edge === "start") vm.setLoopRange(Math.max(0, Math.min(range.endFrame - 1, boundary)), range.endFrame, true);
    else vm.setLoopRange(range.startFrame, Math.max(range.startFrame + 1, Math.min(vm.totalFrames, boundary)), true);
  };

  // Continue scrolling while a handle is held near either viewport edge.
  const autoScroll = () => {
    if (!drag) return;
    const bounds = scroll.getBoundingClientRect();
    const distance = drag.clientX < bounds.left + 24 ? drag.clientX - bounds.left - 24
      : drag.clientX > bounds.right - 24 ? drag.clientX - bounds.right + 24 : 0;
    if (distance) {
      scroll.scrollLeft += Math.max(-20, Math.min(20, distance / 3));
      update();
    }
    animationFrame = requestAnimationFrame(autoScroll);
  };

  lane.addEventListener("pointerdown", event => {
    const handle = event.target.closest(".loop-handle");
    if (!handle || event.button !== 0 || !vm.totalFrames) return;
    event.preventDefault();
    stopPlayback();
    handle.focus();
    const edge = handle.id === "loop-start" ? "start" : "end";
    const range = loopRange(vm.project, vm.totalFrames);
    drag = {
      edge, handle, pointerId: event.pointerId, snapshot: vm.snapshot(),
      boundary: edge === "start" ? range.startFrame : range.endFrame,
      initialX: event.clientX - document.querySelector("#timeline-content").getBoundingClientRect().left,
      clientX: event.clientX
    };
    handle.setPointerCapture(event.pointerId);
    document.documentElement.classList.add("loop-dragging");
    animationFrame = requestAnimationFrame(autoScroll);
  });

  document.addEventListener("pointermove", event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.clientX = event.clientX;
    update();
  });

  const finish = (cancel = false) => {
    if (!drag) return;
    const { handle, pointerId, snapshot } = drag;
    drag = null;
    cancelAnimationFrame(animationFrame);
    animationFrame = null;
    document.documentElement.classList.remove("loop-dragging");
    if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    if (cancel) vm.applySnapshot(snapshot);
    else vm.commitLoopRange(snapshot);
  };
  document.addEventListener("pointerup", event => {
    if (drag && event.pointerId === drag.pointerId) { drag.clientX = event.clientX; update(); finish(); }
  });
  document.addEventListener("pointercancel", event => {
    if (drag && event.pointerId === drag.pointerId) finish(true);
  });
  lane.addEventListener("lostpointercapture", () => finish(true));
  window.addEventListener("blur", () => finish(true));
  lane.addEventListener("keydown", event => {
    if (event.key === "Escape" && drag) { event.preventDefault(); event.stopPropagation(); finish(true); return; }
    const handle = event.target.closest(".loop-handle");
    if (!handle || drag || !vm.totalFrames || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    stopPlayback();
    const range = loopRange(vm.project, vm.totalFrames);
    const start = handle.id === "loop-start";
    const min = start ? 0 : range.startFrame + 1;
    const max = start ? range.endFrame - 1 : vm.totalFrames;
    const current = start ? range.startFrame : range.endFrame;
    const value = event.key === "Home" ? min : event.key === "End" ? max
      : Math.max(min, Math.min(max, current + (event.key === "ArrowLeft" ? -1 : 1)));
    vm.setLoopRange(start ? value : range.startFrame, start ? range.endFrame : value);
  });
}
