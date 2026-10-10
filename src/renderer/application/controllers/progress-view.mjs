import { ControllerBase } from '../controller-base.mjs';


/** Display progress and cancellation for long-running operations. */
export class ProgressView extends ControllerBase {
  /** Mount an operation progress dialog and return update and close functions. */
  showOperationProgress(title, message, total = null) {
    const runtime = this.application;
    const dialog = document.querySelector("#operation-progress-dialog");
    const cancelButton = document.querySelector("#operation-progress-cancel");
    cancelButton.hidden = true;
    const progress = document.querySelector("#operation-progress");
    document.querySelector("#operation-progress-title").textContent = title;
    document.querySelector("#operation-progress-message").textContent = message;
    const value = document.querySelector("#operation-progress-value");
    if (total === null) {
      progress.removeAttribute("value");
      value.textContent = "Please wait…";
    } else {
      progress.max = total;
      progress.value = 0;
      value.textContent = `0 / ${total}`;
    }
    if (!dialog.open) dialog.showModal();
    return {
      update(current, detail) {
        if (total === null) {
          progress.removeAttribute("value");
        } else {
          progress.max = total;
          progress.value = current;
        }
        value.textContent = total === null ? "Please wait…" : total === 1 ? `${Math.round(current * 100)}%`
          : `${Math.floor(current)} / ${total} Â· ${Math.round(current / total * 100)}%`;
        document.querySelector("#operation-progress-message").textContent = detail;
      },
      close() {
        if (dialog.open) dialog.close();
      }
    };
  }
}
