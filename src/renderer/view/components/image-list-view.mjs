import {ViewComponent} from '../view-component.mjs';

/** Render virtual source-list rows and selection without mutating project data. */
export class ImageListView extends ViewComponent {

  /** Create one accessible asset-list row and request its cached thumbnail. */
  imageRow(image, index) {
    const row = document.createElement("div");
    row.className = "image-row";
    row.classList.toggle('active', image.id === this.view.activeImageId);
    row.classList.toggle('selected', this.view.selectedImageIds?.has(image.id) ?? false);
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(this.view.selectedImageIds?.has(image.id) ?? false));
    row.draggable = true;
    row.dataset.imageId = image.id;
    row.innerHTML = `<img class="image-thumb" alt="" draggable="false"><div class="image-info"><div class="image-index">${String(index + 1).padStart(2, "0")}</div><div class="image-name" data-tooltip="${this.view.escape(image.name)}">${this.view.escape(image.name)}</div></div><button class="image-remove" type="button" data-image-id="${this.view.escape(image.id)}" aria-label="Remove ${this.view.escape(image.name)}" data-tooltip="Remove image and its timeline clips"><span class="material-icon" aria-hidden="true">close</span></button>`;
    const thumbnail = row.querySelector("img");
    thumbnail.decoding = "async";
    this.view.setThumbnail(thumbnail, image);
    return row;
  }

  /** Invalidate virtual rows when asset identities, names, or working paths change. */
  updateImageList(images) {
    const key = images.map((image) => `${image.id}\0${image.path}\0${image.name}\0${JSON.stringify(image.crop ?? null)}`).join("\u0001");
    if (key !== this.view.imageListKey) {
      this.view.images = images;
      this.view.imageListKey = key;
      this.view.visibleImageWindowKey = null;
      this.view.imageListContent.style.height = `${16 + images.length * 48}px`;
    } else {
      this.view.images = images;
    }
    this.view.renderVisibleImageRows();
  }

  /** Render only visible rows while retaining active selection and dragged items. */
  renderVisibleImageRows() {
    if (!this.view.imageListContent) return;
    const rowHeight = 48;
    const buffer = 5;
    const firstIndex = Math.max(0, Math.floor((this.view.imageList.scrollTop - 8) / rowHeight) - buffer);
    const lastIndex = Math.min(
      this.view.images.length,
      Math.ceil((this.view.imageList.scrollTop + this.view.imageList.clientHeight - 8) / rowHeight) + buffer
    );
    const indexes = new Set();
    for (let index = firstIndex; index < lastIndex; index += 1) indexes.add(index);
    if (this.view.draggedImageId) {
      const draggedIndex = this.view.images.findIndex((image) => image.id === this.view.draggedImageId);
      if (draggedIndex >= 0) indexes.add(draggedIndex);
    }
    const windowKey = `${[...indexes].sort((a, b) => a - b).join(",")}`;
    if (windowKey === this.view.visibleImageWindowKey) return;
    this.view.visibleImageWindowKey = windowKey;
    const fragment = document.createDocumentFragment();
    for (const index of [...indexes].sort((a, b) => a - b)) {
      const row = this.view.imageRow(this.view.images[index], index);
      row.style.top = `${8 + index * rowHeight}px`;
      fragment.append(row);
    }
    this.view.imageListContent.replaceChildren(fragment);
  }
}
