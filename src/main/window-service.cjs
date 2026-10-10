const {app, BrowserWindow} = require('electron');
const path = require('node:path');
const {applicationIconPath} = require('./application-icon.cjs');

/** Create the isolated desktop window and guard unsaved editor state on close. */
function createWindow() {
  const icon = applicationIconPath();
  if (process.platform === 'darwin') app.dock?.setIcon(icon);
  const window = new BrowserWindow({
    icon,
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 560,
    backgroundColor: "#080808",
    frame: false,
    thickFrame: true,
    resizable: true,
    maximizable: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  window.setMenuBarVisibility(false);
  window.removeMenu();
  window.on("close", (event) => {
    if (window.frameLineCloseConfirmed || !window.frameLineCloseReady) return;
    event.preventDefault();
    window.webContents.send("window:request-close");
  });
  window.webContents.on("did-start-loading", () => { window.frameLineCloseReady = false; });
  window.webContents.on("render-process-gone", () => { window.frameLineCloseReady = false; });
  window.on("maximize", () => window.webContents.send("window:maximized", true));
  window.on("unmaximize", () => window.webContents.send("window:maximized", false));
  window.loadFile(path.join(__dirname, "../renderer/index.html"));
}
module.exports = {createWindow};
