import test from 'node:test';
import assert from 'node:assert/strict';
import {TimelineCleanupThumbnails} from '../src/renderer/view/timeline-cleanup-thumbnails.mjs';

const card = id => ({image:{id},element:{}});

test('edited thumbnails reuse duplicate sources, limit concurrency and release owned files',async () => {
  let running = 0, maximum = 0;
  const calls = [], released = [];
  const thumbnails = new TimelineCleanupThumbnails(async image => {
    calls.push(image.id); maximum = Math.max(maximum,++running);
    await new Promise(resolve => setImmediate(resolve));
    running--;
    return {path:`/preview/${image.id}.png`,temporary:image.id !== 'original'};
  },paths => released.push(...paths));
  const cards = [card('a'),card('b'),card('a'),card('c'),card('original')];
  await thumbnails.render(cards);
  assert.equal(maximum,2);
  assert.deepEqual(calls,['a','b','c','original']);
  assert.equal(cards[0].element.src,cards[2].element.src);
  thumbnails.clear();
  assert.deepEqual(released,['/preview/a.png','/preview/b.png','/preview/c.png']);
});

test('obsolete thumbnail results never update cards and release late outputs',async () => {
  let finish;
  const released = [], item = card('old');
  const thumbnails = new TimelineCleanupThumbnails(() => new Promise(resolve => {finish=resolve;}),paths => released.push(...paths));
  const pending = thumbnails.render([item]);
  thumbnails.clear();
  finish({path:'/preview/obsolete.png',temporary:true});
  await pending;
  assert.equal(item.element.src,undefined);
  assert.deepEqual(released,['/preview/obsolete.png']);
});

test('thumbnail failures reject the current preview and retain ownership of successful outputs',async () => {
  const released = [];
  const thumbnails = new TimelineCleanupThumbnails(async image => {
    if (image.id === 'broken') throw new Error('Missing source');
    return {path:'/preview/ok.png',temporary:true};
  },paths => released.push(...paths));
  await assert.rejects(thumbnails.render([card('ok'),card('broken')]),/Missing source/);
  thumbnails.clear();
  assert.deepEqual(released,['/preview/ok.png']);
});
