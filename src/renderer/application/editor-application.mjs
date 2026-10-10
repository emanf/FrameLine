import {EditorSessionViewModel} from '../viewmodel/editor-session-view-model.mjs';
import { ToolCoordinator } from './tool-coordinator.mjs';
import { PreferencesController } from './controllers/preferences-controller.mjs';
import { EditorCoordinator } from './controllers/editor-coordinator.mjs';
import { BrushRasterView } from './controllers/brush-raster-view.mjs';
import { PreviewCanvasView } from './controllers/preview-canvas-view.mjs';
import { CropToolController } from './controllers/crop-tool-controller.mjs';
import { ToolPanelView } from './controllers/tool-panel-view.mjs';
import { PreviewNavigationView } from './controllers/preview-navigation-view.mjs';
import { FeedbackView } from './controllers/feedback-view.mjs';
import { ToolHistoryController } from './controllers/tool-history-controller.mjs';
import { WindowController } from './controllers/window-controller.mjs';
import { MediaImportController } from './controllers/media-import-controller.mjs';
import { VideoImportDialogView } from './controllers/video-import-dialog-view.mjs';
import { ImageProcessingService } from './controllers/image-processing-service.mjs';
import { NumberDialogView } from './controllers/number-dialog-view.mjs';
import { BackgroundRemovalDialogView } from './controllers/background-removal-dialog-view.mjs';
import { ProgressView } from './controllers/progress-view.mjs';
import { ExportController } from './controllers/export-controller.mjs';
import { BackgroundToolController } from './controllers/background-tool-controller.mjs';
import { PlaybackController } from './controllers/playback-controller.mjs';
import { ProjectController } from './controllers/project-controller.mjs';
import { TimelineInputController } from './controllers/timeline-input-controller.mjs';
import { BrushInputController } from './controllers/brush-input-controller.mjs';
import { OutlineToolController } from './controllers/outline-tool-controller.mjs';
import { ColorCleanupToolController } from './controllers/color-cleanup-tool-controller.mjs';
import { ProcessingToolController } from './controllers/processing-tool-controller.mjs';
import { PaddingToolController } from './controllers/padding-tool-controller.mjs';
import { PreviewDisplayView } from './controllers/preview-display-view.mjs';
import { WorkspaceLayoutView } from './controllers/workspace-layout-view.mjs';
import { ImageListController } from './controllers/image-list-controller.mjs';
import { ClipMenuController } from './controllers/clip-menu-controller.mjs';
import { ContextMenuView } from './controllers/context-menu-view.mjs';
import { KeyboardController } from './controllers/keyboard-controller.mjs';

/** Compose editor components and expose their bound commands to event handlers. */
export class EditorApplication {
  /** Instantiate components before executing bindings that use their commands. */
  constructor() {
    this.session = new EditorSessionViewModel();
    this.session.connect(this);
    this.components = new Map();
    this.components.set('PreferencesController', new PreferencesController(this));
    this.components.set('EditorCoordinator', new EditorCoordinator(this));
    this.components.set('BrushRasterView', new BrushRasterView(this));
    this.components.set('PreviewCanvasView', new PreviewCanvasView(this));
    this.components.set('CropToolController', new CropToolController(this));
    this.components.set('ToolPanelView', new ToolPanelView(this));
    this.components.set('PreviewNavigationView', new PreviewNavigationView(this));
    this.components.set('FeedbackView', new FeedbackView(this));
    this.components.set('ToolHistoryController', new ToolHistoryController(this));
    this.components.set('WindowController', new WindowController(this));
    this.components.set('MediaImportController', new MediaImportController(this));
    this.components.set('VideoImportDialogView', new VideoImportDialogView(this));
    this.components.set('ImageProcessingService', new ImageProcessingService(this));
    this.components.set('NumberDialogView', new NumberDialogView(this));
    this.components.set('BackgroundRemovalDialogView', new BackgroundRemovalDialogView(this));
    this.components.set('ProgressView', new ProgressView(this));
    this.components.set('ExportController', new ExportController(this));
    this.components.set('BackgroundToolController', new BackgroundToolController(this));
    this.components.set('PlaybackController', new PlaybackController(this));
    this.components.set('ProjectController', new ProjectController(this));
    this.components.set('TimelineInputController', new TimelineInputController(this));
    this.components.set('BrushInputController', new BrushInputController(this));
    this.components.set('OutlineToolController', new OutlineToolController(this));
    this.components.set('ColorCleanupToolController', new ColorCleanupToolController(this));
    this.components.set('ProcessingToolController', new ProcessingToolController(this));
    this.components.set('PaddingToolController', new PaddingToolController(this));
    this.components.set('PreviewDisplayView', new PreviewDisplayView(this));
    this.components.set('WorkspaceLayoutView', new WorkspaceLayoutView(this));
    this.components.set('ImageListController', new ImageListController(this));
    this.components.set('ClipMenuController', new ClipMenuController(this));
    this.components.set('ContextMenuView', new ContextMenuView(this));
    this.components.set('KeyboardController', new KeyboardController(this));
    for (const component of this.components.values()) {
      for (const name of Object.getOwnPropertyNames(Object.getPrototypeOf(component))) {
        if (name === 'constructor' || name.startsWith('initialize')) continue;
        this[name] = component[name].bind(component);
      }
    }
  }

  /** Attach views and input handlers in dependency order. */
  start() {
    this.tools = new ToolCoordinator(this);
    this.components.get('PreferencesController').initializeState();
    this.updatePreviewToolUi();
    this.components.get('ToolPanelView').initializeEnableControl();
    this.components.get('EditorCoordinator').initializeProjectEvents();
    this.components.get('WindowController').initializeWindowEvents();
    this.components.get('PlaybackController').initializePlaybackEvents();
    this.components.get('ProjectController').initializeProjectActions();
    this.components.get('TimelineInputController').initializeTimelineSettings();
    this.components.get('BrushInputController').initializePointerEvents();
    this.components.get('ToolHistoryController').initializePaintActions();
    this.components.get('OutlineToolController').initializeOutlineControls();
    this.components.get('CropToolController').initializeCropFields();
    this.components.get('ColorCleanupToolController').initializeCleanupControls();
    this.components.get('ProcessingToolController').initializeProcessingControls();
    this.components.get('PaddingToolController').initializePaddingControls();
    this.components.get('PreviewDisplayView').initializeDisplayPopovers();
    this.components.get('WorkspaceLayoutView').initializeLayoutResizers();
    this.components.get('ImageListController').initializeImageListEvents();
    this.components.get('ClipMenuController').initializeContextMenus();
    this.components.get('ExportController').initializeExportEvents();
    this.components.get('KeyboardController').initializeKeyboardEvents();
    this.components.get('TimelineInputController').initializeClipResize();
    void this.tools.loadPlugins();
    window.addEventListener('beforeunload', () => this.toolRegistry.dispose());
    return this;
  }
}
