import { ControllerBase } from '../controller-base.mjs';
import { createProject } from '../../model/project-model.mjs';

/** Save, open, name, and replace portable projects. */
export class ProjectController extends ControllerBase {
  /** Resolve pending edits and save a portable project snapshot. */
  async saveProject() {
    const runtime = this.application;
    try {
      if (!await runtime.resolvePendingToolEdits()) return false;
      runtime.commitProjectTitle();
      if (runtime.outlineApplyBusy || runtime.pendingOutlineApply || runtime.refineBusy) {
        runtime.notifyError("Wait for the image operation to finish before saving the project.");
        return false;
      }
      const savedProject = structuredClone(runtime.vm.project);
      const file = await runtime.withOperationProgress('Saving project', 'Saving images and project data…',
        () => window.frameLine.saveProject(savedProject));
      if (!file) return false;
      runtime.vm.markSaved(savedProject);
      if (file) runtime.toast.textContent = `Saved ${file}`;
      if (file) {
        runtime.toast.classList.add("visible");
        clearTimeout(runtime.toastTimer);
        runtime.toastTimer = setTimeout(() => runtime.toast.classList.remove("visible"), 2200);
      }
      return !runtime.vm.dirty;
    } catch (error) { runtime.notifyError(error); return false; }
  }

  /** Resolve pending tool edits and unsaved project changes before replacement or closing. */
  async confirmDiscardChanges() {
    const runtime = this.application;
    if (!await runtime.resolvePendingToolEdits()) return false;
    runtime.commitProjectTitle();
    if (runtime.outlineApplyBusy || runtime.pendingOutlineApply || runtime.refineBusy) {
      runtime.notifyError("Wait for the image operation to finish before saving, opening, or closing the project.");
      return false;
    }
    if (!runtime.vm.dirty) return true;
    const choice = await runtime.requestMessage({
      title: "Unsaved project",
      message: "Save changes to your FrameLine project?\nDiscarding changes will lose edits made since the last save.",
      actions: [
        { label: "Cancel", value: "cancel" },
        { label: "Discard", value: "discard" },
        { label: "Save", value: "save", primary: true }
      ]
    });
    if (choice.action === "save") return runtime.saveProject();
    return choice.action === "discard";
  }

  /** Validate the editable project name and record a persistent rename. */
  commitProjectTitle() {
    const runtime = this.application;
    const title = document.querySelector("#project-name");
    runtime.vm.setProjectName(title.value);
    title.value = runtime.vm.project.name;
  }

  /** Bind project actions after the editor state and required controls are ready. */
  initializeProjectActions() {
    const runtime = this.application;
    runtime.closeRequestPending = false;
    window.frameLine.onCloseRequested(async () => {
      if (runtime.closeRequestPending) return;
      runtime.closeRequestPending = true;
      try {
        if (await runtime.confirmDiscardChanges()) await window.frameLine.confirmCloseWindow();
      } catch (error) { runtime.notifyError(error); }
      finally { runtime.closeRequestPending = false; }
    });
    document.querySelector("#save-project").addEventListener("click", runtime.saveProject);
    runtime.projectTitle = document.querySelector("#project-name");
    runtime.projectTitle.addEventListener("change", runtime.commitProjectTitle);
    runtime.projectTitle.addEventListener("keydown", event => {
      if (event.key === "Enter") { event.preventDefault(); runtime.commitProjectTitle(); runtime.projectTitle.blur(); }
      else if (event.key === "Escape") { event.preventDefault(); runtime.projectTitle.value = runtime.vm.project.name; runtime.projectTitle.blur(); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault(); runtime.commitProjectTitle(); runtime.saveProject();
      }
    });
    document.querySelector("#new-project").addEventListener("click", async () => {
      try {
        if (!await runtime.confirmDiscardChanges()) return;
        runtime.stopPlayback();
        runtime.previewCropDraft = null;
        runtime.clearLiveOutlinePreview(null);
        runtime.vm.replaceProject(createProject());
        runtime.projectTitle.value = runtime.vm.project.name;
        runtime.projectTitle.removeAttribute("data-project-path");
        runtime.projectTitle.dataset.tooltip = "Edit the project title; Enter to apply, Escape to cancel";
        document.querySelector("#preview-zoom-fit").click();
        runtime.renderPlayButton();
      } catch (error) { runtime.notifyError(error); }
    });
    document.querySelector("#open-project").addEventListener("click", async () => {
      try {
        if (!await runtime.confirmDiscardChanges()) return;
        const opened = await runtime.withOperationProgress('Opening project', 'Reading project data and images…',
          () => window.frameLine.openProject());
        if (opened) {
          runtime.stopPlayback();
          runtime.vm.replaceProject(opened.project);
          runtime.fitPreviewImage();
          runtime.projectTitle.value = runtime.vm.project.name;
          runtime.projectTitle.dataset.projectPath = opened.path;
          runtime.projectTitle.dataset.tooltip = `Edit project title — ${opened.path}`;
          runtime.renderPlayButton();
        }
      } catch (error) { runtime.notifyError(error); }
    });
    document.querySelector("#undo").addEventListener("click", () => runtime.navigateEditHistory());
    document.querySelector("#redo").addEventListener("click", () => runtime.navigateEditHistory(true));
    document.querySelector("#play").addEventListener("click", runtime.togglePlayback);
    document.querySelector("#previous-frame").addEventListener("click", () => runtime.vm.setFrame(runtime.vm.project.currentFrame - 1));
    document.querySelector("#next-frame").addEventListener("click", () => runtime.vm.setFrame(runtime.vm.project.currentFrame + 1));
    document.querySelector("#first-frame").addEventListener("click", () => runtime.vm.setFrame(0));
    document.querySelector("#last-frame").addEventListener("click", () => runtime.vm.setFrame(runtime.vm.totalFrames - 1));
    document.querySelector("#previous-image").addEventListener("click", () => {
      const previous = [...runtime.vm.ranges].reverse().find(({ startFrame }) => startFrame < runtime.vm.project.currentFrame);
      if (previous) runtime.selectAtFrame(previous.startFrame);
    });
    document.querySelector("#next-image").addEventListener("click", () => {
      const next = runtime.vm.ranges.find(({ startFrame }) => startFrame > runtime.vm.project.currentFrame);
      if (next) runtime.selectAtFrame(next.startFrame);
    });
    document.querySelector("#loop-toggle").addEventListener("click", () => {
      runtime.vm.setLoop(!runtime.vm.project.loopEnabled);
      runtime.scheduleSavePreferences();
    });
    document.querySelector("#fps-select").addEventListener("change", async (event) => {
      const select = event.currentTarget;
      let fps = Number(select.value);
      if (select.value === "add") {
        const value = await runtime.requestCustomNumber({
          title: "Custom frame rate",
          label: "Frames per second",
          value: runtime.vm.project.fps,
          min: 0,
          max: 240,
          errorMessage: "Enter a frame rate greater than 0 and no more than 240 FPS."
        });
        if (value === null) { runtime.redraw(); return; }
        fps = value;
        if (!runtime.customFrameRates.includes(fps)) runtime.customFrameRates.push(fps);
        runtime.addCustomSelectValue(select, fps, " FPS");
      }
      try {
        runtime.vm.setFps(fps);
        runtime.scheduleSavePreferences();
      } catch (error) { runtime.notifyError(error); runtime.redraw(); }
    });
  }
}
