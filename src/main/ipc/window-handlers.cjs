const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');

/** Register window commands against the desktop service container. */
function registerWindowHandlers(services) {
  ipcMain.handle("window:minimize", (event) => BrowserWindow.fromWebContents(event.sender)?.minimize());
  
  ipcMain.handle("window:toggle-maximize", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return false;
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
    return window.isMaximized();
  });
  
  ipcMain.handle("window:toggle-fullscreen", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return false;
    window.setFullScreen(!window.isFullScreen());
    return window.isFullScreen();
  });
  
  ipcMain.handle("window:close", (event) => BrowserWindow.fromWebContents(event.sender)?.close());
  
  ipcMain.handle("window:enable-close-guard", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) window.frameLineCloseReady = true;
  });
  
  ipcMain.handle("window:confirm-close", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;
    window.frameLineCloseConfirmed = true;
    window.close();
  });
  
  ipcMain.handle("window:is-maximized", (event) => BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false);
}
module.exports = {registerWindowHandlers};
