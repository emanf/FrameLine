const {app, BrowserWindow} = require('electron');
const {acquireSingleInstance, prepareChromiumCaches} = require('./main/startup.cjs');
const {DesktopApplication} = require('./main/desktop-application.cjs');

// Acquire ownership before touching caches or starting background workers.
if (!acquireSingleInstance(app, BrowserWindow)) app.quit();
else {
  if (process.platform === 'win32') app.setAppUserModelId('com.emanf.frameline');
  prepareChromiumCaches(app);
  const application = new DesktopApplication();
  app.whenReady().then(() => application.start()).catch(error => {console.error('FrameLine startup failed:', error); app.quit();});
}
app.on('window-all-closed', () => {if (process.platform !== 'darwin') app.quit();});
