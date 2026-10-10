import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const {PythonBridge}=createRequire(import.meta.url)('../src/main/python-bridge.cjs');

async function fixture(directory,width,height) {
  const stride=Math.ceil(width*3/4)*4;
  const bytes=Buffer.alloc(54+stride*height,80);
  bytes.fill(0,0,54);bytes.write('BM');bytes.writeUInt32LE(bytes.length,2);bytes.writeUInt32LE(54,10);
  bytes.writeUInt32LE(40,14);bytes.writeInt32LE(width,18);bytes.writeInt32LE(height,22);
  bytes.writeUInt16LE(1,26);bytes.writeUInt16LE(24,28);
  const file=path.join(directory,`${width}.bmp`);await fs.writeFile(file,bytes);return file;
}

test('regular Python requests stream correlated progress without resolving before the result', async () => {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'frameline-bridge-'));
  const bridge=new PythonBridge();
  try {
    const source=await fixture(directory,16,12);const progress=[];
    const result=await bridge.request('apply_outline',{path:source,output:path.join(directory,'outline.png'),outline:{size:3}},event=>progress.push(event));
    assert.equal(result.width,20);
    assert(progress.some(event=>event.current>0 && event.current<event.total));
    assert.equal(progress.at(-1).current,100);
    assert.equal(new Set(progress.map(event=>event.id)).size,1);
    assert.equal(bridge.pending.size,0);
  } finally {bridge.close();await fs.rm(directory,{recursive:true,force:true});}
});

test('new preview cancels obsolete processing while a separate Apply worker remains available', async () => {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'frameline-preview-'));
  const preview=new PythonBridge(),apply=new PythonBridge();
  try {
    const big=await fixture(directory,1024,1024),small=await fixture(directory,16,12);
    let started;
    const running=new Promise(resolve=>{started=resolve;});
    const obsolete=preview.request('apply_outline',{path:big,output:path.join(directory,'obsolete.png'),outline:{size:100}},event=>{
      if(event.message==='Calculating outline…') started();
    },{group:'preview'});
    const cancelled=assert.rejects(obsolete,error=>error.code==='PREVIEW_SUPERSEDED');
    await running;
    const marker=preview.pending.values().next().value.cancelFile;
    const latest=preview.request('apply_outline',{path:small,output:path.join(directory,'latest.png'),outline:{size:1}},null,{group:'preview'});
    const inspected=await apply.request('inspect_images',{paths:[small]});
    assert.equal(inspected[0].width,16);
    assert.equal((await latest).width,18);
    await cancelled;
    await assert.rejects(fs.access(path.join(directory,'obsolete.png')));
    for(let attempt=0;attempt<20;attempt++) {
      try {await fs.access(marker);await new Promise(resolve=>setTimeout(resolve,10));}
      catch {break;}
    }
    await assert.rejects(fs.access(marker));
    assert.equal(preview.pending.size,0);
  } finally {preview.close();apply.close();await fs.rm(directory,{recursive:true,force:true});}
});
