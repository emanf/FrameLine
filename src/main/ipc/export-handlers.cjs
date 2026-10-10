const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');

/** Register export commands against the desktop service container. */
function registerExportHandlers(services) {
  const exportTasks = new Map();
  ipcMain.handle("export:gif", (_event, request) => services.python.request("export_gif", request));
  
  ipcMain.handle("export:choose", async (_event, format) => {
    const extensions = {
      gif: ["gif"], mp4: ["mp4"], mov: ["mov"], webm: ["webm"], avi: ["avi"], mkv: ["mkv"]
    };
    const selected = extensions[format];
    if (!selected) throw new Error(`Unsupported export format: ${format}`);
    const result = await dialog.showSaveDialog({
      defaultPath: `animation.${selected[0]}`,
      filters: [{ name: `${format.toUpperCase()} video`, extensions: selected }]
    });
    return result.canceled ? null : result.filePath;
  });
  
  ipcMain.handle("export:video", (_event, request) => services.python.request("export_video", { ...request, ffmpeg_path: services.ffmpegPath }));
  
  ipcMain.handle("export:choose-directory", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
    return result.canceled ? null : result.filePaths[0];
  });
  
  ipcMain.handle("export:choose-sheet", async () => {
    const result = await dialog.showSaveDialog({
      defaultPath: "contact-sheet.png",
      filters: [{ name: "PNG image", extensions: ["png"] }]
    });
    return result.canceled ? null : result.filePath;
  });
  
  ipcMain.handle("export:images", (_event, request) => services.python.request("export_images", request));
  
  ipcMain.handle("export:sheet", (_event, request) => services.python.request("export_sheet", request));
  
  ipcMain.handle("export:start", (event, { taskId, command, request }) => {
    if (!["export_gif", "export_video", "export_images", "export_sheet"].includes(command)) {
      throw new Error(`Unsupported export task: ${command}`);
    }
    if (exportTasks.has(taskId)) throw new Error("An export with this ID is already running.");
    const sender = event.sender;
    exportTasks.set(taskId, sender);
    services.python.runTask(taskId, command, { ...request, ffmpeg_path: services.ffmpegPath }, (progress) => {
      if (!sender.isDestroyed()) sender.send("export:progress", { taskId, ...progress });
    })
      .then((result) => {
        if (!sender.isDestroyed()) sender.send("export:complete", { taskId, result });
      })
      .catch((error) => {
        if (!sender.isDestroyed()) {
          const channel = error.code === "EXPORT_CANCELLED" ? "export:cancelled" : "export:error";
          sender.send(channel, { taskId, message: error.message });
        }
      })
      .finally(() => exportTasks.delete(taskId));
    return true;
  });
  
  ipcMain.handle("export:cancel", (_event, taskId) => services.python.cancelTask(taskId));
}
module.exports = {registerExportHandlers};
