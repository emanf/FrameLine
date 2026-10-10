import { validateCrop, validateStroke, validateOutline } from '../../model/project-model.mjs';
import { originalImage, preserveOriginal, rebaseImageEdits, workingImageRequest, clearPendingEffects, hasImageEdits } from "../../model/image-effects.mjs";

const copy = value => JSON.parse(JSON.stringify(value));

/** Apply non-destructive image edits and retain originals across working-image replacements. */
export class ImageEffectsCommands {
  constructor(viewModel) { this.viewModel = viewModel; }

  /** Commit one validated brush stroke through the shared stroke command. */
  addPaintStroke(imageId, stroke) {
    return this.viewModel.addPaintStrokes(imageId, [stroke]);
  }

  /** Commit completed strokes, optionally preserving a separate undo step for each gesture. */
  addPaintStrokes(imageId, strokes, {separateUndoSteps = false} = {}) {
    const image = this.viewModel.project.images.find((item) => item.id === imageId);
    if (!image || !strokes.length) return false;
    strokes.forEach(validateStroke);
    if (!separateUndoSteps) this.viewModel.record();
    for (const stroke of copy(strokes)) {
      if (separateUndoSteps) this.viewModel.record();
      image.paintStrokes ??= [];
      image.paintStrokes.push(stroke);
    }
    this.viewModel.notify();
    return true;
  }

  /** Process background removal, then commit its owned result if the revision remains valid. */
  async removeImageBackground(imageId, options, currentResult = null) {
    return this.viewModel.processImageBackground(imageId, options, currentResult);
  }

  /** Use the current edited source for removal and release stale generated output. */
  async processImageBackground(imageId, options, currentResult = null) {
    const image = this.viewModel.project.images.find((item) => item.id === imageId);
    if (!image) return;
    const revision = this.viewModel.editRevision;
    const original = originalImage(image);
    const result = options
      ? await this.viewModel.mediaService.removeBackground({ ...options, ...(currentResult ? { path: currentResult.path } : workingImageRequest(image)) })
      : { path: original.path, ...original.dimensions };
    if (revision !== this.viewModel.editRevision || !this.viewModel.project.images.includes(image)) {
      const outputs = options ? [result.path] : [];
      await this.viewModel.mediaService.discardProcessedImages?.(outputs);
      return false;
    }
    this.viewModel.record();
    preserveOriginal(image);
    if (options) image.sourcePath = original.path;
    else delete image.sourcePath;
    clearPendingEffects(image);
    image.width = result.width ?? currentResult?.width ?? image.width;
    image.height = result.height ?? currentResult?.height ?? image.height;
    image.path = result.path;
    this.viewModel.notify();
    return true;
  }

  /** Restore an image original through the shared Clear command. */
  resetImageBackground(imageId) {
    const image = this.viewModel.project.images.find((item) => item.id === imageId);
    if (!image?.sourcePath) return;
    return this.viewModel.clearImageEffects(imageId);
  }

  /** Restore original source paths and dimensions for the current image or all images. */
  clearImageEffects(imageId, applyToAll = false) {
    const targets = this.viewModel.project.images.filter(image => (applyToAll || image.id === imageId) && hasImageEdits(image));
    if (!targets.length) return false;
    this.viewModel.record();
    for (const image of targets) {
      const original = originalImage(image);
      image.path = original.path;
      image.width = original.dimensions.width;
      image.height = original.dimensions.height;
      delete image.sourcePath;
      delete image.outlineSourcePath;
      delete image.outlineSourceDimensions;
      delete image.outlineSettings;
      delete image.paintStrokes;
      delete image.crop;
      delete image.outline;
    }
    this.viewModel.notify();
    return true;
  }

  /** Commit background-removal output through the guarded working-image result command. */
  setImageBackgroundResults(results, expectedRevision = this.viewModel.editRevision) {
    return this.viewModel.setWorkingImageResults(results, expectedRevision, true);
  }

