const {app, ipcMain, shell, clipboard} = require('electron');
const {AppInfoService} = require('../app-info-service.cjs');

/** Keep application metadata and external navigation behind the preload boundary. */
function registerAppHandlers() {
  const version = app.isPackaged ? app.getVersion() : require('../../../package.json').version;
  const service = new AppInfoService(version,url => shell.openExternal(url),value => clipboard.writeText(value));
  ipcMain.handle('app:info',() => service.getInfo());
  ipcMain.handle('app:open-link',(_event,name) => service.openLink(name));
  ipcMain.handle('app:copy-contact',(_event,name) => service.copyContact(name));
}
module.exports = {registerAppHandlers};
