import { ControllerBase } from '../controller-base.mjs';


/** Control preview background and grid popovers. */
export class PreviewDisplayView extends ControllerBase {
  /** Apply transparency or a chosen solid color to the preview surface only. */
  updatePreviewBackground() {
    const runtime = this.application;
    const color = document.querySelector("#preview-background-color").value;
    const transparent = document.querySelector("#preview-background-transparent").checked;
    const stage = document.querySelector("#preview-stage");
    stage.style.setProperty("--preview-background-color", color);
    stage.classList.toggle("solid-background", !transparent);
    document.querySelector("#preview-background-color-value").value = color;
  }

  /** Close the background popup and restore its toggle state. */
  closePreviewBackground() {
    const runtime = this.application;
    document.querySelector("#preview-background-popover").hidden = true;
    document.querySelector("#preview-background-toggle").setAttribute("aria-expanded", "false");
  }

  /** Close the grid popup and restore its toggle state. */
  closePreviewGrid() {
    const runtime = this.application;
    document.querySelector("#preview-grid-popover").hidden = true;
    document.querySelector("#preview-grid-toggle").setAttribute("aria-expanded", "false");
  }

  /** Bind display popovers after the editor state and required controls are ready. */
  initializeDisplayPopovers() {
    const runtime = this.application;
    document.querySelector("#preview-background-toggle").addEventListener("click", () => {
      runtime.closePreviewGrid();
      const popover = document.querySelector("#preview-background-popover");
      popover.hidden = !popover.hidden;
      document.querySelector("#preview-background-toggle").setAttribute("aria-expanded", String(!popover.hidden));
    });
    document.querySelector("#preview-background-color").addEventListener("input", () => {
      document.querySelector("#preview-background-transparent").checked = false;
      runtime.updatePreviewBackground();
      runtime.scheduleSavePreferences();
    });
    document.querySelector("#preview-background-transparent").addEventListener("change", () => {
      runtime.updatePreviewBackground();
      runtime.scheduleSavePreferences();
    });
    document.querySelector("#preview-background-control").addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      runtime.closePreviewBackground();
      document.querySelector("#preview-background-toggle").focus();
    });
    document.addEventListener("pointerdown", (event) => {
      if (!document.querySelector("#preview-background-control").contains(event.target)) runtime.closePreviewBackground();
    });
    document.querySelector("#preview-grid-toggle").addEventListener("click", event => {
      runtime.closePreviewBackground();
      const popover = document.querySelector("#preview-grid-popover");
      popover.hidden = !popover.hidden;
      event.currentTarget.setAttribute("aria-expanded", String(!popover.hidden));
    });
    document.querySelector("#preview-grid-control").addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      runtime.closePreviewGrid();
      document.querySelector("#preview-grid-toggle").focus();
    });
    document.addEventListener("pointerdown", (event) => {
      const control = document.querySelector("#preview-grid-control");
      if (control.contains(event.target)) return;
      runtime.closePreviewGrid();
    });
    document.querySelector("#preview-grid-visible").addEventListener("change", (event) => {
      runtime.previewGridEnabled = event.currentTarget.checked;
      document.querySelector("#preview-grid-toggle").classList.toggle("grid-enabled", runtime.previewGridEnabled);
      runtime.updatePreviewPixelGrid();
      runtime.scheduleSavePreferences();
    });
    document.querySelector("#preview-grid-size").addEventListener("input", (event) => {
      const input = event.currentTarget;
      const value = Number(input.value);
      if (!Number.isFinite(value)) return;
      const gridSize = Math.max(1, Math.min(256, Math.round(value)));
      input.value = String(gridSize);
      runtime.updatePreviewPixelGrid();
      runtime.scheduleSavePreferences();
    });
    document.querySelector("#preview-grid-opacity").addEventListener("input", (event) => {
      document.querySelector("#preview-grid-opacity-value").value = `${event.currentTarget.value}%`;
      runtime.updatePreviewPixelGrid();
      runtime.scheduleSavePreferences();
    });
    document.querySelector("#export-format").addEventListener("change", runtime.scheduleSavePreferences);
    document.querySelector("#export-scope").addEventListener("change", runtime.scheduleSavePreferences);
    document.querySelector("#preview-stage").addEventListener("contextmenu", (event) => event.preventDefault());
    document.querySelector("#operation-progress-dialog").addEventListener("cancel", (event) => event.preventDefault());
    window.addEventListener("resize", () => {
      runtime.redrawPaintCanvas();
      const image = runtime.currentPreviewImage();
      if (image?.id === runtime.liveOutlinePreviewImageId && runtime.previewImageWrap.classList.contains('outline-preview')) runtime.layoutOutlinePreview(image);
      runtime.updatePreviewPan();
      runtime.scheduleSavePreferences();
    });
    runtime.updatePreviewToolUi();
  }
}
