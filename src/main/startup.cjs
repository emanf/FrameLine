const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// These directories contain only Chromium-generated caches. Browser storage,
// settings, projects and imported/processed images must never be moved.
const CACHE_DIRECTORIES = ['Cache', 'Code Cache', 'GPUCache', 'GPUPersistentCache',
  'DawnGraphiteCache', 'DawnWebGPUCache', 'GrShaderCache', 'ShaderCache'];

function focusWindow(window) {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function acquireSingleInstance(app, BrowserWindow) {
  if (!app.requestSingleInstanceLock()) return false;
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows().find(window => !window.isDestroyed());
    if (window) focusWindow(window);
    else app.once('browser-window-created', (_event, created) => {
      created.once('ready-to-show', () => focusWindow(created));
    });
  });
  return true;
}

function prepareChromiumCaches(app, {fileSystem = fs, warn = console.warn} = {}) {
  const root = path.resolve(app.getPath('userData'));
  const marker = path.join(root, 'chromium-cache-version.json');
  const version = `${process.versions.electron ?? 'test'}:${path.resolve(process.execPath)}`;
  try {
    if (JSON.parse(fileSystem.readFileSync(marker, 'utf8')).version === version) return;
  } catch {}
  fileSystem.mkdirSync(root, {recursive:true});
  const backup = path.join(root, `cache-backup-${crypto.randomUUID()}`);
  let failed = false;
  let moved = false;
  for (const name of CACHE_DIRECTORIES) {
    const source = path.resolve(root, name);
    const target = path.resolve(backup, name);
    // Both resolved paths stay inside the profile; do not follow cache links.
    if (path.dirname(source) !== root || path.dirname(target) !== backup || path.dirname(backup) !== root) {
      throw new Error('Unsafe cache recovery path.');
    }
    try {
      const entry = fileSystem.lstatSync(source);
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        throw new Error('Cache path is not a regular directory.');
      }
      fileSystem.mkdirSync(backup, {recursive:true});
      fileSystem.renameSync(source, target);
      moved = true;
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      failed = true;
      warn(`FrameLine could not refresh ${name}: ${error.message}`);
    }
  }
  if (failed) {
    // A locked/denied old cache must not block the editor. Hardware rendering
    // remains enabled; only on-disk GPU shader caching is bypassed.
    const fallback = path.join(root, 'chromium-cache-fallback');
    fileSystem.mkdirSync(fallback, {recursive:true});
    app.commandLine.appendSwitch('disk-cache-dir', fallback);
    app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
  } else {
    fileSystem.writeFileSync(marker, JSON.stringify({version, ...(moved ? {backup} : {})}), 'utf8');
  }
}

module.exports = {acquireSingleInstance, prepareChromiumCaches};
