"""Pure runner admission/failure tests. No macOS commands or app processes run."""
import importlib.util
import os
from pathlib import Path
import plistlib
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('smoke', Path(__file__).with_name('run-packaged-macos-smoke.py'))
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)

class Admission(unittest.TestCase):
    def test_environment_drops_credentials_and_external_daemon(self):
        with patch.dict(os.environ, {'PATH': '/bin', 'HOME': '/fresh-runner', 'GH_TOKEN': 'secret',
                'ANTHROPIC_API_KEY': 'secret', 'SSH_AUTH_SOCK': '/user/agent',
                'INTENTD_SOCKET': '/user/daemon', 'NODE_OPTIONS': '--require user-code'}, clear=True):
            env = smoke.test_environment(Path('/fixture'), Path('/package/Intent'))
        self.assertEqual(env['HOME'], '/fresh-runner')
        self.assertEqual(env['PACKAGED_APP_PATH'], '/package/Intent')
        for key in ('GH_TOKEN', 'ANTHROPIC_API_KEY', 'SSH_AUTH_SOCK', 'INTENTD_SOCKET', 'NODE_OPTIONS'):
            self.assertNotIn(key, env)

    def test_refuses_local_or_wrong_arch_host_before_commands(self):
        for environment, arch in [('self-hosted', 'arm64'), ('github-hosted', 'x86_64')]:
            with self.subTest(environment=environment, arch=arch), patch.dict(os.environ, {
                'RUNNER_ENVIRONMENT': environment, 'RUNNER_OS': 'macOS', 'RUNNER_ARCH': 'ARM64'}, clear=True), \
                patch.object(smoke.platform, 'system', return_value='Darwin'), \
                patch.object(smoke.platform, 'machine', return_value=arch), patch.object(smoke, 'command') as cmd:
                with self.assertRaisesRegex(RuntimeError, 'fresh GitHub-hosted'):
                    smoke.main()
                cmd.assert_not_called()

    def exercise(self, failure):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'only.dmg').write_bytes(b'fixture-only')
            commands = []
            def command(args, timeout=60):
                commands.append(args)
                if args[0] == failure or (args[0] == 'hdiutil' and args[1] == failure):
                    raise RuntimeError('injected ' + failure)
                if args[:2] == ['hdiutil', 'attach']:
                    mount = args[args.index('-mountpoint') + 1]
                    return plistlib.dumps({'system-entities': [{'mount-point': mount, 'dev-entry': '/dev/fake'}]})
                if args[0] == 'lipo':
                    return b'x86_64' if failure == 'architecture' else b'arm64'
                return b''
            with patch.dict(os.environ, {'RUNNER_ENVIRONMENT': 'github-hosted', 'RUNNER_OS': 'macOS',
                'RUNNER_ARCH': 'ARM64', 'RUNNER_TEMP': temp, 'RUNNER_NAME': 'fixture',
                'GITHUB_SHA': 'source', 'GITHUB_RUN_ID': '1', 'GITHUB_RUN_ATTEMPT': '1'}, clear=True), \
                patch.object(smoke.platform, 'system', return_value='Darwin'), \
                patch.object(smoke.platform, 'machine', return_value='arm64'), \
                patch.object(smoke, 'REPORT', root / 'report'), patch.object(smoke.sys, 'argv', ['runner', temp]), \
                patch.object(smoke, 'command', side_effect=command), patch.object(smoke, 'run_tests') as run:
                if failure:
                    with self.assertRaises(RuntimeError): smoke.main()
                    run.assert_not_called()
                else:
                    smoke.main()
                    self.assertEqual(run.call_count, 2)
                return commands

    def test_detach_signature_and_architecture_failures_block_launch(self):
        for stage in ('detach', 'codesign', 'spctl', 'architecture'):
            with self.subTest(stage=stage): self.exercise(stage)

    def test_copy_failure_still_detaches_only_its_mount(self):
        commands = self.exercise('ditto')
        self.assertEqual(commands[-1][:2], ['hdiutil', 'detach'])
        self.assertNotIn('-force', commands[-1])

    def test_image_is_detached_before_executable_checks_or_journeys(self):
        commands = self.exercise(None)
        detach = next(i for i, command in enumerate(commands) if command[:2] == ['hdiutil', 'detach'])
        verify = next(i for i, command in enumerate(commands) if command[0] == 'codesign')
        self.assertLess(detach, verify)

if __name__ == '__main__': unittest.main()
