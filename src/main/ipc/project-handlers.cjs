const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const {saveProjectFile, readProjectFile} = require('../project-storage.cjs');

/** Register project commands against the desktop service container. */
function registerProjectHandlers(services) {
  ipcMain.handle("project:save", async (_event, project) => {
    const result = await dialog.showSaveDialog({
      defaultPath: "Untitled.frameline",
      filters: [{ name: "FrameLine Project", extensions: ["frameline"] }]
    });
    if (result.canceled || !result.filePath) return null;
    const { validateProject } = await import("../../renderer/model/project-model.mjs");
    const { originalImage } = await import("../../renderer/model/image-effects.mjs");
    validateProject(project);
    // Older JSON projects also gain an explicit original when resaved.
    const portable = structuredClone(project);
    for (const image of portable.images) {
      const original = originalImage(image);
      image.originalPath = original.path;
      image.originalDimensions = original.dimensions;
    }
    await saveProjectFile(result.filePath, portable, (output, snapshot) => services.python.request("save_project", { output, project: snapshot }));
    return result.filePath;
  });
  
  ipcMain.handle("project:open", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "FrameLine Project", extensions: ["frameline", "zip", "json"] }]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const directory = path.join(app.getPath("userData"), "project-assets", crypto.randomUUID());
    try {
      const project = await readProjectFile(result.filePaths[0], async (source) => {
        const unpacked = await services.python.request("open_project", { path: source, output: directory });
        return unpacked.project;
      });
      const { validateProject } = await import("../../renderer/model/project-model.mjs");
      validateProject(project);
      return { path: result.filePaths[0], project };
    } catch (error) { await fs.rm(directory, { recursive: true, force: true }); throw error; }
  });
}
module.exports = {registerProjectHandlers};
