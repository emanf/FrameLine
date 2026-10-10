import {EventBindings} from '../../view/event-bindings.mjs';
import { ControllerBase } from '../controller-base.mjs';
import {BackgroundSettingsView} from '../../view/background/background-settings-view.mjs';
import {BackgroundPreviewController} from '../../view/background/background-preview-controller.mjs';
import {BackgroundNavigationView} from '../../view/background/background-navigation-view.mjs';
import {BackgroundIgnoreBrushView} from '../../view/background/background-ignore-brush-view.mjs';

/** Compose a background-removal session and release all modal handlers on close. */
export class BackgroundRemovalDialogView extends ControllerBase {
  /** @returns {Promise<object|null>} Accepted removal options and batch scope, or null. */
  requestBackgroundOptions(image, currentResult) {
    const bindings = new EventBindings();
    const session = {image, currentResult};
    const backgroundSettingsView = new BackgroundSettingsView(session);
    session.fringeOptions = backgroundSettingsView.fringeOptions.bind(backgroundSettingsView);
    session.storedFringeOptions = backgroundSettingsView.storedFringeOptions.bind(backgroundSettingsView);
    session.currentOptions = backgroundSettingsView.currentOptions.bind(backgroundSettingsView);
    session.saveLastUsed = backgroundSettingsView.saveLastUsed.bind(backgroundSettingsView);
    session.syncMethod = backgroundSettingsView.syncMethod.bind(backgroundSettingsView);
    session.updateValues = backgroundSettingsView.updateValues.bind(backgroundSettingsView);
    session.updateFringeValue = backgroundSettingsView.updateFringeValue.bind(backgroundSettingsView);
    const backgroundPreviewController = new BackgroundPreviewController(session);
    session.fitPreview = backgroundPreviewController.fitPreview.bind(backgroundPreviewController);
    session.setPreviewStatus = backgroundPreviewController.setPreviewStatus.bind(backgroundPreviewController);
    session.scheduleBackgroundPreview = backgroundPreviewController.scheduleBackgroundPreview.bind(backgroundPreviewController);
    session.selectSample = backgroundPreviewController.selectSample.bind(backgroundPreviewController);
    const backgroundNavigationView = new BackgroundNavigationView(session);
    session.closeBackgroundPopover = backgroundNavigationView.closeBackgroundPopover.bind(backgroundNavigationView);
    session.toggleBackgroundPopover = backgroundNavigationView.toggleBackgroundPopover.bind(backgroundNavigationView);
    session.dismissBackgroundPopover = backgroundNavigationView.dismissBackgroundPopover.bind(backgroundNavigationView);
    session.escapeBackgroundPopover = backgroundNavigationView.escapeBackgroundPopover.bind(backgroundNavigationView);
    session.updatePreviewTransform = backgroundNavigationView.updatePreviewTransform.bind(backgroundNavigationView);
    session.resetPreviewView = backgroundNavigationView.resetPreviewView.bind(backgroundNavigationView);
    session.updatePreviewPoint = backgroundNavigationView.updatePreviewPoint.bind(backgroundNavigationView);
    session.startPreviewPan = backgroundNavigationView.startPreviewPan.bind(backgroundNavigationView);
    session.stopPreviewPan = backgroundNavigationView.stopPreviewPan.bind(backgroundNavigationView);
    session.preventPreviewContextMenu = backgroundNavigationView.preventPreviewContextMenu.bind(backgroundNavigationView);
    session.setPreviewBackgroundColor = backgroundNavigationView.setPreviewBackgroundColor.bind(backgroundNavigationView);
    session.setPreviewTransparent = backgroundNavigationView.setPreviewTransparent.bind(backgroundNavigationView);
    session.zoomPreview = backgroundNavigationView.zoomPreview.bind(backgroundNavigationView);
    const backgroundIgnoreBrushView = new BackgroundIgnoreBrushView(session);
    session.renderIgnoreSegment = backgroundIgnoreBrushView.renderIgnoreSegment.bind(backgroundIgnoreBrushView);
    session.flushIgnoreOverlay = backgroundIgnoreBrushView.flushIgnoreOverlay.bind(backgroundIgnoreBrushView);
    session.ignorePoint = backgroundIgnoreBrushView.ignorePoint.bind(backgroundIgnoreBrushView);
    session.updateIgnorePointer = backgroundIgnoreBrushView.updateIgnorePointer.bind(backgroundIgnoreBrushView);
    session.appendIgnorePoint = backgroundIgnoreBrushView.appendIgnorePoint.bind(backgroundIgnoreBrushView);
    session.startIgnoreStroke = backgroundIgnoreBrushView.startIgnoreStroke.bind(backgroundIgnoreBrushView);
    session.moveIgnoreStroke = backgroundIgnoreBrushView.moveIgnoreStroke.bind(backgroundIgnoreBrushView);
    session.finishIgnoreStroke = backgroundIgnoreBrushView.finishIgnoreStroke.bind(backgroundIgnoreBrushView);
    session.toggleIgnoreBrush = backgroundIgnoreBrushView.toggleIgnoreBrush.bind(backgroundIgnoreBrushView);
    session.resetIgnoreMarks = backgroundIgnoreBrushView.resetIgnoreMarks.bind(backgroundIgnoreBrushView);
    session.hideIgnoreCursor = backgroundIgnoreBrushView.hideIgnoreCursor.bind(backgroundIgnoreBrushView);
    session.runtime = this.application;
    session.dialog = document.querySelector("#background-dialog");
    session.form = document.querySelector("#background-form");
    session.sourcePath = session.currentResult.path;
    session.preview = document.querySelector("#background-sample-image");
    session.previewFrame = document.querySelector("#background-preview-frame");
    session.ignoreButton = document.querySelector('#background-ignore-brush');
    session.ignoreControls = document.querySelector('#background-ignore-controls');
    session.ignoreSize = document.querySelector('#background-ignore-size');
    session.ignoreUndo = document.querySelector('#background-ignore-undo');
    session.ignoreClear = document.querySelector('#background-ignore-clear');
    session.ignoreOverlay = document.querySelector('#background-ignore-overlay');
    session.ignoreCursor = document.querySelector('#background-ignore-cursor');
    session.ignoreEnabled = false;
    session.ignoreGesture = null;
    session.ignoreStrokes = [];
    session.ignoreRenderFrame = null;
    session.ignorePending = [];
    session.ignoreButton.setAttribute('aria-pressed', 'false');
    session.ignoreControls.hidden = true;
    session.ignoreCursor.hidden = true;
    session.ignoreUndo.disabled = session.ignoreClear.disabled = true;
    session.ignoreOverlay.width = session.currentResult.width;
    session.ignoreOverlay.height = session.currentResult.height;
    session.fitButton = document.querySelector('#background-preview-fit');
    session.previewColor = document.querySelector("#background-preview-color");
    session.previewTransparent = document.querySelector("#background-preview-transparent");
    session.previewBackgroundControl = document.querySelector('#background-preview-background-control');
    session.previewBackgroundToggle = document.querySelector('#background-preview-background-toggle');
    session.previewBackgroundPopover = document.querySelector('#background-preview-background-popover');
    session.method = document.querySelector("#background-method");
    session.backgroundSource = document.querySelector('#background-source');
    session.aggressive = document.querySelector('#background-aggressive');
    session.aggressiveAmount = document.querySelector('#background-aggressive-amount');
    session.detectedColors = document.querySelector('#background-detected-colors');
    session.errorElement = document.querySelector("#background-error");
    session.sampleHint = document.querySelector("#background-sample-hint");
    session.keyColor = document.querySelector("#background-key-color");
    session.tolerance = document.querySelector("#background-tolerance");
    session.softness = document.querySelector("#background-softness");
    session.softnessEnabled = document.querySelector('#background-softness-enabled');
    session.previewStatus = document.querySelector('#background-preview-status');
    session.previewStatusText = document.querySelector('#background-preview-status-text');
    session.previewProgress = document.querySelector('#background-preview-progress');
    session.smoothingEnabled = document.querySelector("#background-edge-smoothing-enabled");
    session.smoothingAmount = document.querySelector("#background-edge-smoothing-amount");
    session.fringeEnabled = document.querySelector("#background-fringe-enabled");
    session.fringeMethod = document.querySelector('#background-fringe-method');
    session.fringeKeepCustom = document.querySelector('#background-fringe-keep-custom');
    session.fringeKeepColor = document.querySelector('#background-fringe-keep-color');
    session.fringeColorMode = document.querySelector("#background-fringe-color-mode");
    session.fringeColor = document.querySelector("#background-fringe-color");
    session.fringeFields = [
          ["tolerance", 24, 0, 255, ""], ["width", 4, 1, 32, " px"],
          ["sample_distance", 16, 1, 64, " px"], ["strength", 100, 0, 100, "%"],
          ["min_opacity", 0, 0, 100, "%"], ["max_opacity", 100, 0, 100, "%"],
        ].map(([name, defaultValue, min, max, suffix]) => ({
          name, defaultValue, min, max, suffix,
          input: document.querySelector(`#background-fringe-${name.replaceAll("_", "-")}`),
          output: document.querySelector(`#background-fringe-${name.replaceAll("_", "-")}-value`),
        }));
    session.spill = document.querySelector("#background-spill");
    session.spillColor = document.querySelector("#background-spill-color");
    session.edgeTintEnabled = document.querySelector("#background-edge-tint-enabled");
    session.edgeColor = document.querySelector("#background-edge-color");
    session.edgeTint = document.querySelector("#background-edge-tint");
    session.sampleState = { point: null, color: null };
    session.savedLast = session.runtime.readBackgroundOptions("frameline.background.last");
    session.savedDefaults = session.runtime.readBackgroundOptions("frameline.background.defaults");
    session.saved = [session.savedLast, session.savedDefaults].find(options => [1, session.runtime.BACKGROUND_SETTINGS_VERSION].includes(options?.settings_version));
    document.querySelector("#background-color-swatch").style.backgroundColor = "transparent";
    document.querySelector("#background-color-value").textContent = "Not sampled";
    session.errorElement.hidden = true;
    session.form.reset();
    session.method.value = session.saved?.settings_version === session.runtime.BACKGROUND_SETTINGS_VERSION && ['auto', 'sample', 'chroma'].includes(session.saved?.mode) ? session.saved.mode : 'auto';
    session.backgroundSource.value = session.saved?.background_source === 'custom' ? 'custom' : 'auto';
    session.aggressive.checked = session.saved?.aggressive === true;
    session.aggressiveAmount.value = String(session.runtime.clampNumber(session.saved?.aggressive_amount, 0, 100, 50));
    session.detectedColors.textContent = '';
    session.keyColor.value = session.saved?.key_color ?? "#00ff00";
    session.tolerance.value = String(session.saved?.tolerance ?? 128);
    session.softness.value = String(session.saved?.softness ?? 4);
    session.softnessEnabled.checked = session.saved?.softness_enabled === true;
    session.smoothingEnabled.checked = session.saved?.edge_smoothing_enabled === true;
    session.smoothingAmount.value = String(session.runtime.clampNumber(session.saved?.edge_smoothing, 1, 100, 75));
    session.fringeEnabled.checked = session.saved?.fringe_cleanup_enabled === true;
    session.fringeMethod.value = session.saved?.fringe_cleanup && session.saved.fringe_cleanup.method !== 'recover' ? 'replace' : 'recover';
    session.fringeKeepCustom.checked = session.saved?.fringe_keep_custom === true || Boolean(session.saved?.fringe_cleanup?.keep_color);
    session.fringeKeepColor.value = session.saved?.fringe_keep_color ?? '#000000';
    session.fringeColorMode.value = session.saved?.fringe_cleanup?.color ? "custom" : "removal";
    session.fringeColor.value = session.saved?.fringe_color ?? "#00ff00";
    for (const field of session.fringeFields) field.input.value = String(Math.round(session.runtime.clampNumber(session.saved?.fringe_cleanup?.[field.name], field.min, field.max, field.defaultValue)));
    session.fringeMinimum = session.fringeFields.find(({ name }) => name === "min_opacity").input;
    session.fringeMaximum = session.fringeFields.find(({ name }) => name === "max_opacity").input;
    session.fringeMaximum.value = String(Math.max(Number(session.fringeMinimum.value), Number(session.fringeMaximum.value)));
    session.spill.value = String(session.saved?.spill ?? 0);
    session.spillColor.value = session.saved?.spill_color ?? "#808080";
    session.edgeTintEnabled.checked = session.saved?.edge_tint_enabled === true;
    session.edgeColor.value = session.saved?.edge_color ?? "#000000";
    session.edgeTint.value = String(session.saved?.edge_tint ?? 100);
    document.querySelector("#background-connected").checked = session.saved?.connected_only ?? false;
    document.querySelector("#background-set-default").checked = false;
    session.previewColor.value = "#ffffff";
    document.querySelector('#background-preview-color-value').value = session.previewColor.value;
    session.closeBackgroundPopover();
    session.previewFrame.classList.remove("solid-background");
    session.previewFrame.style.setProperty("--background-preview-color", session.previewColor.value);
    session.previewTransparent.checked = true;
    session.preview.src = session.runtime.localImageUrl(session.sourcePath);
    session.runtime.backgroundPreviewZoom = 1;
    session.runtime.backgroundPreviewPan = { x: 0, y: 0 };
    session.runtime.backgroundPreviewDrag = null;
    session.preview.style.setProperty("--background-preview-scale", "1");
    session.preview.style.setProperty("--background-preview-x", "0px");
    session.preview.style.setProperty("--background-preview-y", "0px");
    session.ignoreOverlay.style.setProperty('--background-preview-scale', '1');
    session.ignoreOverlay.style.setProperty('--background-preview-x', '0px');
    session.ignoreOverlay.style.setProperty('--background-preview-y', '0px');
    session.dialog.returnValue = "";
    return new Promise((resolve) => {
      const previewObserver = new ResizeObserver(session.fitPreview);
      previewObserver.observe(session.previewFrame);
      bindings.listen(session.preview, 'load', session.fitPreview);
      bindings.listen(session.fitButton, 'click', session.resetPreviewView);
      const closeButton = document.querySelector("#background-close");
      const cancelButton = document.querySelector("#background-cancel");
      const applyAllButton = document.querySelector("#background-apply-all");
      const connected = document.querySelector("#background-connected");
      const close = () => session.dialog.close();
      const cleanup = () => {
        bindings.dispose();
        if (session.ignoreRenderFrame !== null) cancelAnimationFrame(session.ignoreRenderFrame);
        session.ignoreGesture = null;
        session.ignorePending.length = 0;
        session.ignoreCursor.hidden = true;
        session.ignoreOverlay.getContext('2d').clearRect(0, 0, session.ignoreOverlay.width, session.ignoreOverlay.height);

        previewObserver.disconnect();

        clearTimeout(session.runtime.backgroundPreviewTimer);
        session.previewProgress.hidden = true;
        session.previewStatus.setAttribute('aria-busy', 'false');
        if (session.runtime.backgroundPreviewPanFrame !== null) {
          cancelAnimationFrame(session.runtime.backgroundPreviewPanFrame);
          session.runtime.backgroundPreviewPanFrame = null;
        }
        session.runtime.backgroundPreviewDrag = null;
        session.runtime.backgroundPreviewRequestId++;
        session.runtime.backgroundPreviewTask.finally(() => window.frameLine.clearBackgroundPreview()).catch(session.runtime.notifyError);

        session.closeBackgroundPopover();

        session.preview.removeAttribute("src");
        session.preview.src = "";
      };
      const onClose = () => {
        cleanup();
        resolve(session.dialog.returnValue ? JSON.parse(session.dialog.returnValue) : null);
      };
      const submit = (event) => {
        event.preventDefault();
        const options = session.currentOptions();
        if (session.method.value === "sample" && !session.sampleState.point) {
          session.errorElement.textContent = "Click the image background to sample a color before applying.";
          session.errorElement.hidden = false;
          return;
        }
        session.saveLastUsed();
        if (document.querySelector("#background-set-default").checked) {
          localStorage.setItem("frameline.background.defaults", JSON.stringify({
            ...options,
            ignore_strokes: undefined,
            settings_version: session.runtime.BACKGROUND_SETTINGS_VERSION,
            softness: Number(session.softness.value),
            softness_enabled: session.softnessEnabled.checked,
            edge_smoothing: Number(session.smoothingAmount.value),
            edge_smoothing_enabled: session.smoothingEnabled.checked,
            ...session.storedFringeOptions(),
            key_color: session.keyColor.value,
            spill_color: session.spillColor.value,
            edge_tint_enabled: session.edgeTintEnabled.checked,
            edge_color: session.edgeColor.value,
            edge_tint: Number(session.edgeTint.value)
          }));
        }
        session.dialog.returnValue = JSON.stringify({ options, all: false });
        session.dialog.close();
      };
      const applyAll = () => {
        if (session.method.value === 'sample' && !session.sampleState.point) return;
        const options = session.currentOptions();
        if (session.method.value === 'sample') options.sample_color = session.sampleState.color;
        session.saveLastUsed();
        if (document.querySelector("#background-set-default").checked) {
          localStorage.setItem("frameline.background.defaults", JSON.stringify({
            ...options,
            ignore_strokes: undefined,
            settings_version: session.runtime.BACKGROUND_SETTINGS_VERSION,
            softness: Number(session.softness.value),
            softness_enabled: session.softnessEnabled.checked,
            edge_smoothing: Number(session.smoothingAmount.value),
            edge_smoothing_enabled: session.smoothingEnabled.checked,
            ...session.storedFringeOptions(),
            key_color: session.keyColor.value,
            spill_color: session.spillColor.value,
            edge_tint_enabled: session.edgeTintEnabled.checked,
            edge_color: session.edgeColor.value,
            edge_tint: Number(session.edgeTint.value)
          }));
        }
        session.dialog.returnValue = JSON.stringify({ options, all: true });
        session.dialog.close();
      };
      bindings.listen(closeButton, "click", close);
      bindings.listen(session.ignoreButton, 'click', session.toggleIgnoreBrush);
      bindings.listen(session.ignoreUndo, 'click', session.resetIgnoreMarks);
      bindings.listen(session.ignoreClear, 'click', session.resetIgnoreMarks);
      bindings.listen(session.previewFrame, 'pointerdown', session.startIgnoreStroke);
      bindings.listen(session.previewFrame, 'pointermove', session.moveIgnoreStroke);
      bindings.listen(session.previewFrame, 'pointerup', session.finishIgnoreStroke);
      bindings.listen(session.previewFrame, 'pointercancel', session.finishIgnoreStroke);
      bindings.listen(session.previewFrame, 'pointerleave', session.hideIgnoreCursor);
      bindings.listen(cancelButton, "click", close);
      bindings.listen(applyAllButton, "click", applyAll);
      bindings.listen(session.keyColor, "input", session.scheduleBackgroundPreview);
      bindings.listen(session.spillColor, "input", session.updateValues);
      bindings.listen(session.edgeTintEnabled, "change", session.updateValues);
      bindings.listen(session.edgeColor, "input", session.updateValues);
      bindings.listen(session.edgeTint, "input", session.updateValues);
      bindings.listen(session.previewColor, "input", session.setPreviewBackgroundColor);
      bindings.listen(session.previewBackgroundToggle, 'click', session.toggleBackgroundPopover);
      bindings.listen(session.dialog, 'keydown', session.escapeBackgroundPopover);
      bindings.listen(document, 'pointerdown', session.dismissBackgroundPopover);
      bindings.listen(session.previewTransparent, "change", session.setPreviewTransparent);
      bindings.listen(session.method, "change", session.syncMethod);
      bindings.listen(session.backgroundSource, 'change', session.syncMethod);
      bindings.listen(session.aggressive, 'change', session.syncMethod);
      bindings.listen(session.aggressiveAmount, 'input', session.syncMethod);
      bindings.listen(session.previewFrame, "click", session.selectSample);
      bindings.listen(session.previewFrame, "pointerdown", session.startPreviewPan);
      bindings.listen(session.previewFrame, "pointermove", session.updatePreviewPoint);
      bindings.listen(session.previewFrame, "pointerup", session.stopPreviewPan);
      bindings.listen(session.previewFrame, "pointercancel", session.stopPreviewPan);
      bindings.listen(session.previewFrame, "contextmenu", session.preventPreviewContextMenu);
      bindings.listen(session.previewFrame, "wheel", session.zoomPreview, { passive: false });
      bindings.listen(session.tolerance, "input", session.updateValues);
      bindings.listen(session.softness, "input", session.updateValues);
      bindings.listen(session.softnessEnabled, 'change', session.updateValues);
      bindings.listen(session.smoothingEnabled, "change", session.updateValues);
      bindings.listen(session.smoothingAmount, "input", session.updateValues);
      bindings.listen(session.fringeEnabled, "change", session.updateValues);
      bindings.listen(session.fringeMethod, 'change', session.updateValues);
      bindings.listen(session.fringeKeepCustom, 'change', session.updateValues);
      bindings.listen(session.fringeKeepColor, 'input', session.updateValues);
      bindings.listen(session.fringeColorMode, "change", session.updateValues);
      bindings.listen(session.fringeColor, "input", session.updateValues);
      for (const { input } of session.fringeFields) bindings.listen(input, "input", session.updateFringeValue);
      bindings.listen(session.spill, "input", session.updateValues);
      bindings.listen(connected, "change", session.scheduleBackgroundPreview);
      bindings.listen(session.form, "submit", submit);
      bindings.listen(session.dialog, "close", onClose);
      session.syncMethod();
      session.updateValues();
      session.scheduleBackgroundPreview();
      session.dialog.showModal();
    });
    
  }
}
