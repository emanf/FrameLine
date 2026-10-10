const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');

/** Register tools commands against the desktop service container. */
function registerToolsHandlers(services) {
  ipcMain.handle('tools:list', () => services.toolPlugins.list());
  
  ipcMain.handle('tools:process', async (event, request) => {
    const processor = services.toolPlugins.processor(request.toolId);
    const output = path.join(app.getPath('userData'), request.preview ? 'tool-previews' : 'tool-images', `${crypto.randomUUID()}.png`);
    try {
      const result = await services.processImage(event, 'process_tool_plugin', {...request, processor, output}, Boolean(request.preview));
      services.generatedEffects.set(output, event.sender.id);
      return result;
    } catch (error) { await fs.rm(output, {force:true}); throw error; }
  });
}
module.exports = {registerToolsHandlers};
