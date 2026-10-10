const {app} = require('electron');
const path = require('node:path');

/** Use real resource files for native window icons, including packaged ASAR builds. */
function applicationIconPath() {
  const root = app.isPackaged ? path.join(process.resourcesPath, 'icons') : path.join(__dirname, '..', 'assets', 'icons');
  return path.join(root, process.platform === 'win32' ? 'frameline.ico' : 'frameline-512.png');
}

module.exports = {applicationIconPath};
