const {app, BrowserWindow} = require('electron');
const path = require('node:path');
const {mediaPaths} = require('./runtime-paths.cjs');
const {PythonBridge} = require('./python-bridge.cjs');
const {ToolPluginService} = require('./tool-plugin-service.cjs');
const {createWindow} = require('./window-service.cjs');
const {registerMediaHandlers} = require('./ipc/media-handlers.cjs');
const {registerImagesHandlers} = require('./ipc/images-handlers.cjs');
const {registerProjectHandlers} = require('./ipc/project-handlers.cjs');
const {registerExportHandlers} = require('./ipc/export-handlers.cjs');
const {registerWindowHandlers} = require('./ipc/window-handlers.cjs');
const {registerToolsHandlers} = require('./ipc/tools-handlers.cjs');

/** Own worker lifetimes, plugin discovery, and domain-specific IPC registration. */
class DesktopApplication {
  constructor() {
    Object.assign(this, mediaPaths({packaged:app.isPackaged}));
    this.generatedEffects = new Map(); this.backgroundPreviewFiles = new Map();
    this.processImage = this.processImage.bind(this);
  }

  /** Correlate progress with a renderer request and isolate preview work. */
  processImage(event, command, request, preview = false) {
    const {operationId, ...payload} = request;
    const worker = preview ? this.previewPython ??= this.createPythonBridge() : this.python;
    return worker.request(command, payload, progress => {
      if (typeof operationId === 'string' && !event.sender.isDestroyed()) event.sender.send('images:progress', {operationId, ...progress});
    }, preview ? {group:'preview'} : {});
  }

  /** Discover extensions before creating the renderer, then attach platform events. */
  async start() {
    const extensionRoot = app.isPackaged ? process.resourcesPath : app.getAppPath();
    this.toolPlugins = new ToolPluginService([path.join(extensionRoot, 'extensions'), path.join(app.getPath('userData'), 'extensions')]);
    await this.toolPlugins.discover();
    this.python = this.createPythonBridge();
    registerMediaHandlers(this);
    registerImagesHandlers(this);
    registerProjectHandlers(this);
    registerExportHandlers(this);
    registerWindowHandlers(this);
    registerToolsHandlers(this);
    createWindow();
    app.on('activate', () => {if (BrowserWindow.getAllWindows().length === 0) createWindow();});
    app.on('will-quit', () => this.dispose());
  }
  /** Use the bundled engine in releases and the source interpreter in development. */
  createPythonBridge() {
    return new PythonBridge({ffmpegPath:this.ffmpegPath, ffprobePath:this.ffprobePath, packaged:app.isPackaged});
  }
  /** Close workers and their child processes during app shutdown. */
  dispose() {this.python?.close(); this.previewPython?.close();}
}
module.exports = {DesktopApplication};
