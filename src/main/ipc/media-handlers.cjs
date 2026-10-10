const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const {IMAGE_EXTENSIONS, importImages} = require('../image-import.cjs');

/** Register media commands against the desktop service container. */
function registerMediaHandlers(services) {
  ipcMain.handle("media:choose", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "Images and video", extensions: [...IMAGE_EXTENSIONS, "mp4", "mov", "m4v", "avi", "mkv", "webm", "wmv", "mpeg", "mpg", "m4p", "3gp", "ts", "mts", "m2ts", "flv"] },
        { name: "All files", extensions: ["*"] }
      ]
    });
    return result.canceled ? [] : result.filePaths;
  });
  
  ipcMain.handle("videos:import", async (_event, videoPath, options) => {
    const output = path.join(app.getPath("userData"), "video-frames", crypto.randomUUID());
    await fs.mkdir(output, { recursive: true });
    try {
      return await services.python.request("import_video", { ...options, path: videoPath, output, ffmpeg_path: services.ffmpegPath, ffprobe_path: services.ffprobePath });
    } catch (error) {
      await fs.rm(output, { recursive: true, force: true }).catch((cleanupError) => {
        console.error("Failed to clean up incomplete video import:", cleanupError);
      });
      throw error;
    }
  });
}
module.exports = {registerMediaHandlers};
