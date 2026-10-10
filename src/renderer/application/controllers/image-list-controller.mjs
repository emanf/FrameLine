import { ControllerBase } from '../controller-base.mjs';
import { hasImageEdits } from '../../model/image-effects.mjs';
import { requestImageRename } from '../../view/rename-images-dialog.mjs';

/** Coordinate asset selection, clipboard, naming, ordering, and import actions. */
export class ImageListController extends ControllerBase {
  /** Resolve pending tool edits before executing an image-list command. */
  async runImageListAction(action) {
    const runtime = this.application;
    if (runtime.toolSwitchBusy || runtime.paddingBusy || runtime.outlineApplyBusy || runtime.refineBusy || runtime.backgroundEditBusy) return;
    runtime.toolSwitchBusy = true;
    try {
      if (!await runtime.resolvePendingToolEdits()) return;
      runtime.stopPlayback(); runtime.renderPlayButton();
      await action();
      if (!document.querySelector('dialog[open]')) runtime.importImageList.focus({preventScroll:true});
    } catch (error) {
      if (error.code !== 'EXPORT_CANCELLED') runtime.notifyError(error);
    } finally { runtime.toolSwitchBusy = false; }
  }

  /** Confirm deleting selected source assets and their referenced timeline clips. */
  async confirmRemoveImages(imageIds = [...this.application.vm.selectedImageIds]) {
    const runtime = this.application;
    const ids = new Set(imageIds);
    const images = runtime.vm.project.images.filter(image => ids.has(image.id));
    if (!images.length) return;
    const revision = runtime.vm.editRevision;
    const message = images.length === 1 ? `Remove "${images[0].name}" and all its timeline clips?`
      : `Remove all ${images.length} selected images and their timeline clips?`;
    if (await runtime.confirmAction(images.length === 1 ? 'Delete image' : 'Delete selected images', message, 'Delete')
      && revision === runtime.vm.editRevision) runtime.vm.removeImages(images.map(image => image.id));
  }

