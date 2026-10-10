/** Verify release resources using the packaged Electron runtime, including native modules. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {createRequire} = require('node:module');
const {execFileSync} = require('node:child_process');

async function verify() {
  const [resources, directory, processor, architecture] = process.argv.slice(2);
  assert.equal(process.arch, architecture);
  process.resourcesPath = resources;
  const releaseRequire = createRequire(path.join(resources, 'app.asar', 'package.json'));
  const sharp = releaseRequire('sharp');
  const fixture = path.join(directory, 'packaged-fixture.png');
  await sharp({create:{width:8, height:8, channels:4, background:{r:20,g:30,b:40,alpha:200/255}}}).png().toFile(fixture);
  const avif = await sharp(fixture).avif().toBuffer();
  assert.equal((await sharp(avif).metadata()).format, 'heif');
  assert.equal((await sharp(Buffer.from('<svg width="8" height="8"><rect width="8" height="8" fill="red"/></svg>')).png().toBuffer()).length > 0, true);
  assert.ok((await fs.stat(path.join(resources, 'app.asar', 'node_modules/@fontsource/material-symbols-rounded/400.css'))).size > 0);
  const icon = await sharp(path.join(resources, 'icons', 'frameline-512.png')).metadata();
  assert.equal(icon.width, 512);
  assert.equal(icon.hasAlpha, true);
  assert.ok((await fs.stat(path.join(resources, 'icons', 'frameline.ico'))).size > 0);
  assert.ok((await fs.stat(path.join(resources, 'icons', 'frameline.icns'))).size > 0);
  if (process.platform === 'win32') {
    const ico = await fs.readFile(path.join(resources, 'icons', 'frameline.ico'));
    const entry = 6 + 16 * (ico.readUInt16LE(4) - 1);
    const length = ico.readUInt32LE(entry + 8);
    const offset = ico.readUInt32LE(entry + 12);
    const executable = await fs.readFile(path.join(resources, '..', 'FrameLine.exe'));
    assert.notEqual(executable.indexOf(ico.subarray(offset, offset + length)), -1, 'FrameLine.exe embeds the approved icon');
  }
  const {mediaPaths} = releaseRequire('./src/main/runtime-paths.cjs');
  const media = mediaPaths({packaged:true});
  for (const binary of Object.values(media)) execFileSync(binary, ['-version'], {windowsHide:true, stdio:'pipe'});
  const {PythonBridge} = releaseRequire('./src/main/python-bridge.cjs');
  const bridge = new PythonBridge({...media, packaged:true});
  const timeout = setTimeout(() => {bridge.close(); console.error('Packaged engine timed out'); process.exit(1);}, 60000);
  try {
    const images = await bridge.request('inspect_images', {paths:[fixture]});
    assert.ok(images);
    const output = path.join(directory, 'packaged-plugin.png');
    await bridge.request('process_tool_plugin', {path:fixture, processor, options:{strength:100}, output});
    const {data} = await sharp(output).raw().toBuffer({resolveWithObject:true});
    assert.deepEqual([...data.slice(0, 4)], [235,225,215,200]);
    const gif = path.join(directory, 'packaged.gif');
    await bridge.runTask('build-check', 'export_gif', {fps:24, output:gif, clips:[{path:fixture, duration_frames:2}]}, () => {});
    assert.equal((await sharp(gif).metadata()).format, 'gif');
    console.log('Packaged runtime OK: native images, media, Python IPC, plugins and GIF worker');
  } finally {
    clearTimeout(timeout);
    bridge.close();
  }
}
verify().catch(error => {console.error(error); process.exitCode = 1;});
