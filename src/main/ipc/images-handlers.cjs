const {IMAGE_EXTENSIONS, importImages} = require('../image-import.cjs');
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');

/** Register images commands against the desktop service container. */
function registerImagesHandlers(services) {
  ipcMain.handle("images:choose", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Images", extensions: IMAGE_EXTENSIONS }]
    });
    return result.canceled ? [] : result.filePaths;
  });
  
  ipcMain.handle("images:inspect", async (event, paths, operationId) => {
    const directory = path.join(app.getPath("userData"), "imported-images");
    return importImages(paths, directory, imported => services.python.request("inspect_images", { paths: imported }), progress => {
      if (operationId != null && !event.sender.isDestroyed()) event.sender.send("images:import-progress", { operationId, ...progress });
    });
  });
  
  ipcMain.handle("images:render-current", async (event, request) => {
    const output = path.join(app.getPath("userData"), "working-images", `${crypto.randomUUID()}.png`);
    try {
      const result = await services.processImage(event, "render_current_image", { ...request, output });
      services.generatedEffects.set(output, event.sender.id);
      return result;
    } catch (error) { await fs.rm(output, { force: true }); throw error; }
  });
  
  ipcMain.handle("images:store-working", async (event, png) => {
    const binary = png instanceof Uint8Array;
    if (!binary && (typeof png !== "string" || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(png))) throw new Error("Invalid working image.");
    const output = path.join(app.getPath("userData"), "working-images", `${crypto.randomUUID()}.png`);
    await fs.mkdir(path.dirname(output), { recursive: true });
    try {
      const bytes = binary ? Buffer.from(png.buffer, png.byteOffset, png.byteLength)
        : Buffer.from(png.slice("data:image/png;base64,".length), "base64");
      if (bytes.length < 33 || bytes.subarray(0,8).toString("hex") !== "89504e470d0a1a0a" || bytes.toString("ascii",12,16) !== "IHDR") throw new Error("Invalid working PNG.");
      const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
      if (!width || !height || width > 32767 || height > 32767 || width * height > 100000000) throw new Error("Invalid working image dimensions.");
      await fs.writeFile(output, bytes, { flag: "wx" });
      const result = {path:output, name:path.basename(output), width, height, format:"PNG"};
      services.generatedEffects.set(output, event.sender.id);
      return result;
    } catch (error) { await fs.rm(output, { force: true }); throw error; }
  });
  
  ipcMain.handle("images:sample-color", (_event, request) => services.python.request("sample_image_color", request));
  
  ipcMain.handle("images:remove-background", async (event, request) => {
    const output = path.join(app.getPath("userData"), "background-removal", `${crypto.randomUUID()}.png`);
    const result = await services.processImage(event, "remove_background", { ...request, output });
    services.generatedEffects.set(output, event.sender.id);
    return result;
  });
  
  ipcMain.handle("images:apply-outline", async (event, request) => {
    const output = path.join(app.getPath("userData"), "image-outlines", `${crypto.randomUUID()}.png`);
    await fs.mkdir(path.dirname(output), { recursive: true });
    try {
      const result = await services.processImage(event, "apply_outline", { ...request, output });
      services.generatedEffects.set(output, event.sender.id);
      return result;
    } catch (error) {
      await fs.rm(output, { force: true }).catch((cleanupError) => {
        console.error("Failed to clean up incomplete outlined image:", cleanupError);
      });
      throw error;
    }
  });
  
  ipcMain.handle("images:refine-edges", async (event, request) => {
    const output = path.join(app.getPath("userData"), "refined-edges", `${crypto.randomUUID()}.png`);
    try {
      const result = await services.processImage(event, "refine_edges", { ...request, output });
      services.generatedEffects.set(output, event.sender.id);
      return result;
    } catch (error) {
      await fs.rm(output, { force: true }).catch(cleanupError => console.error("Failed to clean up refined image:", cleanupError));
      throw error;
    }
  });
  
  ipcMain.handle("images:preview-refine", async (event, request) => {
    const output = path.join(app.getPath("userData"), "refine-previews", `${crypto.randomUUID()}.png`);
    try {
      const result = await services.processImage(event, "refine_edges", {...request, output}, true);
      services.generatedEffects.set(output, event.sender.id);
      return result;
    } catch (error) { await fs.rm(output, {force:true}); throw error; }
  });
  
  ipcMain.handle("images:preview-outline", async (event, request) => {
    const output = path.join(app.getPath("userData"), "outline-previews", `${crypto.randomUUID()}.png`);
    await fs.mkdir(path.dirname(output), { recursive: true });
    try {
      const result = await services.processImage(event, "apply_outline", { ...request, output }, true);
      services.generatedEffects.set(output, event.sender.id);
      return result;
    } catch (error) {
      await fs.rm(output, { force: true }).catch(cleanupError => console.error("Failed to clean up outline preview:", cleanupError));
      throw error;
    }
  });
  
  for (const [channel, preview] of [['images:clean-pixels', false], ['images:preview-clean-pixels', true]]) {
    ipcMain.handle(channel, async (event, request) => {
      const output = path.join(app.getPath('userData'), preview ? 'pixel-cleanup-previews' : 'pixel-cleanup', `${crypto.randomUUID()}.png`);
      try {
        const result = await services.processImage(event, 'clean_pixels', {...request, output}, preview);
        services.generatedEffects.set(output, event.sender.id);
        return result;
      } catch (error) { await fs.rm(output, {force:true}); throw error; }
    });
  }
  
  ipcMain.handle("images:discard-outputs", async (event, paths) => {
    if (!Array.isArray(paths)) return;
    for (const value of new Set(paths)) {
      if (typeof value !== "string") continue;
      const output = path.resolve(value);
      if (services.generatedEffects.get(output) !== event.sender.id) continue;
      await fs.rm(output, { force: true });
      services.generatedEffects.delete(output);
    }
  });
  
  ipcMain.handle("images:preview-background", async (event, request) => {
    const senderId = event.sender.id;
    const directory = path.join(app.getPath("userData"), "background-preview");
    const output = path.join(directory, `${crypto.randomUUID()}.png`);
    await fs.mkdir(directory, { recursive: true });
    try {
      const result = await services.processImage(event, "remove_background", { ...request, output }, true);
      const previous = services.backgroundPreviewFiles.get(senderId);
      if (previous) await fs.rm(previous, { force: true });
      services.backgroundPreviewFiles.set(senderId, output);
      return result;
    } catch (error) {
      await fs.rm(output, { force: true }).catch((cleanupError) => {
        console.error("Failed to clean up incomplete background preview:", cleanupError);
      });
      throw error;
    }
  });
  
  ipcMain.handle("images:clear-background-preview", async (event) => {
    const senderId = event.sender.id;
    const preview = services.backgroundPreviewFiles.get(senderId);
    services.backgroundPreviewFiles.delete(senderId);
    if (preview) await fs.rm(preview, { force: true });
  });
  
  ipcMain.handle("images:cancel-preview", () => services.previewPython?.cancelGroup("preview") ?? false);
}
module.exports = {registerImagesHandlers};
