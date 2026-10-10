import {imageUrl, timecode} from './view-format.mjs';
import {ImageListView} from './components/image-list-view.mjs';
import {FrameTrackView} from './components/frame-track-view.mjs';
import {PreviewImageCache} from './components/preview-image-cache.mjs';
import {PreviewImageView} from './components/preview-image-view.mjs';
import {ProjectStatusView} from './components/project-status-view.mjs';
import {clipRanges, totalFrames} from '../model/project-model.mjs';








/** Compose timeline, source-list, preview, status, and bounded resource-cache views. */
export class TimelineView {
  /** Bind shared DOM references and compose specialized presentation components. */
  constructor(toolRegistry) {
    this.toolRegistry = toolRegistry;
    this.imageListView = new ImageListView(this);
    this.frameTrackView = new FrameTrackView(this);
    this.previewImageCache = new PreviewImageCache(this);
    this.previewImageView = new PreviewImageView(this);
    this.projectStatusView = new ProjectStatusView(this);

    this.imageList = document.querySelector("#image-list");
    this.imageListContent = document.createElement("div");
    this.imageListContent.className = "image-list-virtual";
    this.imageList.replaceChildren(this.imageListContent);
    this.timelineScroll = document.querySelector("#timeline-scroll");
    this.timelineContent = document.querySelector("#timeline-content");
    this.ruler = document.querySelector("#ruler");
    this.clipsElement = document.querySelector("#clips");
    this.playhead = document.querySelector("#playhead");
    this.lastPreviewPath = null;
    this.lastActiveImageId = null;
    this.lastFrameInfoFrame = null;
    this.lastPreviewFrame = null;
    this.imageDecodeCache = new Map();
    this.thumbnailCache = new Map();
    this.thumbnailQueue = [];
    this.activeThumbnailLoads = 0;
    this.selectedClipId = null;
    this.selectedClipElement = null;
    this.rulerCacheKey = null;
    this.clipRenderState = null;
    this.visibleClipKey = null;
    this.images = [];
    this.imageListKey = null;
    this.visibleImageWindowKey = null;
    this.draggedImageId = null;
    this.imageList.addEventListener("scroll", () => this.renderVisibleImageRows(), { passive: true });
    this.imageList.addEventListener("dragstart", (event) => {
      const row = event.target.closest(".image-row");
      if (!row) return;
      this.draggedImageId = row.dataset.imageId;
    });
    this.imageList.addEventListener("dragend", () => {
      this.draggedImageId = null;
      this.renderVisibleImageRows();
    });
    this.imageListResizeObserver = new ResizeObserver(() => this.renderVisibleImageRows());
    this.imageListResizeObserver.observe(this.imageList);
  }

  render(vm) {
    const project = vm.project;
    this.selectedImageIds = vm.selectedImageIds;
    this.cacheProjectImages(project.images);
    const ranges = clipRanges(project);
    const imagesById = new Map(project.images.map((image) => [image.id, image]));
    this.imagesById = imagesById;
    const frames = totalFrames(project);
    const pixelsPerFrame = 4 * vm.zoom / 100;
    const width = Math.max(this.timelineScroll.clientWidth, Math.ceil(frames * pixelsPerFrame) + 70, 1);
    this.timelineContent.style.width = `${width}px`;
    this.updateImageList(project.images);
    for (const row of this.imageList.querySelectorAll('.image-row')) {
      const selected = vm.selectedImageIds.has(row.dataset.imageId);
      row.classList.toggle('selected', selected);
      row.setAttribute('aria-selected', String(selected));
    }
    document.querySelector("#image-count").textContent = `${project.images.length} ${project.images.length === 1 ? "image" : "images"}`;
    document.querySelector("#clear-images").hidden = project.images.length === 0;
    document.querySelector('#rename-images').hidden = project.images.length === 0;
    document.querySelector("#empty-list").classList.toggle("visible", project.images.length === 0);
    document.querySelector("#image-list").style.display = project.images.length ? "block" : "none";
    document.querySelector("#fps-display").textContent = `${project.fps} FPS`;
    document.querySelector("#fps-badge").textContent = `${project.fps} FPS`;
    const fpsSelect = document.querySelector("#fps-select");
    fpsSelect.value = [...fpsSelect.options].some((option) => option.value === String(project.fps)) ? String(project.fps) : "add";
    document.querySelector("#speed-display").textContent = `${project.playbackSpeed.toFixed(2)}×`;
    const speedSelect = document.querySelector("#speed-select");
    speedSelect.value = [...speedSelect.options].some((option) => option.value === String(project.playbackSpeed)) ? String(project.playbackSpeed) : "add";
    document.querySelector("#loop-toggle").setAttribute("aria-pressed", String(project.loopEnabled));
    document.querySelector("#loop-toggle strong").textContent = project.loopEnabled ? "ON" : "OFF";
    document.querySelector("#default-duration").value = project.defaultDurationFrames;
    const projectTitle = document.querySelector("#project-name");
    if (document.activeElement !== projectTitle) projectTitle.value = project.name;
    document.querySelector("#undo").disabled = !vm.canUndo;
    document.querySelector("#redo").disabled = !vm.canRedo;
    document.querySelector("#zoom-slider").value = vm.zoom;
    document.querySelector("#zoom-label").textContent = `${vm.zoom}%`;
    this.renderRuler(frames, pixelsPerFrame);
    this.renderClips(vm, ranges, pixelsPerFrame, imagesById);
    this.renderLoopRange(vm, pixelsPerFrame);
    this.renderProperties(vm);
    this.renderFrameInfo(vm, frames);
    this.updatePlayhead(project.currentFrame, pixelsPerFrame);
    this.renderStats(vm, frames);
    this.updatePreview(vm);
  }

  imageRow(image, index) { return this.imageListView.imageRow(image, index); }

  renderLoopRange(vm, px) { return this.frameTrackView.renderLoopRange(vm, px); }

  updateImageList(images) { return this.imageListView.updateImageList(images); }

  renderVisibleImageRows() { return this.imageListView.renderVisibleImageRows(); }

  renderRuler(frames, px) { return this.frameTrackView.renderRuler(frames, px); }

  renderClips(vm, ranges, px, imagesById) { return this.frameTrackView.renderClips(vm, ranges, px, imagesById); }

  renderVisibleClips() { return this.frameTrackView.renderVisibleClips(); }

  renderProperties(vm) { return this.projectStatusView.renderProperties(vm); }

  renderPreviewTools(image) { return this.previewImageView.renderPreviewTools(image); }

  renderFrameInfo(vm, frames) { return this.projectStatusView.renderFrameInfo(vm, frames); }

  renderStats(vm, frames) { return this.projectStatusView.renderStats(vm, frames); }

  updateFrame(vm, fractionalFrame = 0) { return this.frameTrackView.updateFrame(vm, fractionalFrame); }

  updatePlayhead(frame, px) { return this.frameTrackView.updatePlayhead(frame, px); }

  getDecodedPreviewImage(path) { return this.previewImageCache.getDecodedPreviewImage(path); }

  cacheProjectImages(images) { return this.previewImageCache.cacheProjectImages(images); }

  cachePreviewImages(images) { return this.previewImageCache.cachePreviewImages(images); }

  setThumbnail(element, image) { return this.previewImageCache.setThumbnail(element, image); }

  processThumbnailQueue() { return this.previewImageCache.processThumbnailQueue(); }

  updatePreview(vm) { return this.previewImageView.updatePreview(vm); }

  escape(value) { return this.projectStatusView.escape(value); }
}

export { imageUrl, timecode };
