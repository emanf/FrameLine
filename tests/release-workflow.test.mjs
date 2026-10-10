import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const {assertOwner, selectRelease, publishAssets} = require('../scripts/release-workflow.cjs');

const context = {eventName:'workflow_dispatch', actor:'emanf', repo:{owner:'emanf', repo:'FrameLine'}};

/** Restore workflow environment variables after each API simulation. */
function ownerEnvironment(t) {
  const previous = process.env.GITHUB_TRIGGERING_ACTOR;
  process.env.GITHUB_TRIGGERING_ACTOR = 'emanf';
  t.after(() => {
    if (previous === undefined) delete process.env.GITHUB_TRIGGERING_ACTOR;
    else process.env.GITHUB_TRIGGERING_ACTOR = previous;
  });
}

/** Stub API calls so release publication behavior can be verified without touching GitHub. */
function fixture() {
  const operations = [];
  const outputs = {};
  const release = {id:123, tag_name:'v1.0.0', html_url:'https://example.com/release', draft:false, prerelease:false, immutable:false};
  const summary = {addHeading(){return this;}, addTable(){return this;}, addLink(){return this;}, addList(){return this;}, async write(){}};
  const core = {setOutput(name, value){outputs[name] = value;}, summary, info(){}};
  const github = {rest:{repos:{
    async getLatestRelease(){return {data:release};},
    async getRelease(){return {data:release};},
    async getCommit(){return {data:{sha:'a'.repeat(40)}};},
    listReleaseAssets(){},
    async deleteReleaseAsset(values){operations.push(['delete', values.asset_id]);},
    async uploadReleaseAsset(values){operations.push(['upload', values.name, values.owner, values.release_id]);},
  }}, async paginate(){return [{id:456, name:'FrameLine-test.zip'}, {id:789, name:'manual.pdf'}];}};
  return {github, core, release, operations, outputs};
}

test('only the personal repository owner can dispatch or rerun; forks use their own owner', () => {
  assert.doesNotThrow(() => assertOwner(context, 'emanf'));
  assert.throws(() => assertOwner({...context, actor:'someone'}, 'someone'), /Only the repository owner/);
  assert.throws(() => assertOwner(context, 'someone'), /Only the repository owner/);
  assert.throws(() => assertOwner({...context, eventName:'pull_request'}, 'emanf'), /Only the repository owner/);
  assert.doesNotThrow(() => assertOwner({...context, actor:'forker', repo:{owner:'forker', repo:'FrameLine'}}, 'forker'));
});

test('latest release selection freezes its ID, tag and exact commit', async t => {
  ownerEnvironment(t);
  const values = fixture();
  await selectRelease({...values, context});
  assert.deepEqual(values.outputs, {id:'123', tag:'v1.0.0', sha:'a'.repeat(40)});
});

test('missing or immutable releases fail before builds', async t => {
  ownerEnvironment(t);
  const values = fixture();
  values.release.immutable = true;
  await assert.rejects(selectRelease({...values, context}), /immutable/);
  values.github.rest.repos.getLatestRelease = async () => {throw Object.assign(new Error('missing'), {status:404});};
  await assert.rejects(selectRelease({...values, context}), /Create one in Releases/);
});

test('upload resolves collisions before modifying anything and replaces only matching assets', async t => {
  ownerEnvironment(t);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'frameline-release-'));
  t.after(() => rm(directory, {recursive:true, force:true}));
  await writeFile(path.join(directory, 'FrameLine-test.zip'), 'verified fixture');
  const values = fixture();
  const args = {...values, context, releaseId:123, tag:'v1.0.0', sha:'a'.repeat(40), directory};
  await assert.rejects(publishAssets({...args, replace:false}), /Assets already exist/);
  assert.deepEqual(values.operations, []);
  await publishAssets({...args, replace:true});
  assert.deepEqual(values.operations, [['delete',456], ['upload','FrameLine-test.zip','emanf',123]]);
});

test('a moved release tag prevents any upload', async t => {
  ownerEnvironment(t);
  const values = fixture();
  await assert.rejects(publishAssets({...values, context, releaseId:123, tag:'v1.0.0',
    sha:'b'.repeat(40), directory:'unused', replace:true}), /tag was moved/);
  assert.deepEqual(values.operations, []);
});
