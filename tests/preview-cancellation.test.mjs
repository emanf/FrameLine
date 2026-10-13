import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {ImageProcessingService} from '../src/renderer/application/controllers/image-processing-service.mjs';
const {previewFailure} = createRequire(import.meta.url)('../src/main/ipc/preview-failure.cjs');

test('preview IPC returns a cancellation envelope while genuine processing failures still reject', () => {
  assert.deepEqual(previewFailure(Object.assign(new Error('superseded'), {code: 'PREVIEW_SUPERSEDED'})),
    {cancelled: true, code: 'PREVIEW_SUPERSEDED'});
  const failure = new Error('Cannot decode image');
  assert.throws(() => previewFailure(failure), error => error === failure);
});

test('renderer reconstructs cancellation codes and always releases progress subscriptions', async () => {
  const previous = globalThis.window;
  let disposed = 0;
  globalThis.window = {frameLine: {
    onImageProgress: () => () => {disposed++;},
    previewBackground: async () => ({cancelled: true, code: 'PREVIEW_SUPERSEDED'})
  }};
  try {
    const service = Object.create(ImageProcessingService.prototype);
    service.application = {};
    await assert.rejects(service.runImageRequest('previewBackground', {}), error => error.code === 'PREVIEW_SUPERSEDED');
    assert.equal(disposed, 1);
    window.frameLine.previewBackground = async () => ({path: '/valid.png'});
    assert.deepEqual(await service.runImageRequest('previewBackground', {}), {path: '/valid.png'});
    window.frameLine.previewBackground = async () => {throw new Error('Invalid image');};
    await assert.rejects(service.runImageRequest('previewBackground', {}), /Invalid image/);
    assert.equal(disposed, 3);
  } finally {globalThis.window = previous;}
});
