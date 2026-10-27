import hashlib
import importlib.util
import json
from pathlib import Path
import re
import tempfile
import unittest
from unittest.mock import patch
import zipfile


def load_script(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


portable = load_script('eggfans_portable', 'package-eggfans-windows-portable.py')
installer = load_script('eggfans_installer', 'build-eggfans-windows-installer.py')

RUNTIME_FILES = (
    'agent-host/server.mjs',
    'agent-host/runtime/node.exe',
    'cli/beeftv.exe',
)


class EggfansWindowsPackagingTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='eggfans-packaging-test-', dir=Path(__file__).parent)
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.binary_root = self.root / 'bin'
        self.tools = self.root / 'tools'
        self.notices = self.root / 'notices'
        self.plugins = self.root / 'plugins'
        self.runtime_files = {
            'agent-host/server.mjs': b'fixture server',
            'agent-host/runtime/node.exe': b'MZ fixture node',
            'agent-host/runtime/LICENSE': b'fixture Node license',
            'agent-host/node_modules/@scope/package/index.js': b'fixture dependency',
            'agent-host/node_modules/.bun/package/node_modules/dependency/index.js': b'fixture nested dependency',
            'agent-host/node_modules/package/empty-marker': b'',
            'agent-host/media-runtime/ffmpeg.exe': b'MZ fixture media ffmpeg',
            'agent-host/media-runtime/nested/runtime.dll': b'fixture media dependency',
            'cli/beeftv.exe': b'MZ fixture cli',
            'cli/support/runtime.dll': b'fixture cli dependency',
        }
        self.write(self.binary_root / 'EggfansTV.exe', b'MZ fixture application')
        for name, content in self.runtime_files.items():
            self.write(self.binary_root / name, content)
        self.legacy_files = {
            '.local/tools/ffmpeg/ffmpeg.exe': b'fixture ffmpeg',
            '.local/tools/ffmpeg/ffprobe.exe': b'fixture ffprobe',
            '.local/tools/whisper/whisper-cli.exe': b'fixture whisper',
            '.local/tools/whisper/ggml-base.bin': b'fixture model',
            '.local/tools/whisper/whisper.dll': b'fixture whisper library',
            '.local/tools/whisper/ggml.dll': b'fixture ggml',
            '.local/tools/whisper/ggml-base.dll': b'fixture ggml base',
            '.local/tools/whisper/ggml-cpu-x64.dll': b'fixture cpu backend',
            '.local/tools/whisper/ggml-cpu-avx2.dll': b'fixture optional cpu backend',
        }
        for name, content in self.legacy_files.items():
            self.write(self.tools / Path(name).relative_to('.local/tools'), content)
        for name in ('FFmpeg-GPL-3.0.txt', 'whisper.cpp-LICENSE.txt', 'Whisper-model-LICENSE.txt', 'THIRD-PARTY-NOTICES.txt', 'VC_redist.x64.exe'):
            self.write(self.notices / name, b'fixture ' + name.encode())
        self.plugins.mkdir()
        with zipfile.ZipFile(self.plugins / 'fixture.beeftv-plugin', 'w') as archive:
            archive.writestr('manifest.json', json.dumps({'id': 'fixture-protocol'}))
        self.webview = self.root / 'offline-webview-fixture.exe'
        self.write(self.webview, b'MZ deliberately incomplete external runtime')
        self.run_index = 0

    def write(self, target, content):
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)

    def portable_arguments(self):
        self.run_index += 1
        destination = self.root / ('portable-' + str(self.run_index))
        return destination, [
            'package-eggfans-windows-portable.py',
            '--executable', str(self.binary_root / 'EggfansTV.exe'),
            '--plugins', str(self.plugins), '--tools', str(self.tools),
            '--notices', str(self.notices), '--output', str(destination),
            '--version', 'v1.7.16',
        ]

    def test_portable_copies_complete_agent_and_cli_trees_without_other_bin_data(self):
        for name in ('.settings-key', '.env', 'personal.key', '.local/EggfansTV/settings.json', 'unrelated.exe'):
            self.write(self.binary_root / name, b'private fixture excluded from release')
        destination, arguments = self.portable_arguments()
        with patch('sys.argv', arguments), patch.object(portable, 'enable_utf8_manifest', side_effect=RuntimeError('fixture copy complete')):
            with self.assertRaisesRegex(RuntimeError, 'fixture copy complete'):
                portable.main()
        for name, content in {**self.runtime_files, **self.legacy_files}.items():
            with self.subTest(path=name):
                self.assertTrue((destination / name).is_file(), name)
                self.assertEqual((destination / name).read_bytes(), content)
        for name in ('FFmpeg-GPL-3.0.txt', 'whisper.cpp-LICENSE.txt', 'Whisper-model-LICENSE.txt', 'THIRD-PARTY-NOTICES.txt'):
            self.assertEqual((destination / 'licenses' / name).read_bytes(), (self.notices / name).read_bytes())
        self.assertTrue((destination / 'prerequisites/VC_redist.x64.exe').is_file())
        self.assertTrue((destination / 'plugin-packages/fixture.beeftv-plugin').is_file())
        for name in ('.settings-key', '.env', 'personal.key', '.local/EggfansTV', 'unrelated.exe'):
            self.assertFalse((destination / name).exists(), name)
        self.assertFalse(destination.with_suffix('.zip').exists())

    def test_portable_rejects_missing_or_empty_runtime_entries_before_copying(self):
        for name in RUNTIME_FILES:
            source = self.binary_root / name
            original = source.read_bytes()
            for invalid in ('missing', 'empty'):
                with self.subTest(path=name, invalid=invalid):
                    source.unlink() if invalid == 'missing' else source.write_bytes(b'')
                    destination, arguments = self.portable_arguments()
                    error = None
                    try:
                        with patch('sys.argv', arguments), patch.object(portable, 'enable_utf8_manifest', side_effect=RuntimeError('validation was skipped')):
                            portable.main()
                    except (ValueError, RuntimeError) as caught:
                        error = caught
                    finally:
                        source.write_bytes(original)
                    self.assertIsInstance(error, ValueError)
                    self.assertIn(name, str(error))
                    self.assertFalse(destination.exists())

    def test_portable_preserves_existing_required_tools_and_license_checks(self):
        for source, expected in (
            (self.tools / 'ffmpeg/ffmpeg.exe', '.local/tools/ffmpeg/ffmpeg.exe'),
            (self.tools / 'whisper/ggml-base.bin', '.local/tools/whisper/ggml-base.bin'),
            (self.tools / 'whisper/ggml-cpu-x64.dll', 'Whisper CPU backends'),
            (self.notices / 'FFmpeg-GPL-3.0.txt', 'licenses/FFmpeg-GPL-3.0.txt'),
        ):
            with self.subTest(path=expected):
                original = source.read_bytes()
                source.unlink()
                destination, arguments = self.portable_arguments()
                try:
                    with patch('sys.argv', arguments), self.assertRaisesRegex(ValueError, re.escape(expected)):
                        portable.main()
                finally:
                    source.write_bytes(original)
                self.assertFalse(destination.exists())

    def payload_manifest(self):
        payload = self.root / 'payload'
        files = {'EggfansTV.exe': b'MZ fixture application', **self.runtime_files, **self.legacy_files}
        records = []
        for name, content in files.items():
            self.write(payload / name, content)
            records.append({'path': name, 'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()})
        manifest = {'version': 'v1.7.16', 'platform': 'windows-amd64', 'pluginPackages': 1, 'files': records}
        self.write(payload / 'manifest.json', json.dumps(manifest).encode())
        return payload, manifest

    def run_installer_validation(self, payload):
        arguments = ['build-eggfans-windows-installer.py', '--payload', str(payload), '--webview2', str(self.webview), '--output', str(self.root / 'installer.exe')]
        with patch('sys.argv', arguments), patch.object(installer.subprocess, 'run', side_effect=AssertionError('NSIS must not run in fixture tests')):
            installer.main()

    def test_installer_accepts_complete_runtime_manifest_before_external_runtime_validation(self):
        payload, _ = self.payload_manifest()
        with self.assertRaisesRegex(ValueError, 'Expected the complete offline WebView2 installer'):
            self.run_installer_validation(payload)
        self.assertFalse((self.root / 'installer.exe').exists())

    def test_installer_rejects_runtime_entries_missing_from_manifest_or_empty(self):
        for name in RUNTIME_FILES:
            for invalid in ('unlisted', 'empty'):
                with self.subTest(path=name, invalid=invalid):
                    payload, manifest = self.payload_manifest()
                    if invalid == 'unlisted':
                        manifest['files'] = [record for record in manifest['files'] if record['path'] != name]
                    else:
                        (payload / name).write_bytes(b'')
                        record = next(record for record in manifest['files'] if record['path'] == name)
                        record.update({'bytes': 0, 'sha256': hashlib.sha256(b'').hexdigest()})
                    (payload / 'manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
                    with self.assertRaisesRegex(ValueError, re.escape(name)):
                        self.run_installer_validation(payload)

    def test_installer_keeps_hash_and_private_data_validation(self):
        payload, _ = self.payload_manifest()
        (payload / 'cli/beeftv.exe').write_bytes(b'tampered fixture')
        with self.assertRaisesRegex(ValueError, 'Payload hash mismatch: cli/beeftv.exe'):
            self.run_installer_validation(payload)
        payload, manifest = self.payload_manifest()
        private_name = '.local/EggfansTV/settings.json'
        content = b'private fixture'
        self.write(payload / private_name, content)
        manifest['files'].append({'path': private_name, 'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()})
        (payload / 'manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'User data must not be included'):
            self.run_installer_validation(payload)


if __name__ == '__main__':
    unittest.main()
