const metadata = require('../shared/app-info.json');

/** Expose release metadata and open only the app's named public contact links. */
class AppInfoService {
  constructor(version, openExternal, writeText) {
    this.version = version;
    this.openExternal = openExternal;
    this.writeText = writeText;
    this.links = Object.freeze({website:metadata.website,github:metadata.github,email:`mailto:${metadata.email}`});
  }

  /** Return a fresh, serializable About snapshot with the installed package version. */
  getInfo() { return {...metadata,version:this.version}; }

  /** Resolve a named destination in the host instead of accepting renderer-provided URLs. */
  async openLink(name) {
    if (typeof name !== 'string' || !Object.hasOwn(this.links,name)) throw new Error('Unknown application link.');
    await this.openExternal(this.links[name]);
  }

  /** Copy a named contact value without accepting arbitrary renderer content. */
  copyContact(name) {
    if (typeof name !== 'string' || !Object.hasOwn(this.links,name)) throw new Error('Unknown application contact.');
    this.writeText(metadata[name]);
  }
}
module.exports = {AppInfoService};
