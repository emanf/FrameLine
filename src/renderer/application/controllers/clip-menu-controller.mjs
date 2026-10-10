import { ControllerBase } from '../controller-base.mjs';


/** Build timeline context-menu editing commands. */
export class ClipMenuController extends ControllerBase {
  /** Build timeline actions for the clicked clip and the current multi-selection. */
  showContextMenu(x, y, clipId) {
    const runtime = this.application;
    const multiple = runtime.vm.selectedClips.length > 1;
    const clipIndex = runtime.vm.project.clips.findIndex(clip => clip.id === clipId);
    const deleteSide = side => {
      const previousCount = runtime.vm.project.clips.length;
      runtime.stopPlayback();
      if (runtime.vm.deleteClipsRelativeTo(clipId, side)) {
        const count = previousCount - runtime.vm.project.clips.length;
        runtime.showSuccess(`Deleted ${count} timeline ${count === 1 ? "clip" : "clips"} ${side} this clip — Undo to restore`);
      }
      runtime.renderPlayButton();
    };
    const actions = [
      [multiple ? "Select only this clip" : "Select", "near_me", () => runtime.vm.selectClip(clipId)],
      ["Copy", "content_copy", () => { runtime.vm.copySelected(); runtime.showSuccess("Copied selected clips"); }],
      ["Cut", "content_cut", () => { runtime.stopPlayback(); runtime.vm.cutSelected(); runtime.renderPlayButton(); runtime.showSuccess("Cut selected clips — paste at the playhead with Ctrl+V"); }],
      ...(runtime.vm.clipboard?.clips.length ? [["Paste at playhead", "content_paste", () => runtime.vm.pasteClips()]] : []),
      [multiple ? "Duplicate selected" : "Duplicate", "copy_all", () => runtime.vm.duplicateSelected()],
      ["Delete", "delete", () => runtime.confirmRemoveClip(clipId)],
      ["Delete frames before", "arrow_back", () => deleteSide("before"), clipIndex <= 0],
      ["Delete frames after", "arrow_forward", () => deleteSide("after"), clipIndex < 0 || clipIndex >= runtime.vm.project.clips.length - 1],
      [multiple ? "Set duration for selected…" : "Set duration…", "timer", () => { const input = document.querySelector("#clip-frames"); input.focus(); input.select(); }],
      ...(!multiple ? [
      ["Remove background…", "auto_fix_high", async () => {
        const clip = runtime.vm.project.clips.find((item) => item.id === clipId);
        const image = clip && runtime.vm.project.images.find((item) => item.id === clip.imageId);
        if (image) await runtime.removeBackground(image.id);
      }],
      ...(runtime.vm.project.images.find((item) => item.id === runtime.vm.project.clips.find((clip) => clip.id === clipId)?.imageId)?.sourcePath
        ? [["Reset background", "restart_alt", async () => {
          const clip = runtime.vm.project.clips.find((item) => item.id === clipId);
          const image = clip && runtime.vm.project.images.find((item) => item.id === clip.imageId);
          if (image) {
            await runtime.vm.resetImageBackground(image.id);
            runtime.showSuccess(`Restored original ${image.name}`);
          }
        }]]
        : []),
      ] : []),
      ["Move to start", "first_page", () => runtime.vm.moveSelectionToEdge(false)],
      ["Move to end", "last_page", () => runtime.vm.moveSelectionToEdge(true)],
      [multiple ? "Export selected images…" : "Export image…", "file_upload", async () => {
        const imageIds = new Set(runtime.vm.selectedClips.map(clip => clip.imageId));
        const images = runtime.vm.project.images.filter(image => imageIds.has(image.id));
        if (!images.length) return;
        const output = await window.frameLine.chooseExportDirectory();
        if (!output) return;
        await runtime.runExportTask("export_images", {
          mode: "sources", output,
          images: images.map(image => ({ ...image, paint_strokes: image.paintStrokes ?? [] }))
        }, "Exporting images", `Exporting ${images.length} images…`);
        runtime.showSuccess(`Exported ${images.length} images`);
      }],
      ...(!multiple ? [
      ["Replace image…", "image", async () => {
        const paths = await window.frameLine.chooseImages();
        if (!paths.length) return;
        await runtime.vm.replaceClipWithImage(clipId, paths);
      }]
      ] : [])
    ];
    runtime.renderContextMenu(x, y, actions, 'Timeline clip actions');
  }

  /** Bind context menus after the editor state and required controls are ready. */
  initializeContextMenus() {
    const runtime = this.application;
    document.querySelector("#clips").addEventListener("contextmenu", (event) => {
      const clipElement = event.target.closest(".timeline-clip");
      if (!clipElement) return;
      event.preventDefault();
      runtime.scroll.focus({preventScroll:true});
      const clipId = clipElement.dataset.clipId;
      runtime.vm.focusClip(clipId);
      runtime.showContextMenu(event.clientX, event.clientY, clipId);
    });
  }
}
