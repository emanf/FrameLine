const { app, BrowserWindow, ipcMain, nativeImage } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL, fileURLToPath } = require("node:url");
const { PythonBridge } = require('../src/main/python-bridge.cjs');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "frameline-ui-test-"));
app.setPath("userData", temporary);
const root = path.resolve(__dirname, "..");
function bitmap(name, rgb, width = 32, height = 32) {
  const stride = Math.ceil(width * 3 / 4) * 4;
  const data = Buffer.alloc(54 + stride * height);
  data.write("BM"); data.writeUInt32LE(data.length, 2); data.writeUInt32LE(54, 10);
  data.writeUInt32LE(40, 14); data.writeInt32LE(width, 18); data.writeInt32LE(height, 22);
  data.writeUInt16LE(1, 26); data.writeUInt16LE(24, 28);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = 54 + y * stride + x * 3;
    data[offset] = rgb[2]; data[offset + 1] = rgb[1]; data[offset + 2] = rgb[0];
  }
  const file = path.join(temporary, name);
  fs.writeFileSync(file, data);
  return file;
}
const red = bitmap("red.bmp", [255, 0, 0]);
const blue = bitmap("blue.bmp", [0, 0, 255]);
const outlined = bitmap("outlined.bmp", [0, 255, 0]);
const wide = bitmap("wide.bmp", [255, 255, 0], 64, 16);
const tall = bitmap("tall.bmp", [0, 255, 255], 16, 64);
const healingImage = bitmap("healing-mixture.bmp", [3, 170, 3]);
function healingBackground(name, background, mixture) {
  const file = bitmap(name, background);
  const data = fs.readFileSync(file);
  for (let y = 8; y < 24; y++) for (let x = 8; x < 24; x++) {
    const offset = 54 + y * 96 + x * 3;
    data[offset] = mixture[2]; data[offset + 1] = mixture[1]; data[offset + 2] = mixture[0];
  }
  fs.writeFileSync(file, data);
  return file;
}
const autoHealingGreen = healingBackground("healing-green.bmp", [4,244,4], [3,170,3]);
const autoHealingBlue = healingBackground("healing-blue.bmp", [40,70,240], [24,42,144]);
const autoHealingPurple = healingBackground("healing-purple.bmp", [120,60,180], [180,110,240]);
const autoHealingEmpty = bitmap("healing-no-background.bmp", [0,0,0]);
const autoKeepHair = bitmap("hair-cleanup.bmp", [0,240,0]);
{
  const data=fs.readFileSync(autoKeepHair);
  for(let y=0;y<32;y++) for(let x=0;x<24;x++) {
    const foreground=y<11?[0,0,0]:y<22?[120,30,10]:[240,200,80];
    const color=x<8?foreground:foreground.map((value,c)=>(value+[0,240,0][c])/2);
    const offset=54+(31-y)*96+x*3;
    data[offset]=color[2];data[offset+1]=color[1];data[offset+2]=color[0];
  }
  fs.writeFileSync(autoKeepHair,data);
}
const missing = path.join(temporary, "missing.bmp");
let media = [missing];
let outlineResponse;
let realOutlineProcessing = false;
const realOutlineRequests = [];
let outlinePreviewSequence = 0;
let holdOutlinePreview = false;
let releaseOutlinePreview;
let heldOutlineRequest;
const outlinePreviewOutputs = new Set();
const discardedOutlinePreviews = [];
let saves = 0;
let closes = 0;
let opens = 0;
let savedProject;
let validProjectOpen = false;
let backgroundPreviewRequest;
let holdBackgroundPreview = false;
let releaseBackgroundPreview;
let failBackgroundPreview = false;
let backgroundApplyRequest;
let realBackgroundProcessing = false;
let backgroundSequence = 0;
const backgroundApplyRequests = [];
let workingImages = [];
const exportRequests = [];
let window;
let refinePython;
let refineSequence = 0;
let holdRefine = false;
let releaseRefine;
let lastRefineRequest;
const refineOutputs = new Set();
const discardedRefineOutputs = [];
const errors = [];
ipcMain.handle("window:is-maximized", () => false);
ipcMain.handle("window:enable-close-guard", () => true);
ipcMain.handle("images:cancel-preview", () => true);
ipcMain.handle('tools:list', () => ({plugins:[],errors:[]}));
ipcMain.handle("media:choose", () => media);
ipcMain.handle("images:inspect", (_event, paths) => paths.map(file => {
  const bytes = fs.existsSync(file) && fs.readFileSync(file);
  const png = bytes && bytes.subarray(1, 4).toString() === 'PNG';
  return { path: file, name: path.basename(file), width: bytes ? png ? bytes.readUInt32BE(16) : bytes.readInt32LE(18) : 32, height: bytes ? png ? bytes.readUInt32BE(20) : bytes.readInt32LE(22) : 32 };
}));
ipcMain.handle("images:apply-outline", async (_event, request) => {
  if (!realOutlineProcessing) return new Promise(resolve => { outlineResponse = resolve; });
  realOutlineRequests.push(request);
  refinePython ??= new PythonBridge();
  return refinePython.request('apply_outline', {...request, output:path.join(temporary,`outline-regression-${realOutlineRequests.length}.png`)});
});
ipcMain.handle("project:save", (_event, project) => { saves++; savedProject = project; return null; });
ipcMain.handle('images:preview-outline', async (_event, request) => {
  if (holdOutlinePreview) {
    holdOutlinePreview = false;
    heldOutlineRequest = request;
    await new Promise(resolve => {releaseOutlinePreview=resolve;});
  }
  refinePython ??= new PythonBridge();
  const output = path.join(temporary, `outline-preview-${outlinePreviewSequence++}.png`);
  const result = await refinePython.request('apply_outline', {...request, output});
  outlinePreviewOutputs.add(output);
  return result;
});
ipcMain.handle("project:open", () => {
  opens++;
  const project = structuredClone(savedProject);
  if (!validProjectOpen) project.images[0].paintStrokes = "invalid";
  return { path: path.join(temporary, "invalid.frameline"), project };
});
ipcMain.handle("window:confirm-close", () => { closes++; });
ipcMain.handle("images:discard-outputs", (_event, files) => {
  for (const file of files) if (refineOutputs.has(file)) {
    fs.rmSync(file, {force: true});
    discardedRefineOutputs.push(file);
  }
  for (const file of files) if (outlinePreviewOutputs.has(file)) {
    fs.rmSync(file, {force:true});
    discardedOutlinePreviews.push(file);
  }
  return true;
});
const processRefine = async (event, request) => {
  lastRefineRequest = request;
  refinePython ??= new PythonBridge();
  if (holdRefine) {
    holdRefine = false;
    await new Promise(resolve => { releaseRefine = resolve; });
  }
  const output = path.join(temporary, `refined-${refineSequence++}.png`);
  const result = await refinePython.request('refine_edges', {...request, output}, progress => {
    event.sender.send('images:progress', {...progress,operationId:request.operationId});
  });
  refineOutputs.add(output);
  return result;
};
ipcMain.handle('images:refine-edges', processRefine);
ipcMain.handle('images:preview-refine', processRefine);
let cleanSequence=0;
let holdClean=false;
let releaseClean;
let lastCleanRequest;
const cleanOutputs=new Set();
const processClean=async(event,request)=>{
  lastCleanRequest=request;
  if(holdClean){holdClean=false;await new Promise(resolve=>{releaseClean=resolve;});}
  refinePython ??= new PythonBridge();
  const output=path.join(temporary,`clean-pixels-${cleanSequence++}.png`);
  const result=await refinePython.request('clean_pixels',{...request,output},progress=>event.sender.send('images:progress',{...progress,operationId:request.operationId}));
  refineOutputs.add(output);cleanOutputs.add(output);
  return result;
};
ipcMain.handle('images:clean-pixels',processClean);
ipcMain.handle('images:preview-clean-pixels',processClean);
ipcMain.handle("export:choose", (_event, format) => path.join(temporary, `export.${format}`));
ipcMain.handle("export:choose-directory", () => temporary);
ipcMain.handle("export:choose-sheet", () => path.join(temporary, "sheet.png"));
ipcMain.handle("export:start", (event, { taskId, command, request }) => {
  exportRequests.push({ command, request });
  setTimeout(() => event.sender.send("export:complete", { taskId, result: { files: request.clips?.reduce((sum, clip) => sum + clip.duration_frames, 0) ?? request.images?.length, images: request.clips?.length } }), 20);
  return { taskId };
});
ipcMain.handle("images:preview-background", async (_event, request) => {
  backgroundPreviewRequest = request;
  if (holdBackgroundPreview) {
    holdBackgroundPreview = false;
    await new Promise(resolve => { releaseBackgroundPreview = resolve; });
  }
  if (failBackgroundPreview) {
    failBackgroundPreview = false;
    throw new Error('Background preview test failure');
  }
  if (realBackgroundProcessing) {
    refinePython ??= new PythonBridge();
    const output = path.join(temporary,`background-preview-${backgroundSequence++}.png`);
    return refinePython.request('remove_background',{...request,output});
  }
  return workingImages.find(image => image.path === request.path) ?? { path: request.path, width: 32, height: 32 };
});
ipcMain.handle("images:remove-background", async (_event, request) => {
  backgroundApplyRequest = request;
  backgroundApplyRequests.push(request);
  if (realBackgroundProcessing) {
    refinePython ??= new PythonBridge();
    const output = path.join(temporary,`background-applied-${backgroundSequence++}.png`);
    return refinePython.request('remove_background',{...request,output});
  }
  return workingImages.find(image => image.path === request.path) ?? { path: request.path, width: 32, height: 32 };
});
ipcMain.handle('images:sample-color', async (_event, request) => {
  refinePython ??= new PythonBridge();
  return refinePython.request('sample_image_color',request);
});
ipcMain.handle("images:clear-background-preview", () => true);
ipcMain.handle("images:store-working", (_event, png) => {
  const bytes = typeof png === 'string' ? Buffer.from(png.split(",")[1], "base64") : Buffer.from(png);
  const file = path.join(temporary, `working-${workingImages.length}.png`);
  fs.writeFileSync(file, bytes);
  const result = { path: file, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  workingImages.push(result);
  return result;
});

async function evaluate(code) { return window.webContents.executeJavaScript(code); }
async function until(predicate, description) {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out: ${description}`);
}
async function enableTool() {
  if (await evaluate(`!document.querySelector('#preview-feature-enable').hidden && !document.querySelector('#preview-tool-enabled').checked && !document.querySelector('#preview-tool-enabled').disabled`)) {
    await evaluate(`document.querySelector('#preview-tool-enabled').click()`);
  }
}
async function click(selector) {
  if (['#preview-outline-apply', '#preview-crop-apply', '#preview-padding-apply'].includes(selector)) await enableTool();
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  if (['#save-project','#open-project'].includes(selector)) {
    await paintFrame();
    await until(() => evaluate(`!document.querySelector('#operation-progress-dialog').open || document.querySelector('#message-dialog').open`),'project operation or pending-edit prompt');
  }
}
async function importMedia() {
  await click('#import-images');
  await answerMessage('import');
}
async function mouseClick(selector, modifiers = []) {
  const position = await evaluate(`(() => {
    const bounds = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return {x:Math.round(bounds.left + bounds.width / 2), y:Math.round(bounds.top + bounds.height / 2)};
  })()`);
  window.webContents.sendInputEvent({type:"mouseDown", ...position, button:"left", clickCount:1, modifiers});
  window.webContents.sendInputEvent({type:"mouseUp", ...position, button:"left", clickCount:1, modifiers});
  await paintFrame();
}
async function pressKey(keyCode, modifiers = []) {
  window.webContents.sendInputEvent({type:"keyDown", keyCode, modifiers});
  window.webContents.sendInputEvent({type:"keyUp", keyCode, modifiers});
  await paintFrame();
}
async function answerMessage(action, scope = null) {
  await until(() => evaluate(`document.querySelector('#message-dialog').open`), "themed message dialog");
  if (scope) await evaluate(`document.querySelector('#message-scope').value = ${JSON.stringify(scope)}`);
  await click(`#message-actions button[data-action="${action}"]`);
  await until(() => evaluate(`!document.querySelector('#message-dialog').open`), "dismiss themed message dialog");
  await paintFrame();
}
async function paintFrame() {
  await evaluate(`new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Preview animation frame timed out')), 3000);
    requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timeout); resolve(); }));
  })`);
}

async function settingsKeepDraft(readPreview, label) {
  const pixels = await evaluate(readPreview);
  const edits = await evaluate(`(() => {
    const edits = [];
    for (const id of ['fps-select', 'speed-select']) {
      const field = document.getElementById(id);
      const next = [...field.options].find(option => option.value !== field.value && option.value !== 'add');
      edits.push({id, before:field.value, after:next.value});
    }
    for (const id of ['default-duration', 'clip-frames']) {
      const field = document.getElementById(id);
      if (!field.disabled && (id !== 'clip-frames' || !document.querySelector('#clip-properties').hidden)) {
        edits.push({id, before:field.value, after:String(Number(field.value) + 1)});
      }
    }
    const title = document.querySelector('#project-name');
    edits.push({id:'project-name', before:title.value, after:title.value + ' draft'});
    return edits;
  })()`);
  for (const edit of edits) {
    for (const value of [edit.after, edit.before]) {
      await evaluate(`(() => {const f=document.getElementById(${JSON.stringify(edit.id)});
        f.value=${JSON.stringify(value)};f.dispatchEvent(new Event('change', {bubbles:true}));})()`);
      await paintFrame();
      assert.equal(await evaluate(readPreview), pixels, `${label} survives ${edit.id} changes`);
      assert.equal(await evaluate(`document.querySelector('#message-dialog').open`), false, 'unrelated settings need no tool confirmation');
    }
  }
  for (let i = 0; i < 2; i++) {
    await click('#loop-toggle');
    assert.equal(await evaluate(readPreview), pixels, `${label} survives loop changes`);
  }
}

app.whenReady().then(async () => {
  try {
    window = new BrowserWindow({ show: false, width: 1440, height: 900, webPreferences: {
      preload: path.join(root, "src/preload.cjs"), contextIsolation: true, nodeIntegration: false,
      backgroundThrottling: false, offscreen: true
    } });
    window.webContents.on("console-message", (...args) => {
      const details = typeof args[1] === "object" ? args[1] : { level: args[1], message: args[2] };
      if (details.level === "error" || details.level === 3) {
        if (!/source image could not be loaded|ERR_FILE_NOT_FOUND|invalid paint strokes/.test(details.message)) errors.push(details.message);
      }
    });
    await window.loadFile(path.join(root, "src/renderer/index.html"));
    await until(() => evaluate(`document.querySelector('#stats-fps').textContent === '24'`), "renderer startup");
    assert.equal(await evaluate(`document.querySelector('#preview-tool-hand').classList.contains('selected') && document.querySelector('#preview-feature-enable').hidden`), true, 'startup uses Hand without Enable');
    assert.equal(await evaluate(`document.querySelector('#preview-brush-antialias').checked`), true, 'anti-aliasing defaults on independently of feather');
    assert.deepEqual(await evaluate(`Array.from(document.querySelector('.preview-toolbox').children).map(node =>
      node.getAttribute('role') === 'separator' ? 'separator' : node.getAttribute('aria-label'))`),
      ['Clear image effects for this image or all images', 'separator', 'Magic tools', 'separator', 'Enable features', 'separator', 'Basic tools']);
    const gridButton = await evaluate(`(() => { const b = document.querySelector('#preview-grid-toggle').getBoundingClientRect(); return {x:Math.round(b.left+b.width/2), y:Math.round(b.top+b.height/2)}; })()`);
    window.webContents.sendInputEvent({type:'mouseMove', ...gridButton});
    await paintFrame();
    assert.equal(await evaluate(`document.querySelector('#preview-grid-popover').hidden`), true, 'hover does not open Grid');
    await evaluate(`document.querySelector('#preview-grid-toggle').focus()`);
    assert.equal(await evaluate(`document.querySelector('#preview-grid-popover').hidden`), true, 'focus alone does not open Grid');
    await mouseClick('#preview-grid-toggle');
    assert.equal(await evaluate(`!document.querySelector('#preview-grid-popover').hidden && document.querySelector('#preview-grid-toggle').getAttribute('aria-expanded') === 'true'`), true, 'click opens Grid');
    window.webContents.sendInputEvent({type:'mouseMove', x:30, y:130});
    await paintFrame();
    assert.equal(await evaluate(`document.querySelector('#preview-grid-popover').hidden`), false, 'moving away keeps Grid open');
    await mouseClick('#preview-grid-visible');
    assert.equal(await evaluate(`document.querySelector('#preview-grid-popover').hidden`), false, 'using Grid settings keeps it open');
    await mouseClick('#preview-grid-visible');
    await mouseClick('#preview-grid-toggle');
    assert.equal(await evaluate(`document.querySelector('#preview-grid-popover').hidden`), true, 'second click closes Grid');
    await mouseClick('#preview-grid-toggle');
    window.webContents.sendInputEvent({type:'keyDown', keyCode:'Escape'});
    window.webContents.sendInputEvent({type:'keyUp', keyCode:'Escape'});
    await paintFrame();
    assert.equal(await evaluate(`document.querySelector('#preview-grid-popover').hidden && document.activeElement.id === 'preview-grid-toggle'`), true, 'Escape closes Grid and returns focus');
    await mouseClick('#preview-grid-toggle');
    await mouseClick('#preview-background-toggle');
    assert.equal(await evaluate(`document.querySelector('#preview-grid-popover').hidden && !document.querySelector('#preview-background-popover').hidden`), true, 'opening Background closes Grid');
    await mouseClick('#preview-grid-toggle');
    assert.equal(await evaluate(`!document.querySelector('#preview-grid-popover').hidden && document.querySelector('#preview-background-popover').hidden`), true, 'opening Grid closes Background');
    await mouseClick('#project-name');
    assert.equal(await evaluate(`document.querySelector('#preview-grid-popover').hidden`), true, 'clicking outside closes Grid');
    await evaluate(`document.querySelector('#project-name').blur()`);
    assert.equal(await evaluate(`document.querySelectorAll('[title]').length`), 0, 'native title tooltips are replaced throughout the interface');
    const hover = async selector => {
      const position = await evaluate(`(() => { const b = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:Math.round(b.left+b.width/2), y:Math.round(b.top+b.height/2)}; })()`);
      window.webContents.sendInputEvent({type:'mouseMove', ...position});
      await paintFrame();
    };
    const tooltipIs = text => evaluate(`!document.querySelector('#app-tooltip').hidden && document.querySelector('#app-tooltip').textContent === ${JSON.stringify(text)}`);
    await hover('#preview-tool-hand .material-icon');
    await until(() => tooltipIs('Hand tool'), 'themed tooltip shows when hovering a tool icon');
    assert.deepEqual(await evaluate(`(() => {
      const tip = document.querySelector('#app-tooltip'); const style = getComputedStyle(tip);
      return [tip.getAttribute('role'), tip.matches(':popover-open'), style.backgroundColor, style.color, style.fontSize, style.borderRadius];
    })()`), ['tooltip', true, 'rgb(27, 27, 27)', 'rgb(238, 238, 238)', '12px', '5px'], 'tooltip uses app theme, readable typography, and the top layer');
    assert.equal(await evaluate(`document.querySelector('#preview-tool-hand').getAttribute('aria-describedby').includes('app-tooltip')`), true, 'visible tooltip describes its control');
    const tooltipBounds = await evaluate(`(() => {const b=document.querySelector('#app-tooltip').getBoundingClientRect(); return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)};})()`);
    window.webContents.sendInputEvent({type:'mouseMove', ...tooltipBounds});
    await paintFrame();
    assert.equal(await tooltipIs('Hand tool'), true, 'tooltip stays visible while the pointer reads it');
    await hover('#window-close');
    await until(() => tooltipIs('Close'), 'tooltip follows a different control');
    assert.equal(await evaluate(`(() => { const b=document.querySelector('#app-tooltip').getBoundingClientRect(); return b.left>=8 && b.right<=innerWidth-8 && b.top>=8 && b.bottom<=innerHeight-8;})()`), true, 'tooltip stays inside the window near an edge');
    window.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});
    window.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
    assert.equal(await evaluate(`document.querySelector('#app-tooltip').hidden && !document.querySelector('#window-close').hasAttribute('aria-describedby')`), true, 'Escape dismisses the tooltip and cleans its description');
    window.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab'});
    window.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab'});
    await paintFrame();
    // The offscreen host updates activeElement without native focus events.
    await evaluate(`document.querySelector('#preview-tool-hand').focus(); document.querySelector('#preview-tool-hand').dispatchEvent(new FocusEvent('focusin', {bubbles:true}));`);
    await until(() => tooltipIs('Hand tool'), 'keyboard focus shows the same themed tooltip');
    await evaluate(`document.querySelector('#preview-tool-hand').dataset.tooltip = 'Updated <b>tool</b> help';`);
    await until(() => tooltipIs('Updated <b>tool</b> help'), 'dynamic tooltip changes update the visible text');
    assert.equal(await evaluate(`document.querySelector('#app-tooltip').childElementCount`), 0, 'tooltip text is rendered safely without HTML');
    await evaluate(`document.querySelector('#preview-tool-hand').dataset.tooltip = 'Hand tool'; document.querySelector('#preview-tool-hand').blur(); document.querySelector('#preview-tool-hand').dispatchEvent(new FocusEvent('focusout', {bubbles:true}));`);
    window.webContents.sendInputEvent({type:'mouseMove',x:30,y:130});
    await until(() => evaluate(`document.querySelector('#app-tooltip').hidden`), 'leaving a tooltip control hides the popup');
    const titleBarFits = () => evaluate(`(() => {
      const ids = ['new-project', 'open-project', 'project-name', 'save-project', 'undo', 'redo'];
      const bounds = ids.map(id => document.querySelector('#' + id).getBoundingClientRect());
      return bounds.every((box, index) => box.width > 0 && (!index || bounds[index - 1].right <= box.left))
        && bounds[0].left < 200 && bounds.at(-1).right < document.querySelector('.window-controls').getBoundingClientRect().left
        && document.querySelectorAll('.topbar .toolbar-divider').length === 2;
    })()`);
    assert.equal(await titleBarFits(), true, "title bar follows New, Open, editable title, Save, separator, Undo, Redo on the left");
    window.setSize(800, 900);
    await paintFrame();
    assert.equal(await titleBarFits(), true, "title-bar controls remain visible at the minimum window width");
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.project-stats')).fontSize`), "12px", "project data stays readable even at minimum width");
    assert.equal(await evaluate(`(() => {
      const stats = document.querySelector('.project-stats').getBoundingClientRect();
      const controls = document.querySelector('.export-controls').getBoundingClientRect();
      const footer = document.querySelector('.timeline-footer').getBoundingClientRect();
      return stats.right <= controls.left && controls.right <= footer.right;
    })()`), true, "larger export controls fit alongside the stats at minimum window width");
    window.setSize(1440, 900);
    await paintFrame();
    await evaluate(`document.querySelector('#project-name').focus(); document.querySelector('#project-name').value = '  Walk cycle  ';`);
    window.webContents.sendInputEvent({type:"keyDown", keyCode:"Return"});
    window.webContents.sendInputEvent({type:"keyUp", keyCode:"Return"});
    await until(() => evaluate(`document.querySelector('#project-name').value === 'Walk cycle'`), "Enter applies a project rename");
    await click("#undo");
    assert.equal(await evaluate(`document.querySelector('#project-name').value`), "Untitled project");
    await click("#redo");
    assert.equal(await evaluate(`document.querySelector('#project-name').value`), "Walk cycle");
    await evaluate(`document.querySelector('#project-name').focus(); document.querySelector('#project-name').value = 'Cancelled rename';`);
    window.webContents.sendInputEvent({type:"keyDown", keyCode:"Escape"});
    window.webContents.sendInputEvent({type:"keyUp", keyCode:"Escape"});
    await paintFrame();
    assert.equal(await evaluate(`document.querySelector('#project-name').value`), "Walk cycle", "Escape cancels a title edit");
    assert.equal(await evaluate(`CSS.supports('appearance', 'base-select')`), true, "Electron supports themed native select popups");
    assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('select')).filter(select => {
      const picker = getComputedStyle(select, '::picker(select)');
      const option = select.querySelector('option:checked');
      return !(getComputedStyle(select).appearance === 'base-select'
        && picker.backgroundColor === 'rgb(18, 18, 18)'
        && (!option || getComputedStyle(option).backgroundColor === (select.disabled ? 'rgb(18, 18, 18)' : 'rgb(238, 238, 238)')));
    }).map(select => ({id:select.id, disabled:select.disabled, picker:getComputedStyle(select, '::picker(select)').backgroundColor,
      option:getComputedStyle(select.querySelector('option:checked')).backgroundColor}))`), [], "every dropdown has a dark popup and themed selected item");
    await mouseClick("#fps-select");
    await until(() => evaluate(`document.querySelector('#fps-select').matches(':open')`), "open themed frame-rate dropdown");
    if (process.env.FRAMELINE_DROPDOWN_SCREENSHOT) {
      fs.writeFileSync(process.env.FRAMELINE_DROPDOWN_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
    }
    await mouseClick('#fps-select option[value="30"]');
    await until(() => evaluate(`document.querySelector('#stats-fps').textContent === '30' && !document.querySelector('#fps-select').matches(':open')`), "mouse selection changes frame rate and dismisses the popup");
    await mouseClick("#fps-select");
    await mouseClick('#fps-select option[value="24"]');
    await until(() => evaluate(`document.querySelector('#stats-fps').textContent === '24'`), "restore frame rate");
    await mouseClick("#export-format");
    assert.equal(await evaluate(`(() => {
      const select = document.querySelector('#export-format');
      return getComputedStyle(select).fontSize === '12px'
        && getComputedStyle(select, '::picker(select)').fontSize === '12px'
        && Array.from(select.options).every(option => getComputedStyle(option).fontSize === '12px')
        && getComputedStyle(document.querySelector('#export-gif')).fontSize === '12px';
    })()`), true, "export button, closed control, and popup options use readable matching text");
    window.webContents.sendInputEvent({type:"keyDown", keyCode:"Down"});
    window.webContents.sendInputEvent({type:"keyUp", keyCode:"Down"});
    window.webContents.sendInputEvent({type:"keyDown", keyCode:"Return"});
    window.webContents.sendInputEvent({type:"keyUp", keyCode:"Return"});
    await until(() => evaluate(`document.querySelector('#export-format').value === 'mp4' && !document.querySelector('#export-format').matches(':open')`), "keyboard selection works in themed dropdown");
    await evaluate(`document.querySelector('#export-format').value = 'gif'; document.querySelector('#export-format').dispatchEvent(new Event('change'));`);
    await importMedia();
    await until(() => evaluate(`document.querySelector('#preview-image').hidden`), "missing image error");
    media = [red, blue];
    await importMedia();
    await until(() => evaluate(`document.querySelector('#preview-image').src === ${JSON.stringify(pathToFileURL(red).href)} && !document.querySelector('#preview-image').hidden && document.querySelector('#preview-image').naturalWidth === 32`), "valid preview recovery");
    assert.equal(await evaluate(`document.querySelector('#frame-count').textContent`), "25 / 72");
    assert.equal(await evaluate(`Array.from(document.querySelectorAll('.image-name')).every(node => node.dataset.tooltip === node.textContent && !node.hasAttribute('title'))`), true, 'new image-list rows use themed filename tooltips');
    await hover('.image-name');
    await until(() => tooltipIs('missing.bmp'), 'dynamically rendered filename tooltip appears');
    await evaluate(`document.querySelector('.image-name').closest('.image-row').remove()`);
    await until(() => evaluate(`document.querySelector('#app-tooltip').hidden`), 'removing a tooltip owner closes the popup');
    // The next model edit redraws the virtual image list from its source data.
    if (process.env.FRAMELINE_TOOLTIP_SCREENSHOT) {
      await hover('#preview-tool-hand');
      await until(() => tooltipIs('Hand tool'), 'tooltip screenshot');
      fs.writeFileSync(process.env.FRAMELINE_TOOLTIP_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
    }

    await click("#preview-tool-outline");
    assert.equal(await evaluate(`!document.querySelector('#preview-feature-enable').hidden && !document.querySelector('#preview-tool-enabled').checked && document.querySelector('#preview-outline-size').disabled`), true, 'Outline waits for Enable');
    await enableTool();
    assert.equal(await evaluate(`document.querySelector('#preview-image-wrap').classList.contains('live-outline-preview')`), true, 'Enable starts a live outline preview');
    await click('#preview-tool-enabled');
    assert.equal(await evaluate(`!document.querySelector('#preview-tool-enabled').checked && !document.querySelector('#preview-image-wrap').classList.contains('live-outline-preview') && !document.querySelector('#message-dialog').open`), true, 'unchecking discards Outline without a dialog');
    await click("#preview-outline-apply");
    await until(() => Boolean(outlineResponse), "outline request");
    await evaluate(`document.querySelector('#project-name').value = 'Changed while processing'; document.querySelector('#project-name').dispatchEvent(new Event('change'));`);
    outlineResponse({ path: blue, width: 48, height: 48 });
    await until(() => evaluate(`document.querySelector('#preview-outline-apply').textContent === 'Apply outline'`), "obsolete outline completion");
    assert.equal(await evaluate(`document.querySelector('#preview-image').src`), pathToFileURL(red).href);
    assert.equal(await evaluate(`document.querySelector('#preview-image-wrap').classList.contains('live-outline-preview')`), false);
    await click('#undo');
    const requestsBeforeOutlineDraft = outlineResponse;
    await enableTool();
    await evaluate(`document.querySelector('#preview-outline-size').value = '12'; document.querySelector('#preview-outline-size').dispatchEvent(new Event('input'));`);
    assert.equal(outlineResponse, requestsBeforeOutlineDraft, 'outline settings preview without applying or committing');
    assert.equal(await evaluate(`document.querySelector('#preview-image-wrap').classList.contains('live-outline-preview')`), true);
    await click('#preview-tool-crop'); await answerMessage('cancel');
    assert.equal(await evaluate(`document.querySelector('#preview-tool-outline').classList.contains('selected')`), true, 'Cancel keeps the current tool');
    await click('#preview-tool-crop'); await answerMessage('discard');
    assert.equal(await evaluate(`document.querySelector('#preview-image-wrap').classList.contains('live-outline-preview')`), false, 'Discard removes the outline preview');
    assert.equal(await evaluate(`document.querySelector('#preview-outline-size').value`), '8');
    await click('#preview-tool-outline');

    // Seeking does not change the selected clip: preview tools must still edit
    // the image under the playhead, and their enabled state must follow it.
    await evaluate(`
      const ruler = document.querySelector('#ruler');
      const bounds = document.querySelector('#timeline-content').getBoundingClientRect();
      ruler.dispatchEvent(new MouseEvent('click', {bubbles:true, clientX:bounds.left + 48 * 4 + 1}));
    `);
    await until(() => evaluate(`document.querySelector('#preview-image').src === ${JSON.stringify(pathToFileURL(blue).href)}`), "seek to unselected blue image");
    assert.equal(await evaluate(`document.querySelector('#clip-name').textContent`), "red.bmp");
    await evaluate(`(() => {
      const old = JSON.stringify({tolerance:55, softness:35, spill:50, connected_only:true,
        edge_smoothing_enabled:true, fringe_cleanup_enabled:true, edge_tint_enabled:true});
      localStorage.setItem('frameline.background.last', old);
      localStorage.setItem('frameline.background.defaults', old);
    })()`);
    holdBackgroundPreview = true;
    await click("#preview-remove-background");
    await until(() => evaluate(`document.querySelector('#background-dialog').open`), "background dialog");
    await until(async () => Boolean(releaseBackgroundPreview), 'slow background preview started');
    assert.equal(await evaluate(`document.querySelector('#background-filename') === null`), true, 'background subtitle is removed');
    assert.deepEqual(await evaluate(`(() => {
      const d=document;
      return {tolerance:d.querySelector('#background-tolerance').value, blur:d.querySelector('#background-softness').value,
        blurEnabled:d.querySelector('#background-softness-enabled').checked,
        effects:[...d.querySelectorAll('.background-settings input[type="checkbox"]')].map(f=>f.checked),
        spill:d.querySelector('#background-spill').value};
    })()`), {tolerance:'128', blur:'4', blurEnabled:false, effects:[false,false,false,false,false,false,false], spill:'0'},
    'the new preset replaces old stored defaults with tolerance 128 and all optional effects off');
    assert.equal(backgroundPreviewRequest.softness, 0, 'disabled blur does not affect pixels');
    assert.equal(backgroundPreviewRequest.mode, 'auto', 'Auto Background is the new default');
    assert.equal(backgroundPreviewRequest.background_source, 'auto');
    assert.equal(backgroundPreviewRequest.aggressive, false);
    assert.equal(backgroundPreviewRequest.spill, 0);
    assert.equal(await evaluate(`document.querySelector('#background-preview-status').getAttribute('aria-busy')==='true'
      && !document.querySelector('#background-preview-progress').hidden
      && !document.querySelector('#background-preview-progress').hasAttribute('value')
      && document.querySelector('#background-preview-status-text').textContent.includes('not applied')`), true,
    'preview progress is indeterminate while processing and says it is not applied');
    assert.equal(backgroundApplyRequest, undefined, 'live previews never apply an edit');
    if (process.env.FRAMELINE_BACKGROUND_DEFAULTS_SCREENSHOT) {
      await paintFrame();
      fs.writeFileSync(process.env.FRAMELINE_BACKGROUND_DEFAULTS_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
    }
    await evaluate(`document.querySelector('#background-tolerance').value='127';document.querySelector('#background-tolerance').dispatchEvent(new Event('input'));`);
    releaseBackgroundPreview(); releaseBackgroundPreview = null;
    await until(() => evaluate(`document.querySelector('#background-preview-status-text').textContent.startsWith('Preview ready')`), 'latest background preview ready');
    assert.equal(backgroundPreviewRequest.tolerance, 127, 'an old completion cannot mark the newer preview ready');
    assert.equal(await evaluate(`document.querySelector('#background-preview-progress').hidden && document.querySelector('#background-preview-status').getAttribute('aria-busy')==='false'`), true);
    failBackgroundPreview = true;
    await evaluate(`document.querySelector('#background-tolerance').value='128';document.querySelector('#background-tolerance').dispatchEvent(new Event('input'));`);
    await until(() => evaluate(`document.querySelector('#background-preview-status-text').textContent.startsWith('Preview unavailable')`), 'failed preview stops progress');
    assert.equal(await evaluate(`document.querySelector('#background-preview-progress').hidden && !document.querySelector('#background-error').hidden`), true);
    await evaluate(`document.querySelector('#background-tolerance').dispatchEvent(new Event('input'));`);
    await until(() => evaluate(`document.querySelector('#background-preview-status-text').textContent.startsWith('Preview ready') && document.querySelector('#background-error').hidden`), 'preview recovers after an error');
    assert.equal(await evaluate(`document.querySelector('#preview-image').src`), pathToFileURL(blue).href, 'preview processing leaves the main image unchanged');
    await evaluate(`document.querySelector('#background-source').value='custom';document.querySelector('#background-source').dispatchEvent(new Event('change'));
      document.querySelector('#background-key-color').value='#283c50';document.querySelector('#background-key-color').dispatchEvent(new Event('input'));`);
    await until(() => backgroundPreviewRequest.background_source === 'custom', 'custom Auto Background preview');
    assert.deepEqual(backgroundPreviewRequest.key_color, [40,60,80]);
    assert.equal(await evaluate(`document.querySelector('#background-key-color-field').hidden`), false);
    await click('#background-aggressive');
    await evaluate(`document.querySelector('#background-aggressive-amount').value='70';document.querySelector('#background-aggressive-amount').dispatchEvent(new Event('input'));`);
    await until(() => backgroundPreviewRequest.aggressive && backgroundPreviewRequest.aggressive_amount === 70, 'aggressive preview updates');
    assert.equal(await evaluate(`document.querySelector('#background-aggressive-settings').hidden`), false);
    // The remaining legacy effect checks explicitly exercise Chroma key.
    await evaluate(`document.querySelector('#background-method').value='chroma';document.querySelector('#background-method').dispatchEvent(new Event('change'));`);
    await click('#background-preview-background-toggle');
    await hover('#background-preview-transparent');
    await until(() => tooltipIs('Show transparency checkerboard'), 'themed tooltip works inside a modal dialog');
    assert.equal(await evaluate(`document.querySelector('#app-tooltip').matches(':popover-open')`), true, 'modal tooltip renders above the dialog');
    window.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});
    window.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
    await until(() => evaluate(`document.querySelector('#app-tooltip').hidden`), 'Escape dismisses the dialog tooltip');
    assert.equal(await evaluate(`document.querySelector('#background-dialog').open`), true, 'dismissing a tooltip keeps the dialog open');
    await evaluate(`document.querySelector('#background-preview-color').value='#315577';document.querySelector('#background-preview-color').dispatchEvent(new Event('input'));`);
    assert.equal(await evaluate(`document.querySelector('#background-preview-frame').classList.contains('solid-background') && !document.querySelector('#background-preview-transparent').checked && document.querySelector('#background-preview-color-value').value === '#315577'`), true, 'dialog popover sets a solid preview color');
    await click('#background-preview-transparent');
    assert.equal(await evaluate(`!document.querySelector('#background-preview-frame').classList.contains('solid-background') && document.querySelector('#background-preview-transparent').checked`), true, 'dialog popover restores transparency');
    await evaluate(`document.querySelector('#background-preview-background-toggle').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));`);
    assert.equal(await evaluate(`document.querySelector('#background-preview-background-popover').hidden && document.querySelector('#background-dialog').open`), true, 'Escape closes the background popover without closing its dialog');
    await click('#background-preview-background-toggle');
    if (process.env.FRAMELINE_BACKGROUND_POPOVER_SCREENSHOT) {
      await paintFrame();
      fs.writeFileSync(process.env.FRAMELINE_BACKGROUND_POPOVER_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
    }
    await mouseClick('#background-dialog h2');
    assert.equal(await evaluate(`document.querySelector('#background-preview-background-popover').hidden`), true, 'outside click closes the dialog popover');
    assert.equal(await evaluate(`document.querySelector('#background-edge-smoothing-enabled').checked`), false);
    assert.equal(await evaluate(`document.querySelector('#background-edge-smoothing-settings').hidden`), true);
    await click('#background-softness-enabled');
    await until(() => backgroundPreviewRequest?.softness === 4, 'enabling Edge blur uses its saved amount');
    await click('#background-edge-smoothing-enabled');
    await until(() => backgroundPreviewRequest?.edge_smoothing === 75, 'anti-aliased edge preview');
    assert.equal(backgroundPreviewRequest.softness, 0, 'anti-aliasing disables blur');
    assert.equal(await evaluate(`document.querySelector('#background-softness').disabled`), true);
    assert.equal(await evaluate(`document.querySelector('#background-edge-smoothing-settings').hidden`), false);
    assert.equal(await evaluate(`(() => {
      const bounds = document.querySelector('#background-apply').getBoundingClientRect();
      return bounds.top >= 0 && bounds.bottom <= innerHeight;
    })()`), true, 'Apply stays visible with advanced controls expanded');
    await evaluate(`
      document.querySelector('#background-edge-smoothing-amount').value = '82';
      document.querySelector('#background-edge-smoothing-amount').dispatchEvent(new Event('input'));
    `);
    await until(() => backgroundPreviewRequest?.edge_smoothing === 82, 'edge strength updates live');
    assert.equal(await evaluate(`document.querySelector('#background-edge-smoothing-amount-value').textContent`), '82%');
    assert.equal(await evaluate(`document.querySelector('#background-fringe-enabled').checked`), false);
    assert.equal(await evaluate(`document.querySelector('#background-fringe-settings').hidden`), true);
    assert.equal(backgroundPreviewRequest.fringe_cleanup, undefined);
    await click('#background-fringe-enabled');
    await until(() => backgroundPreviewRequest?.fringe_cleanup?.strength === 100, 'local-color fringe cleanup previews live');
    assert.equal(backgroundPreviewRequest.fringe_cleanup.method,'recover','new cleanup defaults to brush-style color and transparency recovery');
    assert.equal(backgroundPreviewRequest.fringe_cleanup.width,4,'cleanup width starts at four pixels');
    assert.equal(backgroundPreviewRequest.softness,0,'recovery keeps inferred edge coverage');
    assert.equal(await evaluate(`(() => {const p=document.querySelector('#background-preview-frame').getBoundingClientRect();const s=document.querySelector('.background-settings').getBoundingClientRect();return p.right<s.left && p.height>350;})()`),true,'large preview sits beside grouped settings');
    assert.equal(backgroundPreviewRequest.fringe_cleanup.color, null, 'cleanup follows the removal color by default');
    await evaluate(`
      document.querySelector('#background-fringe-method').closest('details').open=true;
      document.querySelector('#background-fringe-method').value='replace';
      document.querySelector('#background-fringe-method').dispatchEvent(new Event('change'));
      document.querySelector('#background-fringe-color-mode').value = 'custom';
      document.querySelector('#background-fringe-color-mode').dispatchEvent(new Event('change'));
      document.querySelector('#background-fringe-color').value = '#30a020';
      document.querySelector('#background-fringe-color').dispatchEvent(new Event('input'));
      for (const [field, value] of [['tolerance',120], ['width',4], ['sample-distance',12], ['strength',80], ['min-opacity',75], ['max-opacity',50]]) {
        const input = document.querySelector('#background-fringe-' + field);
        input.value = String(value); input.dispatchEvent(new Event('input'));
      }
    `);
    await until(() => backgroundPreviewRequest?.fringe_cleanup?.strength === 80 && backgroundPreviewRequest.fringe_cleanup.max_opacity === 50, 'custom fringe color and range update preview');
    assert.equal(backgroundPreviewRequest.fringe_cleanup.min_opacity, 50, 'opacity bounds remain ordered');
    await evaluate(`document.querySelector('#background-fringe-min-opacity').value = '0'; document.querySelector('#background-fringe-min-opacity').dispatchEvent(new Event('input'));`);
    await until(() => backgroundPreviewRequest?.fringe_cleanup?.min_opacity === 0, 'minimum opacity updates');
    const fringePreviewOptions = structuredClone(backgroundPreviewRequest.fringe_cleanup);
    assert.deepEqual(fringePreviewOptions, {method:'replace',color:[48,160,32], tolerance:120, width:4, sample_distance:12, strength:80, min_opacity:0, max_opacity:50});
    assert.equal(await evaluate(`document.querySelector('#background-fringe-color-field').hidden`), false);
    if (process.env.FRAMELINE_FRINGE_SCREENSHOT) {
      await evaluate(`(() => {
        const dialog = document.querySelector('#background-dialog');
        const panel = document.querySelector('#background-fringe-panel');
        dialog.scrollTop += panel.getBoundingClientRect().top - dialog.getBoundingClientRect().top - document.querySelector('#background-preview-frame').offsetHeight - 16;
      })()`);
      await paintFrame();
      fs.writeFileSync(process.env.FRAMELINE_FRINGE_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
      await evaluate(`document.querySelector('#background-dialog').scrollTop = 0`);
    }
    if (process.env.FRAMELINE_EDGE_SMOOTHING_SCREENSHOT) {
      await paintFrame();
      fs.writeFileSync(process.env.FRAMELINE_EDGE_SMOOTHING_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
    }
    await click('#background-edge-smoothing-enabled');
    await until(() => backgroundPreviewRequest?.edge_smoothing === 0 && backgroundPreviewRequest.softness === 4, 'turning off anti-aliasing restores blur setting');
    assert.equal(await evaluate(`document.querySelector('#background-softness').disabled`), false);
    await click('#background-edge-smoothing-enabled');
    assert.equal(await evaluate(`document.querySelector('#background-edge-color-field').hidden`), true);
    await evaluate(`document.querySelector('#background-edge-tint-enabled').closest('details').open=true;`);
    await click("#background-edge-tint-enabled");
    await evaluate(`
      document.querySelector('#background-edge-color').value = '#1020f0';
      document.querySelector('#background-edge-color').dispatchEvent(new Event('input'));
      document.querySelector('#background-edge-tint').value = '75';
      document.querySelector('#background-edge-tint').dispatchEvent(new Event('input'));
    `);
    await until(() => backgroundPreviewRequest?.edge_tint === 75, "soft edge tint preview");
    assert.deepEqual(backgroundPreviewRequest.edge_color, [16, 32, 240]);
    assert.equal(await evaluate(`document.querySelector('#background-edge-color-field').hidden`), false);
    await evaluate(`document.querySelector('#background-method').value = 'sample'; document.querySelector('#background-method').dispatchEvent(new Event('change'));`);
    assert.equal(await evaluate(`document.querySelector('#background-edge-color-field').hidden`), false);
    await evaluate(`document.querySelector('#background-method').value = 'chroma'; document.querySelector('#background-method').dispatchEvent(new Event('change'));`);
    await click("#background-cancel");
    await until(() => evaluate(`!document.querySelector('#background-dialog').open`), "cancel background dialog");
    await until(() => evaluate(`!document.querySelector('#preview-remove-background').disabled`), "background dialog cleanup");
    await click("#preview-remove-background");
    await until(() => evaluate(`document.querySelector('#background-dialog').open`), "reopen background dialog");
    assert.equal(await evaluate(`document.querySelector('#background-edge-tint-enabled').checked`), true);
    assert.equal(await evaluate(`document.querySelector('#background-edge-color').value`), "#1020f0");
    assert.equal(await evaluate(`document.querySelector('#background-edge-tint').value`), "75");
    assert.equal(await evaluate(`document.querySelector('#background-edge-smoothing-enabled').checked`), true);
    assert.equal(await evaluate(`document.querySelector('#background-edge-smoothing-amount').value`), '82');
    assert.equal(await evaluate(`document.querySelector('#background-softness').value`), '4', 'reopening preserves the stored blur amount');
    assert.equal(await evaluate(`document.querySelector('#background-softness-enabled').checked`), true, 'reopening remembers explicit blur activation');
    assert.equal(await evaluate(`document.querySelector('#background-fringe-enabled').checked && document.querySelector('#background-fringe-color-mode').value === 'custom' && document.querySelector('#background-fringe-color').value === '#30a020' && document.querySelector('#background-fringe-max-opacity').value === '50'`), true, 'fringe cleanup settings survive cancel and reopening');
    await click("#background-apply");
    await until(() => Boolean(backgroundApplyRequest), "apply soft edge tint");
    assert.deepEqual(backgroundApplyRequest.edge_color, [16, 32, 240]);
    assert.equal(backgroundApplyRequest.edge_tint, 75);
    assert.equal(backgroundApplyRequest.edge_smoothing, 82, 'Apply uses the preview smoothing strength');
    assert.equal(backgroundApplyRequest.softness, 0);
    assert.deepEqual(backgroundApplyRequest.fringe_cleanup, fringePreviewOptions, 'Apply receives the exact cleanup preview options');
    await until(() => evaluate(`!document.querySelector('#operation-progress-dialog').open`), "background processing completion");
    await until(() => evaluate(`!document.querySelector('#preview-remove-background').disabled`), "background processing cleanup");
    await click("#preview-remove-background");
    await until(() => evaluate(`document.querySelector('#background-dialog').open`), "disable soft edge tint");
    await click('#background-edge-smoothing-enabled');
    await click('#background-fringe-enabled');
    await until(() => backgroundPreviewRequest && !('fringe_cleanup' in backgroundPreviewRequest), 'disabling fringe cleanup removes it from the preview');
    await click("#background-edge-tint-enabled");
    await until(() => backgroundPreviewRequest && !("edge_color" in backgroundPreviewRequest), "untinted preview");
    await click("#background-cancel");
    await until(() => evaluate(`!document.querySelector('#background-dialog').open`), "close untinted dialog");
    await until(() => evaluate(`!document.querySelector('#preview-remove-background').disabled`), "untinted dialog cleanup");
    outlineResponse = null;
    await enableTool();
    await evaluate(`document.querySelector('#preview-outline-size').value = '9'; document.querySelector('#preview-outline-size').dispatchEvent(new Event('input'));`);
    await click('#preview-tool-hand'); await answerMessage('apply');
    await until(() => Boolean(outlineResponse), "blue outline request");
    outlineResponse({ path: outlined, width: 32, height: 32 });
    await until(() => evaluate(`document.querySelector('#preview-image').src === ${JSON.stringify(pathToFileURL(outlined).href)}`), "blue outline commit");
    await click('#preview-tool-outline');
    assert.equal(await evaluate(`!document.querySelector('#preview-tool-enabled').checked && !document.querySelector('#preview-image-wrap').classList.contains('live-outline-preview')`), true, 'returning to Outline retains the committed result without a live preview');
    outlineResponse = null;
    await click('#preview-outline-apply');
    await until(() => Boolean(outlineResponse), 'direct Outline Apply request');
    outlineResponse({ path: outlined, width: 32, height: 32 });
    await until(() => evaluate(`document.querySelector('#preview-outline-apply').textContent === 'Apply outline' && !document.querySelector('#preview-tool-enabled').disabled`), 'direct Outline Apply completed');
    assert.equal(await evaluate(`!document.querySelector('#preview-tool-enabled').checked && !document.querySelector('#preview-image-wrap').classList.contains('live-outline-preview') && !document.querySelector('#preview-outline-reset').disabled`), true, 'Outline Apply turns preview off and retains Remove outline');
    await click('#preview-tool-hand');
    assert.equal(await evaluate(`!document.querySelector('#message-dialog').open && document.querySelector('#preview-feature-enable').hidden`), true, 'leaving applied Outline needs no draft dialog');
    assert.equal(await evaluate(`document.querySelector('#preview-clear-effects').disabled`), false);
    await click("#preview-clear-effects");
    await answerMessage("clear", "current");
    await until(() => evaluate(`document.querySelector('#preview-image').src === ${JSON.stringify(pathToFileURL(blue).href)}`), "clear unselected preview effects");

    // Exercise real mouse input and compare every canvas pixel immediately
    // before and after release, including overlapping and translucent paths.
    for (const settings of [
      { tool: "brush", square: false, feather: 0, opacity: 100 },
      { tool: "brush", square: false, feather: 0, opacity: 40 },
      { tool: "brush", square: false, feather: 50, opacity: 60 },
      { tool: "brush", square: true, feather: 0, opacity: 50 },
      { tool: "eraser", square: false, feather: 0, opacity: 100 },
      { tool: "eraser", square: false, feather: 50, opacity: 100 },
      { tool: "brush", square: false, feather: 0, opacity: 70, antiAlias: true },
      { tool: "brush", square: true, feather: 0, opacity: 50, antiAlias: true },
    ]) {
      if (!(await evaluate(`document.querySelector('#preview-tool-${settings.tool}').classList.contains('selected')`))) {
        await click(`#preview-tool-${settings.tool}`);
      }
      await enableTool();
      assert.equal(await evaluate(`document.querySelector('#preview-feature-enable').hidden && !document.querySelector('#preview-brush-size').disabled`), true, `${settings.tool} works without Enable`);
      await evaluate(`
        document.querySelector('#preview-brush-size').value = '3';
        document.querySelector('#preview-brush-opacity').value = '${settings.opacity}';
        document.querySelector('#preview-brush-feather').value = '${settings.feather}';
        document.querySelector('#preview-brush-antialias').checked = ${settings.antiAlias === true};
        document.querySelector('#preview-square-brush').checked = ${settings.square};
        if (${settings.tool === 'brush' && settings.opacity === 40}) {
          document.querySelector('#preview-brush-color').value='#30ff30';
          document.querySelector('#preview-brush-color').dispatchEvent(new Event('input'));
        }
      `);
      const baseline = await evaluate(`document.querySelector('#preview-paint-canvas').toDataURL()`);
      const bounds = await evaluate(`(() => {
        const b = document.querySelector('#preview-image-wrap').getBoundingClientRect();
        return {left:b.left, top:b.top, width:b.width, height:b.height};
      })()`);
      const positions = [[0.23, 0.25], [0.4, 0.42], [0.63, 0.32], [0.48, 0.68], [0.26, 0.42]]
        .map(([x, y]) => ({x:Math.round(bounds.left + x * bounds.width), y:Math.round(bounds.top + y * bounds.height)}));
      window.webContents.sendInputEvent({type:"mouseDown", ...positions[0], button:"left", clickCount:1});
      for (const position of positions.slice(1)) {
        window.webContents.sendInputEvent({type:"mouseMove", ...position, button:"left"});
        await paintFrame();
      }
      await paintFrame();
      const held = await evaluate(`document.querySelector('#preview-paint-canvas').toDataURL()`);
      assert.notEqual(held, baseline, `mouse drag draws ${JSON.stringify(settings)}`);
      if (settings.tool === "brush" && !settings.square && !settings.feather && settings.opacity === 100 && settings.antiAlias !== true) {
        assert.equal(await evaluate(`(() => {
          const c = document.querySelector('#preview-paint-canvas');
          const pixels = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
          return pixels.some((value, i) => i % 4 === 3 && value > 0 && value < 255);
        })()`), false, "round brush with feather zero has fully covered edge pixels");
      }
      window.webContents.sendInputEvent({type:"mouseUp", ...positions.at(-1), button:"left", clickCount:1});
      await paintFrame();
      assert.equal(await evaluate(`document.querySelector('#preview-paint-canvas').toDataURL()`), held, `release keeps ${JSON.stringify(settings)}`);
      if (settings.tool === 'brush' && settings.opacity === 100) {
        await settingsKeepDraft(`document.querySelector('#preview-paint-canvas').toDataURL()`, 'pending brush stroke');
        assert.equal(await evaluate(`!document.querySelector('#preview-paint-apply').disabled && !document.querySelector('#preview-paint-discard').disabled`), true, 'settings leave Apply and Discard available');
        await click('#preview-tool-hand'); await answerMessage('cancel');
        assert.equal(await evaluate(`document.querySelector('#preview-paint-canvas').toDataURL()`), held, 'Cancel retains the pending brush preview');
        await click('#preview-tool-hand'); await answerMessage('apply');
      } else if (settings.tool === 'eraser' && settings.feather === 0) {
        await click('#preview-tool-hand'); await answerMessage('apply');
      } else await click('#preview-paint-apply');
      await click("#undo");
      assert.equal(await evaluate(`document.querySelector('#preview-paint-canvas').toDataURL()`), baseline, "undo restores the prior paint");
      await click("#redo");
      assert.equal(await evaluate(`document.querySelector('#preview-paint-canvas').toDataURL()`), held, "redo restores the same smooth paint");
    }

    for (const tool of ['brush', 'eraser']) {
      if (!(await evaluate(`document.querySelector('#preview-tool-${tool}').classList.contains('selected')`))) await click(`#preview-tool-${tool}`);
      await enableTool();
      const beforeDraft = await evaluate(`document.querySelector('#preview-paint-canvas').toDataURL()`);
      const point = await evaluate(`(() => {
        document.querySelector('#preview-brush-color').value = '#00ff00';
        document.querySelector('#preview-brush-size').value = '5';
        const b = document.querySelector('#preview-image-wrap').getBoundingClientRect();
        return {x:Math.round(b.left + b.width * .8), y:Math.round(b.top + b.height * .2)};
      })()`);
      window.webContents.sendInputEvent({type:'mouseDown', ...point, button:'left', clickCount:1});
      await paintFrame();
      window.webContents.sendInputEvent({type:'mouseUp', ...point, button:'left', clickCount:1});
      await paintFrame();
      assert.notEqual(await evaluate(`document.querySelector('#preview-paint-canvas').toDataURL()`), beforeDraft, `${tool} creates a pending preview`);
      await settingsKeepDraft(`document.querySelector('#preview-paint-canvas').toDataURL()`, `pending ${tool}`);
      await click('#preview-tool-hand'); await answerMessage('discard');
      assert.equal(await evaluate(`document.querySelector('#preview-paint-canvas').toDataURL()`), beforeDraft, `${tool} Discard restores all previous pixels`);
    }
    await click("#preview-tool-crop");
    const cropCorner = async () => {
      await enableTool();
      const start = await evaluate(`(() => {
        const b = document.querySelector('[data-crop-handle="nw"]').getBoundingClientRect();
        return {x:Math.round(b.left + b.width / 2), y:Math.round(b.top + b.height / 2)};
      })()`);
      const bounds = await evaluate(`(() => {
        const b = document.querySelector('#preview-image-wrap').getBoundingClientRect();
        return {width:b.width, height:b.height};
      })()`);
      window.webContents.sendInputEvent({type:"mouseDown", ...start, button:"left", clickCount:1});
      const end = {x:Math.round(start.x + bounds.width / 4), y:Math.round(start.y + bounds.height / 4)};
      window.webContents.sendInputEvent({type:"mouseMove", ...end, button:"left"});
      await paintFrame();
      window.webContents.sendInputEvent({type:"mouseUp", ...end, button:"left", clickCount:1});
      await paintFrame();
    };
    const cropLeft = () => evaluate(`document.querySelector('#preview-image-wrap').style.getPropertyValue('--crop-left')`);
    const seekCropImage = async frame => {
      await evaluate(`(() => {
        const bounds = document.querySelector('#timeline-content').getBoundingClientRect();
        document.querySelector('#ruler').dispatchEvent(new MouseEvent('click', {bubbles:true, clientX:bounds.left + ${frame} * 4 + 1}));
      })()`);
      await paintFrame();
    };
    const cropFields = () => evaluate(`Object.fromEntries([...document.querySelectorAll('[data-crop-field]')].map(field => [field.dataset.cropField, Number(field.value)]))`);
    const editCropFields = async values => {
      await enableTool();
      return evaluate(`(() => {
      for (const [key, value] of Object.entries(${JSON.stringify(values)})) {
        const field = document.querySelector('[data-crop-field="' + key + '"]');
        field.focus(); field.value = value;
        field.dispatchEvent(new Event('input', {bubbles:true}));
        field.dispatchEvent(new Event('change', {bubbles:true})); field.blur();
      }
    })()`);
    };
    assert.deepEqual(await cropFields(), {x:0, y:0, width:32, height:32});
    assert.equal(await evaluate(`document.querySelector('#preview-crop-overlay').hidden && document.querySelector('#preview-crop-width').disabled`), true, 'Crop is inactive before Enable');
    await editCropFields({x:2, y:3, width:25, height:24});
    assert.equal(await evaluate(`document.querySelector('#preview-crop-overlay').hidden`), false, 'Enable shows the crop handles');
    await click('#preview-tool-enabled');
    assert.deepEqual(await cropFields(), {x:0, y:0, width:32, height:32}, 'unchecking Crop discards its draft');
    assert.equal(await evaluate(`document.querySelector('#preview-crop-overlay').hidden && !document.querySelector('#message-dialog').open`), true);
    await editCropFields({x:4, y:6, width:20, height:18});
    assert.deepEqual(await cropFields(), {x:4, y:6, width:20, height:18});
    assert.equal(await cropLeft(), "12.5%", "numeric crop moves the overlay immediately");
    await settingsKeepDraft(`JSON.stringify([...document.querySelectorAll('[data-crop-field]')].map(field => field.value))`, 'pending crop bounds');
    assert.equal(await evaluate(`document.querySelector('#preview-tool-enabled').checked && !document.querySelector('#preview-crop-overlay').hidden`), true, 'settings keep crop active');
    if (process.env.FRAMELINE_CROP_SCREENSHOT) {
      await paintFrame();
      fs.writeFileSync(process.env.FRAMELINE_CROP_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
    }
    await click('#preview-tool-hand');
    await answerMessage('discard');
    assert.equal(await cropLeft(), "0%", "numeric edits remain a draft until Apply");
    await click('#preview-tool-crop');
    await editCropFields({x:4, y:6, width:20, height:18});
    await click('#preview-tool-hand'); await answerMessage('apply');
    await click('#preview-tool-crop');
    await click('#undo');
    assert.deepEqual(await cropFields(), {x:0, y:0, width:32, height:32});
    await click('#redo');
    assert.deepEqual(await cropFields(), {x:4, y:6, width:20, height:18});
    await seekCropImage(24);
    assert.deepEqual(await cropFields(), {x:0, y:0, width:32, height:32}, "single numeric crop retains other images");
    await seekCropImage(48);
    await click('#preview-crop-reset');
    await editCropFields({x:999, width:0});
    assert.deepEqual(await cropFields(), {x:31, y:0, width:1, height:32}, "invalid numeric bounds clamp to source pixels");
    await evaluate(`(() => {
      const field = document.querySelector('#preview-crop-x');
      field.focus(); field.value = ''; field.dispatchEvent(new Event('input', {bubbles:true}));
    })()`);
    assert.equal(await evaluate(`document.querySelector('#preview-crop-x').value`), '', "typing a new number can temporarily leave a blank field");
    // A hidden offscreen window changes activeElement without emitting native blur events.
    await evaluate(`document.querySelector('#preview-crop-x').blur(); document.querySelector('#preview-crop-x').dispatchEvent(new FocusEvent('blur'));`);
    assert.equal((await cropFields()).x, 31, "blank field restores the current valid coordinate on blur");
    await click('#preview-crop-reset');
    await cropCorner();
    const draggedCrop = await cropFields();
    assert.equal(draggedCrop.x + draggedCrop.width, 32);
    assert.equal(draggedCrop.y + draggedCrop.height, 32);
    assert(draggedCrop.x > 0 && draggedCrop.y > 0, "dragging the handles updates the pixel fields");
    assert.notEqual(await cropLeft(), "0%");
    assert.equal(await evaluate(`document.querySelector('#preview-crop-apply').disabled`), false);
    await click("#preview-tool-hand");
    await answerMessage('discard');
    assert.equal(await cropLeft(), "0%", "dragging does not commit the crop before Apply");
    assert.equal(await evaluate(`document.querySelector('#preview-image-wrap').classList.contains('crop-preview')`), false);
    await click("#preview-tool-crop");
    await cropCorner();
    await click("#preview-crop-apply");
    assert.equal(await evaluate(`!document.querySelector('#preview-tool-enabled').checked && document.querySelector('#preview-crop-overlay').hidden && !document.querySelector('#preview-crop-reset').disabled`), true, 'Crop Apply turns preview off and retains Reset');
    const appliedCropLeft = await cropLeft();
    assert.notEqual(appliedCropLeft, "0%");
    await seekCropImage(24);
    assert.equal(await cropLeft(), "0%", "Apply only changes the preview image");
    await seekCropImage(48);
    await evaluate(`document.querySelector('#preview-crop-scope').value = 'all'; document.querySelector('#preview-crop-scope').dispatchEvent(new Event('change'));`);
    await click("#preview-crop-apply");
    await seekCropImage(24);
    assert.equal(await cropLeft(), appliedCropLeft, "Apply to all uses the same crop on other images");
    await evaluate(`document.querySelector('#preview-crop-scope').value = 'current'; document.querySelector('#preview-crop-scope').dispatchEvent(new Event('change'));`);
    await click("#preview-crop-reset");
    assert.equal(await cropLeft(), "0%", "single reset works after Apply to all");
    await seekCropImage(48);
    assert.equal(await cropLeft(), appliedCropLeft, "single reset retains crops on other images");
    await evaluate(`document.querySelector('#preview-crop-scope').value = 'all'; document.querySelector('#preview-crop-scope').dispatchEvent(new Event('change'));`);
    await click("#preview-crop-reset");
    assert.equal(await cropLeft(), "0%", "all-image reset clears the current crop");
    await seekCropImage(24);
    assert.equal(await cropLeft(), "0%", "all-image reset clears other crops");
    await seekCropImage(48);
    await click("#undo");
    assert.equal(await cropLeft(), appliedCropLeft, "undo restores applied crops after reset");
    await click("#redo");
    assert.equal(await cropLeft(), "0%", "redo resets the crops again");
    await evaluate(`document.querySelector('#preview-crop-scope').value = 'current'; document.querySelector('#preview-crop-scope').dispatchEvent(new Event('change'));`);
    await cropCorner();
    await click("#preview-crop-apply");
    const checkToolButtonWidths = async () => {
      assert.equal(await evaluate(`(() => {
        const panel = document.querySelector('.preview-options-panel');
        const padding = parseFloat(getComputedStyle(panel).paddingLeft) + parseFloat(getComputedStyle(panel).paddingRight);
        const width = panel.clientWidth - padding;
        const buttons = [...panel.querySelectorAll('button')].filter(button => button.getBoundingClientRect().width);
        return buttons.length > 0 && buttons.every(button => Math.abs(button.getBoundingClientRect().width - width) < 1 && button.getBoundingClientRect().height >= 30);
      })()`), true, "tool action buttons fill the panel consistently");
    };
    await checkToolButtonWidths();
    assert.equal(await evaluate(`(() => {
      const scope = document.querySelector('#preview-crop-scope').getBoundingClientRect();
      const apply = document.querySelector('#preview-crop-apply').getBoundingClientRect();
      const reset = document.querySelector('#preview-crop-reset').getBoundingClientRect();
      return scope.bottom <= apply.top && apply.bottom <= reset.top
        && document.querySelector('#preview-crop-apply').textContent === 'Apply Crop'
        && document.querySelector('#preview-crop-reset').textContent === 'Reset Crop'
        && document.querySelector('#preview-crop-apply-all') === null;
    })()`), true, "crop scope precedes Apply Crop and Reset Crop");
    await click("#preview-tool-outline");
    await checkToolButtonWidths();
    const assertToolScrollbar = () => evaluate(`(() => {
      const source = getComputedStyle(document.querySelector('#image-list'));
      const tools = getComputedStyle(document.querySelector('.preview-options-panel'));
      return tools.scrollbarColor === source.scrollbarColor
        && tools.scrollbarWidth === source.scrollbarWidth
        && tools.scrollbarGutter === source.scrollbarGutter;
    })()`);
    for (const tool of ['outline', 'brush', 'eraser', 'crop', 'hand']) {
      if (!(await evaluate(`document.querySelector('#preview-tool-${tool}').classList.contains('selected')`))) await click(`#preview-tool-${tool}`);
      assert.equal(await assertToolScrollbar(), true, `${tool} panel uses the Import scrollbar colors, width, and gutter`);
    }
    await click("#preview-tool-outline");
    await evaluate(`document.querySelector('.preview-options-panel').style.height = '180px'`);
    assert.equal(await evaluate(`(() => {
      const panel = document.querySelector('.preview-options-panel');
      return panel.scrollHeight > panel.clientHeight;
    })()`), true, "outline tool panel exposes its themed scrollbar when content overflows");
    await evaluate(`document.querySelector('.preview-options-panel').scrollTop = 40`);
    assert.ok(await evaluate(`document.querySelector('.preview-options-panel').scrollTop`) > 0);
    await evaluate(`document.querySelector('.preview-options-panel').style.removeProperty('height'); document.querySelector('.preview-options-panel').scrollTop = 0;`);
    assert.equal(await evaluate(`(() => {
      const outline = getComputedStyle(document.querySelector('#preview-outline-apply'));
      const crop = getComputedStyle(document.querySelector('#preview-crop-apply'));
      return outline.backgroundColor === crop.backgroundColor && outline.color === crop.color;
    })()`), true, "outline Apply uses the same white button style as crop Apply");
    await click("#preview-tool-crop");
    await click("#preview-remove-background");
    await until(() => evaluate(`document.querySelector('#background-dialog').open`), "cropped painted background dialog");
    const current = workingImages.at(-1);
    assert.ok(current && current.width < 32 && current.height < 32, "dialog snapshot is cropped");
    await until(() => backgroundPreviewRequest?.path === current.path, "current result used by removal preview");
    await until(() => evaluate(`document.querySelector('#background-sample-image').naturalWidth === ${current.width}`), "cropped removal preview dimensions");
    assert.equal(await evaluate(`(() => {
      const image = document.querySelector('#background-sample-image');
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      return pixels.some((value, i) => i % 4 === 3 && value < 255);
    })()`), true, "eraser strokes are present in the cropped working snapshot");
    assert.equal(backgroundPreviewRequest.paint_strokes, undefined, "snapshot paint is consumed once");
    await click("#background-apply");
    await until(() => backgroundApplyRequest?.path === current.path, "apply removal to current result");
    await until(() => evaluate(`!document.querySelector('#operation-progress-dialog').open`), "commit cumulative background result");
    assert.equal(await evaluate(`document.querySelector('#preview-paint-canvas').hidden`), true, "consumed paint is not drawn a second time");
    assert.equal(await evaluate(`document.querySelector('#preview-resolution').textContent`), `${current.width} × ${current.height}`);
    assert.equal(await evaluate(`document.querySelector('#preview-clear-effects').disabled`), false);
    await click("#preview-clear-effects");
    await answerMessage("clear", "current");
    await until(() => evaluate(`document.querySelector('#preview-image').src === ${JSON.stringify(pathToFileURL(blue).href)}`), "restore imported original after cumulative edits");
    assert.equal(await evaluate(`document.querySelector('#preview-clear-effects').disabled`), true);
    await click("#undo");
    await until(() => evaluate(`document.querySelector('#preview-image').src === ${JSON.stringify(pathToFileURL(current.path).href)}`), "undo clear restores working result");
    await click("#redo");
    await until(() => evaluate(`document.querySelector('#preview-image').src === ${JSON.stringify(pathToFileURL(blue).href)}`), "redo clear restores original again");

    // Cancelling scoped Clear leaves edits intact. Clearing all is a single
    // undoable edit, including when the displayed image is already clean.
    await cropCorner();
    await evaluate(`document.querySelector('#preview-crop-scope').value = 'all'; document.querySelector('#preview-crop-scope').dispatchEvent(new Event('change'));`);
    await click("#preview-crop-apply");
    const batchCrop = await cropLeft();
    assert.notEqual(batchCrop, "0%");
    await click("#preview-clear-effects");
    await answerMessage("cancel");
    assert.equal(await cropLeft(), batchCrop, "Cancel retains image effects");
    await click("#preview-clear-effects");
    await until(() => evaluate(`document.querySelector('#message-dialog').open`), "Escape cancellation dialog");
    window.webContents.sendInputEvent({type:"keyDown", keyCode:"Escape"});
    window.webContents.sendInputEvent({type:"keyUp", keyCode:"Escape"});
    await until(() => evaluate(`!document.querySelector('#message-dialog').open`), "Escape cancels Clear");
    await paintFrame();
    assert.equal(await cropLeft(), batchCrop, "Escape retains image effects");
    await click("#preview-clear-effects");
    await answerMessage("clear", "current");
    assert.equal(await cropLeft(), "0%", "single-image Clear restores the displayed original");
    assert.equal(await evaluate(`document.querySelector('#preview-clear-effects').disabled`), false, "Clear all remains available from an unedited image");
    await click("#preview-clear-effects");
    await answerMessage("clear", "all");
    await seekCropImage(24);
    assert.equal(await cropLeft(), "0%", "all-image Clear restores other originals");
    await click("#undo");
    assert.equal(await cropLeft(), batchCrop, "one Undo restores the batch of cleared effects");
    await click("#redo");
    assert.equal(await cropLeft(), "0%", "Redo clears the batch again");
    await seekCropImage(48);

    window.webContents.send("window:request-close");
    await answerMessage("cancel");
    assert.equal(closes, 0);
    window.webContents.send("window:request-close");
    await answerMessage("save");
    await until(() => saves === 1, "save before close");
    assert.equal(savedProject.name, "Walk cycle", "saving includes the editable project title");
    assert.equal(closes, 0, "cancelled save must retain the window");
    await click("#open-project");
    await answerMessage("cancel");
    assert.equal(opens, 0);
    await click("#open-project");
    await answerMessage("discard");
    await until(() => evaluate(`document.querySelector('#toast').textContent.includes('invalid paint strokes')`), "reject invalid opened project");
    assert.equal(opens, 1);
    assert.equal(await evaluate(`document.querySelector('#frame-count').textContent`), "49 / 72");
    assert.equal(await evaluate(`document.querySelector('#preview-image').src`), pathToFileURL(blue).href);
    window.webContents.send("window:request-close");
    await answerMessage("discard");
    await until(() => closes === 1, "discard close confirmation");

    media = [wide, tall];
    await importMedia();
    await until(() => evaluate(`document.querySelector('#frame-count').textContent === '73 / 120'`), "import mixed aspect ratios");
    const seek = async frame => {
      await evaluate(`
        (() => {
        const bounds = document.querySelector('#timeline-content').getBoundingClientRect();
        document.querySelector('#ruler').dispatchEvent(new MouseEvent('click', {bubbles:true, clientX:bounds.left + ${frame} * 4 + 1}));
        })();
      `);
      await paintFrame();
    };
    await seek(48);
    for (let i = 0; i < 4; i++) await click("#preview-zoom-in");
    const drag = await evaluate(`(() => {
      const b = document.querySelector('#preview-stage').getBoundingClientRect();
      return {x:Math.round(b.left + b.width / 2), y:Math.round(b.top + b.height / 2)};
    })()`);
    window.webContents.sendInputEvent({type:"mouseDown", ...drag, button:"right", clickCount:1});
    window.webContents.sendInputEvent({type:"mouseMove", x:drag.x + 40, y:drag.y + 25, button:"right"});
    await paintFrame();
    window.webContents.sendInputEvent({type:"mouseUp", x:drag.x + 40, y:drag.y + 25, button:"right", clickCount:1});
    const viewport = `(() => {
      const style = document.querySelector('#preview-stage').style;
      return {zoom:style.getPropertyValue('--preview-zoom'), x:style.getPropertyValue('--preview-pan-x'), y:style.getPropertyValue('--preview-pan-y')};
    })()`;
    const expectedViewport = await evaluate(viewport);
    assert.notEqual(expectedViewport.zoom, "1");
    assert.equal(expectedViewport.x, "40px");
    assert.equal(expectedViewport.y, "25px");
    await seek(72);
    assert.deepEqual(await evaluate(viewport), expectedViewport, "seek to a wide frame keeps the viewport");
    await seek(96);
    assert.deepEqual(await evaluate(viewport), expectedViewport, "seek to a tall frame keeps the viewport");
    await seek(48);
    await evaluate(`
      window.playbackViewSamples = [];
      window.playbackViewSampler = setInterval(() => window.playbackViewSamples.push({
        ...${viewport}, path:document.querySelector('#preview-image').src,
        frame:document.querySelector('#frame-count').textContent
      }), 16);
    `);
    await click("#play");
    await until(() => evaluate(`window.playbackViewSamples.some(s => s.path === ${JSON.stringify(pathToFileURL(tall).href)})`), "playback reaches tall frame");
    await until(() => evaluate(`window.playbackViewSamples.some(s => s.frame === '1 / 120')`), "playback loops");
    await click("#play");
    const samples = await evaluate(`clearInterval(window.playbackViewSampler); window.playbackViewSamples`);
    assert.ok(samples.some(sample => sample.path === pathToFileURL(wide).href));
    assert.ok(samples.some(sample => sample.path === pathToFileURL(tall).href));
    for (const {zoom, x, y} of samples) assert.deepEqual({zoom, x, y}, expectedViewport, "every playback frame keeps the viewport");
    assert.deepEqual(await evaluate(viewport), expectedViewport, "pausing keeps the viewport");
    await click("#loop-toggle");
    await seek(95);
    await click("#play");
    await until(() => evaluate(`document.querySelector('#frame-count').textContent === '120 / 120' && document.querySelector('#play').getAttribute('aria-label') === 'Play'`), "nonlooping playback stops on the final frame");
    assert.deepEqual(await evaluate(viewport), expectedViewport, "stopping on the final frame keeps the viewport");
    assert.equal(await evaluate(`document.querySelector('#preview-image-wrap').style.height`), `${await evaluate(`document.querySelector('#preview-stage').clientHeight`)}px`, "the final frame's preview dimensions are updated");
    await click("#preview-zoom-fit");
    assert.deepEqual(await evaluate(viewport), {zoom:"0.9", x:"0px", y:"0px"}, "FIT recenters the image with a margin");

    const loopValue = edge => evaluate(`Number(document.querySelector('#loop-${edge}').getAttribute('aria-valuenow'))`);
    const beginLoopDrag = async (edge, delta) => {
      const start = await evaluate(`(() => {
        const bounds = document.querySelector('#loop-${edge}').getBoundingClientRect();
        return {x:Math.round(bounds.left + bounds.width / 2), y:Math.round(bounds.top + bounds.height / 2)};
      })()`);
      window.webContents.sendInputEvent({type:"mouseDown", ...start, button:"left", clickCount:1});
      window.webContents.sendInputEvent({type:"mouseMove", x:start.x + Math.round(delta / 2), y:start.y, button:"left"});
      await paintFrame();
      const end = {x:start.x + delta, y:start.y};
      window.webContents.sendInputEvent({type:"mouseMove", ...end, button:"left"});
      await paintFrame();
      return end;
    };
    const releaseLoopDrag = async end => {
      window.webContents.sendInputEvent({type:"mouseUp", ...end, button:"left", clickCount:1});
      await paintFrame();
    };
    assert.equal(await loopValue("start"), 1);
    assert.equal(await loopValue("end"), 120);
    assert.equal(await evaluate(`(() => {
      const scroll = document.querySelector('#timeline-scroll');
      const lane = document.querySelector('#loop-range');
      const clips = document.querySelector('#clips').getBoundingClientRect();
      const bounds = lane.getBoundingClientRect();
      return lane.closest('#track') === document.querySelector('#track')
        && lane.closest('#timeline-scroll') === scroll
        && clips.bottom <= bounds.top
        && bounds.bottom <= scroll.getBoundingClientRect().top + scroll.clientHeight
        && document.querySelector('.loop-range-viewport') === null;
    })()`), true, "frames and loop handles share the timeline scroll area above its scrollbar");
    const playheadBeforeLoopDrag = await evaluate(`document.querySelector('#frame-count').textContent`);
    await releaseLoopDrag(await beginLoopDrag("start", 12 * 4));
    assert.equal(await evaluate(`document.querySelector('#frame-count').textContent`), playheadBeforeLoopDrag, "dragging a loop handle does not seek the playhead");
    assert.equal(await loopValue("start"), 13, "Start snaps to a whole frame");
    await click("#undo");
    assert.equal(await loopValue("start"), 1, "one Undo reverses the entire handle drag");
    await click("#redo");
    assert.equal(await loopValue("start"), 13);
    await releaseLoopDrag(await beginLoopDrag("end", (36 - 120) * 4));
    assert.equal(await loopValue("end"), 36, "End is the last included frame");
    const frameBeforeKeyboard = await evaluate(`document.querySelector('#frame-count').textContent`);
    window.webContents.sendInputEvent({type:"keyDown", keyCode:"Left"});
    window.webContents.sendInputEvent({type:"keyUp", keyCode:"Left"});
    await until(async () => await loopValue("end") === 35, "keyboard adjusts the focused loop handle");
    assert.equal(await evaluate(`document.querySelector('#frame-count').textContent`), frameBeforeKeyboard, "loop handle keyboard input does not seek the playhead");
    window.webContents.sendInputEvent({type:"keyDown", keyCode:"Right"});
    window.webContents.sendInputEvent({type:"keyUp", keyCode:"Right"});
    await until(async () => await loopValue("end") === 36, "restore End with keyboard");
    const cancelledEnd = await beginLoopDrag("start", 8 * 4);
    window.webContents.sendInputEvent({type:"keyDown", keyCode:"Escape"});
    window.webContents.sendInputEvent({type:"keyUp", keyCode:"Escape"});
    await releaseLoopDrag(cancelledEnd);
    assert.equal(await loopValue("start"), 13, "Escape cancels the loop drag");
    await click("#loop-toggle");
    await seek(72);
    await evaluate(`window.loopSamples = []; window.loopSampler = setInterval(() => {if(document.querySelector('#play').getAttribute('aria-label')==='Pause') window.loopSamples.push(Number(document.querySelector('#frame-count').textContent.split(' / ')[0]));}, 16)`);
    await click("#play");
    await until(() => evaluate(`window.loopSamples.includes(36) && window.loopSamples.filter(frame => frame === 13).length > 2`), "playback wraps from the chosen End back to Start");
    await click("#play");
    const loopSamples = await evaluate(`clearInterval(window.loopSampler); window.loopSamples`);
    assert.ok(loopSamples.every(frame => frame >= 13 && frame <= 36), "every playback frame stays inside the loop");

    await evaluate(`document.querySelector('#zoom-slider').value = '400'; document.querySelector('#zoom-slider').dispatchEvent(new Event('input'));`);
    const held = await evaluate(`(() => {
      const handle = document.querySelector('#loop-end').getBoundingClientRect();
      const timeline = document.querySelector('#timeline-scroll').getBoundingClientRect();
      return {start:{x:Math.round(handle.left + handle.width / 2), y:Math.round(handle.top + handle.height / 2)}, end:{x:Math.round(timeline.right - 10), y:Math.round(handle.top + handle.height / 2)}};
    })()`);
    window.webContents.sendInputEvent({type:"mouseDown", ...held.start, button:"left", clickCount:1});
    window.webContents.sendInputEvent({type:"mouseMove", ...held.end, button:"left"});
    await until(() => evaluate(`document.querySelector('#timeline-scroll').scrollLeft > 0`), "loop drag scrolls near the viewport edge");
    await releaseLoopDrag(held.end);
    assert.ok(await loopValue("end") > 36);
    assert.equal(await evaluate(`(() => {
      const lane = document.querySelector('#loop-range');
      const content = document.querySelector('#timeline-content');
      return Math.abs(lane.getBoundingClientRect().left - content.getBoundingClientRect().left) < 1
        && lane.style.transform === '';
    })()`), true, "frames and loop handles scroll together without a separate offset");
    await click("#undo");
    assert.equal(await loopValue("end"), 36, "Undo restores the range after autoscrolling drag");
    await evaluate(`document.querySelector('#zoom-slider').value = '100'; document.querySelector('#zoom-slider').dispatchEvent(new Event('input')); document.querySelector('#timeline-scroll').scrollLeft = 0;`);
    await paintFrame();
    if (process.env.FRAMELINE_LOOP_SCREENSHOT) fs.writeFileSync(process.env.FRAMELINE_LOOP_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
    const contextPosition = await evaluate(`(() => {
      const clip = document.querySelectorAll('.timeline-clip')[1].getBoundingClientRect();
      return {x:Math.round(clip.left + clip.width / 2), y:Math.round(clip.top + clip.height / 2)};
    })()`);
    window.webContents.sendInputEvent({type:"mouseDown", ...contextPosition, button:"right", clickCount:1});
    window.webContents.sendInputEvent({type:"mouseUp", ...contextPosition, button:"right", clickCount:1});
    await until(() => evaluate(`Boolean(document.querySelector('.context-menu'))`), "open timeline context menu");
    assert.equal(await evaluate(`(() => {
      const menu = document.querySelector('.context-menu');
      const buttons = Array.from(menu.querySelectorAll('button'));
      const labels = buttons.map(button => button.textContent);
      const bounds = menu.getBoundingClientRect();
      return !labels.some(label => label.includes('Split at current frame'))
        && labels.some(label => label.endsWith('Duplicate')) && labels.some(label => label.endsWith('Delete'))
        && getComputedStyle(menu).backgroundColor === 'rgb(18, 18, 18)'
        && buttons.every(button => getComputedStyle(button).fontSize === '12px' && button.getBoundingClientRect().height >= 32)
        && bounds.top >= 8 && bounds.left >= 8 && bounds.bottom <= innerHeight - 8;
    })()`), true, "context menu omits Split, uses the app theme with readable rows, and fits onscreen");
    if (process.env.FRAMELINE_MENU_SCREENSHOT) {
      await paintFrame();
      fs.writeFileSync(process.env.FRAMELINE_MENU_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
    }
    await evaluate(`Array.from(document.querySelectorAll('.context-menu button')).find(button => button.textContent.endsWith('Duplicate')).click()`);
    await until(() => evaluate(`document.querySelector('#stats-frames').textContent === '144' && !document.querySelector('.context-menu')`), "Duplicate still works from the restyled menu");
    await click("#undo");
    assert.equal(await evaluate(`document.querySelector('#stats-frames').textContent`), "120");

    const selectedCount = () => evaluate(`document.querySelectorAll('.timeline-clip.selected').length`);
    const clipIds = () => evaluate(`Array.from(document.querySelectorAll('.timeline-clip')).map(clip => clip.dataset.clipId)`);
    const names = () => evaluate(`Array.from(document.querySelectorAll('.timeline-clip')).map(clip => clip.querySelector('.clip-label strong').textContent)`);
    const selectClip = (index, modifiers = []) => mouseClick(`.timeline-clip:nth-child(${index + 1})`, modifiers);
    const openTimelineMenu = async index => {
      await evaluate(`(() => {
        const clip = document.querySelectorAll('.timeline-clip')[${index}];
        const bounds = clip.getBoundingClientRect();
        clip.dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, cancelable:true, clientX:bounds.left + 10, clientY:bounds.top + 10}));
      })()`);
      await until(() => evaluate(`document.querySelector('.context-menu')?.getAttribute('aria-label') === 'Timeline clip actions'`), 'timeline deletion menu');
    };
    const originalTimeline = await clipIds();
    const originalAssets = await evaluate(`document.querySelector('#image-count').textContent`);
    for (const side of ['before', 'after']) {
      await selectClip(1);
      await selectClip(2, ['control']);
      await selectClip(4, ['control']);
      await openTimelineMenu(2);
      assert.equal(await selectedCount(), 3, 'right-click preserves the group before deletion');
      const label = `Delete frames ${side}`;
      assert.equal(await evaluate(`document.querySelector('.context-menu button[aria-label="${label}"]').disabled`), false);
      await evaluate(`document.querySelector('.context-menu button[aria-label="${label}"]').click()`);
      const expected = side === 'before' ? originalTimeline.slice(2) : originalTimeline.slice(0, 3);
      assert.deepEqual(await clipIds(), expected, 'delete by clicked clip boundary rather than selection');
      assert.equal(await selectedCount(), 1);
      assert.equal(await evaluate(`document.querySelector('#stats-frames').textContent`), '72');
      assert.equal(await evaluate(`document.querySelector('#image-count').textContent`), originalAssets, 'timeline deletion keeps imported images');
      assert.equal(await evaluate(`document.querySelector('#message-dialog').open`), false, 'reversible deletion applies directly');
      await click('#undo');
      assert.deepEqual(await clipIds(), originalTimeline);
      assert.equal(await selectedCount(), 3, 'Undo restores the previous group');
      assert.equal(await loopValue('start'), 13);
      assert.equal(await loopValue('end'), 36);
      await click('#redo');
      assert.deepEqual(await clipIds(), expected);
      await click('#undo');
    }
    for (const [index, side] of [[0, 'before'], [4, 'after']]) {
      await openTimelineMenu(index);
      assert.equal(await evaluate(`document.querySelector('.context-menu button[aria-label="Delete frames ${side}"]').disabled`), true, 'empty side is disabled');
      await pressKey('Escape');
    }
    await selectClip(1);
    await selectClip(2, ["control"]);
    assert.equal(await selectedCount(), 2, "Ctrl-click adds a clip without dropping the first selection");
    assert.equal(await evaluate(`document.querySelector('#clip-name').textContent`), "2 clips selected");
    await selectClip(1, ["control"]);
    assert.equal(await selectedCount(), 1, "Ctrl-click toggles a selected clip off");
    await selectClip(4, ["shift"]);
    assert.equal(await selectedCount(), 4, "Shift-click selects everything between anchor and clicked clip");
    await selectClip(2, ["shift"]);
    assert.equal(await selectedCount(), 2, "repeated Shift-click retains the original anchor");
    await evaluate(`document.querySelector('#clip-frames').value = '12'; document.querySelector('#clip-frames').dispatchEvent(new Event('change'));`);
    assert.equal(await evaluate(`document.querySelector('#stats-frames').textContent`), "96", "duration applies to both selected clips");
    await click("#undo");
    assert.equal(await selectedCount(), 2, "Undo restores the group selection");
    assert.equal(await evaluate(`document.querySelector('#stats-frames').textContent`), "120");

    await selectClip(4, ["control"]);
    const resize = await evaluate(`(() => {
      const bounds = document.querySelector('.timeline-clip:nth-child(3) .clip-resize').getBoundingClientRect();
      return {x:Math.round(bounds.left + bounds.width / 2), y:Math.round(bounds.top + bounds.height / 2)};
    })()`);
    window.webContents.sendInputEvent({type:"mouseDown", ...resize, button:"left", clickCount:1});
    window.webContents.sendInputEvent({type:"mouseMove", x:resize.x + 4 * 4, y:resize.y, button:"left"});
    await paintFrame();
    window.webContents.sendInputEvent({type:"mouseUp", x:resize.x + 4 * 4, y:resize.y, button:"left", clickCount:1});
    await paintFrame();
    assert.equal(await evaluate(`document.querySelector('#stats-frames').textContent`), "132", "dragging an edge resizes all three selected clips by the same frame delta");
    await click("#undo");
    assert.equal(await selectedCount(), 3);

    const beforeMove = await clipIds();
    // Browser drag/drop handlers carry the group, including disjoint clips.
    await evaluate(`(() => {
      const clips = document.querySelectorAll('.timeline-clip');
      const target = clips[0].getBoundingClientRect();
      const transfer = new DataTransfer();
      clips[1].dispatchEvent(new DragEvent('dragstart', {bubbles:true, dataTransfer:transfer}));
      clips[0].dispatchEvent(new DragEvent('drop', {bubbles:true, dataTransfer:transfer, clientX:target.left + 2, clientY:target.top + 20}));
      document.querySelector('#clips').dispatchEvent(new DragEvent('dragend', {bubbles:true, dataTransfer:transfer}));
    })()`);
    assert.deepEqual(await names(), ["red.bmp", "blue.bmp", "tall.bmp", "missing.bmp", "wide.bmp"], "dragging preserves timeline order inside the selected group");
    assert.equal(await selectedCount(), 3);
    await click("#undo");
    assert.deepEqual(await clipIds(), beforeMove);
    assert.equal(await selectedCount(), 3);

    await pressKey("x", ["control"]);
    assert.equal(await evaluate(`document.querySelector('#stats-frames').textContent`), "48", "Ctrl+X cuts the group");
    await click("#undo");
    assert.deepEqual(await clipIds(), beforeMove);
    await click("#redo");
    await seek(24);
    await pressKey("v", ["control"]);
    assert.equal(await evaluate(`document.querySelector('#stats-frames').textContent`), "120", "Ctrl+V inserts the complete cut group at the playhead");
    assert.equal(await selectedCount(), 3);
    assert.deepEqual(await names(), ["missing.bmp", "red.bmp", "blue.bmp", "tall.bmp", "wide.bmp"]);
    await click("#undo");
    await click("#undo");
    assert.deepEqual(await clipIds(), beforeMove);
    assert.equal(await selectedCount(), 3);
    await pressKey("Delete");
    await until(() => evaluate(`document.querySelector('#message-dialog').open`), "batch delete confirmation");
    assert.match(await evaluate(`document.querySelector('#message-text').textContent`), /3 selected timeline clips/);
    await answerMessage("confirm");
    assert.equal(await evaluate(`document.querySelector('#stats-frames').textContent`), "48");
    await click("#undo");
    assert.deepEqual(await clipIds(), beforeMove);
    assert.equal(await selectedCount(), 3);

    const exportScope = async (scope, format) => {
      const count = exportRequests.length;
      await evaluate(`document.querySelector('#export-scope').value = '${scope}'; document.querySelector('#export-format').value = '${format}'`);
      await click("#export-gif");
      await until(() => exportRequests.length === count + 1, `export ${scope} as ${format}`);
      await until(() => evaluate(`!document.querySelector('#operation-progress-dialog').open`), "export completion");
      return exportRequests.at(-1);
    };
    const allExport = await exportScope("all", "gif");
    assert.equal(allExport.command, "export_gif");
    assert.equal(allExport.request.clips.reduce((sum, clip) => sum + clip.duration_frames, 0), 120);
    const rangeExport = await exportScope("range", "mp4");
    assert.equal(rangeExport.command, "export_video");
    assert.deepEqual(rangeExport.request.clips.map(clip => clip.duration_frames), [12, 12], "Start 13 through End 36 trims the two boundary clips exactly");
    const selectedExport = await exportScope("selected", "frames");
    assert.equal(selectedExport.command, "export_images");
    assert.equal(selectedExport.request.mode, "frames");
    assert.deepEqual(selectedExport.request.clips.map(clip => path.basename(clip.path)), ["red.bmp", "blue.bmp", "tall.bmp"]);
    const sheetExport = await exportScope("range", "sheet-frames");
    assert.equal(sheetExport.command, "export_sheet");
    assert.equal(sheetExport.request.clips.reduce((sum, clip) => sum + clip.duration_frames, 0), 24);
    const sourcesExport = await exportScope("range", "sources");
    assert.equal(sourcesExport.request.mode, "sources");
    assert.deepEqual(sourcesExport.request.images.map(image => image.name), ["missing.bmp", "red.bmp"]);
    await exportScope("all", "gif");
    await pressKey("a", ["control"]);
    assert.equal(await selectedCount(), 5, "Ctrl+A selects the entire timeline");
    await mouseClick("#export-format");
    await until(() => evaluate(`document.querySelector('#export-format').matches(':open')`), "open readable export menu");
    if (process.env.FRAMELINE_EXPORT_SCREENSHOT) {
      await paintFrame();
      fs.writeFileSync(process.env.FRAMELINE_EXPORT_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
    }
    window.webContents.sendInputEvent({type:"keyDown", keyCode:"Escape"});
    window.webContents.sendInputEvent({type:"keyUp", keyCode:"Escape"});
    await until(() => evaluate(`!document.querySelector('#export-format').matches(':open')`), "cancel export menu");
    await click("#new-project");
    await answerMessage("cancel");
    assert.equal(await evaluate(`document.querySelector('#project-name').value`), "Walk cycle", "Cancel New keeps the existing project");
    assert.equal(await loopValue("end"), 36);
    await click("#new-project");
    await answerMessage("discard");
    await until(() => evaluate(`document.querySelector('#frame-count').textContent === '0 / 0'`), "New creates an empty project");
    assert.equal(await evaluate(`document.querySelector('#project-name').value`), "Untitled project");
    assert.equal(await evaluate(`document.querySelector('#undo').disabled && document.querySelector('#redo').disabled`), true, "New starts a fresh edit history");
    assert.equal(await evaluate(`document.querySelector('#loop-start').hidden && document.querySelector('#loop-end').hidden`), true);
    await click("#new-project");
    await paintFrame();
    assert.equal(await evaluate(`document.querySelector('#message-dialog').open`), false, "New on an unedited project needs no discard prompt");

    assert.equal(await evaluate(`getComputedStyle(document.querySelector('#preview-stage')).backgroundImage.includes('linear-gradient')`), true);
    await click('#preview-background-toggle');
    assert.equal(await evaluate(`document.querySelector('#preview-background-popover').hidden`), false);
    await evaluate(`document.querySelector('#preview-background-color').value = '#315577'; document.querySelector('#preview-background-color').dispatchEvent(new Event('input'));`);
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('#preview-stage')).backgroundColor`), 'rgb(49, 85, 119)');
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('#preview-stage')).backgroundImage`), 'none');
    assert.equal(await evaluate(`document.querySelector('#undo').disabled`), true, 'preview color does not edit the project');
    await until(() => evaluate(`JSON.parse(localStorage.getItem('frameline.preferences')).previewBackgroundColor === '#315577'`), 'preview background preference is saved');
    await click('#preview-background-transparent');
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('#preview-stage')).backgroundImage.includes('linear-gradient')`), true);
    await click('#preview-background-transparent');
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('#preview-stage')).backgroundColor`), 'rgb(49, 85, 119)', 'returning to color keeps the chosen swatch');
    await evaluate(`document.querySelector('#preview-background-toggle').dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));`);
    assert.equal(await evaluate(`document.querySelector('#preview-background-popover').hidden`), true);

    media = [wide, tall];
    await importMedia();
    await until(() => evaluate(`document.querySelector('#image-count').textContent === '2 images'`), 'padding test images imported');
    await seekCropImage(0);
    if (!await evaluate(`document.querySelector('#preview-tool-crop').classList.contains('selected')`)) await click('#preview-tool-crop');
    assert.equal(await evaluate(`document.querySelector('#preview-tool-crop').classList.contains('selected')`), true, 'Crop is selected before editing');
    await evaluate(`document.querySelector('#preview-crop-scope').value = 'current';`);
    await editCropFields({x:8, y:2, width:40, height:10});
    await click('#preview-crop-apply');
    await click('#preview-tool-padding');
    assert.equal(await evaluate(`document.querySelector('#preview-tool-padding').classList.contains('selected')`), true, 'Padding is selected before editing');
    assert.equal(await evaluate(`document.querySelector('#preview-image-wrap').classList.contains('padding-preview')`), false, 'entering padding alone does not start an edit');
    await click('#preview-padding-lock');
    await click('#preview-padding-lock');
    assert.equal(await evaluate(`document.querySelector('#preview-image-wrap').classList.contains('padding-preview')`), false, 'relocking equal values does not start an edit');
    const editPaddingFields = async values => {
      await enableTool();
      return evaluate(`(() => {
      for (const [side, value] of Object.entries(${JSON.stringify(values)})) {
        const field = document.querySelector('#preview-padding-' + side);
        field.value = value; field.dispatchEvent(new Event('input')); field.dispatchEvent(new Event('change'));
      }
    })()`);
    };
    const paddingFields = () => evaluate(`Object.fromEntries([...document.querySelectorAll('[data-padding-field]')].map(field => [field.dataset.paddingField, Number(field.value)]))`);
    await editPaddingFields({left:5});
    assert.deepEqual(await paddingFields(), {top:5, bottom:5, left:5, right:5}, 'locked padding updates all sides');
    await until(() => evaluate(`document.querySelector('#preview-resolution').textContent === '50 × 20'`), 'live padding preview uses the cropped image');
    assert.equal(await evaluate(`document.querySelector('#preview-image').src`), pathToFileURL(wide).href, 'padding preview leaves the working asset untouched');
    await editPaddingFields({right:8});
    assert.deepEqual(await paddingFields(), {top:8, bottom:8, left:8, right:8});
    await until(() => evaluate(`document.querySelector('#preview-resolution').textContent === '56 × 26'`), 'new padding preview replaces the prior preview');
    await click('#preview-padding-lock');
    await editPaddingFields({left:4, top:6, right:2, bottom:3});
    await until(() => evaluate(`document.querySelector('#preview-resolution').textContent === '46 × 19'`), 'unlocked sides preview independently');
    await click('#preview-padding-lock');
    assert.deepEqual(await paddingFields(), {top:3, bottom:3, left:3, right:3}, 'relocking takes the last edited side');
    await click('#preview-padding-lock');
    await editPaddingFields({left:4, top:6, right:2, bottom:3});
    await until(() => evaluate(`document.querySelector('#preview-resolution').textContent === '46 × 19'`), 'independent sides restored');
    await settingsKeepDraft(`document.querySelector('#preview-padding-canvas').toDataURL()`, 'live padding preview');
    assert.equal(await evaluate(`document.querySelector('#preview-tool-enabled').checked && document.querySelector('#preview-image-wrap').classList.contains('padding-preview')`), true, 'settings keep padding active');
    const savesBeforePaddingDraft = saves;
    await click('#save-project'); await answerMessage('cancel');
    assert.equal(saves, savesBeforePaddingDraft, 'pending padding cannot be silently omitted from a save');
    if (process.env.FRAMELINE_PADDING_DRAFT_SCREENSHOT) {
      await paintFrame();
      fs.writeFileSync(process.env.FRAMELINE_PADDING_DRAFT_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
    }
    await click('#preview-tool-hand'); await answerMessage('cancel');
    assert.equal(await evaluate(`document.querySelector('#preview-tool-padding').classList.contains('selected')`), true);
    assert.equal(await evaluate(`document.querySelector('#preview-image-wrap').classList.contains('padding-preview')`), true);
    await click('#preview-tool-hand'); await answerMessage('discard');
    assert.equal(await evaluate(`document.querySelector('#preview-image-wrap').classList.contains('padding-preview')`), false);
    assert.equal(await evaluate(`document.querySelector('#preview-resolution').textContent`), '64 × 16', 'Discard restores the cropped asset and its original canvas');
    await click('#preview-tool-padding');
    assert.equal(await evaluate(`document.querySelector('#preview-resolution').textContent`), '64 × 16', 'returning after Discard retains the unpadded image');
    assert.equal(await evaluate(`document.querySelector('#preview-image-wrap').classList.contains('padding-preview')`), false, 'returning does not recreate discarded padding');
    await click('#preview-tool-hand');
    await paintFrame();
    assert.equal(await evaluate(`document.querySelector('#message-dialog').open`), false, 'leaving untouched padding needs no Apply/Discard prompt');
    assert.equal(await evaluate(`document.querySelector('#preview-tool-hand').classList.contains('selected')`), true);
    await click('#preview-tool-padding');
    await editPaddingFields({left:4, top:6, right:2, bottom:3});
    await until(() => evaluate(`document.querySelector('#preview-resolution').textContent === '46 × 19'`), 'editing padding again starts a fresh preview');
    const pendingPaddingPixels = await evaluate(`document.querySelector('#preview-padding-canvas').toDataURL()`);
    await evaluate(`(() => {
      for (const [side, value] of Object.entries({left:4, top:6, right:2, bottom:3})) document.querySelector('#preview-padding-' + side).value = value;
    })()`);
    const applyPadding = async (scope, leave = false) => {
      await evaluate(`document.querySelector('#preview-padding-scope').value = '${scope}';`);
      if (leave) { await click('#preview-tool-hand'); await answerMessage('apply'); }
      else await click('#preview-padding-apply');
      await until(() => evaluate(`!document.querySelector('#operation-progress-dialog').open && !document.querySelector('#preview-tool-enabled').checked
        || !document.querySelector('#operation-progress-dialog').open && document.querySelector('#preview-tool-hand').classList.contains('selected')`), 'padding operation completed');
      await paintFrame();
    };
    await applyPadding('current');
    assert.equal(await evaluate(`!document.querySelector('#preview-tool-enabled').checked && !document.querySelector('#preview-image-wrap').classList.contains('padding-preview')`), true, 'Padding Apply commits and turns preview off');
    const committedPaddingPath = await evaluate(`document.querySelector('#preview-image').src`);
    await enableTool();
    await until(() => evaluate(`document.querySelector('#preview-image-wrap').classList.contains('padding-preview')`), 'Enable previews a new padding edit after Apply');
    await click('#preview-tool-enabled');
    assert.equal(await evaluate(`!document.querySelector('#preview-tool-enabled').checked && !document.querySelector('#preview-image-wrap').classList.contains('padding-preview') && !document.querySelector('#message-dialog').open`), true, 'unchecking Padding discards only the new preview');
    assert.equal(await evaluate(`document.querySelector('#preview-image').src`), committedPaddingPath, 'unchecking keeps the already applied padding');
    assert.equal(await evaluate(`document.querySelector('#preview-resolution').textContent`), '46 × 19', 'padding uses the cropped working image');
    assert.equal(await evaluate(`(async () => {
      const image = document.querySelector('#preview-image'); await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      canvas.getContext('2d').drawImage(image, 0, 0); return canvas.toDataURL();
    })()`), pendingPaddingPixels, 'applied padding exactly matches its live preview');
    assert.deepEqual(await evaluate(`(async () => {
      const image = document.querySelector('#preview-image'); await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
      return [Array.from(context.getImageData(0, 0, 1, 1).data), Array.from(context.getImageData(4, 6, 1, 1).data)];
    })()`), [[0,0,0,0], [255,255,0,255]], 'padding is transparent with the original pixels at the chosen offset');
    await click('#preview-tool-hand');
    await click('#preview-tool-padding');
    assert.equal(await evaluate(`document.querySelector('#preview-resolution').textContent`), '46 × 19', 'returning after Apply does not add padding again');
    assert.equal(await evaluate(`document.querySelector('#preview-image-wrap').classList.contains('padding-preview')`), false);
    if (process.env.FRAMELINE_PADDING_SCREENSHOT) {
      await click('#preview-background-toggle');
      await paintFrame();
      fs.writeFileSync(process.env.FRAMELINE_PADDING_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
      await click('#preview-background-toggle');
    }
    await click('#undo');
    await click('#preview-tool-crop');
    assert.deepEqual(await cropFields(), {x:8, y:2, width:40, height:10}, 'undo padding restores the editable crop');
    await click('#redo');
    assert.equal(await evaluate(`document.querySelector('#preview-resolution').textContent`), '46 × 19');
    await seekCropImage(24);
    assert.equal(await evaluate(`document.querySelector('#preview-resolution').textContent`), '16 × 64', 'current-only padding retains other images');
    await seekCropImage(0);
    await click('#preview-clear-effects'); await answerMessage('clear', 'current');
    assert.equal(await evaluate(`document.querySelector('#preview-resolution').textContent`), '64 × 16', 'Clear returns to the imported original');
    await click('#preview-tool-padding');
    await editPaddingFields({left:4, top:6, right:2, bottom:3});
    await until(() => evaluate(`document.querySelector('#preview-resolution').textContent === '70 × 25'`), 'editing prepares the all-image padding draft');
    await applyPadding('all', true);
    assert.equal(await evaluate(`document.querySelector('#preview-resolution').textContent`), '70 × 25');
    await seekCropImage(24);
    assert.equal(await evaluate(`document.querySelector('#preview-resolution').textContent`), '22 × 73');
    await click('#save-project');
    await until(() => Promise.resolve(savedProject.images.length === 2 && savedProject.images[1].width === 22), 'saved project includes padded assets');
    assert.deepEqual(savedProject.images.map(image => [image.originalPath, image.width, image.height]), [[wide,70,25], [tall,22,73]]);
    assert(savedProject.images.every(image => fs.existsSync(image.path)), 'saved padding results exist on disk');
    await click('#undo');
    assert.equal(await evaluate(`document.querySelector('#preview-resolution').textContent`), '16 × 64');
    await seekCropImage(0);
    assert.equal(await evaluate(`document.querySelector('#preview-resolution').textContent`), '64 × 16', 'one undo restores all images');
    await click('#redo');
    await click('#preview-clear-effects'); await answerMessage('clear', 'all');
    await seekCropImage(24);
    assert.equal(await evaluate(`document.querySelector('#preview-resolution').textContent`), '16 × 64', 'Clear all restores every original');
    await click('#preview-remove-background');
    await until(() => evaluate(`document.querySelector('#background-dialog').open`), 'all-image edge smoothing dialog');
    await click('#background-edge-smoothing-enabled');
    await click('#background-fringe-enabled');
    await evaluate(`document.querySelector('#background-edge-smoothing-amount').value = '89'; document.querySelector('#background-edge-smoothing-amount').dispatchEvent(new Event('input'));`);
    await click('#background-set-default');
    const backgroundCount = backgroundApplyRequests.length;
    await mouseClick('#background-apply-all');
    await until(() => backgroundApplyRequests.length === backgroundCount + 2, 'anti-aliasing applies to both images');
    await until(() => evaluate(`!document.querySelector('#operation-progress-dialog').open && !document.querySelector('#preview-remove-background').disabled`), 'all-image removal completes');
    assert(backgroundApplyRequests.slice(backgroundCount).every(request => request.edge_smoothing === 89 && request.softness === 0), 'all images receive the same anti-aliasing settings');
    assert(backgroundApplyRequests.slice(backgroundCount).every(request => JSON.stringify(request.fringe_cleanup) === JSON.stringify(fringePreviewOptions)), 'all images receive the same local color cleanup options');
    assert.deepEqual(await evaluate(`(() => {
      const options = JSON.parse(localStorage.getItem('frameline.background.defaults'));
      return [options.edge_smoothing_enabled, options.edge_smoothing, options.softness, options.softness_enabled];
    })()`), [true, 89, 4, true], 'defaults preserve enabled smoothing and optional blur amount');
    await evaluate(`localStorage.removeItem('frameline.background.last')`);
    await click('#preview-remove-background');
    await until(() => evaluate(`document.querySelector('#background-dialog').open`), 'restore anti-aliasing defaults');
    assert.equal(await evaluate(`document.querySelector('#background-edge-smoothing-enabled').checked && document.querySelector('#background-edge-smoothing-amount').value === '89' && document.querySelector('#background-softness').disabled`), true);
    assert.equal(await evaluate(`document.querySelector('#background-fringe-enabled').checked && document.querySelector('#background-fringe-strength').value === '80' && document.querySelector('#background-fringe-color-mode').value === 'custom'`), true, 'saved defaults restore color cleanup');
    await click('#background-cancel');
    await until(() => evaluate(`!document.querySelector('#preview-remove-background').disabled`), 'defaults dialog cleanup');
    await until(() => evaluate(`JSON.parse(localStorage.getItem('frameline.preferences')).previewBackgroundTransparent === false`), 'solid preview preference persists');
    await evaluate(`(() => {const preferences = JSON.parse(localStorage.getItem('frameline.preferences')); preferences.previewTool = 'padding'; localStorage.setItem('frameline.preferences', JSON.stringify(preferences)); })()`);
    await evaluate(`window.location.reload()`);
    await until(() => evaluate(`document.querySelector('#preview-stage')?.classList.contains('solid-background') === true`), 'preview color restored on launch');
    assert.equal(await evaluate(`document.querySelector('#preview-background-color').value`), '#315577');
    assert.equal(await evaluate(`document.querySelector('#preview-tool-hand').classList.contains('selected') && document.querySelector('#preview-feature-enable').hidden`), true, 'old saved tool preferences cannot override startup Hand');
    await click('#preview-background-transparent');
    await until(() => evaluate(`JSON.parse(localStorage.getItem('frameline.preferences')).previewBackgroundTransparent === true`), 'transparent preview preference persists');
    await evaluate(`window.location.reload()`);
    await until(() => evaluate(`document.querySelector('#preview-stage') && !document.querySelector('#preview-stage').classList.contains('solid-background')`), 'transparent preview restored on launch');
    media = [healingImage];
    await importMedia();
    await until(() => evaluate(`document.querySelector('#preview-image').naturalWidth === 32 && document.querySelector('#preview-image').src === ${JSON.stringify(pathToFileURL(healingImage).href)}`), 'healing mixture loaded');
    await click('#preview-tool-healing');
    assert.equal(await evaluate(`document.querySelector('#preview-feature-enable').hidden && !document.querySelector('#preview-healing-controls').hidden && !document.querySelector('#preview-brush-size').disabled && document.querySelector('#preview-brush-color-field').hidden`), true, 'Healing works directly with its own two colors');
    await evaluate(`
      for (const [id, value] of [['keep','#000000'], ['remove','#04f404'], ['tolerance','1'], ['strength','100']]) {
        const control = document.querySelector('#preview-healing-' + id); control.value = value; control.dispatchEvent(new Event('input'));
      }
      document.querySelector('#preview-brush-size').value = '5';
      document.querySelector('#preview-brush-feather').value = '0';
      document.querySelector('#preview-brush-antialias').checked = false;
      document.querySelector('#preview-brush-antialias').dispatchEvent(new Event('change'));
      document.querySelector('#preview-square-brush').checked = true;
      document.querySelector('#preview-square-brush').dispatchEvent(new Event('change'));
    `);
    const healingPositions = await evaluate(`(() => {
      const bounds = document.querySelector('#preview-image-wrap').getBoundingClientRect();
      return [.2,.5,.8].map(x => ({x:Math.round(bounds.left + bounds.width*x), y:Math.round(bounds.top + bounds.height*.5)}));
    })()`);
    const drawHealing = async (positions = healingPositions) => {
      if (await evaluate(`document.querySelector('#preview-healing-auto').checked`)) {
        await until(() => evaluate(`!document.querySelector('#preview-healing-auto-status').textContent.startsWith('Reading')`), 'original border reference ready');
      }
      window.webContents.sendInputEvent({type:'mouseDown', ...positions[0], button:'left', clickCount:1});
      for (const position of positions.slice(1)) {
        window.webContents.sendInputEvent({type:'mouseMove', ...position, button:'left'});
        await paintFrame();
      }
      await paintFrame();
      const held = await evaluate(`document.querySelector('#preview-paint-canvas').toDataURL()`);
      window.webContents.sendInputEvent({type:'mouseUp', ...positions.at(-1), button:'left', clickCount:1});
      await paintFrame();
      assert.equal(await evaluate(`document.querySelector('#preview-paint-canvas').toDataURL()`), held, 'healing preview stays identical on mouse release');
      return held;
    };
    const healingPixel = () => evaluate(`Array.from(document.querySelector('#preview-paint-canvas').getContext('2d').getImageData(16,16,1,1).data)`);
    await drawHealing();
    assert.deepEqual(await healingPixel(), [0,0,0,77], 'green mixture becomes black at about 30% opacity');
    assert.deepEqual(await evaluate(`Array.from(document.querySelector('#preview-paint-canvas').getContext('2d').getImageData(0,0,1,1).data)`), [3,170,3,255], 'healing affects only the brush area');
    await click('#preview-paint-discard');
    assert.equal(await evaluate(`document.querySelector('#preview-paint-canvas').hidden && !document.querySelector('#preview-image-wrap').classList.contains('paint-erases-image')`), true, 'Discard restores the imported image');
    const healedPixels = await drawHealing();
    await click('#preview-paint-apply');
    assert.equal(await evaluate(`document.querySelector('#preview-paint-canvas').toDataURL()`), healedPixels);
    await click('#undo');
    assert.equal(await evaluate(`document.querySelector('#preview-paint-canvas').hidden`), true, 'undo restores unhealed pixels');
    await click('#redo');
    assert.equal(await evaluate(`document.querySelector('#preview-paint-canvas').toDataURL()`), healedPixels, 'redo restores the same healing result');
    assert.equal(await drawHealing(), healedPixels, 'a second full-strength healing stroke keeps existing transparency');
    await click('#preview-paint-apply');
    const roundHealingPositions = await evaluate(`(() => {
      const bounds = document.querySelector('#preview-image-wrap').getBoundingClientRect();
      return [.2,.5,.8].map(x => ({x:Math.round(bounds.left + bounds.width*x), y:Math.round(bounds.top + bounds.height*.25)}));
    })()`);
    for (const settings of [{feather:0, strength:100}, {feather:40, strength:70}]) {
      await evaluate(`
        document.querySelector('#preview-square-brush').checked = false;
        document.querySelector('#preview-brush-feather').value = '${settings.feather}';
        document.querySelector('#preview-healing-strength').value = '${settings.strength}';
      `);
      assert.notEqual(await drawHealing(roundHealingPositions), healedPixels, 'round/feathered healing edits the unhealed area');
      await click('#preview-paint-discard');
      assert.equal(await evaluate(`document.querySelector('#preview-paint-canvas').toDataURL()`), healedPixels, 'Discard restores committed healing after round/feathered edits');
    }
    await evaluate(`document.querySelector('#preview-brush-feather').value = '0'; document.querySelector('#preview-healing-strength').value = '100'; document.querySelector('#preview-healing-strength').dispatchEvent(new Event('input'));`);
    await click('#save-project');
    assert(savedProject.images[0].paintStrokes.every(stroke => stroke.tool === 'healing' && stroke.color === '#000000' && stroke.backgroundColor === '#04f404' && stroke.tolerance === 1), 'save includes healing strokes and both colors');
    if (process.env.FRAMELINE_HEALING_SCREENSHOT) {
      await paintFrame();
      fs.writeFileSync(process.env.FRAMELINE_HEALING_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
    }
    await evaluate(`document.querySelector('#preview-healing-remove').value = '#000000'; document.querySelector('#preview-healing-remove').dispatchEvent(new Event('input'));`);
    assert.equal(await evaluate(`document.querySelector('#preview-healing-error').hidden`), false, 'ambiguous same-color mixture shows a themed inline error');
    assert.equal(await drawHealing(), healedPixels, 'invalid equal colors do not edit pixels');
    await evaluate(`document.querySelector('#preview-healing-remove').value = '#04f404'; document.querySelector('#preview-healing-remove').dispatchEvent(new Event('input'));`);
    await until(() => evaluate(`JSON.parse(localStorage.getItem('frameline.preferences')).healingRemove === '#04f404'`), 'healing preferences saved');
    await evaluate(`window.location.reload()`);
    await until(() => evaluate(`document.querySelector('#preview-tool-hand')?.classList.contains('selected')`), 'healing preferences retain startup Hand');
    assert.equal(await evaluate(`document.querySelector('#preview-healing-keep').value === '#000000' && document.querySelector('#preview-healing-remove').value === '#04f404' && document.querySelector('#preview-healing-tolerance').value === '1'`), true, 'healing settings restore on launch');
    media = [autoHealingGreen, autoHealingBlue, autoHealingEmpty, autoHealingPurple];
    await importMedia();
    await until(() => evaluate(`document.querySelector('#preview-image').src === ${JSON.stringify(pathToFileURL(autoHealingGreen).href)} && document.querySelector('#preview-image').naturalWidth === 32`), 'auto healing fixture loaded');
    await click('#preview-tool-healing');
    await evaluate(`
      document.querySelector('#preview-healing-remove').value = '#112233';
      document.querySelector('#preview-healing-remove').dispatchEvent(new Event('input'));
      document.querySelector('#preview-brush-size').value = '5';
      document.querySelector('#preview-brush-feather').value = '0';
      document.querySelector('#preview-square-brush').checked = true;
    `);
    await click('#preview-healing-auto');
    const detected = color => until(() => evaluate(`document.querySelector('#preview-healing-remove').value === '${color}' && document.querySelector('#preview-healing-auto-status').textContent.startsWith('Detected')`), `auto detect ${color}`);
    await until(() => evaluate(`document.querySelector('#preview-healing-auto-status').textContent.startsWith('Click')`), 'original border sampled before brush click');
    assert.equal(await evaluate(`document.querySelector('#preview-healing-remove').value === '#112233'`), true, 'border sampling does not change Remove color before a brush click');
    const autoPositions = await evaluate(`(() => {const b = document.querySelector('#preview-image-wrap').getBoundingClientRect(); return [.2,.5,.8].map(x => ({x:Math.round(b.left+b.width*x),y:Math.round(b.top+b.height*.5)}));})()`);
    await drawHealing([autoPositions[1]]);
    await detected('#04f404');
    assert.deepEqual(await healingPixel(), [0,0,0,77], 'a small brush on a mixed edge uses the original background and recovers opacity');
    await click('#preview-paint-discard');
    await evaluate(`document.querySelector('#preview-brush-size').value='29';document.querySelector('#preview-brush-size').dispatchEvent(new Event('input'));`);
    await drawHealing([autoPositions[1]]);
    await detected('#04f404');
    assert.deepEqual(await healingPixel(), [0,0,0,77], 'a larger brush detects the dominant green within its larger footprint');
    await click('#preview-paint-discard');
    await evaluate(`document.querySelector('#preview-brush-size').value='5';document.querySelector('#preview-brush-size').dispatchEvent(new Event('input'));`);
    await drawHealing(autoPositions);
    await detected('#04f404');
    assert.equal(await evaluate(`document.querySelector('#preview-healing-remove').disabled && document.querySelector('#preview-healing-auto-status').textContent.includes('brush area')`), true);
    assert.deepEqual(await healingPixel(), [0,0,0,77], 'a stroke starting in green keeps that color while dragging through the mixture');
    const pendingAutoPixels = await evaluate(`document.querySelector('#preview-paint-canvas').toDataURL()`);
    await evaluate(`document.querySelector('#preview-brush-size').value='1';document.querySelector('#preview-brush-size').dispatchEvent(new Event('input'));`);
    assert.equal(await drawHealing([autoPositions[1]]), pendingAutoPixels, 'detection samples the pending cleaned pixels and cannot reuse the original green');
    assert.equal(await evaluate(`document.querySelector('#preview-healing-auto-status').textContent.includes('No clear unwanted color')`), true);
    await evaluate(`document.querySelector('#preview-brush-size').value='5';document.querySelector('#preview-brush-size').dispatchEvent(new Event('input'));`);
    await click('#preview-paint-apply');
    await click('#save-project');
    assert.equal(savedProject.images[0].paintStrokes[0].backgroundColor, '#04f404', 'saved auto stroke captures the actual detected color');
    const seekAutoImage = async index => {
      const frame = savedProject.clips.slice(0,index).reduce((sum,clip) => sum + clip.durationFrames,0);
      await evaluate(`(() => {const b=document.querySelector('#timeline-content').getBoundingClientRect(); const zoom=Number(document.querySelector('#zoom-slider').value)/100; document.querySelector('#ruler').dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:b.left+${frame}*4*zoom+1}));})()`);
      await paintFrame();
    };
    await seekAutoImage(1);
    await drawHealing(autoPositions);
    await detected('#2846f0');
    assert.deepEqual(await healingPixel(), [0,0,0,102], 'new frame uses its own blue background rather than the previous detected green');
    await click('#preview-paint-apply');
    await click('#preview-healing-auto');
    assert.equal(await evaluate(`document.querySelector('#preview-healing-remove').value === '#112233' && !document.querySelector('#preview-healing-remove').disabled && document.querySelector('#preview-healing-auto-controls').hidden`), true, 'manual mode restores the original manual color');
    await click('#preview-healing-auto');
    await seekAutoImage(2);
    const beforeFailedDetection = await evaluate(`document.querySelector('#preview-paint-canvas').toDataURL()`);
    assert.equal(await drawHealing(autoPositions), beforeFailedDetection, 'Keep-only area cannot paint with an old detected color');
    assert.equal(await evaluate(`document.querySelector('#preview-healing-auto-status').textContent.includes('No clear unwanted color inside this brush area')`), true, 'local failure shows a manual-choice hint');
    await seekAutoImage(0);
    await click('#preview-tool-crop');
    await editCropFields({x:8,y:8,width:16,height:16});
    await evaluate(`document.querySelector('#preview-crop-scope').value = 'current';`);
    await click('#preview-crop-apply');
    await click('#preview-tool-healing');
    const croppedPosition = await evaluate(`(() => {const b=document.querySelector('#preview-image-wrap').getBoundingClientRect();return {x:Math.round(b.left+b.width*.5),y:Math.round(b.top+b.height*.375)};})()`);
    await drawHealing([croppedPosition]);
    await detected('#04f404');
    await click('#preview-paint-discard');
    await click('#preview-tool-padding');
    await editPaddingFields({left:4,top:4,right:4,bottom:4});
    await applyPadding('current');
    await click('#preview-tool-healing');
    const paddedPosition = await evaluate(`(() => {const b=document.querySelector('#preview-image-wrap').getBoundingClientRect();return {x:Math.round(b.left+b.width*.5),y:Math.round(b.top+b.height*.3)};})()`);
    await drawHealing([paddedPosition]);
    await detected('#04f404');
    assert.equal(await evaluate(`document.querySelector('#preview-healing-auto-status').textContent.includes('brush area')`), true, 'cropped/padded images use current pixels with the preserved original background reference');
    await click('#preview-paint-discard');
    await seekAutoImage(3);
    const purplePosition = await evaluate(`(() => {const b=document.querySelector('#preview-image-wrap').getBoundingClientRect();return {x:Math.round(b.left+b.width*.5),y:Math.round(b.top+b.height*.5)};})()`);
    await drawHealing([purplePosition]);
    await detected('#b46ef0');
    assert.equal(await evaluate(`document.querySelector('#preview-healing-auto-status').textContent.includes('nearest background shade')`), true, 'brightness fallback stays in the purple background color family');
    assert.equal((await healingPixel())[3], 0, 'a shifted background shade is cleaned using the detected endpoint');
    await click('#preview-paint-discard');
    if (process.env.FRAMELINE_HEALING_AUTO_SCREENSHOT) {
      await paintFrame();
      fs.writeFileSync(process.env.FRAMELINE_HEALING_AUTO_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
    }
    await until(() => evaluate(`(() => {const p=JSON.parse(localStorage.getItem('frameline.preferences'));return p.healingAuto === undefined && p.healingRemove === '#112233';})()`), 'auto preference preserves manual color separately');
    await evaluate(`const p=JSON.parse(localStorage.getItem('frameline.preferences'));p.healingAuto=true;localStorage.setItem('frameline.preferences',JSON.stringify(p));window.location.reload();`);
    await until(() => evaluate(`document.querySelector('#preview-tool-hand')?.classList.contains('selected')`), 'auto mode preserves startup Hand');
    assert.equal(await evaluate(`!document.querySelector('#preview-healing-auto').checked && document.querySelector('#preview-healing-remove').value === '#112233'`), true, 'Auto starts off even when legacy preferences enabled it');
    const refineFixture = path.join(temporary, 'colorful-cutout.png');
    const refineOther = path.join(temporary, 'colorful-cutout-2.png');
    const fixturePng = await evaluate(`(() => {
      const c=document.createElement('canvas'); c.width=64; c.height=40; const ctx=c.getContext('2d');
      ctx.fillStyle='#dc1e46'; ctx.fillRect(4,4,24,32);
      ctx.fillStyle='#1e50dc'; ctx.fillRect(36,4,24,32);
      ctx.clearRect(4,4,1,32);ctx.clearRect(59,4,1,32);
      ctx.fillStyle='rgba(245,245,245,.5)';ctx.fillRect(4,4,1,32);ctx.fillRect(59,4,1,32);
      ctx.fillStyle='white';ctx.fillRect(12,12,4,4);
      return c.toDataURL();
    })()`);
    fs.writeFileSync(refineFixture, Buffer.from(fixturePng.split(',')[1], 'base64'));
    fs.copyFileSync(refineFixture, refineOther);
    media = [refineFixture, refineOther];
    await importMedia();
    await until(() => evaluate(`document.querySelector('#preview-image').src === ${JSON.stringify(pathToFileURL(refineFixture).href)} && document.querySelector('#preview-image').naturalWidth === 64`), 'colorful refine fixture loaded');
    await click('#preview-tool-refine');
    assert.equal(await evaluate(`!document.querySelector('#preview-feature-enable').hidden && !document.querySelector('#preview-tool-enabled').checked && !document.querySelector('#preview-refine-controls').hidden && document.querySelector('#preview-refine-repair').disabled`), true, 'Refine Edges starts disabled with the existing Enable workflow');
    await enableTool();
    const editRefine = values => evaluate(`(() => {for(const [key,value] of Object.entries(${JSON.stringify(values)})){const f=document.querySelector('#preview-refine-'+key);f.value=value;f.dispatchEvent(new Event('input'));}})()`);
    const refineReady = () => until(() => evaluate(`document.querySelector('#preview-refine-status').textContent.startsWith('Preview ready') && !document.querySelector('#preview-refine-canvas').hidden`), 'refined preview ready');
    await editRefine({clean:0,repair:100,smooth:0,shrink:0,width:2});
    await refineReady();
    const refinedPixels = () => evaluate(`document.querySelector('#preview-refine-canvas').toDataURL()`);
    const refinedPreview = await refinedPixels();
    await settingsKeepDraft(`document.querySelector('#preview-refine-canvas').toDataURL()`, 'live Refine Edges preview');
    assert.equal(await evaluate(`document.querySelector('#preview-tool-enabled').checked && !document.querySelector('#preview-refine-canvas').hidden`), true, 'settings keep Refine Edges active');
    const savesBeforeRefineDraft = saves;
    await click('#save-project'); await answerMessage('cancel');
    assert.equal(saves, savesBeforeRefineDraft, 'saving cannot silently omit a pending refinement');
    const repairedColors = await evaluate(`(() => {const ctx=document.querySelector('#preview-refine-canvas').getContext('2d');return [[4,20],[59,20],[13,13]].map(([x,y])=>Array.from(ctx.getImageData(x,y,1,1).data));})()`);
    assert(repairedColors[0][0] > 210 && repairedColors[0][1] < 40 && repairedColors[0][3] === 128, 'left boundary uses red interior and preserves opacity');
    assert(repairedColors[1][2] > 210 && repairedColors[1][0] < 40 && repairedColors[1][3] === 128, 'right boundary uses blue interior and preserves opacity');
    assert.deepEqual(repairedColors[2], [255,255,255,255], 'white interior details stay unchanged');
    assert.equal(await evaluate(`document.querySelector('#preview-image').src`), pathToFileURL(refineFixture).href, 'live preview leaves the working image intact');
    await until(async () => discardedRefineOutputs.length > 0, 'preview output cleaned up after drawing');
    if (process.env.FRAMELINE_REFINE_SCREENSHOT) {
      await paintFrame();
      fs.writeFileSync(process.env.FRAMELINE_REFINE_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
    }
    await click('#preview-tool-hand'); await answerMessage('cancel');
    assert.equal(await evaluate(`document.querySelector('#preview-tool-refine').classList.contains('selected')`), true);
    await click('#preview-tool-hand'); await answerMessage('discard');
    assert.equal(await evaluate(`document.querySelector('#preview-refine-canvas').hidden && !document.querySelector('#preview-image-wrap').classList.contains('refine-preview')`), true);
    await click('#preview-tool-refine');
    assert.equal(await evaluate(`document.querySelector('#preview-tool-enabled').checked`), false, 'returning to Refine Edges does not reapply discarded changes');
    await enableTool();
    await refineReady();
    await click('#preview-refine-apply');
    await until(() => evaluate(`!document.querySelector('#operation-progress-dialog').open && !document.querySelector('#preview-tool-enabled').checked && document.querySelector('#preview-image').src !== ${JSON.stringify(pathToFileURL(refineFixture).href)}`), 'refined image committed');
    const committedRefine = await evaluate(`document.querySelector('#preview-image').src`);
    const committedRefinePixels = await evaluate(`(() => {const img=document.querySelector('#preview-image');const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;c.getContext('2d').drawImage(img,0,0);return c.toDataURL();})()`);
    assert.equal(committedRefinePixels, refinedPreview, 'applied pixels exactly match the live preview');
    await click('#save-project');
    assert.equal(savedProject.images[0].originalPath, refineFixture, 'saving refined images preserves the imported original');
    assert.equal(savedProject.images[1].path, refineOther, 'This image does not alter the other image');
    await click('#undo');
    assert.equal(await evaluate(`document.querySelector('#preview-image').src`), pathToFileURL(refineFixture).href);
    await click('#redo');
    assert.equal(await evaluate(`document.querySelector('#preview-image').src`), committedRefine);
    await enableTool();
    await editRefine({repair:50});
    await refineReady();
    await evaluate(`document.querySelector('#preview-refine-scope').value = 'all';`);
    await click('#preview-refine-apply');
    await until(() => evaluate(`!document.querySelector('#operation-progress-dialog').open && !document.querySelector('#preview-tool-enabled').checked`), 'refine all images completed');
    await click('#save-project');
    assert(savedProject.images.every(image => refineOutputs.has(image.path)), 'All images commits a separate refined output for each image');
    await click('#undo');
    await click('#save-project');
    assert.equal(savedProject.images[0].path, fileURLToPath(committedRefine));
    assert.equal(savedProject.images[1].path, refineOther, 'one undo restores the entire refinement batch');
    holdRefine = true;
    await enableTool();
    await until(async () => Boolean(releaseRefine), 'slow refine preview started');
    assert.equal(await evaluate(`document.querySelector('#preview-refine-progress').hidden`),false,'Refine always shows progress during processing');
    window.webContents.send('images:progress',{operationId:'unrelated',current:90,total:100,message:'Unrelated operation'});
    await paintFrame();
    assert.equal(await evaluate(`document.querySelector('#preview-refine-progress').hasAttribute('value')`),false,'unrelated processing cannot update this preview bar');
    window.webContents.send('images:progress',{operationId:lastRefineRequest.operationId,current:42,total:100,message:'Repairing edge colors…'});
    await until(() => evaluate(`document.querySelector('#preview-refine-progress').value===42 && document.querySelector('#preview-refine-status').textContent==='Repairing edge colors…'`),'correlated real progress appears in Refine');
    await evaluate(`document.querySelector('#speed-select').value='2';document.querySelector('#speed-select').dispatchEvent(new Event('change'));`);
    assert.equal(await evaluate(`document.querySelector('#preview-tool-enabled').checked`), true, 'a setting change preserves a preview still processing');
    releaseRefine(); releaseRefine = null;
    await refineReady();
    assert.equal(await evaluate(`document.querySelector('#preview-refine-progress').hidden`),true,'Refine progress hides when the latest preview is ready');
    await click('#preview-refine-discard');
    holdRefine = true;
    await enableTool();
    await until(async () => Boolean(releaseRefine), 'second slow refine preview started');
    await click('#preview-refine-discard');
    const beforeStale = discardedRefineOutputs.length;
    releaseRefine(); releaseRefine = null;
    await until(async () => discardedRefineOutputs.length > beforeStale, 'obsolete preview output discarded');
    assert.equal(await evaluate(`document.querySelector('#preview-refine-canvas').hidden && !document.querySelector('#preview-tool-enabled').checked && !document.querySelector('#preview-image-wrap').classList.contains('refine-preview')`), true, 'late results cannot restore discarded preview');
    await click('#preview-clear-effects'); await answerMessage('clear', 'all');
    await click('#save-project');
    assert.deepEqual(savedProject.images.map(image=>image.path), [refineFixture,refineOther], 'Clear restores both imported originals after refinement');
    await until(() => evaluate(`JSON.parse(localStorage.getItem('frameline.preferences')).refineEdges?.repair === 50`), 'refine settings saved');
    await evaluate(`window.location.reload()`);
    await until(() => evaluate(`document.querySelector('#preview-tool-hand')?.classList.contains('selected')`), 'refine settings preserve startup Hand');
    assert.equal(await evaluate(`document.querySelector('#preview-feature-enable').hidden`), true, 'Hand keeps feature Enable hidden on startup');
    assert.equal(await evaluate(`document.querySelector('#preview-refine-repair').value`), '50', 'refine controls restore saved settings');
    {
      const cleanFixture=path.join(temporary,'noisy-colorful.png'),cleanOther=path.join(temporary,'noisy-colorful-2.png');
      const png=await evaluate(`(() => {
        const c=document.createElement('canvas');c.width=64;c.height=48;const x=c.getContext('2d'),p=x.createImageData(64,48);
        for(let y=3;y<45;y++)for(let px=3;px<61;px++){const color=px<32?[180,40,70]:[30,100,220],i=(y*64+px)*4;for(let ch=0;ch<3;ch++)p.data[i+ch]=color[ch]+((px*7+y*11+ch*3)%15)-7;p.data[i+3]=px<32?128:255;}
        x.putImageData(p,0,0);x.fillStyle='rgba(0,240,0,.5)';x.clearRect(16,16,1,1);x.fillRect(16,16,1,1);x.fillStyle='white';x.fillRect(40,16,6,6);return c.toDataURL();
      })()`);
      fs.writeFileSync(cleanFixture,Buffer.from(png.split(',')[1],'base64'));fs.copyFileSync(cleanFixture,cleanOther);
      media=[cleanFixture,cleanOther];await importMedia();
      await until(()=>evaluate(`document.querySelector('#preview-image').src===${JSON.stringify(pathToFileURL(cleanFixture).href)} && document.querySelector('#preview-image').complete && document.querySelector('#preview-image').naturalWidth===64`),'noise fixture loaded');
      await click('#preview-tool-clean');
      assert.equal(await evaluate(`!document.querySelector('#preview-clean-controls').hidden && !document.querySelector('#preview-tool-enabled').checked && document.querySelector('#preview-clean-strength').disabled`),true,'Clean Pixels uses the opt-in Enable workflow');
      const editClean=values=>evaluate(`(() => {for(const [key,value] of Object.entries(${JSON.stringify(values)})){const field=document.querySelector('#preview-clean-'+key);field.value=value;field.dispatchEvent(new Event('input'));}})()`);
      const cleanReady=()=>until(()=>evaluate(`document.querySelector('#preview-clean-status').textContent.startsWith('Preview ready') && !document.querySelector('#preview-refine-canvas').hidden`),'Clean Pixels latest preview ready');
      const cleanPixels=()=>evaluate(`document.querySelector('#preview-refine-canvas').toDataURL()`);
      await enableTool();await editClean({strength:100,tolerance:32,radius:2,speckles:100});await cleanReady();
      const preview=await cleanPixels();
      assert.notEqual(preview,png,'cleanup changes noisy interior pixels');
      const sample=await evaluate(`(() => {const x=document.querySelector('#preview-refine-canvas').getContext('2d');return [[16,16],[45,30],[42,18],[0,0]].map(([px,y])=>Array.from(x.getImageData(px,y,1,1).data));})()`);
      assert(sample[0][0]>160 && sample[0][1]<60 && sample[0][3]===128,'speckle repair preserves the red local palette and alpha');
      assert(sample[1][2]>205 && sample[1][0]<45,'colorful regions retain their own palette');
      assert.deepEqual(sample[2],[255,255,255,255],'white interior features survive');assert.equal(sample[3][3],0);
      await settingsKeepDraft(`document.querySelector('#preview-refine-canvas').toDataURL()`,'Clean Pixels draft');
      await click('#preview-tool-hand');await answerMessage('cancel');
      assert.equal(await evaluate(`document.querySelector('#preview-tool-clean').classList.contains('selected')`),true);
      await click('#preview-tool-hand');await answerMessage('discard');
      assert.equal(await evaluate(`document.querySelector('#preview-refine-canvas').hidden`),true);
      await click('#preview-tool-clean');assert.equal(await evaluate(`document.querySelector('#preview-tool-enabled').checked`),false,'discarded cleanup does not reapply');
      await enableTool();await cleanReady();
      if(process.env.FRAMELINE_CLEAN_PIXELS_SCREENSHOT){await paintFrame();fs.writeFileSync(process.env.FRAMELINE_CLEAN_PIXELS_SCREENSHOT,(await window.webContents.capturePage()).toPNG());}
      await click('#preview-clean-apply');
      await until(()=>evaluate(`!document.querySelector('#operation-progress-dialog').open && !document.querySelector('#preview-tool-enabled').checked && document.querySelector('#preview-image').complete && document.querySelector('#preview-image').src!==${JSON.stringify(pathToFileURL(cleanFixture).href)}`),'Clean Pixels Apply finishes');
      const appliedUrl=await evaluate(`document.querySelector('#preview-image').src`);
      assert.equal(await evaluate(`(() => {const i=document.querySelector('#preview-image'),c=document.createElement('canvas');c.width=i.naturalWidth;c.height=i.naturalHeight;c.getContext('2d').drawImage(i,0,0);return c.toDataURL();})()`),preview,'Clean Pixels Apply matches preview exactly');
      await click('#save-project');assert.equal(savedProject.images[0].originalPath,cleanFixture);assert.equal(savedProject.images[1].path,cleanOther);
      await click('#undo');assert.equal(await evaluate(`document.querySelector('#preview-image').src`),pathToFileURL(cleanFixture).href);
      await click('#redo');assert.equal(await evaluate(`document.querySelector('#preview-image').src`),appliedUrl);
      await enableTool();await cleanReady();await evaluate(`document.querySelector('#preview-clean-scope').value='all'`);await click('#preview-clean-apply');
      await until(()=>evaluate(`!document.querySelector('#operation-progress-dialog').open && !document.querySelector('#preview-tool-enabled').checked`),'Clean Pixels batch finishes');
      await click('#save-project');assert(savedProject.images.every(image=>cleanOutputs.has(image.path)),'batch commits a cleaned result per image');
      await click('#undo');await click('#save-project');assert.equal(savedProject.images[0].path,fileURLToPath(appliedUrl));assert.equal(savedProject.images[1].path,cleanOther,'batch cleanup is one undo step');
      await click('#redo');await click('#preview-clear-effects');await answerMessage('clear','all');await click('#save-project');
      assert.deepEqual(savedProject.images.map(image=>image.path),[cleanFixture,cleanOther],'Clear restores imported originals after cleanup');
      holdClean=true;await enableTool();await until(()=>Boolean(releaseClean),'slow Clean Pixels preview');
      assert.equal(await evaluate(`document.querySelector('#preview-clean-progress').hidden`),false,'cleanup always shows processing progress');
      window.webContents.send('images:progress',{operationId:lastCleanRequest.operationId,current:37,total:100,message:'Cleaning pixels…'});
      await until(()=>evaluate(`document.querySelector('#preview-clean-progress').value===37`),'cleanup receives correlated progress');
      await editClean({radius:4});await click('#preview-clean-discard');const retired=discardedRefineOutputs.length;releaseClean();releaseClean=null;
      await until(()=>discardedRefineOutputs.length>retired,'obsolete cleanup preview discarded');
      assert.equal(await evaluate(`document.querySelector('#preview-refine-canvas').hidden && !document.querySelector('#preview-tool-enabled').checked`),true,'late result never restores a discarded cleanup');
      await until(()=>evaluate(`JSON.parse(localStorage.getItem('frameline.preferences')).cleanPixels?.radius===4`),'cleanup preferences saved');
      await window.webContents.reload();await until(()=>evaluate(`document.querySelector('#preview-tool-hand')?.classList.contains('selected')`),'cleanup preserves Hand on startup');
      assert.equal(await evaluate(`document.querySelector('#preview-clean-radius').value`),'4');
    }
    // Empty-image creation uses the same persistent PNG path as other edits.
    const openCreate = async (button = '#import-images') => {
      await click(button);
      await answerMessage('create');
      await until(() => evaluate(`document.querySelector('#create-image-dialog').open`), 'create images dialog');
    };
    const setCreate = async values => evaluate(`(() => {
      for (const [key, value] of Object.entries(${JSON.stringify(values)})) {
        const field = document.querySelector('#create-image-' + key);
        field.value = String(value); field.dispatchEvent(new Event('input', {bubbles:true}));
      }
    })()`);
    await openCreate('#empty-import');
    assert.deepEqual(await evaluate(`['width','height','count'].map(key=>document.querySelector('#create-image-'+key).value)`), ['1920','1080','1']);
    assert.equal(await evaluate(`document.querySelector('#create-image-transparent').checked`), true);
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('#create-image-preview')).borderTopWidth`), '0px', 'create dialog preview has no image outline');
    await pressKey('Escape');
    assert.equal(await evaluate(`document.querySelector('#image-count').textContent`), '0 images', 'cancel creates no assets');
    await openCreate();
    await evaluate(`const preset = document.querySelector('#create-image-preset'); preset.value='1'; preset.dispatchEvent(new Event('change', {bubbles:true}));`);
    assert.deepEqual(await evaluate(`['width','height'].map(key=>document.querySelector('#create-image-'+key).value)`), ['512','512']);
    await setCreate({width:24, height:0, count:2});
    await click('#create-image-start');
    assert.equal(await evaluate(`document.querySelector('#create-image-dialog').open && !document.querySelector('#create-image-error').hidden`), true, 'invalid dimensions stay in the themed form');
    await setCreate({height:18});
    assert.equal(await evaluate(`document.querySelector('#create-image-preset').value`), 'custom');
    if (process.env.FRAMELINE_CREATE_SCREENSHOT) {
      await paintFrame();
      fs.writeFileSync(process.env.FRAMELINE_CREATE_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
    }
    await click('#create-image-start');
    await until(() => evaluate(`document.querySelector('#image-count').textContent === '2 images' && !document.querySelector('#operation-progress-dialog').open`), 'created image batch');
    await click('#save-project');
    assert(savedProject.images.every(image => image.width === 24 && image.height === 18 && image.originalPath === image.path));
    assert(savedProject.clips.every(clip => clip.durationFrames === savedProject.defaultDurationFrames));
    const emptyPaths = savedProject.images.map(image => image.path);
    assert.deepEqual(savedProject.images.map(image=>image.name), ['Image 001','Image 002']);
    assert.notEqual(emptyPaths[0], emptyPaths[1], 'created images have independent PNG assets');
    const readCreatedPixel = file => evaluate(`new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{const c=document.createElement('canvas');c.width=c.height=1;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);resolve([...ctx.getImageData(0,0,1,1).data]);};img.onerror=reject;img.src=${JSON.stringify(pathToFileURL(file).href)};})`);
    assert.deepEqual(await readCreatedPixel(emptyPaths[0]), [0,0,0,0], 'transparent assets contain no opaque background');
    await click('#image-list .image-row:nth-child(2)');
    await until(() => evaluate(`document.querySelector('#preview-image').src === ${JSON.stringify(pathToFileURL(emptyPaths[1]).href)}`), 'import-list click activates second image');
    assert.equal(await evaluate(`document.querySelector('#image-list .image-row:nth-child(2)').classList.contains('active')`), true);
    await click('#preview-zoom-fit');
    await click('#preview-tool-brush');
    const canvasBounds = await evaluate(`(() => {const b=document.querySelector('#preview-image-wrap').getBoundingClientRect();const s=document.querySelector('#preview-stage').getBoundingClientRect();return {inside:{x:Math.round(b.left+b.width*.5),y:Math.round(b.top+b.height*.5)},outside:{x:Math.round(s.left+2),y:Math.round(s.top+2)}};})()`);
    const movePreview = async position => {
      window.webContents.sendInputEvent({type:'mouseMove', ...position});
      await paintFrame();
    };
    await movePreview(canvasBounds.inside);
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('#preview-stage')).cursor !== 'none' && !document.querySelector('#preview-brush-cursor').hidden`), true, 'visible pointer and tool outline on drawable canvas');
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('#preview-image-wrap'),'::before').backgroundImage !== 'none' && getComputedStyle(document.querySelector('#preview-image-wrap'),'::after').content === 'none'`), true, 'empty transparent images have a distinct checkerboard without a white outline');
    assert.equal(await evaluate(`(() => {const c=document.querySelector('#preview-image-wrap').getBoundingClientRect();const s=document.querySelector('#preview-stage').getBoundingClientRect();return c.left>s.left && c.right<s.right && c.top>s.top && c.bottom<s.bottom;})()`), true, 'created images fit with room on all four sides');
    if (process.env.FRAMELINE_EMPTY_PREVIEW_SCREENSHOT) {
      fs.writeFileSync(process.env.FRAMELINE_EMPTY_PREVIEW_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
    }
    await movePreview(canvasBounds.outside);
    assert.equal(await evaluate(`document.querySelector('#preview-brush-cursor').hidden`), true, 'tool boundary hides outside the canvas');
    const altWheel = async delta => {
      await evaluate(`(() => {const p=${JSON.stringify(canvasBounds.inside)};document.querySelector('#preview-stage').dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,altKey:true,clientX:p.x,clientY:p.y,deltaY:${delta}}));})()`);
      await paintFrame();
    };
    for (const tool of ['brush','eraser','healing']) {
      if (tool !== 'brush') await click('#preview-tool-'+tool);
      await evaluate(`document.querySelector('#preview-square-brush').checked=true;document.querySelector('#preview-brush-feather').value='35';document.querySelector('#preview-brush-feather').dispatchEvent(new Event('input'));`);
      await movePreview(canvasBounds.inside);
      assert.equal(await evaluate(`document.querySelector('#preview-brush-cursor').classList.contains('square')`), tool !== 'eraser', 'tool outline matches the selected shape even with feathering');
      await evaluate(`(() => {const field=document.querySelector('#preview-brush-size');field.value='12';field.dispatchEvent(new Event('input'));})()`);
      const viewport = await evaluate(`(() => {const s=document.querySelector('#preview-stage').style;return {zoom:s.getPropertyValue('--preview-zoom'),x:s.getPropertyValue('--preview-pan-x'),y:s.getPropertyValue('--preview-pan-y')};})()`);
      await altWheel(-100);
      assert.equal(await evaluate(`document.querySelector('#preview-brush-size').value`), '13', tool+' Alt-wheel up enlarges');
      await altWheel(100);
      assert.equal(await evaluate(`document.querySelector('#preview-brush-size').value`), '12', tool+' Alt-wheel down shrinks');
      await evaluate(`document.querySelector('#preview-brush-size').value='200'`);
      await altWheel(-100);
      assert.equal(await evaluate(`document.querySelector('#preview-brush-size').value`), '201', tool+' Alt-wheel crosses the former size limit');
      await evaluate(`{const field=document.querySelector('#preview-brush-size');field.value='4096';field.dispatchEvent(new Event('input'));}`);
      assert.equal(await evaluate(`document.querySelector('#preview-brush-size').value`),'4096',tool+' numeric size has no 200 px cap');
      assert.equal(await evaluate(`document.querySelector('#preview-brush-size').hasAttribute('max')`),false);
      assert.equal(await evaluate(`Number(document.querySelector('#preview-brush-size-slider').max)>=4096`),true,'slider expands for larger sizes');
      await altWheel(-100);
      assert.equal(await evaluate(`document.querySelector('#preview-brush-size').value`),'4097');
      await evaluate(`{const slider=document.querySelector('#preview-brush-size-slider');slider.value='300';slider.dispatchEvent(new Event('input'));}`);
      assert.equal(await evaluate(`document.querySelector('#preview-brush-size').value`),'300','slider updates the numeric brush size');
      const sliderLimit = await evaluate(`document.querySelector('#preview-brush-size-slider').max`);
      await evaluate(`{const slider=document.querySelector('#preview-brush-size-slider');slider.value='450';slider.dispatchEvent(new Event('input'));}`);
      assert.equal(await evaluate(`document.querySelector('#preview-brush-size-slider').max`),sliderLimit,'slider scale stays stable during a drag');
      await evaluate(`document.querySelector('#preview-brush-size').value='1'`);
      await altWheel(100);
      assert.equal(await evaluate(`document.querySelector('#preview-brush-size').value`), '1');
      assert.deepEqual(await evaluate(`(() => {const s=document.querySelector('#preview-stage').style;return {zoom:s.getPropertyValue('--preview-zoom'),x:s.getPropertyValue('--preview-pan-x'),y:s.getPropertyValue('--preview-pan-y')};})()`), viewport, 'Alt resize preserves zoom and pan');
    }
    await click('#preview-tool-hand');
    const panPreview = async (button, dx, dy = 0) => {
      const start = await evaluate(`(() => {const b=document.querySelector('#preview-stage').getBoundingClientRect();return {x:Math.round(b.left+b.width*.75),y:Math.round(b.top+b.height*.5)};})()`);
      window.webContents.sendInputEvent({type:'mouseDown',...start,button,clickCount:1});
      window.webContents.sendInputEvent({type:'mouseMove',x:start.x+dx,y:start.y+dy,button});
      await paintFrame();
      window.webContents.sendInputEvent({type:'mouseUp',x:start.x+dx,y:start.y+dy,button,clickCount:1});
      await paintFrame();
    };
    await panPreview('left',40,30);
    assert.deepEqual(await evaluate(`(() => {const s=document.querySelector('#preview-stage').style;return [s.getPropertyValue('--preview-pan-x'),s.getPropertyValue('--preview-pan-y')];})()`), ['40px','30px'], 'Hand pans freely even below 100% zoom');
    for(let index=0;index<4;index++) await click('#preview-zoom-in');
    await click('#preview-tool-brush');
    const panDistance=await evaluate(`Math.round(document.querySelector('#preview-stage').clientWidth*.5)`);
    for(let index=0;index<5;index++) await panPreview('right',-panDistance);
    assert.equal(await evaluate(`document.querySelector('#preview-image-wrap').getBoundingClientRect().right < document.querySelector('#preview-stage').getBoundingClientRect().left`), true, 'right dragging can move the whole image outside the viewport at high zoom');
    assert.equal(await evaluate(`document.querySelector('#preview-paint-canvas').hidden && document.querySelector('#preview-paint-apply').disabled`), true, 'right dragging with Brush selected pans without painting');
    await click('#preview-zoom-fit');
    assert.deepEqual(await evaluate(`(() => {const s=document.querySelector('#preview-stage').style;return [s.getPropertyValue('--preview-zoom'),s.getPropertyValue('--preview-pan-x'),s.getPropertyValue('--preview-pan-y')];})()`), ['0.9','0px','0px'], 'FIT brings an offscreen image back with a margin');
    await click('#preview-tool-hand');
    await click('#undo');
    assert.equal(await evaluate(`document.querySelector('#image-count').textContent`), '0 images', 'one undo removes the batch');
    await click('#redo');
    await click('#save-project');
    assert.deepEqual(savedProject.images.map(image=>image.path), emptyPaths, 'redo restores PNG assets');
    await openCreate();
    assert.deepEqual(await evaluate(`['width','height','count'].map(key=>document.querySelector('#create-image-'+key).value)`), ['24','18','1']);
    assert.equal(await evaluate(`document.querySelector('#create-image-transparent').checked && document.querySelector('#create-image-corners').children.length === 4`), true);
    await setCreate({color:'#1256ab'});
    assert.equal(await evaluate(`!document.querySelector('#create-image-transparent').checked && document.querySelector('#create-image-preview').classList.contains('solid-background')`), true, 'color selection previews a solid background');
    await click('#create-image-start');
    await until(() => evaluate(`document.querySelector('#image-count').textContent === '3 images'`), 'solid empty image created');
    await click('#save-project');
    assert.deepEqual(await readCreatedPixel(savedProject.images.at(-1).path), [18,86,171,255]);
    assert.equal(savedProject.images.at(-1).name, 'Image 003', 'numbering continues across creation batches');
    media = [red, tall];
    await importMedia();
    await until(() => evaluate(`document.querySelector('#image-count').textContent === '5 images'`), 'reference images imported');
    await openCreate();
    assert.deepEqual(await evaluate(`['width','height','count'].map(key=>document.querySelector('#create-image-'+key).value)`), ['16','64','1']);
    assert.deepEqual(await evaluate(`({color:document.querySelector('#create-image-color').value, transparent:document.querySelector('#create-image-transparent').checked})`), {color:'#00ffff', transparent:false}, 'background sampled from all four original corners');
    await click('#create-image-cancel');
    await click('#save-project');
    assert.equal(savedProject.images.length, 5, 'cancel preserves the existing project');
    validProjectOpen = true;
    await click('#preview-zoom-in');
    await click('#preview-zoom-in');
    await click('#open-project');
    await answerMessage('discard');
    await until(() => evaluate(`document.querySelector('#preview-zoom-label').textContent === '90.0%' && document.querySelector('#project-name').dataset.projectPath`), 'opened project fits its active image');
    assert.deepEqual(await evaluate(`(() => {const s=document.querySelector('#preview-stage').style;return [s.getPropertyValue('--preview-pan-x'),s.getPropertyValue('--preview-pan-y')];})()`), ['0px','0px']);
    assert.equal(await evaluate(`document.querySelector('#image-count').textContent`), '5 images', 'open restores created and imported image assets together');
    await click('#image-list .image-row:first-child');
    if (!await evaluate(`document.querySelector('#preview-tool-brush').classList.contains('selected')`)) await click('#preview-tool-brush');
    await evaluate(`
      document.querySelector('#preview-brush-color').value='#0000ff';
      document.querySelector('#preview-brush-color').dispatchEvent(new Event('input'));
      document.querySelector('#preview-brush-size').value='5';
      document.querySelector('#preview-brush-opacity').value='100';
      document.querySelector('#preview-brush-feather').value='0';
      document.querySelector('#preview-brush-antialias').checked=false;
      document.querySelector('#preview-square-brush').checked=false;
    `);
    const hardDotPosition=await evaluate(`(() => {const b=document.querySelector('#preview-image-wrap').getBoundingClientRect();return {x:Math.round(b.left+b.width*.5),y:Math.round(b.top+b.height*.5)};})()`);
    const hardDot=await drawHealing([hardDotPosition]);
    assert.equal(await evaluate(`(() => {const c=document.querySelector('#preview-paint-canvas');const data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;return Array.from(data).filter((_,i)=>i%4===3&&data[i]===255).length;})()`), 21, 'a size-five hard circle has the expected pixel footprint');
    assert.equal(await evaluate(`document.querySelector('#preview-image-wrap').classList.contains('pixel-perfect')`), true, 'zero-feather round pixels display without resampling blur when magnified');
    await click('#preview-paint-apply');
    assert.equal(await evaluate(`document.querySelector('#preview-paint-canvas').toDataURL()`), hardDot, 'Apply preserves the exact hard circle');
    const compareHardExport = async label => {
      await click('#save-project');
      const image=savedProject.images[0];
      refinePython ??= new PythonBridge();
      const output=path.join(temporary,`hard-round-${label}.png`);
      await refinePython.request('render_current_image',{path:image.path,paint_strokes:image.paintStrokes,output});
      const expected=await evaluate(`new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;c.getContext('2d').drawImage(img,0,0);resolve(c.toDataURL());};img.onerror=reject;img.src=${JSON.stringify(pathToFileURL(output).href)};})`);
      assert.equal(await evaluate(`document.querySelector('#preview-paint-canvas').toDataURL()`), expected, 'round '+label+' pixels match real Python export rendering');
    };
    await compareHardExport('opaque');
    await evaluate(`document.querySelector('#preview-brush-size').value='3';document.querySelector('#preview-brush-opacity').value='30';`);
    const partialPositions=await evaluate(`(() => {const b=document.querySelector('#preview-image-wrap').getBoundingClientRect();return [.2,.3,.2].map(x=>({x:Math.round(b.left+b.width*x),y:Math.round(b.top+b.height*.2)}));})()`);
    await drawHealing(partialPositions);
    assert.deepEqual(await evaluate(`(() => {const c=document.querySelector('#preview-paint-canvas');const data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;return [...new Set(Array.from(data).filter((_,i)=>i%4===3))].sort((a,b)=>a-b);})()`), [0,77,255], 'round stamp overlaps retain uniform 30% opacity');
    await click('#preview-paint-apply');
    await compareHardExport('partial');
    // Test the new controls against real Python exports, not just renderer
    // redraws. Clearing between cases keeps every edge visible on transparency.
    for (const antiAlias of [true,false]) for (const square of [false,true]) for (const feather of [0,40]) {
      await click('#preview-clear-effects'); await answerMessage('clear','current');
      await until(() => evaluate(`document.querySelector('#preview-paint-canvas').hidden`), 'clear restores the transparent original');
      await evaluate(`
        document.querySelector('#preview-brush-antialias').checked=${antiAlias};
        document.querySelector('#preview-brush-antialias').dispatchEvent(new Event('change'));
        document.querySelector('#preview-square-brush').checked=${square};
        document.querySelector('#preview-brush-size').value='5';
        document.querySelector('#preview-brush-opacity').value='30';
        document.querySelector('#preview-brush-feather').value='${feather}';
        document.querySelector('#preview-brush-feather').dispatchEvent(new Event('input'));
      `);
      const positions=await evaluate(`(() => {const b=document.querySelector('#preview-image-wrap').getBoundingClientRect();return [[.3,.3],[.65,.55],[.3,.3]].map(([x,y])=>({x:Math.round(b.left+b.width*x),y:Math.round(b.top+b.height*y)}));})()`);
      const painted=await drawHealing(positions);
      await click('#preview-paint-apply');
      assert.equal(await evaluate(`document.querySelector('#preview-paint-canvas').toDataURL()`),painted,'Apply preserves anti-aliasing and feather pixels');
      const label=`${antiAlias?'smooth':'pixel'}-${square?'square':'round'}-${feather}`;
      await compareHardExport(label);
      assert.equal(savedProject.images[0].paintStrokes[0].antiAlias,antiAlias,'project stores the rendering choice per stroke');
      if (!antiAlias && !feather) {
        assert.deepEqual(await evaluate(`(() => {const c=document.querySelector('#preview-paint-canvas');const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;return [...new Set(Array.from(d).filter((_,i)=>i%4===3))].sort((a,b)=>a-b);})()`),[0,77],'round and square pixel strokes have uniform opacity without overlap buildup');
      }
      await click('#preview-tool-eraser');
      await evaluate(`document.querySelector('#preview-brush-size').value='3';`);
      const erased=await drawHealing([positions[1]]);
      await click('#preview-paint-apply');
      assert.equal(await evaluate(`document.querySelector('#preview-paint-canvas').toDataURL()`),erased,'Apply preserves smooth and pixel eraser results');
      await compareHardExport(`${label}-eraser`);
      await click('#preview-tool-brush');
    }
    await until(() => evaluate(`JSON.parse(localStorage.getItem('frameline.preferences')).brushAntiAlias === false`), 'pixel preference is saved');
    await evaluate(`document.querySelector('#preview-brush-antialias').checked=true;document.querySelector('#preview-brush-antialias').dispatchEvent(new Event('change'));`);
    await until(() => evaluate(`JSON.parse(localStorage.getItem('frameline.preferences')).brushAntiAlias === true`), 'smooth preference is saved');
    // Verify the redesigned dialog and both apply scopes with actual Python
    // processing, including differently sized sampled-color batch frames.
    await click('#new-project'); await answerMessage('discard');
    const cleanupFiles=[];
    for (const [width,height] of [[64,48],[48,40]]) {
      const png=await evaluate(`(() => {const c=document.createElement('canvas');c.width=${width};c.height=${height};const x=c.getContext('2d');x.fillStyle='#04f404';x.fillRect(0,0,c.width,c.height);x.fillStyle='#03aa03';x.fillRect(4,4,c.width-8,c.height-8);x.fillStyle='#000000';x.fillRect(6,6,c.width-12,c.height-12);return c.toDataURL();})()`);
      const file=path.join(temporary,`cleanup-${width}.png`); fs.writeFileSync(file,Buffer.from(png.split(',')[1],'base64')); cleanupFiles.push(file);
    }
    media=cleanupFiles; await importMedia();
    await until(() => evaluate(`document.querySelector('#preview-image').naturalWidth === 64`),'cleanup fixtures imported');
    await evaluate(`localStorage.removeItem('frameline.background.last');localStorage.removeItem('frameline.background.defaults');`);
    realBackgroundProcessing=true;
    await click('#preview-remove-background');
    await until(() => evaluate(`document.querySelector('#background-dialog').open`),'real cleanup dialog');
    await click('#background-fringe-enabled');
    await evaluate(`document.querySelector('#background-key-color').value='#04f404';document.querySelector('#background-key-color').dispatchEvent(new Event('input'));document.querySelector('#background-tolerance').value='100';document.querySelector('#background-tolerance').dispatchEvent(new Event('input'));document.querySelector('#background-fringe-width').value='2';document.querySelector('#background-fringe-width').dispatchEvent(new Event('input'));`);
    await evaluate(`document.querySelector('#background-fringe-strength').value='0';document.querySelector('#background-fringe-strength').dispatchEvent(new Event('input'));`);
    assert.equal(await evaluate(`document.querySelector('#background-softness').disabled`),true,'zero cleanup strength leaves explicitly disabled blur off');
    await click('#background-softness-enabled');
    assert.equal(await evaluate(`document.querySelector('#background-softness').disabled`),false,'zero cleanup strength allows explicitly enabled blur');
    await evaluate(`document.querySelector('#background-fringe-strength').value='100';document.querySelector('#background-fringe-strength').dispatchEvent(new Event('input'));`);
    const readPreviewPixel = () => evaluate(`(() => {const i=document.querySelector('#background-sample-image');if(!i.complete||!i.naturalWidth)return null;const c=document.createElement('canvas');c.width=i.naturalWidth;c.height=i.naturalHeight;c.getContext('2d').drawImage(i,0,0);return Array.from(c.getContext('2d').getImageData(4,20,1,1).data);})()`);
    await until(async()=>JSON.stringify(await readPreviewPixel())==='[0,0,0,77]','live recovery preview uses brush mixture formula');
    assert(await evaluate(`document.querySelector('#background-sample-image').getBoundingClientRect().width>400`),'small source images fit the large preview');
    const cleanPreview = await evaluate(`(() => {const i=document.querySelector('#background-sample-image'),c=document.createElement('canvas');c.width=i.naturalWidth;c.height=i.naturalHeight;c.getContext('2d').drawImage(i,0,0);return c.toDataURL();})()`);
    if (process.env.FRAMELINE_BACKGROUND_CLEANUP_SCREENSHOT) {
      await evaluate(`document.querySelector('#background-fringe-panel').scrollIntoView({block:'end'});`);
      await paintFrame(); fs.writeFileSync(process.env.FRAMELINE_BACKGROUND_CLEANUP_SCREENSHOT,(await window.webContents.capturePage()).toPNG());
    }
    await click('#background-apply');
    await until(() => evaluate(`!document.querySelector('#operation-progress-dialog').open && document.querySelector('#preview-image').src.includes('background-applied-') && document.querySelector('#preview-image').complete`),'real current-image cleanup applied');
    assert.equal(await evaluate(`(() => {const i=document.querySelector('#preview-image'),c=document.createElement('canvas');c.width=i.naturalWidth;c.height=i.naturalHeight;c.getContext('2d').drawImage(i,0,0);return c.toDataURL();})()`),cleanPreview,'applied cleanup exactly matches the live preview');
    await click('#undo');
    await until(()=>evaluate(`document.querySelector('#preview-image').src === ${JSON.stringify(pathToFileURL(cleanupFiles[0]).href)}`),'undo restores source cleanup image');
    await click('#preview-remove-background');
    await until(()=>evaluate(`document.querySelector('#background-dialog').open`),'sampled cleanup dialog');
    await evaluate(`document.querySelector('#background-method').value='sample';document.querySelector('#background-method').dispatchEvent(new Event('change'));`);
    assert.equal(await evaluate(`document.querySelector('#background-preview-progress').hidden && document.querySelector('#background-preview-status-text').textContent.includes('Choose a background color')`), true, 'waiting for a sample is not shown as processing');
    await until(()=>evaluate(`document.querySelector('#background-sample-image').complete && document.querySelector('#background-sample-image').src === ${JSON.stringify(pathToFileURL(cleanupFiles[0]).href)}`),'original source shown before sampling');
    await evaluate(`(() => {const i=document.querySelector('#background-sample-image'),b=i.getBoundingClientRect();i.dispatchEvent(new MouseEvent('click',{bubbles:true,button:0,clientX:b.left+b.width*.025,clientY:b.top+b.height*.025}));})()`);
    await until(()=>evaluate(`document.querySelector('#background-color-value').textContent === '#04F404' && !document.querySelector('#background-apply-all').disabled`),'sampling enables Apply to all');
    const batchStart=backgroundApplyRequests.length;
    await click('#background-set-default'); await click('#background-apply-all');
    await until(()=>backgroundApplyRequests.length===batchStart+2,'sampled batch processes both dimensions');
    await until(()=>evaluate(`!document.querySelector('#operation-progress-dialog').open && !document.querySelector('#preview-remove-background').disabled`),'sampled batch finishes');
    assert(backgroundApplyRequests.slice(batchStart).every(r=>r.fringe_cleanup.method==='recover' && r.fringe_cleanup.width===2 && JSON.stringify(r.sample_color)==='[4,244,4]'),'sampled batch uses cleanup and the chosen background color');
    await click('#save-project');
    const batchPaths=savedProject.images.map(i=>i.path);
    assert(savedProject.images.every(i=>i.path!==i.originalPath && fs.existsSync(i.path)),'saved project retains both corrected assets and originals');
    await click('#undo'); await click('#save-project');
    assert.deepEqual(savedProject.images.map(i=>i.path),cleanupFiles,'one undo restores the whole cleanup batch');
    await click('#redo'); await click('#save-project');
    assert.deepEqual(savedProject.images.map(i=>i.path),batchPaths,'redo restores both cleaned images');
    await click('#new-project'); await answerMessage('discard');
    const autoFiles=[];
    for (const [index,color] of ['#20db40','#efe4d8'].entries()) {
      const png=await evaluate(`(() => {const c=document.createElement('canvas');c.width=64;c.height=48;const x=c.getContext('2d');x.fillStyle=${JSON.stringify(color)};x.fillRect(0,0,64,48);x.fillStyle='#7030c8';x.fillRect(15,10,34,28);x.fillStyle='#ef7040';x.fillRect(20,15,8,8);return c.toDataURL();})()`);
      const file=path.join(temporary,`auto-background-${index}.png`);fs.writeFileSync(file,Buffer.from(png.split(',')[1],'base64'));autoFiles.push(file);
    }
    media=autoFiles;await importMedia();
    await evaluate(`localStorage.removeItem('frameline.background.last');localStorage.removeItem('frameline.background.defaults');`);
    await click('#preview-remove-background');
    await until(()=>evaluate(`document.querySelector('#background-preview-status-text').textContent.startsWith('Preview ready') && document.querySelector('#background-detected-colors').textContent.includes('#20db40')`),'Auto detects the actual preview image border');
    await click('#background-ignore-brush');await paintFrame();
    await evaluate(`document.querySelector('#background-ignore-size').value='8';`);
    const drawIgnore = async () => {
      const positions=await evaluate(`(() => {const b=document.querySelector('#background-sample-image').getBoundingClientRect();return [6,10].map(x=>({x:Math.round(b.left+b.width*x/64),y:Math.round(b.top+b.height*.5)}));})()`);
      window.webContents.sendInputEvent({type:'mouseMove',...positions[0]});await paintFrame();
      assert.equal(await evaluate(`document.querySelector('#background-ignore-cursor').hidden`),false,'Ignore shows the brush boundary');
      window.webContents.sendInputEvent({type:'mouseDown',...positions[0],button:'left',clickCount:1});await paintFrame();
      window.webContents.sendInputEvent({type:'mouseMove',...positions[1],button:'left'});await paintFrame();
      const held=await evaluate(`document.querySelector('#background-ignore-overlay').toDataURL()`);
      window.webContents.sendInputEvent({type:'mouseUp',...positions[1],button:'left',clickCount:1});await paintFrame();
      assert.equal(await evaluate(`document.querySelector('#background-ignore-overlay').toDataURL()`),held,'Ignore overlay is identical on release');
      await until(()=>evaluate(`document.querySelector('#background-preview-status-text').textContent.startsWith('Preview ready')`),'Ignore preview ready');
      const pixel=await evaluate(`(() => {const c=document.querySelector('#background-ignore-overlay');return Array.from(c.getContext('2d').getImageData(6,24,1,1).data);})()`);
      assert.equal(pixel[3],56,'Ignore overlay stays faint without opacity buildup');
      assert(pixel[0]===255 && Math.abs(pixel[1]-55)<=1 && Math.abs(pixel[2]-65)<=1,'Ignore overlay is red (allowing canvas premultiplication rounding)');
    };
    await drawIgnore();
    assert.equal(backgroundPreviewRequest.ignore_strokes.length,1);
    const ignoredPreviewPixel = () => evaluate(`(() => {const i=document.querySelector('#background-sample-image'),c=document.createElement('canvas');c.width=64;c.height=48;c.getContext('2d').drawImage(i,0,0);return Array.from(c.getContext('2d').getImageData(6,24,1,1).data);})()`);
    assert.deepEqual(await ignoredPreviewPixel(),[32,219,64,255],'Ignore restores the protected source pixels in live preview');
    await click('#background-ignore-undo');
    await until(()=>evaluate(`document.querySelector('#background-preview-status-text').textContent.startsWith('Preview ready')`),'undo Ignore preview ready');
    assert.equal((await ignoredPreviewPixel())[3],0,'Undo mark removes protection');
    await drawIgnore();await drawIgnore();
    assert.equal(backgroundPreviewRequest.ignore_strokes.length,2);
    await click('#background-ignore-clear');
    await until(()=>evaluate(`document.querySelector('#background-preview-status-text').textContent.startsWith('Preview ready')`),'clear Ignore preview ready');
    assert.equal(await evaluate(`document.querySelector('#background-ignore-undo').disabled && document.querySelector('#background-ignore-clear').disabled`),true);
    assert.equal((await ignoredPreviewPixel())[3],0,'Clear removes all protection');
    await drawIgnore();
    // Zoom/pan use exactly the same transform for the image and its overlay.
    await evaluate(`document.querySelector('#background-preview-frame').dispatchEvent(new WheelEvent('wheel',{deltaY:-100,clientX:500,clientY:400,bubbles:true,cancelable:true}));`);
    assert.equal(await evaluate(`(() => {const a=document.querySelector('#background-sample-image').getBoundingClientRect(),b=document.querySelector('#background-ignore-overlay').getBoundingClientRect();return Math.abs(a.left-b.left)<.1 && Math.abs(a.top-b.top)<.1 && Math.abs(a.width-b.width)<.1 && Math.abs(a.height-b.height)<.1;})()`),true,'Ignore overlay follows zoom exactly');
    await click('#background-preview-fit');
    await click('#background-ignore-brush');
    await until(()=>evaluate(`document.querySelector('#background-preview-status-text').textContent.startsWith('Preview ready')`),'disabling painting retains Ignore protection');
    assert.deepEqual(await ignoredPreviewPixel(),[32,219,64,255]);
    if(process.env.FRAMELINE_IGNORE_BRUSH_SCREENSHOT){await click('#background-ignore-brush');await paintFrame();fs.writeFileSync(process.env.FRAMELINE_IGNORE_BRUSH_SCREENSHOT,(await window.webContents.capturePage()).toPNG());}
    const autoBatchStart=backgroundApplyRequests.length;
    await click('#background-set-default');
    await click('#background-apply-all');
    await until(()=>backgroundApplyRequests.length===autoBatchStart+2,'Auto processes every batch image');
    await until(()=>evaluate(`!document.querySelector('#operation-progress-dialog').open && !document.querySelector('#preview-remove-background').disabled`),'Auto batch finishes');
    assert(backgroundApplyRequests.slice(autoBatchStart).every(request=>request.mode==='auto' && request.background_source==='auto' && !request.aggressive),'each image independently detects its own background');
    assert.equal(await evaluate(`'ignore_strokes' in JSON.parse(localStorage.getItem('frameline.background.defaults'))`),false,'Ignore marks never leak into saved defaults');
    await click('#save-project');
    const autoPaths=savedProject.images.map(image=>image.path);
    for(const file of autoPaths) {
      const pixels=await evaluate(`(async()=>{const i=new Image();await new Promise((resolve,reject)=>{i.onload=resolve;i.onerror=reject;i.src=${JSON.stringify(pathToFileURL(file).href)};});const c=document.createElement('canvas');c.width=i.naturalWidth;c.height=i.naturalHeight;const x=c.getContext('2d');x.drawImage(i,0,0);return [Array.from(x.getImageData(0,0,1,1).data),Array.from(x.getImageData(21,16,1,1).data)];})()`);
      assert.equal(pixels[0][3],0,'Auto removes each different background');
      assert.deepEqual(pixels[1],[239,112,64,255],'Auto keeps colorful foreground');
      const protectedPixel=await evaluate(`(async()=>{const i=new Image();await new Promise(resolve=>{i.onload=resolve;i.src=${JSON.stringify(pathToFileURL(file).href)};});const c=document.createElement('canvas');c.width=64;c.height=48;c.getContext('2d').drawImage(i,0,0);return Array.from(c.getContext('2d').getImageData(6,24,1,1).data);})()`);
      assert.deepEqual(protectedPixel,file===autoPaths[0]?[32,219,64,255]:[239,228,216,255],'batch Ignore preserves each frame’s own source color, without the red overlay');
    }
    await click('#undo');await click('#save-project');
    assert.deepEqual(savedProject.images.map(image=>image.path),autoFiles,'Auto batch is one undo step');
    await click('#redo');await click('#save-project');
    assert.deepEqual(savedProject.images.map(image=>image.path),autoPaths,'Auto batch redo restores saved processed images');
    await click('#preview-remove-background');
    await until(()=>evaluate(`document.querySelector('#background-dialog').open`),'reopen Ignore dialog');
    assert.equal(await evaluate(`document.querySelector('#background-ignore-brush').getAttribute('aria-pressed')==='false' && document.querySelector('#background-ignore-undo').disabled && !document.querySelector('#background-ignore-overlay').getContext('2d').getImageData(0,0,64,48).data.some(value=>value)`),true,'reopening has no old marks or active brush');
    await click('#background-cancel');
    realBackgroundProcessing=false;
    await window.webContents.reload();
    await until(() => evaluate(`document.querySelector('#preview-tool-hand')?.classList.contains('selected') && document.querySelector('#preview-brush-antialias').checked`), 'anti-aliasing preference restores on startup');
    {
    media = [red,blue,wide];
    await importMedia();
    await until(() => evaluate(`document.querySelector('#image-count').textContent === '3 images'`), 'import menu fixtures loaded');
    const assetCount = () => evaluate(`Number(document.querySelector('#image-count').textContent.split(' ')[0])`);
    const selectedAssetCount = () => evaluate(`document.querySelectorAll('#image-list .image-row.selected').length`);
    const openImageMenu = async index => {
      const position = await evaluate(`(() => {const b=document.querySelectorAll('#image-list .image-row')[${index}].getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)};})()`);
      window.webContents.sendInputEvent({type:'mouseDown',...position,button:'right',clickCount:1});
      window.webContents.sendInputEvent({type:'mouseUp',...position,button:'right',clickCount:1});
      await until(() => evaluate(`document.querySelector('.context-menu')?.getAttribute('aria-label') === 'Imported image actions'`), 'import image context menu');
    };
    const imageMenuAction = async label => {
      const labels = await evaluate(`Array.from(document.querySelectorAll('.context-menu button')).map(button=>button.getAttribute('aria-label'))`);
      assert(labels.includes(label), `Missing image menu action ${label}; available: ${labels.join(', ')}`);
      await evaluate(`Array.from(document.querySelectorAll('.context-menu button')).find(button=>button.getAttribute('aria-label')===${JSON.stringify(label)}).click()`);
      await until(() => evaluate(`!document.querySelector('.context-menu')`), 'image menu action closes the menu');
      await paintFrame();
    };
    const projectSnapshot = async () => {
      const count = saves;
      await click('#save-project');
      await until(async () => saves > count, 'save import-list changes');
      return structuredClone(savedProject);
    };
    // Batch rename uses labels throughout the UI, portable saves, and exports.
    const originalNames = ['red.bmp','blue.bmp','wide.bmp'];
    const beforeRename = await projectSnapshot();
    assert.equal(await evaluate(`!document.querySelector('#rename-images').hidden && document.querySelector('#clear-images').nextElementSibling.id==='rename-images'`),true,'Rename appears beside Clear');
    const importPanelWidth = await evaluate(`document.documentElement.style.getPropertyValue('--image-panel-width')`);
    await evaluate(`document.documentElement.style.setProperty('--image-panel-width','135px')`);await paintFrame();
    assert.equal(await evaluate(`(() => {const panel=document.querySelector('.image-panel').getBoundingClientRect();return [...document.querySelectorAll('.panel-heading-actions button')].every(button=>{const b=button.getBoundingClientRect();return b.left>=panel.left && b.right<=panel.right;});})()`),true,'Import actions fit the narrowest panel');
    await evaluate(`document.documentElement.style.setProperty('--image-panel-width',${JSON.stringify(importPanelWidth)})`);await paintFrame();
    const openRename = async () => {
      await click('#rename-images');
      await until(()=>evaluate(`document.querySelector('#rename-images-dialog').open`),'batch rename dialog');
    };
    const renameValues = async values => {
      await evaluate(`(() => {for(const [id,value] of Object.entries(${JSON.stringify(values)})){const input=document.querySelector('#rename-'+id);if(typeof value==='boolean') input.checked=value;else input.value=String(value);}document.querySelector('#rename-images-form').dispatchEvent(new Event('input',{bubbles:true}));})()`);
    };
    const renamePreview = () => evaluate(`Array.from(document.querySelectorAll('#rename-preview tr')).map(row=>row.lastElementChild.textContent)`);
    await openRename();
    assert.deepEqual(await renamePreview(),['Image001.bmp','Image002.bmp','Image003.bmp']);
    await renameValues({base:'ImageName',padding:'00',extension:false});
    assert.deepEqual(await renamePreview(),['ImageName01','ImageName02','ImageName03']);
    await renameValues({base:'Invalid/name'});
    assert.equal(await evaluate(`!document.querySelector('#rename-error').hidden && document.querySelector('#rename-apply').disabled`),true,'invalid names stay in the dialog');
    await renameValues({base:'ImageName',start:''});
    assert.equal(await evaluate(`document.querySelector('#rename-apply').disabled`),true,'blank start is invalid');
    await renameValues({start:1,padding:'000'});
    if(process.env.FRAMELINE_RENAME_SCREENSHOT){await paintFrame();fs.writeFileSync(process.env.FRAMELINE_RENAME_SCREENSHOT,(await window.webContents.capturePage()).toPNG());}
    await click('#rename-cancel');
    assert.deepEqual((await projectSnapshot()).images.map(image=>image.name),originalNames,'Cancel leaves names unchanged');
    await openRename();await renameValues({base:'ImageName',extension:false});
    await click('#rename-apply');
    await until(()=>evaluate(`!document.querySelector('#rename-images-dialog').open && document.activeElement.id==='image-list' && document.querySelector('#image-list .image-name').textContent==='ImageName001'`),'batch rename applies and restores list focus');
    const renamed = await projectSnapshot();
    assert.deepEqual(renamed.images.map(image=>image.name),['ImageName001','ImageName002','ImageName003']);
    assert.deepEqual(renamed.images.map(({name,...image})=>image),beforeRename.images.map(({name,...image})=>image),'rename preserves paths and edits');
    assert.deepEqual(renamed.clips,beforeRename.clips,'rename preserves the timeline');
    assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('#image-list .image-name')).map(node=>node.textContent)`),renamed.images.map(image=>image.name));
    assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('.clip-label strong')).map(node=>node.textContent)`),renamed.images.map(image=>image.name),'timeline labels update');
    await openImageMenu(0);const renameExports=exportRequests.length;await imageMenuAction('Export image…');
    await until(()=>exportRequests.length>renameExports,'renamed source export request');
    assert.equal(exportRequests.at(-1).request.images[0].name,'ImageName001');
    await until(()=>evaluate(`!document.querySelector('#operation-progress-dialog').open`),'renamed export completes');
    await click('#undo');assert.deepEqual((await projectSnapshot()).images.map(image=>image.name),originalNames,'all renames are one undo step');
    await click('#redo');assert.deepEqual((await projectSnapshot()).images.map(image=>image.name),renamed.images.map(image=>image.name));
    await click('#undo');
    await mouseClick('#image-list .image-row:nth-child(1)');await mouseClick('#image-list .image-row:nth-child(3)',['control']);
    await openRename();await renameValues({scope:'selected',mode:'pattern',pattern:'{name}_{number}{ext}',start:10,step:5,padding:'00',order:'reverse',case:'upper'});
    assert.deepEqual(await renamePreview(),['WIDE_10.BMP','RED_15.BMP']);
    assert.equal(await evaluate(`document.querySelector('#rename-sequence-fields').hidden && !document.querySelector('#rename-pattern-fields').hidden`),true,'pattern mode shows its fields');
    await click('#rename-apply');
    await until(()=>evaluate(`document.querySelector('#image-list .image-name').textContent==='RED_15.BMP'`),'selected rename applies');
    assert.deepEqual((await projectSnapshot()).images.map(image=>image.name),['RED_15.BMP','blue.bmp','WIDE_10.BMP']);
    assert.equal(await selectedAssetCount(),2,'rename retains multi-selection');
    await click('#undo');
    await openRename();await renameValues({mode:'pattern',pattern:'Same',unique:false});
    assert.equal(await evaluate(`document.querySelector('#rename-apply').disabled`),true,'duplicate names cannot apply without uniqueness');
    await renameValues({unique:true});assert.deepEqual(await renamePreview(),['Same','Same (2)','Same (3)']);
    await pressKey('Escape');
    assert.deepEqual((await projectSnapshot()).images.map(image=>image.name),originalNames);
    await mouseClick('#image-list .image-row:first-child');
    await openImageMenu(0);
    assert.equal(await selectedAssetCount(), 1, 'right click selects its asset');
    assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('.context-menu button')).slice(0,8).map(b=>b.getAttribute('aria-label'))`),
      ['Select','Select all images','Copy','Cut','Paste','Duplicate','Delete','Insert at playhead']);
    assert.equal(await evaluate(`document.querySelector('.context-menu button[aria-label="Paste"]').disabled`), true, 'Paste is disabled with an empty asset clipboard');
    assert.equal(await evaluate(`(() => {const m=document.querySelector('.context-menu'),b=m.getBoundingClientRect();return getComputedStyle(m).backgroundColor==='rgb(18, 18, 18)' && [...m.querySelectorAll('button')].every(b=>getComputedStyle(b).fontSize==='12px') && b.left>=8 && b.right<=innerWidth-8 && b.top>=8 && b.bottom<=innerHeight-8;})()`), true, 'import menu uses the timeline theme and stays in the viewport');
    if (process.env.FRAMELINE_IMPORT_MENU_SCREENSHOT) {
      await paintFrame();
      fs.writeFileSync(process.env.FRAMELINE_IMPORT_MENU_SCREENSHOT,(await window.webContents.capturePage()).toPNG());
    }
    await pressKey('Down');
    assert.equal(await evaluate(`document.activeElement.getAttribute('aria-label')`), 'Select all images', 'arrow keys navigate the menu');
    await pressKey('Escape');
    assert.equal(await evaluate(`!document.querySelector('.context-menu') && document.activeElement.id==='image-list'`), true, 'Escape restores import-list focus');
    await openImageMenu(0); await imageMenuAction('Copy');
    assert.equal(await assetCount(), 3, 'Copy does not add an asset or clip');
    await openImageMenu(1); await imageMenuAction('Paste');
    await until(async () => await assetCount() === 4, 'Paste adds a new asset');
    let assets = await projectSnapshot();
    assert.deepEqual(assets.images.map(i=>i.name), ['red.bmp','blue.bmp','red.bmp','wide.bmp']);
    assert.equal(assets.clips.length, 4);
    assert.equal(new Set(assets.images.map(i=>i.id)).size, 4);
    assert.equal(new Set(assets.clips.map(c=>c.id)).size, 4);
    await click('#undo'); assert.equal(await assetCount(), 3);
    await click('#redo'); assert.equal(await assetCount(), 4);
    await mouseClick('#image-list .image-row:nth-child(1)');
    await mouseClick('#image-list .image-row:nth-child(3)', ['control']);
    assert.equal(await selectedAssetCount(), 2, 'Ctrl toggles import-list images');
    await openImageMenu(2);
    assert.equal(await selectedAssetCount(), 2, 'right click retains the selected asset group');
    await imageMenuAction('Duplicate selected');
    assert.equal(await assetCount(), 6);
    assert.equal(await selectedAssetCount(), 2);
    await click('#undo'); assert.equal(await assetCount(), 4);
    await click('#redo'); assert.equal(await assetCount(), 6);
    await openImageMenu(3); await imageMenuAction('Cut');
    assert.equal(await assetCount(), 4);
    assert.equal((await projectSnapshot()).clips.length, 4, 'Cut removes the assets and their clips');
    await click('#undo'); assert.equal(await assetCount(), 6);
    await click('#redo'); assert.equal(await assetCount(), 4);
    await openImageMenu(1); await imageMenuAction('Paste');
    assert.equal(await assetCount(), 6);
    await openImageMenu(2); await imageMenuAction('Delete'); await answerMessage('cancel');
    assert.equal(await assetCount(), 6, 'Cancel leaves assets intact');
    await openImageMenu(2); await imageMenuAction('Delete'); await answerMessage('confirm');
    assert.equal(await assetCount(), 4);
    await click('#undo'); assert.equal(await assetCount(), 6, 'one Undo restores the deleted group');
    await click('#redo'); assert.equal(await assetCount(), 4);
    await mouseClick('#image-list .image-row:nth-child(2)');
    await mouseClick('#image-list .image-row:nth-child(4)', ['shift']);
    assert.equal(await selectedAssetCount(), 3, 'Shift selects an asset range');
    await openImageMenu(3); await imageMenuAction('Select only this image');
    assert.equal(await selectedAssetCount(), 1);
    await evaluate(`document.querySelector('#image-list').focus()`);
    await pressKey('a', ['control']); assert.equal(await selectedAssetCount(), 4);
    await pressKey('c', ['control']);
    await pressKey('d', ['control']); assert.equal(await assetCount(), 8);
    await click('#undo'); assert.equal(await assetCount(), 4);
    await evaluate(`document.querySelector('#image-list').focus()`);
    await pressKey('x', ['control']); assert.equal(await assetCount(), 0, 'Ctrl+X cuts import assets rather than just timeline clips');
    assert.equal(await evaluate(`document.querySelector('#rename-images').hidden`),true,'Rename hides when there are no images');
    await evaluate(`document.querySelector('#empty-list').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:50,clientY:200}))`);
    await until(() => evaluate(`Boolean(document.querySelector('.context-menu'))`), 'empty import-list menu');
    assert.equal(await evaluate(`document.querySelector('.context-menu button[aria-label="Paste"]').disabled`), false);
    await imageMenuAction('Paste'); assert.equal(await assetCount(), 4, 'Paste works in an empty import list');
    await click('#undo'); assert.equal(await assetCount(), 0);
    await click('#redo'); assert.equal(await assetCount(), 4);
    await evaluate(`document.querySelector('#image-list').focus()`);
    await pressKey('v', ['control']); assert.equal(await assetCount(), 8, 'Ctrl+V uses the asset clipboard while the list has focus');
    await click('#undo'); assert.equal(await assetCount(), 4);
    const beforeMove = await projectSnapshot();
    await mouseClick('#image-list .image-row:first-child');
    await openImageMenu(0); await imageMenuAction('Move to end');
    assert.equal((await projectSnapshot()).images.at(-1).id, beforeMove.images[0].id);
    await click('#undo');
    await openImageMenu(0); await imageMenuAction('Select');
    await openImageMenu(0);
    const beforeAssetExport = exportRequests.length;
    await imageMenuAction('Export image…');
    await until(async () => exportRequests.length > beforeAssetExport, 'import menu exports the selected working image');
    assert.equal(exportRequests.at(-1).request.images.length, 1);
    await until(() => evaluate(`!document.querySelector('#operation-progress-dialog').open`), 'asset export completed');
    const clipsBeforeInsert = (await projectSnapshot()).clips.length;
    await openImageMenu(0); await imageMenuAction('Insert at playhead');
    assert.equal((await projectSnapshot()).clips.length, clipsBeforeInsert + 1);
    assert.equal(await assetCount(), 4, 'Insert at playhead reuses the source asset');
    await click('#undo');
    await click('#preview-tool-brush');
    await evaluate(`document.querySelector('#preview-brush-size').value='5';document.querySelector('#preview-brush-opacity').value='100';document.querySelector('#preview-brush-feather').value='0';document.querySelector('#preview-brush-color').value='#00ff00';document.querySelector('#preview-brush-color').dispatchEvent(new Event('input'));`);
    const assetPaintPoint = await evaluate(`(() => {const b=document.querySelector('#preview-image-wrap').getBoundingClientRect();return {x:Math.round(b.left+b.width*.5),y:Math.round(b.top+b.height*.5)};})()`);
    window.webContents.sendInputEvent({type:'mouseDown',...assetPaintPoint,button:'left',clickCount:1}); await paintFrame();
    window.webContents.sendInputEvent({type:'mouseUp',...assetPaintPoint,button:'left',clickCount:1}); await paintFrame();
    const assetDraftPixels = await evaluate(`document.querySelector('#preview-paint-canvas').toDataURL()`);
    await openImageMenu(0); await imageMenuAction('Copy'); await answerMessage('cancel');
    assert.equal(await evaluate(`document.querySelector('#preview-paint-canvas').toDataURL()`), assetDraftPixels, 'Cancel copying preserves the live tool draft');
    await openImageMenu(0); await imageMenuAction('Copy'); await answerMessage('apply');
    await until(() => evaluate(`document.activeElement.id==='image-list'`), 'asset clipboard action restores list focus');
    await pressKey('v', ['control']);
    assert.equal(await assetCount(), 5);
    const copiedAssetId = await evaluate(`document.querySelector('#image-list .image-row.selected').dataset.imageId`);
    assets = await projectSnapshot();
    assert.equal(assets.images.find(i=>i.id===copiedAssetId).paintStrokes.length, 1, 'asset Copy/Apply/Paste includes the applied stroke');
    assert.equal(await evaluate(`document.querySelector('#preview-paint-canvas').toDataURL()`), assetDraftPixels, 'copied asset shows the same working pixels');
    }
    {
      // Each release is one undo step, both before Apply and after committing.
      media = [blue]; await importMedia();
      if (!(await evaluate(`document.querySelector('#preview-tool-brush').classList.contains('selected')`))) await click('#preview-tool-brush');
      await evaluate(`document.querySelector('#preview-brush-size').value='3';document.querySelector('#preview-brush-opacity').value='65';document.querySelector('#preview-brush-feather').value='35';document.querySelector('#preview-brush-antialias').checked=true;document.querySelector('#preview-square-brush').checked=false;`);
      const pixels = () => evaluate(`document.querySelector('#preview-paint-canvas').toDataURL()`);
      const baseline = await pixels();
      const draw = async points => {
        const positions = await evaluate(`(() => {const b=document.querySelector('#preview-image-wrap').getBoundingClientRect();return ${JSON.stringify(points)}.map(([x,y])=>({x:Math.round(b.left+b.width*x),y:Math.round(b.top+b.height*y)}));})()`);
        window.webContents.sendInputEvent({type:'mouseDown',...positions[0],button:'left',clickCount:1}); await paintFrame();
        for(const position of positions.slice(1)) {window.webContents.sendInputEvent({type:'mouseMove',...position,button:'left'});await paintFrame();}
        const held = await pixels();
        window.webContents.sendInputEvent({type:'mouseUp',...positions.at(-1),button:'left',clickCount:1});await paintFrame();
        assert.equal(await pixels(),held,'incremental preview stays identical on release');
        return held;
      };
      const first = await draw([[.2,.3],[.3,.4],[.4,.5]]);
      const fpsBefore = await evaluate(`document.querySelector('#fps-select').value`);
      const fpsAfter = fpsBefore === '12' ? '24' : '12';
      await evaluate(`document.querySelector('#fps-select').value=${JSON.stringify(fpsAfter)};document.querySelector('#fps-select').dispatchEvent(new Event('change'));`);
      const second = await draw([[.6,.3],[.7,.4],[.8,.5]]);
      assert.notEqual(second,first);
      await click('#undo'); assert.equal(await pixels(),first,'Undo removes only the latest pending stroke');
      await click('#undo'); assert.equal(await pixels(),first,'Undo settings retains the earlier stroke');
      assert.equal(await evaluate(`document.querySelector('#fps-select').value`),fpsBefore);
      await evaluate(`document.querySelector('#preview-stage').dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true}));`);
      assert.equal(await pixels(),baseline,'Ctrl+Z removes the remaining pending stroke');
      assert.equal(await evaluate(`document.querySelector('#preview-paint-apply').disabled`),true);
      await evaluate(`document.querySelector('#preview-stage').dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,shiftKey:true,bubbles:true}));`);
      assert.equal(await pixels(),first,'Ctrl+Shift+Z restores the exact earlier stroke');
      await click('#redo'); assert.equal(await pixels(),first);
      assert.equal(await evaluate(`document.querySelector('#fps-select').value`),fpsAfter);
      await evaluate(`document.querySelector('#preview-stage').dispatchEvent(new KeyboardEvent('keydown',{key:'y',ctrlKey:true,bubbles:true}));`);
      assert.equal(await pixels(),second,'Ctrl+Y restores the second stroke');
      await click('#preview-paint-apply');
      assert.equal(await pixels(),second,'Apply preserves every preview pixel');
      await click('#undo'); assert.equal(await pixels(),first,'after Apply, Undo still removes one stroke');
      await click('#undo'); assert.equal(await pixels(),baseline,'second Undo removes only the first stroke');
      await click('#redo'); assert.equal(await pixels(),first);
      await click('#redo'); assert.equal(await pixels(),second);
      await click('#undo'); await click('#undo');

      // Coalesced samples describe a curve even when one dispatched event has
      // a distant endpoint. Also capture a final position supplied only at Up.
      const curve = await evaluate(`(() => {
        const stage=document.querySelector('#preview-stage'), b=document.querySelector('#preview-image-wrap').getBoundingClientRect();
        const p=(x,y)=>({clientX:b.left+b.width*x,clientY:b.top+b.height*y});
        stage.dispatchEvent(new PointerEvent('pointerdown',{...p(.25,.5),pointerId:1,button:0,buttons:1,bubbles:true}));
        const move=new PointerEvent('pointermove',{...p(.75,.5),pointerId:1,buttons:1,bubbles:true});
        Object.defineProperty(move,'getCoalescedEvents',{value:()=>[p(.3,.35),p(.4,.25),p(.6,.25),p(.7,.35)]});
        stage.dispatchEvent(move);
        stage.dispatchEvent(new PointerEvent('pointerup',{...p(.75,.7),pointerId:1,button:0,bubbles:true}));
        const c=document.querySelector('#preview-paint-canvas'),data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
        return {top:data[(8*c.width+13)*4+3],end:data[(22*c.width+24)*4+3],png:c.toDataURL()};
      })()`);
      assert(curve.top>0,'batched intermediate positions retain the top of the curve');
      assert(curve.end>0,'pointerup captures the final mouse position');
      assert.equal(await evaluate(`document.querySelector('#redo').disabled`),true,'a new stroke clears redo');
      await click('#undo'); assert.equal(await pixels(),baseline,'the entire sampled curve is one Undo step');
      await click('#undo'); await click('#undo');
      await click('#redo'); await click('#redo');
      await click('#redo'); assert.equal(await pixels(),curve.png);
      await click('#preview-paint-discard');

      await click('#preview-tool-crop'); await enableTool();
      const cropBefore = await evaluate(`document.querySelector('#preview-crop-width').value`);
      await evaluate(`{const f=document.querySelector('#preview-crop-width');f.value='20';f.dispatchEvent(new Event('input',{bubbles:true}));f.dispatchEvent(new Event('change',{bubbles:true}));}`);
      await paintFrame(); await click('#undo');
      assert.equal(await evaluate(`document.querySelector('#preview-crop-width').value`),cropBefore,'Undo restores numeric crop preview');
      await click('#redo');
      assert.equal(await evaluate(`document.querySelector('#preview-crop-width').value`),'20','Redo restores crop preview');
      await click('#preview-tool-hand'); await answerMessage('discard');
      await click('#preview-tool-outline'); await enableTool();
      const outlineBefore = await evaluate(`document.querySelector('#preview-outline-size').value`);
      await evaluate(`{const f=document.querySelector('#preview-outline-size');f.value='15';f.dispatchEvent(new Event('input',{bubbles:true}));f.value='18';f.dispatchEvent(new Event('input',{bubbles:true}));f.dispatchEvent(new Event('change',{bubbles:true}));}`);
      await paintFrame(); await click('#undo');
      assert.equal(await evaluate(`document.querySelector('#preview-outline-size').value`),outlineBefore,'one slider gesture is one Undo step');
      await click('#redo'); assert.equal(await evaluate(`document.querySelector('#preview-outline-size').value`),'18');
      await click('#preview-tool-hand'); await answerMessage('discard');
      await click('#preview-tool-padding'); await enableTool();
      await until(() => evaluate(`document.querySelector('#preview-image-wrap').classList.contains('padding-preview')`),'padding preview for history');
      const paddingBefore = await evaluate(`document.querySelector('#preview-padding-left').value`);
      await evaluate(`{const f=document.querySelector('#preview-padding-left');f.value='7';f.dispatchEvent(new Event('input',{bubbles:true}));f.dispatchEvent(new Event('change',{bubbles:true}));}`);
      await paintFrame(); await click('#undo');
      assert.equal(await evaluate(`document.querySelector('#preview-padding-left').value`),paddingBefore,'Undo restores linked padding settings');
      await click('#redo'); assert.equal(await evaluate(`document.querySelector('#preview-padding-left').value`),'7');
      await click('#preview-tool-hand'); await answerMessage('discard');
      await click('#preview-tool-refine'); await enableTool();
      await until(() => evaluate(`document.querySelector('#preview-image-wrap').classList.contains('refine-preview')`),'Refine preview for history');
      const refineBefore = await evaluate(`JSON.stringify([...document.querySelectorAll('[data-refine-field]')].map(f=>f.value))`);
      await evaluate(`(() => {const fields=[...document.querySelectorAll('[data-refine-field]')];for(const field of fields){field.value=field.dataset.refineField==='width'?'1':'0';field.dispatchEvent(new Event('input',{bubbles:true}));}fields.at(-1).dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await paintFrame();
      const refineZero = await evaluate(`JSON.stringify([...document.querySelectorAll('[data-refine-field]')].map(f=>f.value))`);
      await click('#undo');
      assert.equal(await evaluate(`JSON.stringify([...document.querySelectorAll('[data-refine-field]')].map(f=>f.value))`),refineBefore);
      await until(() => evaluate(`document.querySelector('#preview-image-wrap').classList.contains('refine-preview')`),'Undo restores Refine preview');
      await click('#redo');
      assert.equal(await evaluate(`JSON.stringify([...document.querySelectorAll('[data-refine-field]')].map(f=>f.value))`),refineZero,'Redo restores zero effect controls');
      assert.equal(await evaluate(`!document.querySelector('#preview-image-wrap').classList.contains('refine-preview') && document.querySelector('#preview-refine-apply').disabled`),true,'zero Refine result is the source image');
      await click('#preview-tool-hand');
    }
    {
      await click('#preview-tool-brush');
      await evaluate(`{const size=document.querySelector('#preview-brush-size');size.value='4096';size.dispatchEvent(new Event('input'));document.querySelector('#preview-brush-feather').value='0';document.querySelector('#preview-brush-opacity').value='100';document.querySelector('#preview-square-brush').checked=false;document.querySelector('#preview-brush-antialias').checked=true;}`);
      const point = await evaluate(`(() => {const b=document.querySelector('#preview-image-wrap').getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)};})()`);
      window.webContents.sendInputEvent({type:'mouseDown',...point,button:'left',clickCount:1});await paintFrame();
      window.webContents.sendInputEvent({type:'mouseUp',...point,button:'left',clickCount:1});await paintFrame();
      assert.equal(await evaluate(`(() => {const c=document.querySelector('#preview-paint-canvas'),p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;return p.every((v,i)=>i%4!==3||v===255);})()`),true,'a 4096 px brush covers the image without truncating its size');
      await click('#preview-paint-apply');
      const savedCount = saves;
      await click('#save-project'); await until(() => saves>savedCount,'save large brush stroke');
      assert.equal(savedProject.images.flatMap(image=>image.paintStrokes??[]).at(-1).size,4096,'saved stroke keeps its full size');
      await until(() => evaluate(`JSON.parse(localStorage.getItem('frameline.preferences')).brushSize===4096`),'large size preference saved');
      await window.webContents.reload();
      await until(() => evaluate(`document.querySelector('#preview-tool-hand')?.classList.contains('selected')`),'startup after large brush size');
      assert.equal(await evaluate(`document.querySelector('#preview-brush-size').value`),'4096','large size is restored after reload');
      await evaluate(`{const size=document.querySelector('#preview-brush-size');size.value='';size.dispatchEvent(new Event('input'));size.dispatchEvent(new Event('blur'));}`);
      assert.equal(await evaluate(`document.querySelector('#preview-brush-size').value`),'4096','empty entry restores the last valid size');
    }
    {
      media = [autoHealingGreen]; await importMedia(); await click('#preview-tool-healing');
      await evaluate(`(() => {
        document.querySelector('#preview-healing-auto').checked=false;
        document.querySelector('#preview-healing-auto').dispatchEvent(new Event('change'));
        document.querySelector('#preview-healing-keep').value='#000000';
        document.querySelector('#preview-healing-remove').value='#04f404';
        document.querySelector('#preview-healing-remove').dispatchEvent(new Event('input'));
        document.querySelector('#preview-healing-strength').value='100';
        document.querySelector('#preview-healing-tolerance').value='1';
        document.querySelector('#preview-brush-size').value='200';
        document.querySelector('#preview-brush-feather').value='0';
        document.querySelector('#preview-brush-antialias').checked=true;
        document.querySelector('#preview-square-brush').checked=false;
        document.querySelector('#preview-background-color').value='#202020';
        document.querySelector('#preview-background-color').dispatchEvent(new Event('input'));
        document.querySelector('#preview-grid-visible').checked=false;
        document.querySelector('#preview-grid-visible').dispatchEvent(new Event('change'));
      })()`);
      const point = await evaluate(`(() => {const b=document.querySelector('#preview-image-wrap').getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)};})()`);
      window.webContents.sendInputEvent({type:'mouseDown',...point,button:'left',clickCount:1});await paintFrame();
      window.webContents.sendInputEvent({type:'mouseUp',...point,button:'left',clickCount:1});await paintFrame();
      const cleaned = await evaluate(`document.querySelector('#preview-paint-canvas').toDataURL()`);
      await click('#preview-tool-outline'); await answerMessage('apply');
      assert.equal(await evaluate(`document.querySelector('#preview-paint-canvas').toDataURL()`),cleaned,'switching tools retains Color Cleanup pixels');
      const rect = await evaluate(`(() => {const b=document.querySelector('#preview-image-wrap').getBoundingClientRect();return {x:Math.round(b.left),y:Math.round(b.top),width:Math.round(b.width),height:Math.round(b.height)};})()`);
      const screenshotPixel = async () => {
        if (await evaluate(`document.querySelector('#preview-tool-enabled').checked`)) await until(() => evaluate(`document.querySelector('#preview-outline-status').textContent.startsWith('Preview ready.')`),'pixel-exact Outline preview ready');
        await paintFrame();
        const shot=(await window.webContents.capturePage(rect)).resize({width:32,height:32});
        const bitmap=shot.toBitmap(), offset=(16*32+8)*4;
        return [...bitmap.subarray(offset,offset+4)];
      };
      const before = await screenshotPixel();
      await enableTool();
      await evaluate(`(() => {for(const [id,value] of [['size','3'],['position','outside'],['softness','0'],['opacity','100'],['color','#ffffff']]){const f=document.querySelector('#preview-outline-'+id);f.value=value;f.dispatchEvent(new Event('input',{bubbles:true}));}document.querySelector('#preview-outline-color').dispatchEvent(new Event('change',{bubbles:true}));})()`);
      const enabled = await screenshotPixel();
      assert(enabled[2]>before[2]+30,'Enable visibly outlines the cleaned character instead of the hidden original');
      assert.equal(await evaluate(`document.querySelector('#preview-image-wrap').classList.contains('outline-preview') && !document.querySelector('#preview-outline-canvas').hidden`),true);
      assert.equal(await evaluate(`document.querySelector('#preview-paint-canvas').toDataURL()`),cleaned,'live Outline does not bake into the paint canvas');
      await click('#preview-tool-enabled');
      assert.deepEqual(await screenshotPixel(),before,'disabling Outline restores the cleaned result');
      await click('#undo');
      assert.deepEqual(await screenshotPixel(),enabled,'Undo restores the enabled outline preview');
      const exactPreview = await evaluate(`document.querySelector('#preview-outline-canvas').toDataURL()`);
      realOutlineProcessing = true;
      await click('#preview-outline-apply');
      await until(() => evaluate(`!document.querySelector('#preview-tool-enabled').checked && document.querySelector('#preview-image').naturalWidth===38`),'real Outline after Color Cleanup');
      assert.equal(await evaluate(`(() => {const i=document.querySelector('#preview-image'),c=document.createElement('canvas');c.width=i.naturalWidth;c.height=i.naturalHeight;c.getContext('2d').drawImage(i,0,0);return c.toDataURL();})()`),exactPreview,'every preview pixel matches Apply after Color Cleanup');
      const source = nativeImage.createFromPath(realOutlineRequests.at(-1).path);
      assert.deepEqual(source.getSize(),{width:32,height:32});
      const sourcePixels=source.toBitmap();
      assert.equal(sourcePixels[(16*32+6)*4+3],0,'Outline Apply receives the background removed by Color Cleanup');
      assert(sourcePixels[(16*32+16)*4+3]>0 && sourcePixels[(16*32+16)*4+3]<255,'Apply retains recovered foreground transparency');
      await click('#undo');
      await until(() => evaluate(`document.querySelector('#preview-image').naturalWidth===32`),'Undo real Outline');
      assert.equal(await evaluate(`document.querySelector('#preview-paint-canvas').toDataURL()`),cleaned,'Undo applied Outline preserves the cleaned image');
      for (const settings of [
        {position:'inside',size:3,softness:0,opacity:100,color:'#ff30a0'},
        {position:'inside',size:4,softness:2,opacity:45,color:'#09e5c7'},
        {position:'center',size:1,softness:0,opacity:75,color:'#80adff'},
        {position:'center',size:5,softness:2,opacity:60,color:'#123456'},
        {position:'outside',size:2,softness:0,opacity:35,color:'#efc345'},
        {position:'outside',size:4,softness:3,opacity:90,color:'#ffffff'},
        {position:'center',size:3,softness:2,opacity:55,color:'#ab5cef',crop:{x:6,y:4,width:20,height:24}}
      ]) {
        const {crop,...outlineSettings}=settings;
        if (crop) {
          await click('#preview-tool-crop');
          await editCropFields(crop);
          await evaluate(`document.querySelector('#preview-crop-scope').value='current';`);
          await click('#preview-crop-apply');
          await click('#preview-tool-outline');
        }
        await enableTool();
        await evaluate(`(() => {for(const [id,value] of Object.entries(${JSON.stringify(outlineSettings)})){const f=document.querySelector('#preview-outline-'+id);f.value=String(value);f.dispatchEvent(new Event('input',{bubbles:true}));}document.querySelector('#preview-outline-color').dispatchEvent(new Event('change',{bubbles:true}));})()`);
        await until(() => evaluate(`document.querySelector('#preview-outline-status').textContent.startsWith('Preview ready.')`),'Outline parity preview');
        const preview = await evaluate(`document.querySelector('#preview-outline-canvas').toDataURL()`);
        const dimensions = await evaluate(`(() => {const c=document.querySelector('#preview-outline-canvas');return [c.width,c.height];})()`);
        const requests = realOutlineRequests.length;
        await click('#preview-outline-apply');
        const resultUrl = pathToFileURL(path.join(temporary,`outline-regression-${requests+1}.png`)).href;
        await until(() => evaluate(`document.querySelector('#preview-image').src===${JSON.stringify(resultUrl)} && document.querySelector('#preview-image').complete && !document.querySelector('#preview-tool-enabled').checked`),'Outline parity Apply');
        assert.deepEqual(await evaluate(`[document.querySelector('#preview-image').naturalWidth,document.querySelector('#preview-image').naturalHeight]`),dimensions,'preview and Apply use identical padded bounds');
        assert.equal(await evaluate(`(() => {const i=document.querySelector('#preview-image'),c=document.createElement('canvas');c.width=i.naturalWidth;c.height=i.naturalHeight;c.getContext('2d').drawImage(i,0,0);return c.toDataURL();})()`),preview,'exact Outline preview/Apply pixels: '+JSON.stringify(settings));
        if (crop) assert.deepEqual(nativeImage.createFromPath(realOutlineRequests.at(-1).path).getSize(),{width:20,height:24},'Outline uses the cropped Color Cleanup result');
        await click('#undo');
        assert.equal(await evaluate(`document.querySelector('#preview-paint-canvas').toDataURL()`),cleaned,'Undo retains the cleaned source for each outline mode');
      }
      realOutlineProcessing = false;
      await click('#preview-tool-hand');
      media=[blue]; await importMedia(); await click('#preview-tool-brush');
      await evaluate(`document.querySelector('#preview-brush-size').value='3';document.querySelector('#preview-brush-opacity').value='100';`);
      const brushPoint=await evaluate(`(() => {const b=document.querySelector('#preview-image-wrap').getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)};})()`);
      window.webContents.sendInputEvent({type:'mouseDown',...brushPoint,button:'left',clickCount:1});await paintFrame();
      window.webContents.sendInputEvent({type:'mouseUp',...brushPoint,button:'left',clickCount:1});await paintFrame();
      await click('#preview-tool-outline'); await answerMessage('apply'); await enableTool();
      await until(() => evaluate(`document.querySelector('#preview-outline-status').textContent.startsWith('Preview ready.')`),'Outline after brush-only edits');
      assert.equal(await evaluate(`(() => {const c=document.querySelector('#preview-outline-canvas');return [...c.getContext('2d').getImageData(c.width/2,c.height/2,1,1).data].some((v,i)=>i<3&&v>0);})()`),true,'Outline includes brush-only edits');
      let previousOutlinePreview=await evaluate(`document.querySelector('#preview-outline-canvas').toDataURL()`);
      for (const selector of ['#preview-outline-size','#preview-outline-softness','#preview-outline-opacity']) {
        await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
        await pressKey(selector==='#preview-outline-opacity'?'Left':'Right');
        await until(() => evaluate(`document.querySelector('#preview-outline-status').textContent.startsWith('Preview ready.') && document.querySelector('#preview-outline-canvas').toDataURL()!==${JSON.stringify(previousOutlinePreview)}`),'live Outline native keyboard update: '+selector);
        previousOutlinePreview=await evaluate(`document.querySelector('#preview-outline-canvas').toDataURL()`);
      }
      for (const fraction of [.35,.6,.2]) {
        const position=await evaluate(`(() => {const f=document.querySelector('#preview-outline-size');f.scrollIntoView({block:'nearest'});const b=f.getBoundingClientRect();return {x:Math.round(b.left+b.width*${fraction}),y:Math.round(b.top+b.height/2)};})()`);
        window.webContents.sendInputEvent({type:'mouseDown',...position,button:'left',clickCount:1});
        window.webContents.sendInputEvent({type:'mouseUp',...position,button:'left',clickCount:1});
        await until(() => evaluate(`document.querySelector('#preview-outline-status').textContent.startsWith('Preview ready.') && document.querySelector('#preview-outline-canvas').toDataURL()!==${JSON.stringify(previousOutlinePreview)}`),'live Outline native mouse update');
        previousOutlinePreview=await evaluate(`document.querySelector('#preview-outline-canvas').toDataURL()`);
      }
      const slider=await evaluate(`(() => {const b=document.querySelector('#preview-outline-size').getBoundingClientRect();return {left:b.left,width:b.width,y:Math.round(b.top+b.height/2)};})()`);
      const sliderPosition=fraction=>({x:Math.round(slider.left+slider.width*fraction),y:slider.y});
      window.webContents.sendInputEvent({type:'mouseDown',...sliderPosition(.2),button:'left',clickCount:1});
      for (let step=1;step<=16;step++) {
        window.webContents.sendInputEvent({type:'mouseMove',...sliderPosition(.2+step*.03),button:'left'});
        await new Promise(resolve=>setTimeout(resolve,40));
      }
      assert.notEqual(await evaluate(`document.querySelector('#preview-outline-canvas').toDataURL()`),previousOutlinePreview,'Outline refreshes while the slider is still held and moving');
      window.webContents.sendInputEvent({type:'mouseUp',...sliderPosition(.68),button:'left',clickCount:1});
      await until(() => evaluate(`document.querySelector('#preview-outline-status').textContent.startsWith('Preview ready.')`),'Outline settles on the final dragged setting');
      const draggedOutlinePreview=await evaluate(`document.querySelector('#preview-outline-canvas').toDataURL()`);
      await click('#undo');
      await until(() => evaluate(`document.querySelector('#preview-outline-status').textContent.startsWith('Preview ready.') && document.querySelector('#preview-outline-canvas').toDataURL()===${JSON.stringify(previousOutlinePreview)}`),'Undo restores the previous live Outline size');
      await click('#redo');
      await until(() => evaluate(`document.querySelector('#preview-outline-status').textContent.startsWith('Preview ready.') && document.querySelector('#preview-outline-canvas').toDataURL()===${JSON.stringify(draggedOutlinePreview)}`),'Redo restores the final dragged Outline size');
      realOutlineProcessing=true;
      const draggedResultUrl=pathToFileURL(path.join(temporary,`outline-regression-${realOutlineRequests.length+1}.png`)).href;
      await click('#preview-outline-apply');
      await until(() => evaluate(`document.querySelector('#preview-image').src===${JSON.stringify(draggedResultUrl)} && document.querySelector('#preview-image').complete && !document.querySelector('#preview-tool-enabled').checked`),'Apply final dragged Outline settings');
      assert.equal(await evaluate(`(() => {const i=document.querySelector('#preview-image'),c=document.createElement('canvas');c.width=i.naturalWidth;c.height=i.naturalHeight;c.getContext('2d').drawImage(i,0,0);return c.toDataURL();})()`),draggedOutlinePreview,'Apply uses the final live slider result, not an intermediate request');
      await click('#undo');
      await enableTool();
      await until(() => evaluate(`document.querySelector('#preview-outline-status').textContent.startsWith('Preview ready.')`),'Outline re-enabled after undoing Apply');
      realOutlineProcessing=false;
      await click('#preview-tool-enabled');
      assert.equal(await evaluate(`getComputedStyle(document.querySelector('#preview-paint-canvas')).filter`),'none','disabling clears the live filter');
      holdOutlinePreview = true;
      releaseOutlinePreview = null;
      await enableTool();
      await until(() => Boolean(releaseOutlinePreview),'pending outline preview');
      assert.equal(await evaluate(`document.querySelector('#preview-outline-progress').hidden`),false,'Outline shows progress while waiting for processing');
      window.webContents.send('images:progress',{operationId:heldOutlineRequest.operationId,current:20,total:100,message:'Calculating outline…'});
      await until(() => evaluate(`document.querySelector('#preview-outline-progress').value===20`),'Outline receives processing progress');
      assert.equal(await evaluate(`document.querySelector('#preview-outline-status').getAttribute('aria-busy')`),'true','pending preview reports working status');
      const obsolete = path.join(temporary,`outline-preview-${outlinePreviewSequence}.png`);
      await click('#preview-tool-enabled');
      assert.equal(await evaluate(`document.querySelector('#preview-outline-progress').hidden`),true,'Discard immediately hides Outline progress');
      releaseOutlinePreview();
      await until(() => discardedOutlinePreviews.includes(obsolete),'obsolete outline preview output cleaned');
      assert.equal(await evaluate(`!document.querySelector('#preview-image-wrap').classList.contains('outline-preview') && document.querySelector('#preview-outline-canvas').hidden`),true,'discarded asynchronous previews cannot return');
    }
    {
      await window.webContents.reload();
      await until(() => evaluate(`document.querySelector('#preview-tool-hand')?.classList.contains('selected')`),'fresh image for Auto Keep hair');
      media=[autoKeepHair]; await importMedia(); await click('#preview-tool-healing');
      assert.equal(await evaluate(`document.querySelector('#preview-healing-auto-keep').checked`),false,'Auto Keep is opt-in');
      await evaluate(`(() => {
        const auto=document.querySelector('#preview-healing-auto-keep');auto.checked=true;auto.dispatchEvent(new Event('change'));
        document.querySelector('#preview-healing-remove').value='#00f000';
        document.querySelector('#preview-healing-remove').dispatchEvent(new Event('input'));
        document.querySelector('#preview-healing-tolerance').value='1';
        document.querySelector('#preview-healing-strength').value='100';
        document.querySelector('#preview-brush-size').value='5';
        document.querySelector('#preview-brush-feather').value='0';
        document.querySelector('#preview-brush-antialias').checked=false;
        document.querySelector('#preview-square-brush').checked=true;
      })()`);
      assert.equal(await evaluate(`document.querySelector('#preview-healing-keep').disabled && !document.querySelector('#preview-healing-hair-controls').hidden`),true,'hair controls replace manual Keep');
      const hairPoint=await evaluate(`(() => {const b=document.querySelector('#preview-image-wrap').getBoundingClientRect();return {x:Math.round(b.left+b.width*.5),y:Math.round(b.top+b.height*.5)};})()`);
      const hairPixel=()=>evaluate(`Array.from(document.querySelector('#preview-paint-canvas').getContext('2d').getImageData(16,16,1,1).data)`);
      const drawHair=async()=>{
        window.webContents.sendInputEvent({type:'mouseDown',...hairPoint,button:'left',clickCount:1});await paintFrame();
        window.webContents.sendInputEvent({type:'mouseMove',x:hairPoint.x+8,y:hairPoint.y,button:'left'});await paintFrame();
        window.webContents.sendInputEvent({type:'mouseMove',x:hairPoint.x+16,y:hairPoint.y,button:'left'});await paintFrame();
        const held=await evaluate(`document.querySelector('#preview-paint-canvas').toDataURL()`);
        window.webContents.sendInputEvent({type:'mouseUp',x:hairPoint.x+16,y:hairPoint.y,button:'left',clickCount:1});await paintFrame();
        assert.equal(await evaluate(`document.querySelector('#preview-paint-canvas').toDataURL()`),held,'hair preview stays identical on release');
      };
      await drawHair();
      const actual=await hairPixel();
      assert(actual.every((value,c)=>Math.abs(value-[120,30,10,128][c])<=1),`Auto Keep recovers brown hair without forcing it to black: ${JSON.stringify(actual)}`);
      await click('#undo');assert.equal(await evaluate(`document.querySelector('#preview-paint-canvas').hidden`),true,'one Undo removes a completed hair stroke');
      await click('#redo');assert.deepEqual(await hairPixel(),actual);
      await click('#preview-paint-apply');assert.deepEqual(await hairPixel(),actual,'Apply retains the hair preview');
      const prior=saves;await click('#save-project');await until(()=>saves>prior,'save hair cleanup stroke');
      const stroke=savedProject.images[0].paintStrokes[0];
      assert.deepEqual([stroke.autoKeep,stroke.sampleDistance,stroke.recoverTransparency],[true,24,true]);
      const priorOpen=opens;validProjectOpen=true;await click('#open-project');await answerMessage('discard');await until(()=>opens>priorOpen,'open saved hair cleanup');
      await until(async()=>JSON.stringify(await hairPixel())===JSON.stringify(actual),'saved Auto Keep stroke renders again');
      await click('#preview-tool-healing');
      await evaluate(`{const control=document.querySelector('#preview-healing-recover-transparency');control.checked=false;control.dispatchEvent(new Event('change'));}`);
      await drawHair();
      assert.equal((await hairPixel())[3],actual[3],'opacity-preserving pass keeps existing strand alpha');
      await click('#preview-paint-discard');
      await until(() => evaluate(`(() => {const prefs=JSON.parse(localStorage.getItem('frameline.preferences'));return prefs.healingAutoKeep===true && prefs.healingRecoverTransparency===false;})()`),'Auto Keep preferences saved');
      await window.webContents.reload();
      await until(() => evaluate(`document.querySelector('#preview-tool-hand')?.classList.contains('selected')`),'startup remains Hand with hair settings');
      assert.equal(await evaluate(`document.querySelector('#preview-healing-auto-keep').checked && !document.querySelector('#preview-healing-recover-transparency').checked && !document.querySelector('#preview-healing-auto').checked`),true,'hair preferences restore while Auto Remove stays off');
    }
    refinePython?.close();
    assert.deepEqual(errors, []);
    console.log("Electron smoke checks passed: Refine Edges with real Python processing, local red/blue edge repair, exact preview/Apply pixels, batch undo, draft-safe saving, Discard and obsolete-preview cleanup, saved refine settings; click-local color cleanup detection, brush footprint and edited-image sampling, default Auto off, manual fallback and saved preferences, two-color healing brush, exact held/released healing pixels, healing Apply/Discard/undo/save/preferences, live edge anti-aliasing, local color fringe cleanup, opacity controls, saved defaults and Apply to all, themed hover/keyboard/modal tooltips, startup Hand, grouped tools, feature Enable/Apply/Discard, direct Brush/Eraser, click-open Grid, Ctrl/Shift multi-selection, scoped exports, loop playback, themed controls, save/open, brush rendering, editable crop bounds, linked live padding, exact preview/application pixels, draft-safe saving, undo/Clear, preview preferences, and zoom/pan persistence.");
    // Force the test host to exit after checking the renderer; normal app close
    // is exercised through the bridge above and must not gate test teardown.
    app.exit(0);
  } catch (error) {
    refinePython?.close();
    console.error(error);
    console.error("Renderer errors:", errors);
    if (window && !window.isDestroyed()) {
      console.error("Current toast:", await evaluate(`document.querySelector('#toast').textContent`));
      console.error("Preview state:", await evaluate(`({resolution:document.querySelector('#preview-resolution').textContent,
        tool:document.querySelector('#preview-tool-name').textContent, enabled:document.querySelector('#preview-tool-enabled').checked,
        padding:Array.from(document.querySelectorAll('[data-padding-field]')).map(field=>field.value),
        crop:Array.from(document.querySelectorAll('[data-crop-field]')).map(field=>field.value),
        paddingPreview:document.querySelector('#preview-image-wrap').classList.contains('padding-preview')})`));
      console.error("Dropdown state:", await evaluate(`({value:document.querySelector('#export-format').value, open:document.querySelector('#export-format').matches(':open'), focus:document.activeElement.id})`));
    }
    app.exit(1);
  }
});
// Electron may still hold profile files during quit on Windows. Remove the
// temporary profile from a separate process after this host has exited.
app.on("quit", () => {
  const { spawn } = require("node:child_process");
  const cleanup = spawn(process.execPath, ["-e", `
    const fs = require('node:fs');
    const path = require('node:path');
    const root = require('node:os').tmpdir();
    const directory = process.argv[1];
    const relative = path.relative(root, directory);
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
      setTimeout(() => fs.rmSync(directory, {recursive:true, force:true, maxRetries:3}), 1000);
    }
  `, temporary], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, stdio: "ignore", windowsHide: true });
  cleanup.unref();
});
