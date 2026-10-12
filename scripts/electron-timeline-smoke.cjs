/** Exercise timeline dialogs, selection actions, and playback controls in the real renderer. */
const {app,BrowserWindow,ipcMain,clipboard} = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {pathToFileURL} = require('node:url');
const sharp = require('sharp');
const {createHash}=require('node:crypto');
const root = path.resolve(__dirname,'..');
const version=require('../package.json').version;
let window, temporary, source, saved, saves = 0, workingCount = 0;
const workingPaths = new Set();
const errors = [];
const evaluate = code => window.webContents.executeJavaScript(code,true);
const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
async function until(check,label) {
  const deadline = Date.now()+15000;
  while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve=>setTimeout(resolve,25)); }
  throw new Error(`Timed out: ${label}`);
}
async function settings(values) {
  await evaluate(`(() => {for(const [name,value] of Object.entries(${JSON.stringify(values)})) {
    const field = document.querySelector('#cleanup-'+name);
    if(typeof value === 'boolean') field.checked=value; else field.value=String(value);
  } document.querySelector('#timeline-cleanup-form').dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await previewReady();
}
const previewReady = () => until(()=>evaluate(`document.querySelector('#timeline-cleanup-dialog').open && document.querySelector('#cleanup-progress').hidden`),'cleanup result');
const previewNumbers = () => evaluate(`Array.from(document.querySelectorAll('#cleanup-preview .cleanup-preview-item > span'),item=>Number(item.textContent.slice(1)))`);
async function save() {
  await until(()=>evaluate(`document.querySelector('#preview-local-brush-progress').hidden`),'brush ready before save');
  const previous = saves; await click('#save-project');
  await until(()=>saves>previous,'save project');
  await until(()=>evaluate(`!document.querySelector('#operation-progress-dialog').open`),'save closes');
}

app.whenReady().then(async()=>{
  try {
    temporary = await fs.mkdtemp(path.join(os.tmpdir(),'frameline-timeline-'));
    app.setPath('userData',temporary);
    const {createProject} = await import(pathToFileURL(path.join(root,'src/renderer/model/project-model.mjs')).href);
    const images = [];
    for(let i=0;i<21;i++) {
      const filename = path.join(temporary,`frame-${i}.png`);
      await sharp({create:{width:64,height:64,channels:4,background:{r:i*10,g:90,b:200-i*5,alpha:1}}}).png().toFile(filename);
      images.push({id:`image-${i}`,name:`Frame ${i+1}`,path:filename,width:64,height:64});
    }
    source = {...createProject(),name:'Timeline checks',images,clips:images.map((image,i)=>({id:`clip-${i}`,imageId:image.id,durationFrames:1}))};
    ipcMain.handle('tools:list',()=>[]);
    ipcMain.handle('window:is-maximized',()=>false);
    ipcMain.handle('window:enable-close-guard',()=>null);
    ipcMain.handle('images:cancel-preview',()=>null);
    require('../src/main/ipc/app-handlers.cjs').registerAppHandlers();
    ipcMain.handle('project:open',()=>({path:path.join(temporary,'test.frameline'),project:structuredClone(source)}));
    ipcMain.handle('project:save',(_event,project)=>{saved=structuredClone(project); saves++; return path.join(temporary,'saved.frameline');});
    ipcMain.handle('images:store-working',async (_event,bytes)=>{
      const filename = path.join(temporary,`working-${++workingCount}.png`);
      await fs.writeFile(filename,bytes);
      const {width,height} = await sharp(filename).metadata();
      workingPaths.add(filename);
      return {path:filename,width,height};
    });
    ipcMain.handle('images:discard-outputs',async (_event,paths)=>{
      for(const filename of paths) if(workingPaths.delete(filename)) await fs.rm(filename,{force:true});
    });
    window = new BrowserWindow({show:false,width:1440,height:960,webPreferences:{preload:path.join(root,'src/preload.cjs'),contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
    window.webContents.on('console-message',(_event,...args)=>{
      const details = typeof args[0] === 'object' ? args[0] : {level:args[0],message:args[1]};
      if(details.level === 'error' || details.level === 3) errors.push(details.message);
    });
    await window.loadFile(path.join(root,'src/renderer/index.html'));
    await until(()=>evaluate(`document.querySelector('#stats-fps').textContent === '24'`),'startup');
    assert.equal(await evaluate(`document.querySelector('#timeline-scroll').scrollHeight <= document.querySelector('#timeline-scroll').clientHeight`),true,'initial timeline fits its contents');
    assert.equal(await evaluate(`document.querySelector('#timeline-cleanup').disabled`),true);
    const toolbox=await evaluate(`(() => {
      const bounds=id=>{const r=document.getElementById(id).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
      return {clear:bounds('preview-clear-effects'),recover:bounds('preview-tool-recover'),background:bounds('preview-remove-background'),crop:bounds('preview-tool-crop'),
        outline:bounds('preview-tool-outline'),padding:bounds('preview-tool-padding'),hand:bounds('preview-tool-hand'),brush:bounds('preview-tool-brush'),
        dividers:Array.from(document.querySelectorAll('.preview-toolbox > .tool-divider'),node=>node.getBoundingClientRect().y),
        area:document.querySelector('.preview-toolbox').getBoundingClientRect().width};
    })()`);
    assert.equal(toolbox.background.y,toolbox.crop.y,'Remove Background and Crop share the first effect row');
    assert.equal(toolbox.outline.y,toolbox.padding.y,'Outline and Padding share the next effect row');
    assert.equal(toolbox.hand.y,toolbox.brush.y,'Hand and Brush share the first basic row');
    assert.equal(toolbox.crop.x-toolbox.background.x,34,'columns preserve their button size and gap');
    assert.equal(toolbox.clear.y,toolbox.recover.y,'Clear and Recover share the top row');
    assert.equal(toolbox.recover.x-toolbox.clear.x,34,'Recover occupies the column beside Clear');
    assert.equal(await evaluate(`document.querySelector('#preview-tool-recover').parentElement.dataset.toolGroup`),'clear');
    assert(toolbox.clear.y<toolbox.dividers[0] && toolbox.dividers[0]<toolbox.background.y);
    assert(toolbox.padding.y<toolbox.dividers[1] && toolbox.dividers[1]<toolbox.hand.y,'effects and basic tools remain separate');
    assert.equal(toolbox.area,76);

    await click('#app-about');
    await until(()=>evaluate(`document.querySelector('#about-dialog').open && document.querySelector('[data-app-info="version"]').textContent === ${JSON.stringify(version)}`),'About metadata');
    if(process.env.FRAMELINE_ABOUT_SCREENSHOT) {
      await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
      await fs.writeFile(process.env.FRAMELINE_ABOUT_SCREENSHOT,(await window.webContents.capturePage()).toPNG());
    }
    const copied=[];
    const writeText=clipboard.writeText; clipboard.writeText=value=>copied.push(value);
    try {
      for(const name of ['email','website','github']) {
        await click(`[data-app-copy="${name}"]`);
        await until(()=>evaluate(`document.querySelector('[data-app-copy="${name}"] span').textContent === 'check'`),'copy feedback');
      }
      assert.deepEqual(copied,['emanf.cco@gmail.com','http://emanf.ir','https://github.com/emanf/FrameLine']);
      const style=await evaluate(`(() => {const s=getComputedStyle(document.querySelector('.about-copy'));return [s.borderTopWidth,s.borderRadius];})()`);
      assert.deepEqual(style,['0px','50%']);
    } finally {clipboard.writeText=writeText;}
    await click('#about-dialog [data-about-close]');
    assert.equal(await evaluate(`document.querySelector('#loop-toggle').parentElement.classList.contains('transport-bar') && document.querySelector('#clip-properties').closest('.timeline-heading') !== null`),true);
    const square = await evaluate(`(() => {const r=document.querySelector('#loop-toggle').getBoundingClientRect();return [r.width,r.height];})()`);
    assert.equal(square[0],square[1]);
    await click('#loop-toggle'); assert.equal(await evaluate(`document.querySelector('#loop-toggle').getAttribute('aria-pressed')`),'false');
    await click('#undo'); assert.equal(await evaluate(`document.querySelector('#loop-toggle').getAttribute('aria-pressed')`),'true');
    await click('#import-images');
    await until(()=>evaluate(`document.querySelector('#message-dialog').open`),'add dialog');
    assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('#message-actions button'),button=>button.textContent)`),['Cancel','Create Empty Images','Import media']);
    await click('#message-actions [data-action="cancel"]');
    await click('#open-project');
    await until(()=>evaluate(`document.querySelector('#stats-frames').textContent === '21'`),'fixture opens');
    assert.equal(await evaluate(`document.querySelector('#timeline-scroll').scrollHeight <= document.querySelector('#timeline-scroll').clientHeight`),true,'selected timeline fits its contents');
    if(process.env.FRAMELINE_TOOLBOX_SCREENSHOT) {
      await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
      await fs.writeFile(process.env.FRAMELINE_TOOLBOX_SCREENSHOT,(await window.webContents.capturePage()).toPNG());
    }

    window.setSize(800,560);
    await until(()=>evaluate(`innerWidth === 800`),'compact window');
    assert.equal(await evaluate(`document.querySelector('#timeline-scroll').scrollHeight <= document.querySelector('#timeline-scroll').clientHeight`),true,'compact timeline fits without vertical scrolling');
    assert.equal(await evaluate(`document.querySelector('#window-close').getBoundingClientRect().right <= innerWidth`),true,'all title bar buttons fit');
    await evaluate(`document.querySelector('#timeline-resizer').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));`);
    assert.equal(await evaluate(`Boolean(document.documentElement.style.getPropertyValue('--timeline-height'))`),true,'manual timeline sizing remains available');
    await evaluate(`document.documentElement.style.removeProperty('--timeline-height');`);
    window.setSize(1440,960);
    await until(()=>evaluate(`innerWidth === 1440`),'normal window');
    await click('#timeline-cleanup'); await previewReady();
    assert.deepEqual(await previewNumbers(),[1,6,11,16,21]);
    assert.equal(await evaluate(`document.querySelector('#stats-frames').textContent`),'21','preview is nonmutating');
    if(process.env.FRAMELINE_TIMELINE_SCREENSHOT) await fs.writeFile(process.env.FRAMELINE_TIMELINE_SCREENSHOT,(await window.webContents.capturePage()).toPNG());
    await click('#cleanup-cancel');
    await until(()=>evaluate(`!document.querySelector('#timeline-cleanup-dialog').open && document.activeElement.id === 'timeline-scroll'`),'cleanup cancel completes');
    assert.equal(await evaluate(`document.querySelector('#stats-frames').textContent`),'21');
    await click('#timeline-cleanup'); await previewReady();
    await settings({action:'remove',mode:'odd'});
    assert.deepEqual(await previewNumbers(),[2,4,6,8,10,12,14,16,18,20]);
    await settings({action:'keep',mode:'every'});
    await click('#cleanup-preview [data-exclude="6"]'); await previewReady();
    assert.deepEqual(await previewNumbers(),[1,11,16,21]);
    await click('#cleanup-reset-overrides'); await previewReady();
    assert.deepEqual(await previewNumbers(),[1,6,11,16,21]);
    await click('#cleanup-apply');
    await until(()=>evaluate(`document.querySelector('#stats-frames').textContent === '5'`),'cleanup applies');
    await save();
    assert.deepEqual(saved.clips.map(clip=>clip.id),['clip-0','clip-5','clip-10','clip-15','clip-20']);
    assert.equal(saved.images.length,21);
    await click('#undo'); assert.equal(await evaluate(`document.querySelector('#stats-frames').textContent`),'21');
    await click('#redo'); assert.equal(await evaluate(`document.querySelector('#stats-frames').textContent`),'5');
    await click('#undo'); await save();
    // Select a nonadjacent group using the same click modifiers as desktop input.
    await evaluate(`(() => {
      document.querySelector('#clips [data-clip-id="clip-0"]').dispatchEvent(new MouseEvent('click',{bubbles:true}));
      document.querySelector('#clips [data-clip-id="clip-2"]').dispatchEvent(new MouseEvent('click',{bubbles:true,ctrlKey:true}));
      document.querySelector('#clips [data-clip-id="clip-4"]').dispatchEvent(new MouseEvent('click',{bubbles:true,ctrlKey:true}));
      document.querySelector('#clips [data-clip-id="clip-2"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:350,clientY:650}));})()`);
    await until(()=>evaluate(`Boolean(document.querySelector('.context-menu [aria-label="Reverse"]'))`),'Reverse selection menu');
    await click('.context-menu [aria-label="Reverse"]'); await save();
    assert.deepEqual(saved.clips.slice(0,5).map(clip=>clip.id),['clip-4','clip-1','clip-2','clip-3','clip-0']);
    await click('#undo'); await save();
    assert.deepEqual(saved.clips.slice(0,5).map(clip=>clip.id),['clip-0','clip-1','clip-2','clip-3','clip-4']);
    // Open a long held clip and exercise the module worker and bounded preview pages.
    source = {...createProject(),name:'Held frame checks',images:[images[0]],clips:[{id:'held',imageId:images[0].id,durationFrames:50000}]};
    await click('#open-project'); await until(()=>evaluate(`document.querySelector('#stats-frames').textContent === '50000'`),'held fixture');
    await click('#timeline-cleanup'); await previewReady(); await settings({unit:'frames',every:5});
    assert.equal((await previewNumbers()).length,48);
    assert.equal(await evaluate(`document.querySelector('#cleanup-pages').textContent`),'of 209');
    await click('#cleanup-next'); assert.equal((await previewNumbers())[0],241);
    await evaluate(`document.querySelector('#cleanup-page').value='209';document.querySelector('#cleanup-page').dispatchEvent(new Event('change',{bubbles:true}));`);
    assert.equal((await previewNumbers()).at(-1),49996);
    await settings({mode:'custom',custom:'0'});
    assert.equal(await evaluate(`document.querySelector('#cleanup-apply').disabled && !document.querySelector('#cleanup-error').hidden`),true);
    await settings({mode:'every',every:5});
    await click('#cleanup-apply'); await until(()=>evaluate(`document.querySelector('#stats-frames').textContent === '10000'`),'held frames apply');
    await click('#undo'); assert.equal(await evaluate(`document.querySelector('#stats-frames').textContent`),'50000');
    // Compare the displayed square cursor directly with the live raster at small brush sizes.
    await click('#preview-tool-brush');
    for(const size of [1,2,3]) {
      await evaluate(`(() => {
        document.querySelector('#preview-brush-size').value=${JSON.stringify(String(size))};
        document.querySelector('#preview-brush-antialias').checked=false;
        document.querySelector('#preview-square-brush').checked=true;
        document.querySelector('#preview-brush-feather').value='0';
        document.querySelector('#preview-brush-opacity').value='100';
        document.querySelector('#preview-brush-color').value='#ff0055';
        document.querySelector('#preview-brush-color').dispatchEvent(new Event('input'));
      })()`);
      await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
      const point = await evaluate(`(() => {const r=document.querySelector('#preview-image-wrap').getBoundingClientRect();return {x:Math.round(r.left+r.width*.51),y:Math.round(r.top+r.height*.56)};})()`);
      window.webContents.sendInputEvent({type:'mouseMove',...point});
      window.webContents.sendInputEvent({type:'mouseDown',...point,button:'left',clickCount:1});
      await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
      const held = await evaluate(`(() => {
        const canvas=document.querySelector('#preview-paint-canvas'), data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
        const pixels=[];for(let y=0;y<canvas.height;y++) for(let x=0;x<canvas.width;x++) if(data[(y*canvas.width+x)*4+3]) pixels.push([x,y]);
        const image=document.querySelector('#preview-image-wrap').getBoundingClientRect(),cursor=document.querySelector('#preview-brush-cursor').getBoundingClientRect();
        return {pixels,png:canvas.toDataURL(),cursor:[cursor.left,cursor.top,cursor.width,cursor.height],
          image:[image.left,image.top,image.width/canvas.width,image.height/canvas.height]};
      })()`);
      assert.equal(held.pixels.length,size*size,'square stamp occupies its requested pixels');
      const left=Math.min(...held.pixels.map(p=>p[0])),top=Math.min(...held.pixels.map(p=>p[1]));
      const expected=[held.image[0]+left*held.image[2],held.image[1]+top*held.image[3],size*held.image[2],size*held.image[3]];
      assert(held.cursor.every((value,index)=>Math.abs(value-expected[index])<.04),'cursor and painted square have the same screen bounds');
      window.webContents.sendInputEvent({type:'mouseUp',...point,button:'left',clickCount:1});
      await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
      assert.equal(await evaluate(`document.querySelector('#preview-paint-canvas').toDataURL()`),held.png,'release keeps the painted pixels');
      await click('#undo');
    }
    // Protection is persistent and restoration commits precisely one gesture at a time.
    await click('#preview-tool-ignore');
    await until(()=>evaluate(`document.querySelector('#preview-tool-name').textContent === 'IGNORE BRUSH'`),'Ignore selection');
    await evaluate(`(() => {
      document.querySelector('#preview-brush-size').value='8';
      document.querySelector('#preview-brush-antialias').checked=false;
      document.querySelector('#preview-square-brush').checked=true;
    })()`);
    const ignorePoint=await evaluate(`(() => {const r=document.querySelector('#preview-image-wrap').getBoundingClientRect();return {x:Math.round(r.left+r.width*.5),y:Math.round(r.top+r.height*.5)};})()`);
    window.webContents.sendInputEvent({type:'mouseDown',...ignorePoint,button:'left',clickCount:1});
    window.webContents.sendInputEvent({type:'mouseUp',...ignorePoint,button:'left',clickCount:1});
    await until(()=>evaluate(`!document.querySelector('#preview-ignore-overlay').hidden`),'Ignore stroke saved');
    await save(); assert.equal(saved.images[0].ignoreStrokes.length,1);
    assert.equal(await evaluate(`document.querySelector('#preview-paint-actions').hidden`),true);
    const protectedProject=structuredClone(saved);
    assert.equal(await evaluate(`document.querySelector('#preview-background-control').nextElementSibling.id`),'preview-ignore-toggle');
    await click('#preview-ignore-toggle');
    assert.equal(await evaluate(`document.querySelector('#preview-ignore-overlay').hidden && !document.querySelector('#preview-ignore-visible').checked && document.querySelector('#preview-ignore-enabled').checked`),true,'hiding the overlay leaves protection enabled');
    assert.equal(await evaluate(`document.querySelector('#preview-ignore-toggle').getAttribute('aria-pressed')`),'false');
    await save();assert.deepEqual(saved,protectedProject,'overlay visibility does not modify project data');
    await until(()=>evaluate(`JSON.parse(localStorage.getItem('frameline.preferences')).previewIgnoreVisible === false`),'overlay visibility saved');
    await click('#preview-ignore-visible');
    assert.equal(await evaluate(`!document.querySelector('#preview-ignore-overlay').hidden && document.querySelector('#preview-ignore-toggle').getAttribute('aria-pressed') === 'true'`),true,'tool checkbox synchronizes the toolbar toggle');
    await click('#preview-ignore-toggle');await click('#preview-ignore-toggle');
    assert.equal(await evaluate(`!document.querySelector('#preview-ignore-overlay').hidden`),true);
    await click('#undo');assert.equal(await evaluate(`document.querySelector('#preview-ignore-overlay').hidden`),true);
    await click('#redo');assert.equal(await evaluate(`document.querySelector('#preview-ignore-overlay').hidden`),false);
    await click('#preview-ignore-enabled'); await save(); assert.equal(saved.images[0].ignoreEnabled,false);
    await click('#undo');await save();assert.equal(saved.images[0].ignoreEnabled,true);
    await click('#preview-ignore-toggle');
    await click('#preview-tool-brush');
    await until(()=>evaluate(`document.querySelector('#preview-tool-name').textContent === 'BRUSH'`),'Brush selection');
    window.webContents.sendInputEvent({type:'mouseDown',...ignorePoint,button:'left',clickCount:1});
    window.webContents.sendInputEvent({type:'mouseUp',...ignorePoint,button:'left',clickCount:1});
    await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    const protectedAlpha=await evaluate(`(() => {const c=document.querySelector('#preview-paint-canvas');return c.getContext('2d').getImageData(32,32,1,1).data[3];})()`);
    assert.equal(protectedAlpha,0,'Brush leaves protected pixels untouched');
    await click('#preview-paint-apply'); await save(); assert.equal(saved.images[0].paintStrokes[0].ignoreStrokes.length,1);
    await click('#preview-ignore-toggle');
    source={...createProject(),name:'Recover checks',images:[{...images[0],originalPath:images[0].path,originalDimensions:{width:64,height:64},
      paintStrokes:[{tool:'brush',color:'#ff0000',opacity:1,size:64,shape:'square',antiAlias:false,feather:0,points:[[.5,.5]]}],
      ignoreStrokes:structuredClone(saved.images[0].ignoreStrokes)}],clips:[{id:'recover',imageId:images[0].id,durationFrames:1}]};
    await click('#open-project');
    await until(()=>evaluate(`document.querySelector('#stats-frames').textContent === '1'`),'Recover fixture');
    await click('#preview-tool-recover');
    await until(()=>evaluate(`document.querySelector('#preview-tool-name').textContent === 'RECOVER BRUSH' && document.querySelector('#preview-local-brush-progress').hidden && !document.querySelector('#preview-brush-size').disabled`),'Recover prepared');
    await evaluate(`document.querySelector('#preview-brush-size').value='4';`);
    const recoverPoint=await evaluate(`(() => {const r=document.querySelector('#preview-image-wrap').getBoundingClientRect();return {x:Math.round(r.left+r.width*.5),y:Math.round(r.top+r.height*.5)};})()`);
    window.webContents.sendInputEvent({type:'mouseDown',...recoverPoint,button:'left',clickCount:1});
    await evaluate(`new Promise(resolve=>requestAnimationFrame(resolve))`);
    const recoveredLive=await evaluate(`Array.from(document.querySelector('#preview-paint-canvas').getContext('2d').getImageData(32,32,1,1).data)`);
    assert.deepEqual(recoveredLive,[0,90,200,255],'Recover restores original even inside Ignore');
    window.webContents.sendInputEvent({type:'mouseUp',...recoverPoint,button:'left',clickCount:1});
    await until(()=>evaluate(`document.querySelector('#preview-local-brush-progress').hidden && !document.querySelector('#preview-brush-size').disabled`),'Recover commits');
    await save(); const recoveredPath=saved.images[0].path;
    assert.notEqual(recoveredPath,images[0].path);assert.equal(saved.images[0].paintStrokes,undefined);
    const recoveredBuffer=await sharp(recoveredPath).raw().toBuffer();
    assert.deepEqual(Array.from(recoveredBuffer.subarray((32*64+32)*4,(32*64+32)*4+4)),recoveredLive);
    assert.deepEqual(Array.from(recoveredBuffer.subarray(0,4)),[255,0,0,255],'Recover preserves unrelated edits');
    assert.equal(saved.images[0].ignoreStrokes.length,1);
    await click('#undo');await save();assert.equal(saved.images[0].path,images[0].path);assert.equal(saved.images[0].paintStrokes.length,1);
    await click('#redo');await save();assert.equal(saved.images[0].path,recoveredPath);
    await until(()=>evaluate(`document.querySelector('#preview-local-brush-progress').hidden && !document.querySelector('#preview-brush-size').disabled`),'Recover ready after Redo');
    await click('#preview-tool-hand');
    // Hold long strokes on a realistic image and compare live, release, Apply and history pixels.
    const largeOriginal=path.join(temporary,'large-original.png'),largeWorking=path.join(temporary,'large-working.png');
    await sharp({create:{width:1280,height:960,channels:4,background:{r:0,g:90,b:200,alpha:1}}}).png().toFile(largeOriginal);
    await sharp({create:{width:1280,height:960,channels:4,background:{r:210,g:40,b:50,alpha:1}}}).png().toFile(largeWorking);
    const pixelHash=selector=>evaluate(`(async()=>{
      const c=document.querySelector(${JSON.stringify(selector)}),data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
      const hash=await crypto.subtle.digest('SHA-256',data);return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
    })()`);
    const timingResults=[];
    for(const tool of ['brush','ignore','recover']) {
      source={...createProject(),name:'Long '+tool,images:[{id:'long',name:'Long stroke',path:largeWorking,width:1280,height:960,
        originalPath:largeOriginal,originalDimensions:{width:1280,height:960}}],clips:[{id:'long-clip',imageId:'long',durationFrames:1}]};
      await click('#open-project');await until(()=>evaluate(`document.querySelector('#project-name').value === 'Long '+${JSON.stringify(tool)}`),'large fixture');
      await click('#preview-tool-'+tool);
      await until(()=>evaluate(`document.querySelector('#preview-tool-name').textContent === ${JSON.stringify(tool==='brush'?'BRUSH':tool.toUpperCase()+' BRUSH')} && document.querySelector('#preview-local-brush-progress').hidden && !document.querySelector('#preview-brush-size').disabled`),'large brush ready');
      await evaluate(`(() => {
        document.querySelector('#preview-brush-size').value='32';document.querySelector('#preview-brush-antialias').checked=true;
        document.querySelector('#preview-square-brush').checked=false;document.querySelector('#preview-brush-feather').value=${tool==='brush' ? "'30'" : "'0'"};
        document.querySelector('#preview-brush-opacity').value='65';
        window.strokeTestPointer=null;
        window.addEventListener('pointerdown',event=>window.strokeTestPointer=event.pointerId,{once:true,capture:true});
      })()`);
      const first=await evaluate(`(() => {const r=document.querySelector('#preview-image-wrap').getBoundingClientRect();return {x:Math.round(r.left+r.width*.79),y:Math.round(r.top+r.height*.5)};})()`);
      window.webContents.sendInputEvent({type:'mouseMove',...first});
      window.webContents.sendInputEvent({type:'mouseDown',...first,button:'left',clickCount:1});
      await evaluate(`new Promise(resolve=>requestAnimationFrame(resolve))`);
      const timings=await evaluate(`(async()=>{
        const r=document.querySelector('#preview-image-wrap').getBoundingClientRect(),stage=document.querySelector('#preview-stage'),times=[];
        let last,previous=performance.now();
        for(let frame=0;frame<130;frame++) {
          for(let sample=0;sample<6;sample++) {
            const i=frame*6+sample,angle=i*.025;
            last={x:Math.round(r.left+r.width*(.5+Math.cos(angle)*(.29+i*.00001))),y:Math.round(r.top+r.height*(.5+Math.sin(angle)*(.3+i*.000008)))};
            stage.dispatchEvent(new PointerEvent('pointermove',{pointerId:window.strokeTestPointer,clientX:last.x,clientY:last.y,button:-1,buttons:1,pointerType:'mouse',bubbles:true}));
          }
          await new Promise(resolve=>requestAnimationFrame(resolve));
          const now=performance.now();times.push(now-previous);previous=now;
        }
        delete window.strokeTestPointer;
        const median=a=>a.sort((a,b)=>a-b)[Math.floor(a.length/2)];
        return {last,bounds:[r.left,r.top,r.width,r.height],early:median(times.slice(0,30)),late:median(times.slice(-30)),samples:780};
      })()`);
      const selector=tool==='ignore' ? '#preview-ignore-overlay' : '#preview-paint-canvas';
      window.webContents.sendInputEvent({type:'mouseMove',...timings.last});
      await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
      const heldHash=await pixelHash(selector);
      assert(timings.late<timings.early*3+25,tool+' stroke work does not increase after two seconds');
      window.webContents.sendInputEvent({type:'mouseUp',...timings.last,button:'left',clickCount:1});
      await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
      if(tool==='brush') {
        assert.equal(await pixelHash(selector),heldHash,'long Brush release keeps the live pixels');
        await click('#preview-paint-apply');assert.equal(await pixelHash(selector),heldHash,'long Brush Apply uses identical coverage');
      } else if(tool==='ignore') assert.equal(await pixelHash(selector),heldHash,'long Ignore release keeps the overlay pixels');
      await save();
      if(tool==='recover') {
        assert.equal(createHash('sha256').update(await sharp(saved.images[0].path).ensureAlpha().raw().toBuffer()).digest('hex'),heldHash,'long Recover output equals held pixels');
      }
      await click('#undo');await save();
      assert.equal(saved.images[0].paintStrokes,undefined);assert.equal(saved.images[0].ignoreStrokes,undefined);assert.equal(saved.images[0].path,largeWorking,'one Undo restores the entire long gesture');
      await click('#redo');await save();
      if(tool==='ignore') assert.equal(await pixelHash(selector),heldHash,'long Ignore Redo uses identical coverage');
      if(tool==='brush') assert.equal(await pixelHash(selector),heldHash,'long Brush Redo uses identical coverage');
      await until(()=>evaluate(`document.querySelector('#preview-local-brush-progress').hidden`),'long brush ready');
      await click('#preview-tool-hand');
      timingResults.push({tool,earlyMs:Number(timings.early.toFixed(1)),lateMs:Number(timings.late.toFixed(1))});
    }
    console.log('Long-stroke UI frame timings:',JSON.stringify(timingResults));
    const retainedWorking=workingPaths.size;
    // Saved edits must be visible in result thumbnails without changing project assets.
    source = {...createProject(),name:'Edited thumbnails',images:[{...images[0],crop:{left:0,top:0,right:0.5,bottom:1}}],
      clips:[{id:'edited',imageId:images[0].id,durationFrames:10}]};
    await click('#open-project'); await until(()=>evaluate(`document.querySelector('#stats-frames').textContent === '10'`),'edited fixture');
    await click('#timeline-cleanup'); await previewReady();
    await until(()=>evaluate(`document.querySelector('#cleanup-preview img').naturalWidth === 32`),'cropped thumbnail');
    assert.equal(workingPaths.size,retainedWorking+1);
    await click('#cleanup-cancel');
    await until(()=>workingPaths.size === retainedWorking,'temporary thumbnail released');
    assert.equal(source.images[0].path,images[0].path);
    assert.deepEqual(errors,[]);
    console.log('Timeline UI checks passed: pattern preview, cancellation, exceptions, worker paging, Apply/Undo/Redo, selected Reverse, square Loop, timing controls, Add action order, About metadata, initial height, square brush cursor alignment, About clipboard, Ignore/Recover gestures and Undo/Redo');
    window.destroy(); app.quit();
  } catch(error) {
    console.error(error); console.error(errors);
    if(window && !window.isDestroyed()) console.error(await evaluate(`document.querySelector('#toast').textContent`));
    app.exit(1);
  }
});

// Chromium releases profile locks after exit; a detached helper owns only this test directory.
app.on('quit',()=>{
  if(!temporary) return;
  const {spawn} = require('node:child_process');
  const cleanup = spawn(process.execPath,['-e',`
    const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
    const directory = path.resolve(process.argv[1]), relative = path.relative(os.tmpdir(),directory);
    if(relative && !relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(directory).startsWith('frameline-timeline-'))
      setTimeout(()=>fs.rmSync(directory,{recursive:true,force:true,maxRetries:3}),1000);
  `,temporary],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:'ignore',windowsHide:true});
  cleanup.unref();
});
