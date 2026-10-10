import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const {engineCommand, mediaPaths} = require('../src/main/runtime-paths.cjs');

test('packaged workers use real resources without a Python script or interpreter dependency', () => {
  const command = engineCommand({packaged:true, resourcesPath:'/release/resources', platform:'win32', python:'custom-python'});
  assert.equal(command.executable, path.join('/release/resources', 'backend', 'frameline-engine.exe'));
  assert.deepEqual(command.args, []);
  assert.ok(engineCommand({packaged:true, resourcesPath:'/r', platform:'linux'}).executable.endsWith('frameline-engine'));
});

test('source workers retain the configured Python command', () => {
  const command = engineCommand({packaged:false, python:'custom-python'});
  assert.equal(command.executable, 'custom-python');
  assert.ok(command.args[0].endsWith(path.join('backend', 'engine.py')));
});

test('packaged video binaries resolve outside ASAR for each platform', () => {
  for (const platform of ['win32', 'linux', 'darwin']) {
    const paths = mediaPaths({packaged:true, resourcesPath:'/r', platform});
    const suffix = platform === 'win32' ? '.exe' : '';
    assert.equal(paths.ffmpegPath, path.join('/r', 'media', `ffmpeg${suffix}`));
    assert.equal(paths.ffprobePath, path.join('/r', 'media', `ffprobe${suffix}`));
  }
});
