import { ControllerBase } from '../controller-base.mjs';
import { showMessage } from '../../view/message-dialog.mjs';

/** Display notifications and themed confirmation dialogs. */
export class FeedbackView extends ControllerBase {
  /** Display an operation error through the app notification UI. */
  notifyError(error) {
    const runtime = this.application;
    console.error(error);
    runtime.toast.textContent = error instanceof Error ? error.message : String(error);
    runtime.toast.classList.add("visible");
    clearTimeout(runtime.toastTimer);
    runtime.toastTimer = setTimeout(() => runtime.toast.classList.remove("visible"), 3500);
  }

  /** Open the themed message dialog and resolve its action and optional scope choice. */
  requestMessage(options) {
    const runtime = this.application;
    runtime.stopPlayback();
    runtime.renderPlayButton();
    return showMessage(options);
  }

  /** Resolve a destructive-action confirmation without changing the project. */
  async confirmAction(title, message, label) {
    const runtime = this.application;
    const result = await runtime.requestMessage({ title, message, actions: [
      { label: "Cancel", value: "cancel" },
      { label, value: "confirm", primary: true }
    ] });
    return result.action === "confirm";
  }

  /** Synchronize playback icon and accessible label with the current playback state. */
  renderPlayButton() {
    const runtime = this.application;
    const button = document.querySelector("#play");
    button.querySelector(".material-icon").textContent = runtime.playing ? "pause" : "play_arrow";
    button.setAttribute("aria-label", runtime.playing ? "Pause" : "Play");
  }

  /** Display a short success notification and replace its dismissal timer. */
  showSuccess(message) {
    const runtime = this.application;
    runtime.toast.textContent = message;
    runtime.toast.classList.add("visible");
    clearTimeout(runtime.toastTimer);
    runtime.toastTimer = setTimeout(() => runtime.toast.classList.remove("visible"), 2500);
  }
}
