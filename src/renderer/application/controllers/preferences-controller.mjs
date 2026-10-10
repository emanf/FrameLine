import { ControllerBase } from '../controller-base.mjs';
import { initializeTooltips } from '../../view/tooltips.mjs';
import { TimelineViewModel } from '../../viewmodel/timeline-view-model.mjs';
import { TimelineView } from '../../view/timeline-view.mjs';

import { WorkingSourceCache } from '../../model/working-source-cache.mjs';

/** Load, validate, and persist editor preferences. */
export class PreferencesController extends ControllerBase {
  /** Read saved preferences, falling back to defaults for invalid storage. */
  readAppPreferences() {
    const runtime = this.application;
    try {
      const value = JSON.parse(localStorage.getItem(runtime.PREFERENCES_KEY) ?? "{}");
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch (error) {
      console.warn("Ignoring invalid saved app preferences:", error);
      return {};
    }
  }

  /** Filter saved presets to unique finite values inside their accepted bounds. */
  normalizeCustomNumbers(values, min, max) {
    const runtime = this.application;
    if (!Array.isArray(values)) return [];
    return [...new Set(values
      .map(Number)
      .filter((value) => Number.isFinite(value) && value > min && value <= max))];
  }

  /** Return a finite bounded value, falling back when input is invalid. */
  clampNumber(value, min, max, fallback) {
    const runtime = this.application;
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
  }

  /** Restore validated local controls and layout preferences while retaining startup Hand selection. */
  restorePreferences() {
    const runtime = this.application;
    runtime.vm.project.fps = runtime.clampNumber(runtime.savedPreferences.fps, 0.01, 240, runtime.vm.project.fps);
    runtime.vm.project.playbackSpeed = runtime.clampNumber(runtime.savedPreferences.playbackSpeed, 0.01, 16, runtime.vm.project.playbackSpeed);
    runtime.vm.project.defaultDurationFrames = Math.round(runtime.clampNumber(runtime.savedPreferences.defaultDurationFrames, 1, 1000000, runtime.vm.project.defaultDurationFrames));
    runtime.vm.project.loopEnabled = typeof runtime.savedPreferences.loopEnabled === "boolean" ? runtime.savedPreferences.loopEnabled : runtime.vm.project.loopEnabled;
    runtime.vm.zoom = runtime.clampNumber(runtime.savedPreferences.timelineZoom, 1, 5000, runtime.vm.zoom);
    runtime.previewGridEnabled = typeof runtime.savedPreferences.previewGridEnabled === "boolean" ? runtime.savedPreferences.previewGridEnabled : runtime.previewGridEnabled;
    runtime.foregroundColor = /^#[a-f\d]{6}$/i.test(runtime.savedPreferences.brushColor ?? "") ? runtime.savedPreferences.brushColor : runtime.foregroundColor;
  
    for (const [selector, values, suffix] of [
      ["#fps-select", runtime.customFrameRates, " FPS"],
      ["#speed-select", runtime.customPlaybackSpeeds, "×"]
    ]) {
      const select = document.querySelector(selector);
      const addOption = select.querySelector('option[value="add"]');
      for (const value of values) {
        const option = document.createElement("option");
        option.value = String(value);
        option.textContent = `${value}${suffix} (custom)`;
        select.insertBefore(option, addOption);
      }
    }
  
    for (const [variable, value, min, max] of [
      ["--image-panel-width", runtime.savedPreferences.imagePanelWidth, 135, 1000],
      ["--properties-panel-width", runtime.savedPreferences.propertiesPanelWidth, 160, 1000],
      ["--timeline-height", runtime.savedPreferences.timelineHeight, 160, 1000]
    ]) {
      if (Number.isFinite(Number(value))) {
        document.documentElement.style.setProperty(variable, `${runtime.clampNumber(value, min, max, min)}px`);
      }
    }
  
    document.querySelector("#preview-brush-color").value = runtime.foregroundColor;
    document.querySelector("#preview-brush-opacity").value = String(runtime.clampNumber(runtime.savedPreferences.brushOpacity, 1, 100, 100));
    document.querySelector("#preview-brush-size").value = String(runtime.clampNumber(runtime.savedPreferences.brushSize, 1, Number.MAX_VALUE, 12));
    document.querySelector("#preview-brush-feather").value = String(runtime.clampNumber(runtime.savedPreferences.brushFeather, 0, 100, 0));
    document.querySelector("#preview-brush-antialias").checked = runtime.savedPreferences.brushAntiAlias !== false;
    document.querySelector("#preview-square-brush").checked = runtime.savedPreferences.squareBrush === true;
    document.querySelector("#preview-healing-keep").value = /^#[a-f\d]{6}$/i.test(runtime.savedPreferences.healingKeep ?? "") ? runtime.savedPreferences.healingKeep : "#000000";
    document.querySelector("#preview-healing-remove").value = /^#[a-f\d]{6}$/i.test(runtime.savedPreferences.healingRemove ?? "") ? runtime.savedPreferences.healingRemove : "#04f404";
    runtime.healingManualRemove = document.querySelector("#preview-healing-remove").value;
    document.querySelector("#preview-healing-auto").checked = false;
    document.querySelector("#preview-healing-auto-keep").checked = runtime.savedPreferences.healingAutoKeep === true;
    document.querySelector("#preview-healing-sample-distance").value = String(Math.round(runtime.clampNumber(runtime.savedPreferences.healingSampleDistance, 1, 128, 24)));
    document.querySelector("#preview-healing-recover-transparency").checked = runtime.savedPreferences.healingRecoverTransparency !== false;
    document.querySelector("#preview-healing-tolerance").value = String(Math.round(runtime.clampNumber(runtime.savedPreferences.healingTolerance, 0, 255, 24)));
    document.querySelector("#preview-healing-strength").value = String(Math.round(runtime.clampNumber(runtime.savedPreferences.healingStrength, 1, 100, 100)));
    runtime.updateHealingControls();
    for (const tool of runtime.toolRegistry.processors()) {
      const legacy = tool.id === 'refine' ? runtime.savedPreferences.refineEdges : tool.id === 'clean' ? runtime.savedPreferences.cleanPixels : undefined;
      runtime.toolControls.write(tool.id, runtime.savedPreferences.toolOptions?.[tool.id] ?? legacy);
    }
    document.querySelector("#preview-grid-visible").checked = runtime.previewGridEnabled;
    document.querySelector("#preview-grid-size").value = String(runtime.clampNumber(runtime.savedPreferences.previewGridSize, 1, 256, 8));
    document.querySelector("#preview-grid-opacity").value = String(runtime.clampNumber(runtime.savedPreferences.previewGridOpacity, 0, 100, 25));
    document.querySelector("#preview-grid-toggle").classList.toggle("grid-enabled", runtime.previewGridEnabled);
    document.querySelector("#preview-grid-opacity-value").value = `${document.querySelector("#preview-grid-opacity").value}%`;
    document.querySelector("#preview-background-color").value = /^#[a-f\d]{6}$/i.test(runtime.savedPreferences.previewBackgroundColor ?? "")
      ? runtime.savedPreferences.previewBackgroundColor : "#ffffff";
    document.querySelector("#preview-background-transparent").checked = runtime.savedPreferences.previewBackgroundTransparent !== false;
    runtime.updatePreviewBackground();
    document.querySelector("#preview-brush-opacity-value").value = `${document.querySelector("#preview-brush-opacity").value}%`;
    runtime.updateBrushSizeUi();
    document.querySelector("#preview-brush-feather-value").value = `${document.querySelector("#preview-brush-feather").value}%`;
    if (["gif", "mp4", "mov", "webm", "avi", "mkv", "sources", "frames", "sheet-clips", "sheet-frames"].includes(runtime.savedPreferences.exportFormat)) {
      document.querySelector("#export-format").value = runtime.savedPreferences.exportFormat;
    }
    if (["all", "range", "selected"].includes(runtime.savedPreferences.exportScope)) document.querySelector("#export-scope").value = runtime.savedPreferences.exportScope;
  }

  /** Debounce saving validated controls, viewport values, and tool preferences to local storage. */
  scheduleSavePreferences() {
    const runtime = this.application;
    clearTimeout(runtime.preferencesSaveTimer);
    runtime.preferencesSaveTimer = setTimeout(() => {
      const number = (selector) => Number(document.querySelector(selector).value);
      const preferences = {
        fps: runtime.vm.project.fps,
        playbackSpeed: runtime.vm.project.playbackSpeed,
        defaultDurationFrames: runtime.vm.project.defaultDurationFrames,
        loopEnabled: runtime.vm.project.loopEnabled,
        timelineZoom: runtime.vm.zoom,
        previewZoom:runtime.previewZoom,
        imagePanelWidth: document.querySelector(".image-panel").getBoundingClientRect().width,
        propertiesPanelWidth: document.querySelector(".properties-panel").getBoundingClientRect().width,
        timelineHeight: document.querySelector(".timeline-panel").getBoundingClientRect().height,
        customFrameRates:runtime.customFrameRates,
        customPlaybackSpeeds:runtime.customPlaybackSpeeds,
        brushColor: runtime.foregroundColor,
        brushOpacity: number("#preview-brush-opacity"),
        brushSize: runtime.currentBrushSize(),
        brushFeather: number("#preview-brush-feather"),
        brushAntiAlias: document.querySelector("#preview-brush-antialias").checked,
        squareBrush: document.querySelector("#preview-square-brush").checked,
        healingKeep: document.querySelector("#preview-healing-keep").value,
        healingRemove: runtime.healingManualRemove,
        healingTolerance: number("#preview-healing-tolerance"),
        healingStrength: number("#preview-healing-strength"),
        healingAutoKeep: document.querySelector("#preview-healing-auto-keep").checked,
        healingSampleDistance: number("#preview-healing-sample-distance"),
        healingRecoverTransparency: document.querySelector("#preview-healing-recover-transparency").checked,
        refineEdges: runtime.refineOptions(),
        cleanPixels: runtime.cleanOptions(),
        toolOptions: Object.fromEntries(runtime.toolRegistry.processors().map(tool => [tool.id, runtime.processingOptions(tool.id)])),
        previewGridEnabled:runtime.previewGridEnabled,
        previewGridSize: number("#preview-grid-size"),
        previewGridOpacity: number("#preview-grid-opacity"),
        previewBackgroundColor: document.querySelector("#preview-background-color").value,
        previewBackgroundTransparent: document.querySelector("#preview-background-transparent").checked,
        exportFormat: document.querySelector("#export-format").value,
        exportScope: document.querySelector("#export-scope").value
      };
      try {
        localStorage.setItem(runtime.PREFERENCES_KEY, JSON.stringify(preferences));
      } catch (error) {
        runtime.notifyError(error);
      }
    }, 150);
  }

  /** Read a saved removal preset and discard malformed settings. */
  readBackgroundOptions(key) {
    const runtime = this.application;
    try {
      const value = JSON.parse(localStorage.getItem(key) ?? "null");
      if (!value || typeof value !== "object") return null;
      return value;
    } catch (error) {
      console.warn(`Ignoring invalid saved background settings (${key}):`, error);
      return null;
    }
  }

  /** Bind state after the editor state and required controls are ready. */
  initializeState() {
    const runtime = this.application;
    initializeTooltips();
    runtime.vm = new TimelineViewModel();
    runtime.view = new TimelineView(runtime.toolRegistry);
    runtime.scroll = document.querySelector("#timeline-scroll");
    runtime.toast = document.querySelector("#toast");
    runtime.PREFERENCES_KEY = "frameline.preferences";
    runtime.BACKGROUND_SETTINGS_VERSION = 2;
    
    runtime.savedPreferences = runtime.readAppPreferences();
    runtime.customFrameRates = runtime.normalizeCustomNumbers(runtime.savedPreferences.customFrameRates, 0, 240);
    runtime.customPlaybackSpeeds = runtime.normalizeCustomNumbers(runtime.savedPreferences.customPlaybackSpeeds, 0, 16);

    runtime.previewZoom = runtime.clampNumber(runtime.savedPreferences.previewZoom, 0.4, 12800, 100);
    runtime.MIN_PREVIEW_ZOOM = 0.4;
    runtime.MAX_PREVIEW_ZOOM = 12800;

    runtime.lastHistoryStateId = runtime.vm.historyStateId;

    runtime.MIN_BACKGROUND_PREVIEW_ZOOM = 0.045;
    runtime.MAX_BACKGROUND_PREVIEW_ZOOM = 128;

    runtime.backgroundPreviewTask = Promise.resolve();

    runtime.previewPaintCanvas = document.querySelector("#preview-paint-canvas");
    runtime.previewPaintContext = runtime.previewPaintCanvas.getContext("2d");
    runtime.previewImageWrap = document.querySelector("#preview-image-wrap");
    runtime.previewBrushCursor = document.querySelector("#preview-brush-cursor");
    runtime.previewPixelGrid = document.querySelector("#preview-pixel-grid");
    runtime.previewPixelGridContext = runtime.previewPixelGrid.getContext("2d");
    runtime.workingSourceCache = new WorkingSourceCache(path => window.frameLine.discardProcessedImages([path]));
    runtime.restorePreferences();
    document.querySelector("#preview-image").addEventListener("load", () => {
      document.querySelector("#preview-image").hidden = false;
      document.querySelector(".preview-placeholder").hidden = true;
      runtime.redrawPaintCanvas();
    });
    
  }
}
