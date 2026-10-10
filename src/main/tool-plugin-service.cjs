const fs = require('node:fs/promises');
const path = require('node:path');
const {pathToFileURL} = require('node:url');

/** Discover trusted local extensions and resolve their entry points inside each folder. */
class ToolPluginService {
  constructor(directories) { this.directories = directories; this.plugins = new Map(); this.errors = []; }

  /** Resolve a manifest file without allowing an entry point to escape its plugin folder. */
  async resolveFile(folder, value, extension) {
    if (typeof value !== 'string' || path.extname(value) !== extension || path.isAbsolute(value)) throw new Error(`Expected a relative ${extension} entry point.`);
    const root = await fs.realpath(folder);
    const resolved = await fs.realpath(path.resolve(root, value));
    const relative = path.relative(root, resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !(await fs.stat(resolved)).isFile()) throw new Error('Entry points must stay inside the plugin folder.');
    return resolved;
  }

  /** Refresh the allowlist once at startup, reporting invalid folders individually. */
  async discover() {
    this.plugins.clear(); this.errors = [];
    for (const directory of this.directories) {
      let entries;
      try { entries = await fs.readdir(directory, {withFileTypes:true}); }
      catch (error) { if (error.code !== 'ENOENT') this.errors.push(`${directory}: ${error.message}`); continue; }
      for (const entry of entries.sort((a,b) => a.name.localeCompare(b.name))) {
        if (!entry.isDirectory()) continue;
        const folder = path.join(directory, entry.name);
        try {
          const manifestPath = await this.resolveFile(folder, 'plugin.json', '.json');
          if ((await fs.stat(manifestPath)).size > 65536) throw new Error('Manifest is too large.');
          const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
          if (!/^[a-z][a-z0-9-]{0,63}$/.test(manifest.id) || manifest.apiVersion !== 1 || typeof manifest.name !== 'string' || !manifest.name.trim() || manifest.name.length > 80) throw new Error('Invalid plugin ID, name, or API version.');
          if (this.plugins.has(manifest.id) || ['clear','background','crop','outline','padding','refine','clean','hand','brush','healing','eraser'].includes(manifest.id)) throw new Error('Plugin ID is already registered.');
          const entryPath = await this.resolveFile(folder, manifest.entry, '.mjs');
          const processor = manifest.processor ? await this.resolveFile(folder, manifest.processor, '.py') : null;
          this.plugins.set(manifest.id, {id:manifest.id,name:manifest.name,entryURL:pathToFileURL(entryPath).href,processor});
        } catch (error) { this.errors.push(`${entry.name}: ${error.message}`); }
      }
    }
    return this.list();
  }

  /** Return renderer metadata without exposing processor path selection through IPC. */
  list() { return {plugins:[...this.plugins.values()].map(({processor,...plugin}) => ({...plugin,processorAvailable:Boolean(processor)})), errors:[...this.errors]}; }
  processor(id) { const processor = this.plugins.get(id)?.processor; if (!processor) throw new Error('No Python processor registered for this tool.'); return processor; }
}
module.exports = {ToolPluginService};
