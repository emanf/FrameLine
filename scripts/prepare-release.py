"""Verify all native build manifests and collect their packages for release upload."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil


def file_digest(path):
    """Hash large release archives without loading them into memory."""
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def prepare_assets(source, output, tag, commit, legacy_x86=True, installers=False):
    """Validate every requested target before copying any file for publication."""
    source = source.resolve(strict=True)
    expected = {'windows/x64', 'macos/x64', 'macos/arm64', 'linux/x64', 'linux/arm64'}
    if legacy_x86:
        expected.add('windows/x86')
    manifests = {}
    packages = {}
    version = None
    for manifest_path in source.rglob('build-manifest.json'):
        if manifest_path.is_symlink():
            raise ValueError('Build manifests must be regular files.')
        manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
        target = manifest.get('target')
        if target not in expected or target in manifests:
            raise ValueError(f'Unexpected or duplicate build target: {target}')
        if manifest.get('status') != 'complete':
            raise ValueError(f'Build did not complete: {target}')
        if version is None:
            version = manifest.get('version')
        if not isinstance(version, str) or not version or manifest.get('version') != version:
            raise ValueError('Builds must have the same application version.')
        system, arch = target.split('/')
        prefix = f'FrameLine-{version}-{system}-{arch}'
        extensions = {'.tar.gz'} if system == 'linux' else {'.zip'}
        if installers:
            extensions.add({'windows': '.exe', 'macos': '.dmg', 'linux': '.AppImage'}[system])
        required_names = {prefix + extension for extension in extensions}
        records = manifest.get('artifacts', [])
        if {record.get('file') for record in records} != required_names or len(records) != len(required_names):
            raise ValueError(f'Build has missing or unexpected packages: {target}')
        for record in records:
            name = record['file']
            if Path(name).name != name or '/' in name or '\\' in name or name in packages:
                raise ValueError(f'Unsafe or duplicate package filename: {name}')
            package = manifest_path.parent / name
            if package.is_symlink() or not package.is_file() or not package.resolve().is_relative_to(source):
                raise ValueError(f'Package is missing or outside the artifact directory: {name}')
            if package.stat().st_size != record.get('bytes') or file_digest(package) != record.get('sha256'):
                raise ValueError(f'Package checksum or size mismatch: {name}')
            packages[name] = (package, record['sha256'])
        manifests[target] = manifest
    if set(manifests) != expected:
        raise ValueError('Missing build targets: ' + ', '.join(sorted(expected - set(manifests))))
    output = output.resolve()
    if output == source or output.is_relative_to(source) or source.is_relative_to(output):
        raise ValueError('Release assets must be collected outside the downloaded artifact tree.')
    if output.exists() and any(output.iterdir()):
        raise ValueError('The release asset directory must be empty.')
    output.mkdir(parents=True, exist_ok=True)
    for name, (package, _digest) in sorted(packages.items()):
        shutil.copy2(package, output / name)
    info_name = 'FrameLine-builds.json'
    (output / info_name).write_text(json.dumps({'tag': tag, 'commit': commit, 'builds': manifests}, indent=2) + '\n', encoding='utf-8')
    sums = [f'{digest}  {name}' for name, (_package, digest) in sorted(packages.items())]
    sums.append(f'{file_digest(output / info_name)}  {info_name}')
    (output / 'SHA256SUMS.txt').write_text('\n'.join(sums) + '\n', encoding='utf-8')
    return sorted(packages)


def main():
    """Assemble archives and checksums using workflow-provided release metadata."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--tag', required=True)
    parser.add_argument('--commit', required=True)
    parser.add_argument('--legacy-windows-x86', action='store_true')
    parser.add_argument('--installers', action='store_true')
    args = parser.parse_args()
    files = prepare_assets(args.source, args.output, args.tag, args.commit,
                           args.legacy_windows_x86, args.installers)
    print(f'Verified {len(files)} packages for release {args.tag}.')


if __name__ == '__main__':
    main()
