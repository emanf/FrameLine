import {ViewComponent} from '../view-component.mjs';
import {timecode, durationTimecode} from '../view-format.mjs';

/** Render clip properties and readable project/frame status. */
export class ProjectStatusView extends ViewComponent {

  /** Synchronize editable clip properties with the current selection. */
  renderProperties(vm) {
    const range = vm.selectedRange;
    const previewImage = vm.previewImage;
    this.view.renderPreviewTools(previewImage);
    document.querySelector("#selection-empty").hidden = Boolean(range);
    document.querySelector("#clip-properties").hidden = !range;
    if (!range) return;
    const selected = vm.selectedRanges;
    const multiple = selected.length > 1;
    const image = vm.project.images.find((item) => item.id === range.clip.imageId);
    document.querySelector("#clip-name").textContent = multiple ? `${selected.length} clips selected` : image?.name ?? "Missing image";
    document.querySelector("#clip-start").textContent = `Frame ${selected[0].startFrame + 1}`;
    document.querySelector("#clip-end").textContent = `Frame ${selected.at(-1).endFrame}`;
    const uniform = selected.every(item => item.clip.durationFrames === range.clip.durationFrames);
    const frames = document.querySelector("#clip-frames");
    const seconds = document.querySelector("#clip-seconds");
    frames.value = uniform ? range.clip.durationFrames : "";
    seconds.value = uniform ? (range.clip.durationFrames / vm.project.fps).toFixed(2) : "";
    frames.placeholder = seconds.placeholder = uniform ? "" : "Mixed";
    document.querySelector("#selection-timing-hint").hidden = !multiple;
  }

  /** Display readable current-frame and timecode values. */
  renderFrameInfo(vm, frames) {
    this.view.lastFrameInfoFrame = vm.project.currentFrame;
    document.querySelector("#frame-count").textContent = frames ? `${vm.project.currentFrame + 1} / ${frames}` : "0 / 0";
    document.querySelector("#timecode").textContent = timecode(vm.project.currentFrame / vm.project.fps);
  }

  /** Summarize project image count, timeline duration, and active dimensions. */
  renderStats(vm, frames) {
    document.querySelector("#stats-images").textContent = vm.project.images.length;
    document.querySelector("#stats-frames").textContent = frames;
    document.querySelector("#stats-fps").textContent = vm.project.fps;
    document.querySelector("#stats-duration").textContent = durationTimecode(frames / vm.project.fps);
    document.querySelector("#stats-speed").textContent = `${vm.project.playbackSpeed.toFixed(2)}×`;
    document.querySelector("#stats-loop").textContent = `LOOP ${vm.project.loopEnabled ? "ON" : "OFF"}`;
  }

  /** Escape text used in small generated markup fragments. */
  escape(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }
}
