"""Release collection rejects incomplete, corrupt or unexpected build artifacts."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('prepare_release', Path(__file__).resolve().parents[1] / 'scripts/prepare-release.py')
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)


class PrepareReleaseTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.source = self.root / 'artifacts'
        self.output = self.root / 'assets'
        self.manifests = {}

    def populate(self, legacy=True, installers=False):
        targets = ['windows/x64', 'macos/x64', 'macos/arm64', 'linux/x64', 'linux/arm64']
        if legacy:
            targets.append('windows/x86')
        for target in targets:
            system, arch = target.split('/')
            folder = self.source / system / arch / 'timestamp'
            folder.mkdir(parents=True)
            suffixes = ['.tar.gz' if system == 'linux' else '.zip']
            if installers:
                suffixes.append({'windows': '.exe', 'macos': '.dmg', 'linux': '.AppImage'}[system])
            records = []
            for suffix in suffixes:
                name = f'FrameLine-1.0.0-{system}-{arch}{suffix}'
                content = target.encode()
                (folder / name).write_bytes(content)
                records.append({'file': name, 'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()})
            manifest = {'status':'complete', 'target':target, 'version':'1.0.0', 'artifacts':records}
            file = folder / 'build-manifest.json'
            file.write_text(json.dumps(manifest), encoding='utf-8')
            self.manifests[target] = (file, manifest)

    def prepare(self, **options):
        return release.prepare_assets(self.source, self.output, 'v1.0.0', 'a' * 40, **options)

    def test_complete_matrix_produces_packages_and_checksums(self):
        self.populate()
        self.assertEqual(len(self.prepare()), 6)
        info = json.loads((self.output / 'FrameLine-builds.json').read_text())
        self.assertEqual(info['commit'], 'a' * 40)
        sums = (self.output / 'SHA256SUMS.txt').read_text().splitlines()
        self.assertEqual(len(sums), 7)
        for line in sums:
            digest, name = line.split('  ')
            self.assertEqual(release.file_digest(self.output / name), digest)

    def test_without_legacy_and_with_installers_checks_expected_outputs(self):
        self.populate(legacy=False, installers=True)
        self.assertEqual(len(self.prepare(legacy_x86=False, installers=True)), 10)

    def test_missing_target_creates_no_publication_directory(self):
        self.populate(legacy=False)
        with self.assertRaisesRegex(ValueError, 'windows/x86'):
            self.prepare()
        self.assertFalse(self.output.exists())

    def test_corrupt_package_cannot_be_published(self):
        self.populate()
        file, data = self.manifests['windows/x64']
        (file.parent / data['artifacts'][0]['file']).write_bytes(b'corrupt')
        with self.assertRaisesRegex(ValueError, 'checksum or size'):
            self.prepare()
        self.assertFalse(self.output.exists())

    def test_failed_build_cannot_be_published(self):
        self.populate()
        file, data = self.manifests['linux/x64']
        data['status'] = 'failed'
        file.write_text(json.dumps(data), encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'did not complete'):
            self.prepare()

    def test_unexpected_package_filename_is_rejected(self):
        self.populate()
        file, data = self.manifests['windows/x64']
        data['artifacts'][0]['file'] = '../secret.zip'
        file.write_text(json.dumps(data), encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'unexpected packages'):
            self.prepare()


if __name__ == '__main__':
    unittest.main()
