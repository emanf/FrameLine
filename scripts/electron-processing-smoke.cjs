// Exercise production IPC/preload/Python workers instead of the UI suite's mocks.
const {app, BrowserWindow, dialog}=require('electron');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const {once}=require('node:events');
const {spawn}=require('node:child_process');
const sharp=require('sharp');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'frameline-processing-test-'));
app.setPath('userData',temporary);
fs.cpSync(path.join(__dirname,'../docs/examples/invert-colors'),path.join(temporary,'extensions/invert-colors'),{recursive:true});
require('../src/main.cjs');

app.whenReady().then(async()=>{
  const window=BrowserWindow.getAllWindows()[0] ?? (await once(app,'browser-window-created'))[1];
  window.hide();
  window.webContents.setBackgroundThrottling(false);
  try {
    if(window.webContents.isLoading()) await once(window.webContents,'did-finish-load');
    let secondLaunch=false;
    app.once('second-instance',()=>{secondLaunch=true;});
    const secondary=spawn(process.execPath,[path.join(__dirname,'electron-singleton-probe.cjs'),temporary],
      {windowsHide:true,stdio:['ignore','pipe','pipe']});
    let secondaryOutput='';secondary.stdout.on('data',data=>{secondaryOutput+=data;});secondary.stderr.on('data',data=>{secondaryOutput+=data;});
    const [secondaryCode]=await once(secondary,'exit');
    assert.equal(secondaryCode,0,secondaryOutput);
    assert.equal(secondLaunch,true,'second launch reaches the primary process');
    assert.equal(BrowserWindow.getAllWindows().length,1,'only the primary window exists');
    assert.equal(window.isVisible(),true,'second launch brings the existing window forward');
    window.hide();
    const timeout=setTimeout(()=>{console.error('Production processing test timed out.');process.exitCode=1;app.exit(1);},60000);
    const svgPath=path.join(temporary,'character.SVG');
    const avifPath=path.join(temporary,'character.AVIF');
    const svg='<svg xmlns="http://www.w3.org/2000/svg" width="32" height="24"><rect x="8" y="6" width="16" height="12" fill="#2864c8" fill-opacity="0.5"/></svg>';
    fs.writeFileSync(svgPath,svg);
    await sharp(Buffer.from(svg)).avif({lossless:true,effort:0,chromaSubsampling:'4:4:4'}).toFile(avifPath);
    const savedPath=path.join(temporary,'formats.frameline');
    dialog.showSaveDialog=async()=>({canceled:false,filePath:savedPath});
    dialog.showOpenDialog=async options=>({canceled:false,filePaths:options.filters?.[0]?.name==='FrameLine Project'?[savedPath]:[svgPath,avifPath]});
    const formatResult=await window.webContents.executeJavaScript(`(async()=>{
      const paths=${JSON.stringify([svgPath,avifPath])};
      const chosen=await window.frameLine.chooseImages();
      const media=await window.frameLine.chooseMedia();
      const progress=[];
      const imported=await window.frameLine.inspectImages(paths,event=>progress.push(event));
      const alpha=[];const edited=[];
      for(const input of imported){
        const image=new Image();
        await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('Imported image did not load'));
          image.src='file:///'+input.path.replaceAll('\\\\','/');});
        const canvas=document.createElement('canvas');canvas.width=32;canvas.height=24;
        const context=canvas.getContext('2d');context.drawImage(image,0,0);
        alpha.push([context.getImageData(0,0,1,1).data[3],context.getImageData(8,6,1,1).data[3]]);
        edited.push(await window.frameLine.renderCurrentImage({path:input.path,crop:{left:0.25,top:0.25,right:0.75,bottom:0.75}}));
      }
      const images=imported.map((image,index)=>({...image,id:'format-'+index,name:'ImageName'+String(index+1).padStart(3,'0'),path:edited[index].path,width:16,height:12,
        originalPath:image.path,originalDimensions:{width:32,height:24}}));
      const project={version:1,name:'SVG and AVIF',fps:24,defaultDurationFrames:24,playbackSpeed:1,loopEnabled:true,
        loopStartFrame:0,loopEndFrame:null,currentFrame:0,images,clips:images.map((image,index)=>({id:'clip-'+index,imageId:image.id,durationFrames:24}))};
      const saved=await window.frameLine.saveProject(project);
      const reopened=await window.frameLine.openProject();
      const exportResult=await window.frameLine.exportImages({mode:'sources',images:reopened.project.images,output:${JSON.stringify(path.join(temporary,'format-exports'))}});
      return {chosen,media,imported,progress,alpha,edited,saved,reopened,exportResult};
    })()`);
    assert.deepEqual(formatResult.chosen,[svgPath,avifPath]);
    clearTimeout(timeout);
    assert.deepEqual(formatResult.media,[svgPath,avifPath]);
    assert.deepEqual(formatResult.alpha,[[0,128],[0,128]],'renderer decodes transparent SVG/AVIF working images');
    assert.equal(formatResult.progress.at(-1).current,2);
    assert.equal(formatResult.progress.at(-1).total,2);
    assert.equal(formatResult.saved,savedPath);
    assert.equal(formatResult.reopened.project.images.length,2);
    assert.equal(formatResult.exportResult.files,2);
    for(const [index,image] of formatResult.imported.entries()){
      assert.deepEqual([image.width,image.height,image.format],[32,24,'PNG']);
      assert.equal(image.name,index?'character.AVIF':'character.SVG');
      const reopened=formatResult.reopened.project.images[index];
      assert.equal(reopened.name,'ImageName'+String(index+1).padStart(3,'0'),'portable save keeps renamed image labels');
      const exported=path.join(temporary,'format-exports',reopened.name+'.png');
      assert.deepEqual(fs.readFileSync(exported),fs.readFileSync(reopened.path),'source export uses renamed labels and the real image extension');
      assert(fs.existsSync(reopened.path)&&fs.existsSync(reopened.originalPath));
      assert.deepEqual(fs.readFileSync(reopened.path),fs.readFileSync(formatResult.edited[index].path),'portable save preserves edited pixels');
      assert.deepEqual(fs.readFileSync(reopened.originalPath),fs.readFileSync(image.path),'portable save preserves the imported appearance for Clear');
    }
    const result=await window.webContents.executeJavaScript(`(async()=>{
      const canvas=document.createElement('canvas');canvas.width=64;canvas.height=48;
      const context=canvas.getContext('2d');context.fillStyle='#30a0dc';context.fillRect(15,10,34,28);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
      const input=await window.frameLine.storeWorkingImage(new Uint8Array(await blob.arrayBuffer()));
      const events=[];const stop=window.frameLine.onImageProgress(event=>events.push(event));
      try {
        const preview=await window.frameLine.previewImageOutline({path:input.path,outline:{size:3,position:'outside'},operationId:'outline-preview'});
        const applied=await window.frameLine.applyImageOutline({path:input.path,outline:{size:3,position:'outside'},operationId:'outline-apply'});
        const options={clean:10,repair:60,smooth:25,shrink:0,width:2};
        const refinedPreview=await window.frameLine.previewRefineEdges({path:input.path,options,operationId:'refine-preview'});
        const refinedApply=await window.frameLine.refineImageEdges({path:input.path,options,operationId:'refine-apply'});
        const pluginList=await window.frameLine.listToolPlugins();
        const pluginPreview=await window.frameLine.processToolImage({toolId:'example-invert',preview:true,path:input.path,options:{strength:75},operationId:'plugin-preview'});
        const pluginApply=await window.frameLine.processToolImage({toolId:'example-invert',path:input.path,options:{strength:75},operationId:'plugin-apply'});
        let invalidPlugin=false;try{await window.frameLine.processToolImage({toolId:'unregistered',processor:'engine.py',path:input.path});}catch{invalidPlugin=true;}
        const cleanOptions={strength:80,tolerance:32,radius:2,speckles:60};
        const cleanPreview=await window.frameLine.previewCleanPixels({path:input.path,options:cleanOptions,operationId:'clean-preview'});
        const cleanApply=await window.frameLine.cleanImagePixels({path:input.path,options:cleanOptions,operationId:'clean-apply'});
        const removed=await window.frameLine.removeBackground({path:input.path,mode:'chroma',key_color:[0,255,0],tolerance:128,softness:0,spill:0,operationId:'background-apply'});
        context.fillStyle='#e6dcd2';context.fillRect(0,0,64,48);
        context.fillStyle='#30a0dc';context.fillRect(15,10,34,28);
        const autoBlob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
        const autoInput=await window.frameLine.storeWorkingImage(new Uint8Array(await autoBlob.arrayBuffer()));
        const autoOptions={path:autoInput.path,mode:'auto',background_source:'auto',tolerance:128,softness:0,spill:0,
          ignore_strokes:[{size:.15,points:[[.1,.5],[.15,.5]]}]};
        const autoPreview=await window.frameLine.previewBackground({...autoOptions,operationId:'auto-preview'});
        const autoApplied=await window.frameLine.removeBackground({...autoOptions,operationId:'auto-apply'});
        const invalid=await window.frameLine.storeWorkingImage(new Uint8Array([1,2,3])).then(()=>false,()=>true);
        await window.frameLine.cancelImagePreview();
        return {pluginList,pluginPreview,pluginApply,invalidPlugin,input,preview,applied,refinedPreview,refinedApply,cleanPreview,cleanApply,removed,autoInput,autoPreview,autoApplied,events,invalid};
      } finally {stop();}
    })()`);
    assert.deepEqual([result.input.width,result.input.height],[64,48]);
    assert.equal(result.invalid,true);
    assert.deepEqual(result.autoPreview.background_colors,[[230,220,210]],'production Auto detects the image border color');
    for(const [first,second] of [[result.pluginPreview,result.pluginApply],[result.preview,result.applied],[result.refinedPreview,result.refinedApply],[result.cleanPreview,result.cleanApply],[result.autoPreview,result.autoApplied]]) {
      assert.deepEqual([first.width,first.height],[second.width,second.height]);
      assert.deepEqual(fs.readFileSync(first.path),fs.readFileSync(second.path),'production preview and Apply encode identical images');
    }
    for(const operationId of ['plugin-preview','plugin-apply','outline-preview','outline-apply','refine-preview','refine-apply','clean-preview','clean-apply','background-apply','auto-preview','auto-apply']) {
      const events=result.events.filter(event=>event.operationId===operationId);
      assert(events.some(event=>event.current>0 && event.current<event.total),operationId+' streams stage progress');
      assert.equal(events.at(-1).current,100);
    }
    assert.equal(result.pluginList.plugins[0].id,'example-invert');
    assert.equal(result.invalidPlugin,true,'unregistered processor selection is rejected');
    await window.webContents.executeJavaScript(`(async()=>{
      const until=async(condition)=>{for(let i=0;i<500;i++){if(await condition())return;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error('Plugin UI timeout');};
      await until(()=>document.querySelector('#preview-tool-example-invert'));
      document.querySelector('#open-project').click();
      await until(()=>document.querySelector('#image-list [data-image-id]'));
      const before=document.querySelector('#preview-image').src;
      document.querySelector('#preview-tool-example-invert').click();
      await until(()=>document.querySelector('#preview-tool-name').textContent==='INVERT COLORS');
      document.querySelector('#preview-example-invert-scope').value='all';
      document.querySelector('#preview-tool-enabled').click();
      await until(()=>document.querySelector('#preview-example-invert-status').textContent.startsWith('Preview ready'));
      const canvas=document.querySelector('#preview-refine-canvas');
      const expected=[...canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data];
      document.querySelector('#preview-example-invert-apply').click();
      await until(()=>!document.querySelector('#preview-tool-enabled').checked && !document.querySelector('#operation-progress-dialog').open);
      const image=new Image();image.src=document.querySelector('#preview-image').src;await image.decode();
      const output=document.createElement('canvas');output.width=image.naturalWidth;output.height=image.naturalHeight;output.getContext('2d').drawImage(image,0,0);
      const actual=[...output.getContext('2d').getImageData(0,0,output.width,output.height).data];
      if(JSON.stringify(actual)!==JSON.stringify(expected))throw new Error('Plugin preview and Apply differ');
      document.querySelector('#undo').click();
      await until(()=>document.querySelector('#preview-image').src===before);
      document.querySelector('#redo').click();
      document.querySelector('#save-project').click();
      await until(()=>!document.querySelector('#operation-progress-dialog').open);
    })()`);
    const pluginProject=await window.webContents.executeJavaScript('window.frameLine.openProject()');
    assert.equal(pluginProject.project.images.length,2);
    assert.ok(pluginProject.project.images.every(image=>image.originalPath && image.path!==image.originalPath),'batch plugin results preserve originals in portable saves');
    const files=[result.pluginPreview,result.pluginApply,result.input,result.preview,result.applied,result.refinedPreview,result.refinedApply,result.cleanPreview,result.cleanApply,result.removed,result.autoInput,result.autoPreview,result.autoApplied].map(item=>item.path);
    await window.webContents.executeJavaScript(`(async()=>{await window.frameLine.clearBackgroundPreview();await window.frameLine.discardProcessedImages(${JSON.stringify(files)});})()`);
    assert(files.every(file=>!fs.existsSync(file)),'generated previews and working files are discarded through ownership checks');
    console.log('Production processing checks passed: installed plugin discovery, controls, preview/Apply equality, batch undo/redo and portable save/open; SVG/AVIF import, transparency, progress, editing/export and portable save/open; binary PNG storage, dedicated previews, real stage progress, identical preview/Apply images, validation and cleanup.');
  } catch(error) {
    process.exitCode=1;
    console.error(error);
  } finally {
    window.frameLineCloseConfirmed=true;
    app.quit();
  }
});

app.on('quit',()=>{
  const relative=path.relative(os.tmpdir(),temporary);
  if(!relative || relative.startsWith('..') || path.isAbsolute(relative)) return;
  const {spawn}=require('node:child_process');
  const cleanup=spawn(process.execPath,['-e',`setTimeout(()=>require('node:fs').rmSync(process.argv[1],{recursive:true,force:true,maxRetries:3}),1000)`,temporary],
    {env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:'ignore',windowsHide:true});
  cleanup.unref();
});
app.on('will-quit',()=>{if(process.exitCode) app.exit(process.exitCode);});
