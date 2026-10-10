import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkingSourceCache } from '../src/renderer/model/working-source-cache.mjs';

test('preview source is built once, retired files remain until every reader releases', async () => {
  const disposed=[];
  const cache=new WorkingSourceCache(path => disposed.push(path));
  const project={}; const source={project,imageKey:'edited'};
  let loads=0;
  const load=async()=>{loads++;return {path:'current.png',temporary:true};};
  const first=await cache.acquire(source,load);
  const second=await cache.acquire(source,load);
  assert.equal(loads,1);
  cache.clear();
  assert.deepEqual(disposed,[]);
  first.release(); first.release();
  assert.deepEqual(disposed,[]);
  second.release();
  assert.deepEqual(disposed,['current.png']);
});

test('Undo/source changes invalidate cache; late builds and failed builds are cleaned safely', async () => {
  const disposed=[];const cache=new WorkingSourceCache(path=>disposed.push(path));const project={};
  let resolve;
  const pending=cache.acquire({project,imageKey:'old'},()=>new Promise(done=>{resolve=done;}));
  await Promise.resolve();
  const current=await cache.acquire({project,imageKey:'new'},async()=>({path:'new.png',temporary:true}));
  resolve({path:'old.png',temporary:true});
  const old=await pending;
  assert.deepEqual(disposed,[]);
  old.release();
  assert.deepEqual(disposed,['old.png']);
  current.release();cache.clear();
  assert.deepEqual(disposed,['old.png','new.png']);
  await assert.rejects(cache.acquire({project,imageKey:'broken'},async()=>{throw new Error('decode');}),/decode/);
  const retry=await cache.acquire({project,imageKey:'broken'},async()=>({path:'original.png',temporary:false}));
  retry.release();cache.clear();
  assert.deepEqual(disposed,['old.png','new.png']);
});
