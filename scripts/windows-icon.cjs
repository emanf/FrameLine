/** Embed Windows artwork and version metadata with Electron Builder's PE resource library. */
const fs = require('node:fs/promises');
const path = require('node:path');
const {createRequire} = require('node:module');

module.exports = async function embedWindowsIcon(context) {
  if (context.electronPlatformName !== 'win32') return;
  // Resolve the pinned builder's own library rather than adding a runtime dependency.
  const {NtExecutable, NtExecutableResource, Data, Resource} = createRequire(process.argv[1])('resedit');
  const filename = path.join(context.appOutDir, 'FrameLine.exe');
  const executable = NtExecutable.from(await fs.readFile(filename));
  const resources = NtExecutableResource.from(executable);
  const artwork = Data.IconFile.from(await fs.readFile(path.join(context.packager.projectDir, 'src/assets/icons/frameline.ico')));
  const groups = resources.entries.filter(entry => entry.type === 14);
  for (const group of groups.length ? groups : [{id:1, lang:1033}]) {
    Resource.IconGroupEntry.replaceIconsForResource(resources.entries, group.id, group.lang,
      artwork.icons.map(icon => icon.data));
  }
  const info = context.packager.appInfo;
  for (const version of Resource.VersionInfo.fromEntries(resources.entries)) {
    for (const language of version.getAllLanguagesForStringValues()) {
      version.setFileVersion(info.buildVersion, language.lang);
      version.setProductVersion(info.version, language.lang);
      version.setStringValues(language, {
        FileDescription: info.productName,
        ProductName: info.productName,
        InternalName: info.productFilename,
        OriginalFilename: 'FrameLine.exe',
        FileVersion: info.version,
        ProductVersion: info.version,
      });
    }
    version.outputToResourceEntries(resources.entries);
  }
  resources.outputResource(executable);
  await fs.writeFile(filename, Buffer.from(executable.generate()));
  console.log('FrameLine Windows icon embedded');
};
