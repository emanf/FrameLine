import {ToolEditHistory} from '../model/tool-edit-history.mjs';

/** Transient viewport, gesture, preview-job, and tool state; never written to project files. */
export class EditorSessionViewModel {
  /** Start each session with Hand selected, no pending edits, and idle processing. */
  constructor() {
    this.preferencesSaveTimer = null;
    this.playing = false;
    this.lastTick = null;
    this.frameRemainder = 0;
    this.animationFrameId = null;
    this.toastTimer = undefined;
    this.resizeState = null;
    this.previewPanX = 0;
    this.previewPanY = 0;
    this.previewPanPointerId = null;
    this.previewPanStart = null;
    this.previewPanImagePath = null;
    this.previewPanImageId = null;
    this.previewTool = "hand";
    this.previewToolEnabled = true;
    this.previewPaintPointerId = null;
    this.previewPaintStroke = null;
    this.previewPaintFrame = null;
    this.previewCropDrag = null;
    this.previewCropDraft = null;
    this.previewPaintDraft = null;
    this.previewOutlineDraft = null;
    this.previewPaddingDraft = null;
    this.previewRefineDraft = null;
    this.outlinePreviewRequestId = 0;
    this.outlinePreviewTimer = null;
    this.outlinePreviewGeneration = 0;
    this.outlinePreviewPending = null;
    this.outlinePreviewRunning = false;
    this.toolEditHistory = new ToolEditHistory();
    this.toolHistorySource = null;
    this.toolGestureBefore = null;
    this.navigatingHistory = false;
    this.paintRasterCache = null;
    this.paintDirtyRegion = null;
    this.paintRenderedPointCount = 0;
    this.paintPointerBounds = null;
    this.refinePreviewRequestId = 0;
    this.refinePreviewTimer = null;
    this.refinePreviewGeneration = 0;
    this.refinePreviewPending = null;
    this.refinePreviewRunning = false;
    this.paddingPreviewSource = null;
    this.paddingPreviewRevision = 0;
    this.toolSwitchBusy = false;
    this.dismissContextMenu = null;
    this.foregroundColor = "#ff3030";
    this.lastBrushSize = 12;
    this.resizingBrushWithSlider = false;
    this.healingManualRemove = "#04f404";
    this.healingDetectedColor = null;
    this.healingDetectionError = null;
    this.healingReference = null;
    this.healingDetectionSource = null;
    this.brushCursorPosition = null;
    this.previewGridEnabled = false;
    this.backgroundPreviewZoom = 1;
    this.backgroundPreviewPan = { x: 0, y: 0 };
    this.backgroundPreviewDrag = null;
    this.backgroundPreviewPanFrame = null;
    this.backgroundPreviewRequestId = 0;
    this.backgroundPreviewTimer = null;
    this.backgroundEditBusy = false;
    this.paddingBusy = false;
    this.outlineApplyBusy = false;
    this.refineBusy = false;
    this.addImagesBusy = false;
    this.lastAddedImage = null;
    this.liveOutlinePreviewImageId = null;
  }

  /** Expose session property accessors to composed controllers without duplicating state. */
  connect(application) {
    for (const key of Object.keys(this)) Object.defineProperty(application, key, {
      configurable:false, enumerable:true, get:() => this[key], set:value => {this[key] = value;}
    });
  }
}
