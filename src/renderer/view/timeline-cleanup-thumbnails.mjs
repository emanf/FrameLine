import {imageUrl} from './view-format.mjs';

/** Materialize one preview page with bounded concurrency and owned temporary outputs. */
export class TimelineCleanupThumbnails {
  constructor(resolveImage, releaseImages) {
    this.resolveImage = resolveImage;
    this.releaseImages = releaseImages;
    this.generation = 0;
    this.paths = new Set();
  }

  /** Retire a page; late results release themselves rather than updating detached cards. */
  clear() {
    this.generation++;
    this.release([...this.paths]);
    this.paths.clear();
  }

  /** Release only files owned by the materialization service. */
  release(paths) {
    if (paths.length) Promise.resolve(this.releaseImages(paths)).catch(error => console.error(error));
  }

  /** Render each distinct edited source once, using at most two simultaneous requests. */
  async render(cards) {
    const generation = this.generation;
    const sources = new Map();
    for (const {image,element} of cards) {
      if (!sources.has(image.id)) sources.set(image.id,{image,elements:[]});
      sources.get(image.id).elements.push(element);
    }
    const queue = [...sources.values()];
    let error = null;
    const consume = async () => {
      while (queue.length && generation === this.generation) {
        const {image,elements} = queue.shift();
        try {
          const result = await this.resolveImage(image);
          if (generation !== this.generation) {
            if (result.temporary) this.release([result.path]);
            continue;
          }
          if (result.temporary) this.paths.add(result.path);
          for (const element of elements) element.src = imageUrl(result.path);
        } catch (failure) {
          error ??= failure;
        }
      }
    };
    await Promise.all([consume(),consume()]);
    if (generation === this.generation && error) throw error;
  }
}
