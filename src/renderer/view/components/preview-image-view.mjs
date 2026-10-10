import {ViewComponent} from '../view-component.mjs';
import {imageUrl} from '../view-format.mjs';

import {hasImageEdits} from '../../model/image-effects.mjs';

/** Render active working images and registered tool availability. */
export class PreviewImageView extends ViewComponent {

  /** Enable registered image-dependent tools according to the active source. */
  renderPreviewTools(image) {
    for (const tool of this.view.toolRegistry?.values() ?? []) {
      if (tool.id !== 'clear' && tool.definition.mode !== 'pointer') document.getElementById(tool.buttonId).disabled = !image;
    }
    document.querySelector('#preview-clear-effects').disabled = !image || !this.view.images.some(hasImageEdits);
  }

  /** Display the active working image and update source-list activation and resolution. */
  updatePreview(vm) {
    this.view.lastPreviewFrame = vm.project.currentFrame;
    const ranges = vm.ranges;
    const rangeIndex = ranges.findIndex(({ startFrame, endFrame }) => vm.project.currentFrame >= startFrame && vm.project.currentFrame < endFrame);
    const range = ranges[rangeIndex];
    const image = vm.previewImage;
    if (this.view.activeImageId !== image?.id) {
      this.view.activeImageId = image?.id ?? null;
      for (const row of this.view.imageList.querySelectorAll('.image-row')) row.classList.toggle('active', row.dataset.imageId === this.view.activeImageId);
    }
    const nextRange = rangeIndex >= 0 ? ranges[(rangeIndex + 1) % ranges.length] : null;
    const nextImage = nextRange && this.view.imagesById.get(nextRange.clip.imageId);
    this.view.cachePreviewImages([image, nextImage?.path === image?.path ? null : nextImage]);
    const preview = document.querySelector("#preview-image");
    const previewWrap = document.querySelector("#preview-image-wrap");
    const placeholder = document.querySelector(".preview-placeholder");
    const path = image?.path ?? null;
    this.view.renderPreviewTools(image);
    if (path !== this.view.lastPreviewPath) {
      this.view.lastPreviewPath = path;
      this.view.lastActiveImageId = image?.id ?? null;
      if (path) {
        preview.hidden = false;
        preview.src = imageUrl(path);
        previewWrap.hidden = false;
        placeholder.hidden = true;
        document.querySelector("#preview-resolution").textContent = `${image.width} × ${image.height}`;
      } else {
        preview.removeAttribute("src");
        previewWrap.hidden = true;
        placeholder.hidden = false;
        document.querySelector("#preview-resolution").textContent = "NO IMAGE";
      }
    }
  }
}
