const path = require('node:path');

/** Locate worker commands and media binaries outside Electron's ASAR archive. */
function engineCommand({packaged = false, resourcesPath = process.resourcesPath,
  platform = process.platform, python = process.env.PYTHON} = {}) {
  if (packaged) return {executable:path.join(resourcesPath, 'backend',
    platform === 'win32' ? 'frameline-engine.exe' : 'frameline-engine'), args:[]};
  return {executable:python || (platform === 'win32' ? 'python' : 'python3'),
    args:[path.join(__dirname, '..', '..', 'backend', 'engine.py')]};
}

/** Packaged workers cannot execute FFmpeg from a virtual ASAR path. */
function mediaPaths({packaged = false, resourcesPath = process.resourcesPath,
  platform = process.platform} = {}) {
  if (!packaged) return {ffmpegPath:require('ffmpeg-static'), ffprobePath:require('ffprobe-static').path};
  const suffix = platform === 'win32' ? '.exe' : '';
  return {ffmpegPath:path.join(resourcesPath, 'media', `ffmpeg${suffix}`),
    ffprobePath:path.join(resourcesPath, 'media', `ffprobe${suffix}`)};
}

module.exports = {engineCommand, mediaPaths};
