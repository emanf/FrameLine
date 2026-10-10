"""Build matrix and packaging contracts; no dependency downloads are required."""
import importlib.util
import io
import gzip
import hashlib
import tempfile
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('frameline_build', Path(__file__).resolve().parents[1] / 'scripts/build.py')
build = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = build
SPEC.loader.exec_module(build)


class BuildTests(unittest.TestCase):
    def test_native_defaults_and_complete_matrix(self):
        host = build.Target('windows', 'x64')
        self.assertEqual(build.select_targets('auto', 'auto', host), [host])
        self.assertEqual(len(build.select_targets('all', 'all', host)), 5)
        self.assertEqual(len(build.select_targets('all', 'all', host, legacy=True)), 6)

    def test_x86_requires_explicit_legacy_mode_and_windows(self):
        host = build.Target('windows', 'x86')
        with self.assertRaisesRegex(ValueError, 'legacy'):
            build.select_targets('windows', 'x86', host)
        with self.assertRaisesRegex(ValueError, 'Windows-only'):
            build.select_targets('linux', 'x86', host, True)
        self.assertEqual(build.select_targets('windows', 'x86', host, True), [host])
        self.assertEqual(host.node_arch, 'ia32')

    def test_native_resources_are_external_and_platform_names_explicit(self):
        for target in build.TARGETS:
            config = build.builder_config(target, Path('/engine'), Path('/media'), Path('/out'), '43.0.0')
            self.assertEqual([item['to'] for item in config['extraResources']], ['backend', 'media', 'extensions', 'icons'])
            self.assertIn(target.system + '-' + target.arch, config['artifactName'])
            self.assertIsNone(config['publish'])
            self.assertTrue(config['asarUnpack'])
            self.assertNotIn('backend/**/*', config['files'])

    def test_installer_formats_follow_native_platform(self):
        for system, expected in [('windows', 'nsis'), ('macos', 'dmg'), ('linux', 'AppImage')]:
            config = build.builder_config(build.Target(system, 'x64'), Path('/a'), Path('/b'), Path('/c'), '44.5.1', True)
            section = {'windows': 'win', 'macos': 'mac', 'linux': 'linux'}[system]
            self.assertIn(expected, config[section]['target'])

    def test_wrong_node_architecture_is_rejected_before_build(self):
        with patch.object(build.subprocess, 'check_output', return_value='{"arch":"x64","platform":"win32","version":"22.0.0"}'):
            with self.assertRaisesRegex(ValueError, 'matching Node and Python'):
                build.verify_tools('node', build.Target('windows', 'x86'))

    def test_x86_sharp_requires_node_20(self):
        with patch.object(build.subprocess, 'check_output', return_value='{"arch":"ia32","platform":"win32","version":"22.0.0"}'):
            with self.assertRaisesRegex(ValueError, 'Node.js 20 x86'):
                build.verify_tools('node', build.Target('windows', 'x86'))

    def test_media_download_verifies_decompressed_binary(self):
        binary = b"verified native media fixture"
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "media"
            with patch.object(build.urllib.request, 'urlopen', return_value=io.BytesIO(gzip.compress(binary))):
                build.download_binary('release/ffmpeg', destination, hashlib.sha256(binary).hexdigest())
            self.assertEqual(destination.read_bytes(), binary)
            with patch.object(build.urllib.request, 'urlopen', return_value=io.BytesIO(gzip.compress(binary))):
                with self.assertRaisesRegex(ValueError, 'Checksum mismatch'):
                    build.download_binary('release/ffmpeg', destination, '0' * 64)
            self.assertFalse(destination.exists())

    def test_cross_platform_plan_is_read_only(self):
        with patch.object(build, 'build') as packaging, patch.object(build, 'host_target', return_value=build.Target('windows', 'x64')):
            self.assertEqual(build.main(['--all', '--legacy-windows-x86', '--dry-run']), 0)
            packaging.assert_not_called()


if __name__ == '__main__':
    unittest.main()
