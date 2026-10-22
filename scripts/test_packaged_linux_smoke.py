"""Pure Linux admission/composition controls; never launch an app or subprocess."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('linux_smoke', Path(__file__).with_name('run-packaged-linux-smoke.py'))
linux = importlib.util.module_from_spec(spec)
spec.loader.exec_module(linux)


class LinuxAdmission(unittest.TestCase):
    def test_refuses_nonhosted_and_wrong_architecture(self):
        env = {'RUNNER_ENVIRONMENT': 'github-hosted', 'RUNNER_OS': 'Linux',
               'RUNNER_ARCH': 'X64', 'DISPLAY': ':99', 'XAUTHORITY': '/fixture/cookie'}
        with patch.dict(os.environ, env, clear=True), patch.object(linux.platform, 'system', return_value='Linux'), \
             patch.object(linux.platform, 'machine', return_value='x86_64'):
            linux.require_host()
            for key, value in [('RUNNER_ENVIRONMENT', 'self-hosted'), ('RUNNER_ARCH', 'ARM64'), ('DISPLAY', '')]:
                with patch.dict(os.environ, {key: value}):
                    with self.assertRaises(RuntimeError): linux.require_host()

    def test_elf_identity_and_rejected_architecture_or_link(self):
        with tempfile.TemporaryDirectory() as temp:
            binary = Path(temp) / 'fixture'
            binary.write_bytes(b'\x7fELF\x02\x01' + b'\0' * 12 + b'\x3e\x00' + b'fixture')
            binary.chmod(0o700)
            identity = linux.executable_identity(binary)
            self.assertEqual(identity['bytes'], 27)
            self.assertEqual(identity['sha256'], linux.hashlib.sha256(binary.read_bytes()).hexdigest())
            link = binary.with_name('link')
            link.symlink_to(binary)
            with self.assertRaises(RuntimeError): linux.executable_identity(link)
            binary.write_bytes(b'\x7fELF\x02\x01' + b'\0' * 12 + b'\xb7\x00')
            with self.assertRaisesRegex(RuntimeError, 'x86-64'): linux.executable_identity(binary)
            binary.write_bytes(b'\x7fELF')
            with self.assertRaises(RuntimeError): linux.executable_identity(binary)

    def test_default_environment_removes_optin_and_service_credentials(self):
        with patch.dict(os.environ, {'PATH': '/fixture/bin', 'HOME': '/fresh/runner',
                                    'XAUTHORITY': '/fixture/cookie', 'GH_TOKEN': 'fake',
                                    'NODE_OPTIONS': 'fake', 'BUILD_SMOKE_VALIDATE_JOURNEYS': '1'}, clear=True):
            env = linux.default_environment(Path('/fixture'), Path('/package/intent'))
        for key in ('GH_TOKEN', 'NODE_OPTIONS', 'BUILD_SMOKE_VALIDATE_JOURNEYS'):
            self.assertNotIn(key, env)
        self.assertEqual(env['XAUTHORITY'], '/fixture/cookie')
        self.assertEqual(env['INTENTD_SOCKET'] if 'INTENTD_SOCKET' in env else None, None)
        self.assertEqual(env['TMPDIR'], '/fixture/tmp')

    def test_main_selects_default_suite_and_propagates_failure(self):
        with tempfile.TemporaryDirectory() as temp:
            with patch.dict(os.environ, {'RUNNER_TEMP': temp, 'GITHUB_SHA': 'fixture-source',
                                        'GITHUB_RUN_ID': 'fixture-run', 'GITHUB_RUN_ATTEMPT': '1',
                                        'RUNNER_NAME': 'fixture-runner', 'XAUTHORITY': '/fixture/cookie'}), \
                 patch('sys.argv', ['runner']), patch.object(linux, 'require_host'), \
                 patch.object(linux, 'executable_identity', return_value={'arch': 'x86_64'}), \
                 patch.object(linux.smoke, 'record') as record, \
                 patch.object(linux.smoke, 'run_tests', side_effect=RuntimeError('fixture failure')) as run:
                with self.assertRaisesRegex(RuntimeError, 'fixture failure'): linux.main()
                self.assertEqual(run.call_args.args[0], 'default-suite')
                self.assertEqual(run.call_args.args[1], ['--grep-invert', '(auggie|claude-code|codex|opencode)'])
                self.assertNotIn('BUILD_SMOKE_VALIDATE_JOURNEYS', run.call_args.args[2])
                self.assertEqual(record.call_args.args[1]['source'], 'fixture-source')
            linux.smoke.FIXTURE_ROOT = None


if __name__ == '__main__':
    unittest.main()
