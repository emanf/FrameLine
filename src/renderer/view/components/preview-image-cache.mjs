import {ViewComponent} from '../view-component.mjs';
import {imageUrl} from '../view-format.mjs';

/** Manage bounded decode and thumbnail work for active and nearby assets. */
export class PreviewImageCache extends ViewComponent {

  /** Return an available decoded image from the bounded preview cache. */
  getDecodedPreviewImage(path) {
    const decoder = this.view.imageDecodeCache.get(path)?.decoder;
    return decoder?.complete && decoder.naturalWidth ? decoder : null;
  }

  /** Retire cached images and thumbnails no longer referenced by project assets. */
  cacheProjectImages(images) {
    const activePaths = new Set(images.map((image) => image.path));
    for (const path of this.view.imageDecodeCache.keys()) {
      if (!activePaths.has(path)) this.view.imageDecodeCache.delete(path);
    }
    for (const [path, entry] of this.view.thumbnailCache) {
      if (activePaths.has(path)) continue;
      if (entry.url) URL.revokeObjectURL(entry.url);
      this.view.thumbnailCache.delete(path);
    }
  }

  /** Warm a bounded set of nearby preview images for smoother playback. */
  cachePreviewImages(images) {
    const wantedPaths = new Set(images.filter(Boolean).map((image) => image.path));
    for (const path of this.view.imageDecodeCache.keys()) {
      if (!wantedPaths.has(path)) this.view.imageDecodeCache.delete(path);
    }
    for (const image of images) {
      if (!image || this.view.imageDecodeCache.has(image.path)) continue;
      const decoder = new Image();
      decoder.decoding = "async";
      const entry = { decoder, status: "loading" };
      this.view.imageDecodeCache.set(image.path, entry);
      decoder.src = imageUrl(image.path);
      decoder.decode()
        .then(() => { entry.status = "ready"; })
        .catch((error) => {
          this.view.imageDecodeCache.delete(image.path);
          console.warn(`Could not preload preview image "${image.name}":`, error);
        });
    }
  }

  /** Apply a cached thumbnail or enqueue a bounded decode request. */
  setThumbnail(element, image) {
    const crop = image.crop;
    element.style.clipPath = crop
      ? `inset(${crop.top * 100}% ${(1 - crop.right) * 100}% ${(1 - crop.bottom) * 100}% ${crop.left * 100}%)`
      : "";
    const cached = this.view.thumbnailCache.get(image.path);
    if (cached?.state === "ready") {
      element.dataset.thumbnailPath = image.path;
      element.src = cached.url;
      return;
    }
    let entry = cached;
    if (!entry) {
      entry = { state: "queued", url: null, elements: new Set(), name: image.name };
      this.view.thumbnailCache.set(image.path, entry);
      this.view.thumbnailQueue.push(image.path);
    }
    entry.elements.add(element);
    element.dataset.thumbnailPath = image.path;
    this.view.processThumbnailQueue();
  }

  /** Decode queued thumbnails with limited concurrency and reject obsolete row results. */
  processThumbnailQueue() {
    while (this.view.activeThumbnailLoads < 2 && this.view.thumbnailQueue.length) {
      const path = this.view.thumbnailQueue.shift();
      const entry = this.view.thumbnailCache.get(path);
      if (!entry || entry.state !== "queued") continue;
      entry.state = "loading";
      this.view.activeThumbnailLoads += 1;
      const source = new Image();
      source.decoding = "async";
      source.src = imageUrl(path);
      source.decode()
        .then(() => new Promise((resolve, reject) => {
          const scale = Math.min(1, 256 / source.naturalWidth, 144 / source.naturalHeight);
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(source.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(source.naturalHeight * scale));
          const context = canvas.getContext("2d");
          if (!context) {
            reject(new Error("Could not create thumbnail canvas."));
            return;
          }
          context.drawImage(source, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((blob) => {
            if (blob) resolve(URL.createObjectURL(blob));
            else reject(new Error("Could not encode image thumbnail."));
          }, "image/webp", 0.82);
        }))
        .then((url) => {
          if (this.view.thumbnailCache.get(path) !== entry) {
            URL.revokeObjectURL(url);
            return;
          }
          entry.url = url;
          entry.state = "ready";
          for (const element of entry.elements) {
            if (element.isConnected && element.dataset.thumbnailPath === path) element.src = url;
          }
          entry.elements.clear();
        })
        .catch((error) => {
          if (this.view.thumbnailCache.get(path) === entry) this.view.thumbnailCache.delete(path);
          console.warn(`Could not create thumbnail for "${entry.name}":`, error);
        })
        .finally(() => {
          this.view.activeThumbnailLoads -= 1;
          this.view.processThumbnailQueue();
        });
    }
  }
}