  /** Validate an entire result batch before rebasing image edits and recording one undo step. */
  setWorkingImageResults(results, expectedRevision = this.viewModel.editRevision, backgroundRemoval = false) {
    if (expectedRevision !== this.viewModel.editRevision || !results.length) return false;
    const targets = results.map(result => this.viewModel.project.images.find(image => image.id === result.imageId));
    if (targets.some(image => !image)) return false;
    if (new Set(results.map(result => result.imageId)).size !== results.length
      || results.some(result => typeof result.path !== "string" || !result.path
        || !Number.isSafeInteger(result.width) || result.width < 1
        || !Number.isSafeInteger(result.height) || result.height < 1)) {
      throw new Error("Invalid processed image results.");
    }
    this.viewModel.record();
    results.forEach((result, index) => {
      const image = targets[index];
      preserveOriginal(image);
      if (backgroundRemoval) image.sourcePath = originalImage(image).path;
      clearPendingEffects(image);
      image.path = result.path;
      image.width = result.width;
      image.height = result.height;
    });
    this.viewModel.notify();
    return true;
  }

  /** Commit outlined image results while retaining the source needed by Reset Outline. */
  setImageOutlineResults(results, record = true, expectedRevision = this.viewModel.editRevision) {
    if (expectedRevision !== this.viewModel.editRevision) return false;
    const validResults = results.filter(({ imageId }) => this.viewModel.project.images.some((image) => image.id === imageId));
    if (!validResults.length) return false;
    validResults.forEach(({ outline }) => validateOutline(outline));
    if (record) this.viewModel.record();
    else this.viewModel.editRevision += 1;
    for (const { imageId, path, width, height, outline, basePath, baseDimensions, bakedEdits } of validResults) {
      const image = this.viewModel.project.images.find((item) => item.id === imageId);
      preserveOriginal(image);
      if (bakedEdits) clearPendingEffects(image);
      if (basePath) {
        image.outlineSourcePath = basePath;
        image.outlineSourceDimensions = { ...baseDimensions };
      }
      if (!image.outlineSourcePath) {
        image.outlineSourcePath = image.path;
        image.outlineSourceDimensions = { width: image.width, height: image.height };
      }
      image.path = path;
      rebaseImageEdits(image, width, height);
      image.outlineSettings = copy(outline);
      delete image.outline;
    }
    this.viewModel.notify();
    return true;
  }

  /** Restore pre-outline sources for the requested image IDs. */
  resetImageOutline(imageIds) {
    const targets = this.viewModel.project.images.filter((image) => imageIds.includes(image.id) && image.outlineSourcePath);
    if (!targets.length) return false;
    this.viewModel.record();
    for (const image of targets) {
      image.path = image.outlineSourcePath;
      if (image.outlineSourceDimensions) {
        rebaseImageEdits(image, image.outlineSourceDimensions.width, image.outlineSourceDimensions.height);
      }
      delete image.outlineSourcePath;
      delete image.outlineSourceDimensions;
      delete image.outlineSettings;
      delete image.outline;
    }
    this.viewModel.notify();
    return true;
  }

  /** Validate and commit normalized crop bounds for one image or the entire project. */
  setImageCrop(imageId, crop, applyToAll = false) {
    const image = this.viewModel.project.images.find((item) => item.id === imageId);
    if (!image) return false;
    validateCrop(crop);
    const targets = applyToAll ? this.viewModel.project.images : [image];
    const nextCrop = crop && (crop.left > 0 || crop.top > 0 || crop.right < 1 || crop.bottom < 1)
      ? copy(crop)
      : undefined;
    if (targets.every((target) => JSON.stringify(target.crop) === JSON.stringify(nextCrop))) return false;
    this.viewModel.record();
    for (const target of targets) {
      if (nextCrop) target.crop = copy(nextCrop);
      else delete target.crop;
    }
    this.viewModel.notify();
    return true;
  }
}
