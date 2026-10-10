const fs = require('node:fs/promises');
const path = require('node:path');

/** Require the personal repository owner for initial dispatches and subsequent reruns. */
function assertOwner(context, triggeringActor = process.env.GITHUB_TRIGGERING_ACTOR) {
  const owner = context.repo.owner.toLowerCase();
  if (context.eventName !== 'workflow_dispatch' || context.actor.toLowerCase() !== owner ||
      String(triggeringActor).toLowerCase() !== owner) {
    throw new Error('Only the repository owner may start or rerun release builds.');
  }
}

/** Reject releases which cannot accept additional downloadable assets. */
function assertWritableRelease(release) {
  if (release.draft || release.prerelease) throw new Error('Publish a stable release before running this workflow.');
  if (release.immutable) throw new Error('The latest release is immutable and cannot accept new assets.');
}

/** Freeze the latest published release and its tagged commit before any build starts. */
async function selectRelease({github, context, core}) {
  assertOwner(context);
  let release;
  try {
    ({data:release} = await github.rest.repos.getLatestRelease(context.repo));
  } catch (error) {
    if (error.status === 404) throw new Error('No published stable release exists. Create one in Releases, then run this workflow.');
    throw error;
  }
  assertWritableRelease(release);
  const {data:commit} = await github.rest.repos.getCommit({...context.repo, ref:`refs/tags/${release.tag_name}`});
  core.setOutput('id', String(release.id));
  core.setOutput('tag', release.tag_name);
  core.setOutput('sha', commit.sha);
  await core.summary.addHeading('Release build').addTable([
    [{data:'Release', header:true}, {data:'Source commit', header:true}],
    [release.tag_name, commit.sha],
  ]).write();
}

/** Upload only verified files to the frozen release, preserving unrelated assets. */
async function publishAssets({github, context, core, releaseId, tag, sha, replace, directory}) {
  assertOwner(context);
  const {data:release} = await github.rest.repos.getRelease({...context.repo, release_id:releaseId});
  assertWritableRelease(release);
  if (release.tag_name !== tag) throw new Error('The selected release tag changed while builds were running.');
  const {data:commit} = await github.rest.repos.getCommit({...context.repo, ref:`refs/tags/${tag}`});
  if (commit.sha !== sha) throw new Error('The release tag was moved while builds were running. Run a new build.');
  const entries = await fs.readdir(directory, {withFileTypes:true});
  if (!entries.length || entries.some(entry => !entry.isFile())) throw new Error('Expected verified release files only.');
  const files = entries.map(entry => entry.name).sort();
  const assets = await github.paginate(github.rest.repos.listReleaseAssets, {...context.repo, release_id:releaseId, per_page:100});
  const existing = new Map(assets.map(asset => [asset.name, asset]));
  const collisions = files.filter(name => existing.has(name));
  if (collisions.length && !replace) {
    throw new Error(`Assets already exist: ${collisions.join(', ')}. Enable Replace matching generated assets to update them.`);
  }
  // Resolve every collision before modifying the release; never remove other attachments.
  for (const name of files) {
    if (existing.has(name)) await github.rest.repos.deleteReleaseAsset({...context.repo, asset_id:existing.get(name).id});
    const data = await fs.readFile(path.join(directory, name));
    await github.rest.repos.uploadReleaseAsset({...context.repo, release_id:releaseId, name, data,
      headers:{'content-type':'application/octet-stream', 'content-length':String(data.length)}});
    core.info(`Uploaded ${name}`);
  }
  await core.summary.addHeading('Downloads uploaded').addLink('Open release', release.html_url)
    .addList(files).write();
}

module.exports = {assertOwner, selectRelease, publishAssets};