  /** Build image-list commands while preserving the active multi-selection. */
  async showImageContextMenu(event) {
    const runtime = this.application;
    event.preventDefault();
    const row = event.target.closest('.image-row');
    const imageId = row?.dataset.imageId ?? null;
    const bounds = runtime.importImageList.getBoundingClientRect();
    const x = event.clientX || bounds.left + 12;
    const y = event.clientY || bounds.top + 12;
    if (runtime.toolSwitchBusy || runtime.paddingBusy || runtime.outlineApplyBusy || runtime.refineBusy || runtime.backgroundEditBusy) return;
    runtime.toolSwitchBusy = true;
    try {
      if (imageId && imageId !== runtime.currentPreviewImage()?.id && !await runtime.resolvePendingToolEdits()) return;
      runtime.stopPlayback(); runtime.renderPlayButton();
      runtime.importImageList.focus({preventScroll:true});
      if (imageId) {
        if (!runtime.vm.focusImage(imageId)) return;
        runtime.fitPreviewImage();
      }
      const multiple = runtime.vm.selectedImages.length > 1;
      const selectedIds = [...runtime.vm.selectedImageIds];
      const image = runtime.vm.project.images.find(item => item.id === imageId);
      const guarded = action => () => runtime.runImageListAction(action);
      const actions = [
        ...(image ? [[multiple ? 'Select only this image' : 'Select', 'near_me', () => runtime.vm.selectImage(image.id)]] : []),
        ['Select all images', 'select_all', () => runtime.vm.selectAllImages(), !runtime.vm.project.images.length],
        ['Copy', 'content_copy', guarded(() => {if (runtime.vm.copyImages(selectedIds)) runtime.showSuccess('Copied selected images');}), !selectedIds.length],
        ['Cut', 'content_cut', guarded(() => {if (runtime.vm.cutImages(selectedIds)) runtime.showSuccess('Cut selected images');}), !selectedIds.length],
        ['Paste', 'content_paste', guarded(() => {runtime.vm.pasteImages(imageId); runtime.fitPreviewImage();}), !runtime.vm.imageClipboard?.images.length],
        [multiple ? 'Duplicate selected' : 'Duplicate', 'copy_all', guarded(() => {runtime.vm.duplicateImages(selectedIds); runtime.fitPreviewImage();}), !selectedIds.length],
        ['Delete', 'delete', guarded(() => runtime.confirmRemoveImages(selectedIds)), !selectedIds.length],
        ...(image && !multiple ? [
          ['Insert at playhead', 'add_to_photos', guarded(() => runtime.vm.insertImage(image.id, runtime.vm.project.currentFrame))],
          ['Remove background…', 'auto_fix_high', guarded(() => runtime.removeBackground(image.id))],
          ...(hasImageEdits(image) ? [['Reset to original', 'restart_alt', guarded(() => runtime.vm.clearImageEffects(image.id))]] : [])
        ] : []),
        ['Move to start', 'first_page', guarded(() => runtime.vm.moveImagesToEdge(false, selectedIds)), !selectedIds.length],
        ['Move to end', 'last_page', guarded(() => runtime.vm.moveImagesToEdge(true, selectedIds)), !selectedIds.length],
        [multiple ? 'Export selected images…' : 'Export image…', 'file_upload', guarded(async () => {
          const images = runtime.vm.project.images.filter(item => selectedIds.includes(item.id)).map(item => structuredClone(item));
          if (!images.length) return;
          const output = await window.frameLine.chooseExportDirectory();
          if (!output) return;
          await runtime.runExportTask('export_images', {mode:'sources', output,
            images:images.map(item => ({...item, paint_strokes:item.paintStrokes ?? []}))},
            'Exporting images', `Exporting ${images.length} images…`);
          runtime.showSuccess(`Exported ${images.length} images`);
        }), !selectedIds.length],
        ['Add images…', 'add_photo_alternate', () => document.querySelector('#import-images').click()]
      ];
      runtime.renderContextMenu(x, y, actions, 'Imported image actions');
    } catch (error) { runtime.notifyError(error); }
    finally { runtime.toolSwitchBusy = false; }
  }

