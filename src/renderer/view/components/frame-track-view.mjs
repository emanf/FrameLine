import {ViewComponent} from '../view-component.mjs';

import {totalFrames, loopRange} from '../../model/project-model.mjs';

/** Render virtual clips, frame ruler, playhead, and loop bounds. */
export class FrameTrackView extends ViewComponent {

  /** Position inclusive Start/End loop handles inside the frame track. */
  renderLoopRange(vm, px) {
    const frames = vm.totalFrames;
    const { startFrame, endFrame } = loopRange(vm.project, frames);
    const start = document.querySelector("#loop-start");
    const end = document.querySelector("#loop-end");
    const band = document.querySelector("#loop-range-band");
    const lane = document.querySelector("#loop-range");
    lane.classList.toggle("loop-disabled", !vm.project.loopEnabled);
    document.querySelector("#loop-range-empty").hidden = Boolean(frames);
    for (const element of [start, end, band]) element.hidden = !frames;
    band.style.left = `${startFrame * px}px`;
    band.style.width = `${(endFrame - startFrame) * px}px`;
    start.style.left = `${startFrame * px}px`;
    // Keep the End handle reachable even at very small timeline zoom levels.
    end.style.left = `${Math.max(66, endFrame * px)}px`;
    document.querySelector("#loop-start-label").textContent = `Start ${startFrame + 1}`;
    document.querySelector("#loop-end-label").textContent = `End ${endFrame}`;
    for (const [handle, value, min, max] of [[start, startFrame + 1, 1, endFrame], [end, endFrame, startFrame + 1, frames]]) {
      handle.setAttribute("aria-valuenow", value);
      handle.setAttribute("aria-valuemin", min);
      handle.setAttribute("aria-valuemax", max);
      handle.setAttribute("aria-valuetext", `Frame ${value}`);
    }
  }

  /** Render cached frame ruler ticks for the visible duration and zoom. */
  renderRuler(frames, px) {
    const desired = 20 / px;
    const choices = [1, 2, 5, 10, 12, 15, 20, 24, 25, 30, 50, 60, 100, 120, 240, 500, 1000, 2000, 5000, 10000];
    const interval = choices.find((value) => value >= desired) ?? 10000;
    const visibleStart = Math.max(0, Math.floor(this.view.timelineScroll.scrollLeft / px) - interval);
    const visibleEnd = Math.min(frames, Math.ceil((this.view.timelineScroll.scrollLeft + this.view.timelineScroll.clientWidth) / px) + interval);
    const firstMark = Math.floor(visibleStart / interval) * interval;
    const lastMark = Math.ceil(visibleEnd / interval) * interval;
    const cacheKey = `${frames}:${px}:${interval}:${firstMark}:${lastMark}`;
    if (cacheKey === this.view.rulerCacheKey) return;
    this.view.rulerCacheKey = cacheKey;
    this.view.ruler.replaceChildren();
    for (let frame = firstMark; frame < lastMark && frame < frames; frame += interval) {
      const mark = document.createElement("div");
      mark.className = "ruler-mark major";
      mark.style.left = `${frame * px}px`;
      const label = document.createElement("span");
      label.textContent = String(frame + 1);
      mark.append(label);
      this.view.ruler.append(mark);
    }
    if (!frames) {
      const mark = document.createElement("div");
      mark.className = "ruler-mark major";
      mark.style.left = "0";
      mark.innerHTML = "<span>1</span>";
      this.view.ruler.append(mark);
    }
  }

  /** Capture clip render inputs and refresh the visible track window. */
  renderClips(vm, ranges, px, imagesById) {
    this.view.clipRenderState = { vm, ranges, px, imagesById };
    this.view.clipsElement.style.width = `${Math.max(this.view.timelineScroll.clientWidth, Math.ceil(totalFrames(vm.project) * px), 1)}px`;
    this.view.visibleClipKey = null;
    this.view.renderVisibleClips();
    document.querySelector("#track").style.backgroundSize = `${px}px 100%`;
  }

  /** Render visible timeline clips with selection, duration, and thumbnail state. */
  renderVisibleClips() {
    if (!this.view.clipRenderState) return;
    const { vm, ranges, px, imagesById } = this.view.clipRenderState;
    const overscan = 500;
    const firstVisibleFrame = Math.max(0, Math.floor((this.view.timelineScroll.scrollLeft - overscan) / px));
    const lastVisibleFrame = Math.ceil((this.view.timelineScroll.scrollLeft + this.view.timelineScroll.clientWidth + overscan) / px);
    let low = 0;
    let high = ranges.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (ranges[middle].endFrame <= firstVisibleFrame) low = middle + 1;
      else high = middle;
    }
    const firstIndex = low;
    while (low < ranges.length && ranges[low].startFrame < lastVisibleFrame) low += 1;
    const visibleClipKey = `${firstIndex}:${low}`;
    if (visibleClipKey === this.view.visibleClipKey) return;
    this.view.visibleClipKey = visibleClipKey;
    const fragment = document.createDocumentFragment();
    for (const { clip, startFrame } of ranges.slice(firstIndex, low)) {
      const image = imagesById.get(clip.imageId);
      const element = document.createElement("div");
      element.className = `timeline-clip${vm.selectedClipIds.has(clip.id) ? " selected" : ""}`;
      element.setAttribute("role", "option");
      element.setAttribute("aria-label", `${image?.name ?? "Missing image"}, ${clip.durationFrames} frames`);
      element.setAttribute("aria-selected", vm.selectedClipIds.has(clip.id));
      element.dataset.clipId = clip.id;
      element.draggable = true;
      element.style.left = `${startFrame * px}px`;
      element.style.width = `${Math.max(1, clip.durationFrames * px)}px`;
      if (image) {
        const thumbnail = document.createElement("img");
        thumbnail.alt = "";
        thumbnail.draggable = false;
        thumbnail.decoding = "async";
        this.view.setThumbnail(thumbnail, image);
        element.append(thumbnail);
      }
      if (clip.durationFrames * px >= 55) {
        const label = document.createElement("div");
        label.className = "clip-label";
        const name = document.createElement("strong");
        name.textContent = image?.name ?? "Missing image";
        label.append(name);
        if (clip.durationFrames * px >= 115) {
          const duration = document.createElement("span");
          duration.textContent = `${clip.durationFrames} fr · ${(clip.durationFrames / vm.project.fps).toFixed(2)} s`;
          label.append(duration);
        }
        element.append(label);
      }
      const resize = document.createElement("div");
      resize.className = "clip-resize";
      resize.dataset.tooltip = "Drag to resize (whole frames)";
      resize.dataset.startFrame = String(startFrame);
      resize.dataset.clipId = clip.id;
      element.append(resize);
      fragment.append(element);
    }
    this.view.clipsElement.replaceChildren(fragment);
  }

  /** Update playback labels and preview without rebuilding the full project view. */
  updateFrame(vm, fractionalFrame = 0) {
    const frame = vm.project.currentFrame;
    if (frame !== this.view.lastFrameInfoFrame) this.view.renderFrameInfo(vm, vm.totalFrames);
    this.view.updatePlayhead(vm.project.currentFrame + fractionalFrame, 4 * vm.zoom / 100);
    if (frame !== this.view.lastPreviewFrame) this.view.updatePreview(vm);
  }

  /** Position the playhead in whole or fractional display-frame coordinates. */
  updatePlayhead(frame, px) {
    this.view.playhead.style.transform = `translate3d(${frame * px}px, 0, 0)`;
  }
}
