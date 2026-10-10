const { contextBridge, ipcRenderer, webUtils } = require("electron");
let nextImageImportId = 0;

contextBridge.exposeInMainWorld("frameLine", {
  listToolPlugins: () => ipcRenderer.invoke('tools:list'),
  processToolImage: request => ipcRenderer.invoke('tools:process', request),
  chooseMedia: () => ipcRenderer.invoke("media:choose"),
  chooseImages: () => ipcRenderer.invoke("images:choose"),
  inspectImages: async (paths, onProgress) => {
    const operationId = ++nextImageImportId;
    const listener = (_event, payload) => {
      if (payload.operationId === operationId && typeof onProgress === "function") onProgress(payload);
    };
    ipcRenderer.on("images:import-progress", listener);
    try { return await ipcRenderer.invoke("images:inspect", paths, operationId); }
    finally { ipcRenderer.removeListener("images:import-progress", listener); }
  },
  sampleImageColor: (request) => ipcRenderer.invoke("images:sample-color", request),
  removeBackground: (request) => ipcRenderer.invoke("images:remove-background", request),
  applyImageOutline: (request) => ipcRenderer.invoke("images:apply-outline", request),
  previewImageOutline: (request) => ipcRenderer.invoke("images:preview-outline", request),
  refineImageEdges: (request) => ipcRenderer.invoke("images:refine-edges", request),
  previewRefineEdges: (request) => ipcRenderer.invoke("images:preview-refine", request),
  cleanImagePixels: (request) => ipcRenderer.invoke('images:clean-pixels', request),
  previewCleanPixels: (request) => ipcRenderer.invoke('images:preview-clean-pixels', request),
  cancelImagePreview: () => ipcRenderer.invoke("images:cancel-preview"),
  onImageProgress: callback => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("images:progress", listener);
    return () => ipcRenderer.removeListener("images:progress", listener);
  },
  renderCurrentImage: (request) => ipcRenderer.invoke("images:render-current", request),
  storeWorkingImage: (png) => ipcRenderer.invoke("images:store-working", png),
  discardProcessedImages: (paths) => ipcRenderer.invoke("images:discard-outputs", paths),
  previewBackground: (request) => ipcRenderer.invoke("images:preview-background", request),
  clearBackgroundPreview: () => ipcRenderer.invoke("images:clear-background-preview"),
  importVideo: (videoPath, options) => ipcRenderer.invoke("videos:import", videoPath, options),
  saveProject: (project) => ipcRenderer.invoke("project:save", project),
  openProject: () => ipcRenderer.invoke("project:open"),
  chooseExportPath: (format) => ipcRenderer.invoke("export:choose", format),
  exportGif: (request) => ipcRenderer.invoke("export:gif", request),
  exportVideo: (request) => ipcRenderer.invoke("export:video", request),
  chooseExportDirectory: () => ipcRenderer.invoke("export:choose-directory"),
  chooseSheetPath: () => ipcRenderer.invoke("export:choose-sheet"),
  exportImages: (request) => ipcRenderer.invoke("export:images", request),
  exportSheet: (request) => ipcRenderer.invoke("export:sheet", request),
  startExport: (taskId, command, request) => ipcRenderer.invoke("export:start", { taskId, command, request }),
  cancelExport: (taskId) => ipcRenderer.invoke("export:cancel", taskId),
  onExportEvent: (callback) => {
    const listeners = ["export:progress", "export:complete", "export:error", "export:cancelled"];
    const handlers = listeners.map((channel) => {
      const listener = (_event, payload) => callback(channel, payload);
      ipcRenderer.on(channel, listener);
      return [channel, listener];
    });
    return () => handlers.forEach(([channel, listener]) => ipcRenderer.removeListener(channel, listener));
  },
  getPathForFile: (file) => webUtils.getPathForFile(file),
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window:toggle-maximize"),
  toggleFullscreen: () => ipcRenderer.invoke("window:toggle-fullscreen"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  confirmCloseWindow: () => ipcRenderer.invoke("window:confirm-close"),
  enableCloseGuard: () => ipcRenderer.invoke("window:enable-close-guard"),
  onCloseRequested: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("window:request-close", listener);
    return () => ipcRenderer.removeListener("window:request-close", listener);
  },
  isWindowMaximized: () => ipcRenderer.invoke("window:is-maximized"),
  onWindowMaximized: (callback) => {
    const listener = (_event, maximized) => callback(maximized);
    ipcRenderer.on("window:maximized", listener);
    return () => ipcRenderer.removeListener("window:maximized", listener);
  }
});
