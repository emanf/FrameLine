import { ControllerBase } from '../controller-base.mjs';


/** Collect video sampling options in the themed dialog. */
export class VideoImportDialogView extends ControllerBase {
  /** Collect video sampling mode, interval/count, and target FPS before decoding. */
  requestVideoImportOptions(videoPath) {
    const runtime = this.application;
    const dialog = document.querySelector("#video-import-dialog");
    const form = document.querySelector("#video-import-form");
    const filename = videoPath.split(/[\\/]/).at(-1);
    document.querySelector("#video-import-filename").textContent = filename;
    document.querySelector("#video-import-fps").textContent = runtime.vm.project.fps;
    document.querySelector("#video-import-error").hidden = true;
    form.reset();
    for (const details of form.querySelectorAll('details')) details.open = false;
    dialog.returnValue = "";
    const modeInputs = [...form.querySelectorAll('input[name="video-import-mode"]')];
    const intervalInput = document.querySelector("#video-import-interval");
    const countInput = document.querySelector("#video-import-count");
    const syncModeControls = () => {
      const selectedMode = form.querySelector('input[name="video-import-mode"]:checked')?.value;
      intervalInput.disabled = selectedMode !== "interval";
      countInput.disabled = selectedMode !== "count";
    };
    for (const input of modeInputs) input.addEventListener("change", syncModeControls);
    syncModeControls();
  
    return new Promise((resolve) => {
      const closeButton = document.querySelector("#video-import-close");
      const cancelButton = document.querySelector("#video-import-cancel");
      const close = () => dialog.close();
      const cleanup = () => {
        closeButton.removeEventListener("click", close);
        cancelButton.removeEventListener("click", close);
        form.removeEventListener("submit", submit);
        for (const input of modeInputs) input.removeEventListener("change", syncModeControls);
        dialog.removeEventListener("close", onClose);
      };
      const onClose = () => {
        cleanup();
        resolve(dialog.returnValue ? JSON.parse(dialog.returnValue) : null);
      };
      const submit = (event) => {
        event.preventDefault();
        const selectedMode = form.querySelector('input[name="video-import-mode"]:checked')?.value ?? "default";
        const options = { mode: selectedMode };
        if (selectedMode === "interval") {
          const intervalValue = intervalInput.value.trim().replace(",", ".");
          const intervalSeconds = Number(intervalValue);
          if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0 || intervalSeconds > 86400) {
            document.querySelector("#video-import-error").textContent = "Enter an interval greater than 0 and no more than 86,400 seconds.";
            document.querySelector("#video-import-error").hidden = false;
            intervalInput.focus();
            return;
          }
          options.interval_seconds = intervalSeconds;
        } else if (selectedMode === "count") {
          const imageCount = Number(countInput.value);
          if (!Number.isInteger(imageCount) || imageCount < 1 || imageCount > 100000) {
            document.querySelector("#video-import-error").textContent = "Enter a whole image count between 1 and 100,000.";
            document.querySelector("#video-import-error").hidden = false;
            countInput.focus();
            return;
          }
          options.image_count = imageCount;
        }
        dialog.returnValue = JSON.stringify(options);
        dialog.close();
      };
      closeButton.addEventListener("click", close);
      cancelButton.addEventListener("click", close);
      form.addEventListener("submit", submit);
      dialog.addEventListener("close", onClose);
      dialog.showModal();
    });
  }
}
