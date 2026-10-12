import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {AppInfoService} = require('../src/main/app-info-service.cjs');

test('copy contacts writes plain email and links and rejects unknown renderer values',() => {
  const copied=[],service=new AppInfoService('1',async()=>{},value=>copied.push(value));
  for(const name of ['email','website','github']) service.copyContact(name);
  assert.deepEqual(copied,['emanf.cco@gmail.com','http://emanf.ir','https://github.com/emanf/FrameLine']);
  for(const value of ['constructor','__proto__','https://other.example',null,{}]) assert.throws(()=>service.copyContact(value),/Unknown application contact/);
  assert.equal(copied.length,3);
});

test('About uses the installed version and returns independent release metadata',() => {
  const service = new AppInfoService('2.3.4',async () => {});
  const info = service.getInfo();
  assert.equal(info.version,'2.3.4');
  assert.equal(info.author,'eManF');
  assert.match(info.lastUpdated,/^\d{4}-\d{2}-\d{2}$/);
  info.website = 'https://other.example';
  assert.equal(service.getInfo().website,'http://emanf.ir');
});

test('external navigation accepts only named public links and propagates host failures',async () => {
  const opened = [], service = new AppInfoService('1.0.0',async url => opened.push(url));
  for (const name of ['website','github','email']) await service.openLink(name);
  assert.deepEqual(opened,['http://emanf.ir','https://github.com/emanf/FrameLine','mailto:emanf.cco@gmail.com']);
  for (const invalid of ['https://other.example','file:///C:/example.exe','__proto__','constructor',null,{}]) {
    await assert.rejects(service.openLink(invalid),/Unknown application link/);
  }
  assert.equal(opened.length,3);
  const failing = new AppInfoService('1.0.0',async () => {throw new Error('Browser unavailable');});
  await assert.rejects(failing.openLink('website'),/Browser unavailable/);
});
