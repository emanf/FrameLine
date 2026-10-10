import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
const {acquireSingleInstance,prepareChromiumCaches}=createRequire(import.meta.url)('../src/main/startup.cjs');

test('a second launch restores and focuses the primary window; secondary acquires no ownership',()=>{
  const app=new EventEmitter();let locked=true;app.requestSingleInstanceLock=()=>locked;
  const calls=[];const window={isDestroyed:()=>false,isMinimized:()=>true,
    restore:()=>calls.push('restore'),show:()=>calls.push('show'),focus:()=>calls.push('focus')};
  assert.equal(acquireSingleInstance(app,{getAllWindows:()=>[window]}),true);
  app.emit('second-instance');assert.deepEqual(calls,['restore','show','focus']);
  locked=false;assert.equal(acquireSingleInstance(app,{getAllWindows:()=>[]}),false);
  assert.equal(app.listenerCount('second-instance'),1);
});

test('a launch during startup focuses the window when its first paint is ready',()=>{
  const app=new EventEmitter();app.requestSingleInstanceLock=()=>true;
  acquireSingleInstance(app,{getAllWindows:()=>[]});app.emit('second-instance');
  const window=new EventEmitter();let focused=0;
  Object.assign(window,{isDestroyed:()=>false,isMinimized:()=>false,show:()=>{},focus:()=>focused++});
  app.emit('browser-window-created',{},window);assert.equal(focused,0);
  window.emit('ready-to-show');assert.equal(focused,1);
});

test('cache recovery backs up only cache directories once and preserves all saved state',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'frameline-cache-test-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  for(const name of ['Cache','GPUCache','Local Storage','imported-images','project-assets']){
    fs.mkdirSync(path.join(root,name));fs.writeFileSync(path.join(root,name,'data'),'preserved');
  }
  fs.writeFileSync(path.join(root,'Preferences'),'preferences');
  const app={getPath:()=>root,commandLine:{appendSwitch:()=>assert.fail('no fallback needed')}};
  prepareChromiumCaches(app);
  const marker=JSON.parse(fs.readFileSync(path.join(root,'chromium-cache-version.json')));
  assert.equal(fs.readFileSync(path.join(marker.backup,'GPUCache','data'),'utf8'),'preserved');
  assert.equal(fs.readFileSync(path.join(marker.backup,'Cache','data'),'utf8'),'preserved');
  for(const name of ['Local Storage','imported-images','project-assets'])
    assert.equal(fs.readFileSync(path.join(root,name,'data'),'utf8'),'preserved');
  assert.equal(fs.readFileSync(path.join(root,'Preferences'),'utf8'),'preferences');
  fs.mkdirSync(path.join(root,'GPUCache'));fs.writeFileSync(path.join(root,'GPUCache','new'),'new cache');
  prepareChromiumCaches(app);
  assert.equal(fs.readFileSync(path.join(root,'GPUCache','new'),'utf8'),'new cache');
  assert.equal(fs.readdirSync(root).filter(name=>name.startsWith('cache-backup-')).length,1);
});

test('denied cache recovery keeps existing files and bypasses disk caches without disabling rendering',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'frameline-cache-test-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'GPUCache'));fs.writeFileSync(path.join(root,'GPUCache','data'),'locked');
  const switches=[];const app={getPath:()=>root,commandLine:{appendSwitch:(...args)=>switches.push(args)}};
  const denied={...fs,renameSync:()=>{throw Object.assign(new Error('Access denied'),{code:'EACCES'});}};
  const warnings=[];prepareChromiumCaches(app,{fileSystem:denied,warn:message=>warnings.push(message)});
  assert.equal(fs.readFileSync(path.join(root,'GPUCache','data'),'utf8'),'locked');
  assert.deepEqual(switches,[['disk-cache-dir',path.join(root,'chromium-cache-fallback')],['disable-gpu-shader-disk-cache']]);
  assert.equal(warnings.length,1);assert.equal(fs.existsSync(path.join(root,'chromium-cache-version.json')),false);
});