  /** Bind image list events after the editor state and required controls are ready. */
  initializeImageListEvents() {
    const runtime = this.application;
    document.querySelector("#image-list").addEventListener("dragstart", (event) => {
      if (event.target.closest(".image-remove")) {
        event.preventDefault();
        return;
      }
      const row = event.target.closest(".image-row");
      if (!row) return;
      row.classList.add("dragging");
      event.dataTransfer.setData("application/x-frameline-image", row.dataset.imageId);
      event.dataTransfer.effectAllowed = "copyMove";
    });
    runtime.importImageList = document.querySelector('#image-list');
    runtime.importImageList.addEventListener("click", async (event) => {
      const removeButton = event.target.closest(".image-remove");
      if (!removeButton) {
        const row = event.target.closest('.image-row');
        if (!row || runtime.toolSwitchBusy || runtime.paddingBusy || runtime.outlineApplyBusy || runtime.refineBusy) return;
        runtime.toolSwitchBusy = true;
        try {
          if (!await runtime.resolvePendingToolEdits()) return;
          runtime.stopPlayback();
          runtime.importImageList.focus({preventScroll:true});
          runtime.vm.selectImage(row.dataset.imageId, {toggle:event.ctrlKey || event.metaKey,
            range:event.shiftKey, additive:event.ctrlKey || event.metaKey});
          runtime.fitPreviewImage();
        } catch (error) { runtime.notifyError(error); }
        finally { runtime.toolSwitchBusy = false; }
        return;
      }
      const image = runtime.vm.project.images.find((item) => item.id === removeButton.dataset.imageId);
      const revision = runtime.vm.editRevision;
      if (image && await runtime.confirmAction("Remove image", `Remove "${image.name}" and its timeline clips?`, "Remove") && revision === runtime.vm.editRevision) {
        runtime.vm.removeImage(image.id);
      }
    });
    document.querySelector('#rename-images').addEventListener('click',()=>runtime.runImageListAction(async()=>{
      const revision = runtime.vm.editRevision;
      const options = await requestImageRename(runtime.vm.project.images,[...runtime.vm.selectedImageIds]);
      if (!options || revision !== runtime.vm.editRevision) return;
      const count = runtime.vm.renameImages(options);
      if (count) runtime.showSuccess(`Renamed ${count} ${count===1 ? 'image' : 'images'}`);
    }));
    runtime.importImageList.addEventListener('contextmenu', runtime.showImageContextMenu);
    document.querySelector('#empty-list').addEventListener('contextmenu', runtime.showImageContextMenu);
    document.querySelector("#image-list").addEventListener("dragend", (event) => event.target.closest(".image-row")?.classList.remove("dragging"));
    document.querySelector("#image-list").addEventListener("dragover", (event) => {
      if (event.dataTransfer.types.includes("application/x-frameline-image")) {
        event.preventDefault();
        const row = event.target.closest(".image-row");
        document.querySelectorAll(".image-row.drop-target").forEach((item) => item.classList.remove("drop-target"));
        if (row) {
          row.classList.add("drop-target");
          event.dataTransfer.dropEffect = "move";
        }
      } else if (event.dataTransfer.types.includes("Files")) event.preventDefault();
    });
    document.querySelector("#image-list").addEventListener("drop", async (event) => {
      event.preventDefault();
      document.querySelectorAll(".image-row.drop-target").forEach((item) => item.classList.remove("drop-target"));
      const id = event.dataTransfer.getData("application/x-frameline-image");
      const target = event.target.closest(".image-row");
      if (id && target) {
        const after = event.clientY > target.getBoundingClientRect().top + target.offsetHeight / 2;
        runtime.vm.reorderImages(id, target.dataset.imageId, after);
      } else if (event.dataTransfer.files.length) {
        const paths = [...event.dataTransfer.files].map((file) => window.frameLine.getPathForFile(file)).filter(Boolean);
        const after = target && event.clientY > target.getBoundingClientRect().top + target.offsetHeight / 2;
        await runtime.importPaths(paths, null, target ? { imageId: target.dataset.imageId, after } : null);
      }
    });
    document.querySelector("#clips").addEventListener("click", (event) => {
      if (event.target.closest(".clip-resize")) return;
      const element = event.target.closest(".timeline-clip");
      if (!element) return;
      runtime.vm.selectClip(element.dataset.clipId, { toggle: event.ctrlKey || event.metaKey, range: event.shiftKey, additive: event.ctrlKey || event.metaKey });
      runtime.setCurrentFrameFromPointer(event);
    });
    document.querySelector("#clips").addEventListener("dragstart", (event) => {
      const clip = event.target.closest(".timeline-clip");
      if (!clip || event.target.closest(".clip-resize")) { event.preventDefault(); return; }
      runtime.stopPlayback(); runtime.renderPlayButton();
      if (!runtime.vm.selectedClipIds.has(clip.dataset.clipId)) runtime.vm.selectedClipId = clip.dataset.clipId;
      event.dataTransfer.setData("application/x-frameline-clip", clip.dataset.clipId);
      event.dataTransfer.setData("application/x-frameline-clips", JSON.stringify([...runtime.vm.selectedClipIds]));
      event.dataTransfer.effectAllowed = "move";
      document.querySelectorAll('.timeline-clip').forEach(element => {
        if (runtime.vm.selectedClipIds.has(element.dataset.clipId)) element.classList.add("dragging", "selected");
        else element.classList.remove("selected");
      });
    });
    document.querySelector("#clips").addEventListener("dragend", () => {
      document.querySelectorAll('.timeline-clip.dragging').forEach(element => element.classList.remove("dragging"));
      runtime.redraw();
    });
    document.querySelector("#timeline-scroll").addEventListener("dragover", (event) => {
      const hasImage = event.dataTransfer.types.includes("application/x-frameline-image");
      const hasClip = event.dataTransfer.types.includes("application/x-frameline-clip");
      const hasFiles = event.dataTransfer.types.includes("Files") || event.dataTransfer.files.length > 0;
      if (!hasImage && !hasClip && !hasFiles) return;
      event.preventDefault();
      const rect = runtime.scroll.getBoundingClientRect();
      if (event.clientX < rect.left + 36) runtime.scroll.scrollLeft -= 14;
      else if (event.clientX > rect.right - 36) runtime.scroll.scrollLeft += 14;
      const clip = event.target.closest(".timeline-clip");
      document.querySelectorAll(".timeline-clip.drop-target").forEach((item) => item.classList.remove("drop-target"));
      if (clip && hasClip) {
        clip.classList.add("drop-target");
        event.dataTransfer.dropEffect = "move";
      } else if (hasImage || hasFiles) {
        event.dataTransfer.dropEffect = "copy";
        const contentRect = document.querySelector("#timeline-content").getBoundingClientRect();
        const frame = Math.max(0, Math.floor((event.clientX - contentRect.left) / (4 * runtime.vm.zoom / 100)));
        const indicator = document.querySelector("#drop-indicator");
        indicator.style.left = `${frame * 4 * runtime.vm.zoom / 100}px`;
        indicator.style.display = "block";
      }
    });
    document.querySelector("#timeline-scroll").addEventListener("dragleave", (event) => {
      if (!event.relatedTarget || !event.currentTarget.contains(event.relatedTarget)) {
        document.querySelector("#drop-indicator").style.display = "none";
        document.querySelectorAll(".timeline-clip.drop-target").forEach((item) => item.classList.remove("drop-target"));
      }
    });
    document.querySelector("#timeline-scroll").addEventListener("drop", async (event) => {
      event.preventDefault();
      document.querySelector("#drop-indicator").style.display = "none";
      document.querySelectorAll(".timeline-clip.drop-target").forEach((item) => item.classList.remove("drop-target"));
      const frame = Math.max(0, Math.floor((event.clientX - document.querySelector("#timeline-content").getBoundingClientRect().left) / (4 * runtime.vm.zoom / 100)));
      const clipId = event.dataTransfer.getData("application/x-frameline-clip");
      const imageId = event.dataTransfer.getData("application/x-frameline-image");
      if (clipId) {
        let target = event.target.closest(".timeline-clip");
        let after = false;
        if (target) after = event.clientX > target.getBoundingClientRect().left + target.offsetWidth / 2;
        else {
          const range = runtime.vm.ranges.find(({ startFrame, endFrame }) => frame >= startFrame && frame < endFrame);
          if (range) {
            target = document.querySelector(`.timeline-clip[data-clip-id="${range.clip.id}"]`);
            after = frame >= range.startFrame + Math.floor(range.clip.durationFrames / 2);
          } else {
            const boundary = frame <= 0 ? runtime.vm.project.clips[0] : runtime.vm.project.clips.at(-1);
            if (boundary) target = document.querySelector(`.timeline-clip[data-clip-id="${boundary.id}"]`);
            after = frame > 0;
          }
        }
        if (target) {
          let ids = [clipId];
          try {
            const payload = JSON.parse(event.dataTransfer.getData("application/x-frameline-clips"));
            if (Array.isArray(payload) && payload.every(id => typeof id === "string")) ids = payload;
          } catch {}
          runtime.vm.setSelection(ids, clipId);
          runtime.vm.moveSelectedClips(target.dataset.clipId, after);
        }
        return;
      }
      if (imageId) {
        runtime.vm.insertImage(imageId, frame);
        return;
      }
      if (event.dataTransfer.files.length) {
        const paths = [...event.dataTransfer.files].map((file) => window.frameLine.getPathForFile(file)).filter(Boolean);
        await runtime.importPaths(paths, frame);
      }
    });
  }
}
