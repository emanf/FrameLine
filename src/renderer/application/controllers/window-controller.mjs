import { ControllerBase } from '../controller-base.mjs';


/** Bind native window actions through the preload API. */
export class WindowController extends ControllerBase {
  /** Synchronize the window-control icon with the native maximized state. */
  updateMaximizeButton(maximized) {
    const runtime = this.application;
    const button = document.querySelector("#window-maximize");
    button.querySelector(".material-icon").textContent = maximized ? "filter_none" : "fullscreen";
    button.dataset.tooltip = maximized ? "Restore down" : "Maximize";
    button.setAttribute("aria-label", button.dataset.tooltip);
  }

  /** Bind window events after the editor state and required controls are ready. */
  initializeWindowEvents() {
    const runtime = this.application;
    window.frameLine.isWindowMaximized().then(runtime.updateMaximizeButton).catch(runtime.notifyError);
    window.frameLine.onWindowMaximized(runtime.updateMaximizeButton);
    document.querySelector("#window-minimize").addEventListener("click", () => window.frameLine.minimizeWindow().catch(runtime.notifyError));
    document.querySelector("#window-maximize").addEventListener("click", () => window.frameLine.toggleMaximizeWindow().then(runtime.updateMaximizeButton).catch(runtime.notifyError));
    document.querySelector("#window-close").addEventListener("click", () => window.frameLine.closeWindow().catch(runtime.notifyError));
    document.querySelector(".topbar").addEventListener("dblclick", (event) => {
      if (event.target.closest("button")) return;
      window.frameLine.toggleMaximizeWindow().then(runtime.updateMaximizeButton).catch(runtime.notifyError);
    });
  }
}
