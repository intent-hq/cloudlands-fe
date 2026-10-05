"""Pure runner admission/failure tests. No macOS commands or app processes run."""
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import tempfile
import unittest
from unittest.mock import Mock, patch
import tarfile

spec = importlib.util.spec_from_file_location('smoke', Path(__file__).with_name('run-packaged-macos-smoke.py'))
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)

class Admission(unittest.TestCase):
    def test_archive_writer_bounds_actual_bytes_and_stays_failed(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'partial.gz'
            with path.open('xb', buffering=0) as raw, patch.object(smoke, 'ARCHIVE_LIMIT', 10), \
                 patch.object(smoke, 'report_bytes', return_value=0):
                writer = smoke.BoundedArchiveWriter(raw)
                self.assertEqual(writer.write(b'12345678'), 8)
                with self.assertRaisesRegex(RuntimeError, 'capture incomplete'): writer.write(b'XYZ')
                with self.assertRaises(RuntimeError): writer.write(b'9')
            self.assertEqual(path.read_bytes(), b'12345678')

    def test_archive_headers_are_charged_even_for_empty_input(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'tmp').mkdir()
            (root / 'tmp/empty').touch()
            report = root / 'report'
            report.mkdir()
            with patch.object(smoke, 'REPORT_TREE', report), patch.object(smoke, 'REPORT', report), patch.object(smoke, 'ARCHIVE_LIMIT', 64):
                with self.assertRaisesRegex(RuntimeError, 'capture incomplete'): smoke.retain_fixtures(root)
            self.assertLessEqual((report / 'fixture-state.tar.gz').stat().st_size, 64)
            self.assertFalse((report / 'fixture-state.json').exists())

    def test_archive_reserves_receipt_space_in_total_report_bound(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'partial.gz'
            with path.open('xb', buffering=0) as raw, patch.object(smoke, 'REPORT_LIMIT', 1024**2 + 10), \
                 patch.object(smoke, 'report_bytes', return_value=8):
                with self.assertRaisesRegex(RuntimeError, 'report byte limit'):
                    smoke.BoundedArchiveWriter(raw).write(b'123')
            self.assertEqual(path.stat().st_size, 0)

    def test_suite_deadline_records_primary_and_stops_owned_child(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            child = Mock(pid=12345, returncode=None)
            child.poll.side_effect = lambda: child.returncode
            def wait(timeout=None):
                child.returncode = -15
                return -15
            child.wait.side_effect = wait
            with patch.object(smoke, 'REPORT_TREE', root), patch.object(smoke, 'REPORT', root), \
                 patch.object(smoke.subprocess, 'Popen', return_value=child) as spawn, \
                 patch.object(smoke.time, 'monotonic', side_effect=[0, 781]), \
                 patch.object(smoke.shutil, 'disk_usage', return_value=Mock(free=10 * 1024**3)), \
                 patch.object(smoke.os, 'killpg') as kill:
                with self.assertRaisesRegex(RuntimeError, 'limit reached'):
                    smoke.run_tests('journeys', ['fixture-only'], {'TMPDIR': str(root / 'tmp')})
            self.assertTrue(spawn.call_args.kwargs['start_new_session'])
            kill.assert_called_once_with(12345, smoke.signal.SIGTERM)
            receipt = json.loads((root / 'journeys-failure.json').read_text())
            self.assertIn('limit reached', receipt['error'])
            self.assertEqual(receipt['cleanup']['directChildWait'], -15)

    def test_fixture_evidence_keeps_git_and_database_but_not_app_or_links(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'tmp/repo/.git').mkdir(parents=True)
            (root / 'tmp/repo/.git/HEAD').write_text('fixture-head')
            (root / 'tmp/profile').mkdir()
            (root / 'tmp/profile/store.sqlite').write_bytes(b'fixture-db')
            (root / 'home/intent/workspaces/child/repo').mkdir(parents=True)
            (root / 'home/intent/workspaces/child/repo/child-output.txt').write_text('child result')
            (root / 'tmp/link').symlink_to('/etc/passwd')
            (root / 'Intent.app').mkdir()
            (root / 'Intent.app/binary').write_bytes(b'not evidence')
            report = root / 'report'
            report.mkdir()
            with patch.object(smoke, 'REPORT_TREE', report), patch.object(smoke, 'REPORT', report): smoke.retain_fixtures(root)
            with tarfile.open(report / 'fixture-state.tar.gz') as archive:
                self.assertEqual(set(archive.getnames()), {'tmp/repo/.git/HEAD', 'tmp/profile/store.sqlite',
                    'home/intent/workspaces/child/repo/child-output.txt'})
                self.assertEqual(archive.extractfile('home/intent/workspaces/child/repo/child-output.txt').read(), b'child result')

    def test_owned_worktree_growth_triggers_existing_fixture_limit(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'tmp').mkdir()
            report = root / 'report'
            report.mkdir()
            worktree_file = root / 'home/intent/workspaces/child/output'
            worktree_file.parent.mkdir(parents=True)
            worktree_file.write_bytes(b'fixture')
            original_stat = Path.stat
            def measured_stat(path, *args, **kwargs):
                value = original_stat(path, *args, **kwargs)
                if path == worktree_file:
                    fields = list(value)
                    fields[6] = 21 * 1024**3
                    return os.stat_result(fields)
                return value
            child = Mock(pid=12345, returncode=None)
            child.poll.return_value = None
            child.wait.return_value = -15
            with patch.object(Path, 'stat', measured_stat), patch.object(smoke, 'REPORT_TREE', report), \
                 patch.object(smoke, 'REPORT', report), patch.object(smoke.subprocess, 'Popen', return_value=child), \
                 patch.object(smoke.time, 'monotonic', return_value=0), patch.object(smoke.os, 'killpg') as kill, \
                 patch.object(smoke.shutil, 'disk_usage', return_value=Mock(free=30 * 1024**3)):
                with self.assertRaisesRegex(RuntimeError, 'limit reached'):
                    smoke.run_tests('fixture', [], {'TMPDIR': str(root / 'tmp')})
            kill.assert_called_once_with(12345, smoke.signal.SIGTERM)
            self.assertEqual(json.loads((report / 'fixture-failure.json').read_text())['cleanup']['directChildWait'], -15)

    def test_capture_excludes_only_npm_cache_and_keeps_actual_worktree_outputs(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            retained = {
                'home/intent/workspaces/child/repo/child-output.txt': b'child result',
                'home/intent/workspaces/mock/repo/README.md': b'hello world',
                'home/.local/state/fixture': b'other home state',
                'home/.npm/_logs/diagnostic.log': b'unique npm diagnostic',
                'home/.npm/_npx/5794dd75a801d955/package.json': b'{"dependencies":{}}',
                'home/.npm/_npx/5794dd75a801d955/package-lock.json': b'{"lockfileVersion":3}',
                'home/.npm/_npx/5794dd75a801d955/diagnostic.log': b'npx diagnostic',
                'home/.npm/_npx/unrecognized/node_modules/fixture': b'not admitted cache',
                'home/.npm/_npx/0000000000000000/node_modules/fixture': b'manifests missing',
                'home/intent/workspaces/child/repo/node_modules/fixture': b'workspace dependency',
            }
            omitted = {
                'home/.npm/_cacache/download': b'reproducible cache',
                'home/.npm/_npx/5794dd75a801d955/node_modules/@anthropic-ai/sdk/claude': b'cached executable',
            }
            for name, data in {**retained, **omitted}.items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
            report = root / 'report'
            report.mkdir()
            with patch.object(smoke, 'REPORT_TREE', report), patch.object(smoke, 'REPORT', report):
                smoke.retain_fixtures(root)
            with tarfile.open(report / 'fixture-state.tar.gz') as archive:
                self.assertEqual(set(archive.getnames()), set(retained))
                for name, data in retained.items(): self.assertEqual(archive.extractfile(name).read(), data)
            receipt = json.loads((report / 'fixture-state.json').read_text())
            self.assertEqual(set(receipt['excludedReproducibleCaches']), {
                'home/.npm/_cacache', 'home/.npm/_npx/5794dd75a801d955/node_modules'})
            self.assertEqual(receipt['cacheExclusionReasons'], {
                'home/.npm/_cacache': 'Reproducible npm content cache',
                'home/.npm/_npx/5794dd75a801d955/node_modules':
                    'Reproducible npx dependencies; sibling package manifests retained'})
            self.assertEqual(receipt['inputBytes'], sum(map(len, retained.values())))

    def test_required_evidence_size_refusal_names_path_and_threshold_without_success_receipt(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path = root / 'home/intent/workspaces/child/repo/child-output.txt'
            path.parent.mkdir(parents=True)
            path.write_bytes(b'fixture')
            report = root / 'report'
            report.mkdir()
            original_stat = Path.stat
            def oversized(candidate, *args, **kwargs):
                value = original_stat(candidate, *args, **kwargs)
                if candidate == path:
                    fields = list(value)
                    fields[6] = 64 * 1024**2 + 1
                    return os.stat_result(fields)
                return value
            with patch.object(Path, 'stat', oversized), patch.object(smoke, 'REPORT_TREE', report), \
                 patch.object(smoke, 'REPORT', report):
                with self.assertRaisesRegex(RuntimeError,
                        r'home/intent/workspaces/child/repo/child-output.txt: fileBytes=67108865/67108864'):
                    smoke.retain_fixtures(root)
            self.assertFalse((report / 'fixture-state.json').exists())
            self.assertTrue((report / 'fixture-state.tar.gz').exists())

    def test_timeout_terminates_only_created_group_and_waits(self):
        child = Mock(pid=12345)
        child.poll.return_value = None
        child.wait.side_effect = [smoke.subprocess.TimeoutExpired('fixture', 10), -9, -9]
        with patch.object(smoke.os, 'killpg') as kill:
            receipt = smoke.stop_test_child(child)
        self.assertEqual([call.args for call in kill.call_args_list],
                         [(12345, smoke.signal.SIGTERM), (12345, smoke.signal.SIGKILL)])
        self.assertEqual(receipt['directChildWait'], -9)
        self.assertIn('not proven', receipt['descendants'])

    def test_failed_termination_remains_unknown(self):
        child = Mock(pid=12345)
        child.poll.return_value = None
        with patch.object(smoke.os, 'killpg', side_effect=OSError('refused')):
            receipt = smoke.stop_test_child(child)
        self.assertEqual(receipt['settlement'], 'unknown')
        self.assertIsNone(receipt['directChildWait'])
        child.wait.assert_not_called()

    def test_environment_drops_credentials_and_external_daemon(self):
        with patch.dict(os.environ, {'PATH': '/bin', 'HOME': '/fresh-runner', 'GH_TOKEN': 'secret',
                'ANTHROPIC_API_KEY': 'secret', 'SSH_AUTH_SOCK': '/user/agent',
                'INTENTD_SOCKET': '/user/daemon', 'NODE_OPTIONS': '--require user-code'}, clear=True):
            env = smoke.test_environment(Path('/fixture'), Path('/package/Intent'))
        self.assertEqual(env['HOME'], '/fixture/home')
        self.assertEqual(env['INTENTD_WORKSPACES_DIR'], '/fixture/home/intent/workspaces')
        self.assertEqual(env['BUILD_SMOKE_WORKSPACES_ROOT'], env['INTENTD_WORKSPACES_DIR'])
        self.assertEqual(env['PACKAGED_APP_PATH'], '/package/Intent')
        for key in ('GH_TOKEN', 'ANTHROPIC_API_KEY', 'SSH_AUTH_SOCK', 'INTENTD_SOCKET', 'NODE_OPTIONS'):
            self.assertNotIn(key, env)

    def test_refuses_local_or_wrong_arch_host_before_commands(self):
        cases = [
            ('self-hosted', 'macOS', 'ARM64', 'Darwin', 'arm64'),
            ('self-hosted', 'macOS', 'X64', 'Darwin', 'x86_64'),
            ('github-hosted', 'macOS', 'ARM64', 'Darwin', 'x86_64'),
            ('github-hosted', 'macOS', 'X64', 'Darwin', 'arm64'),
            ('github-hosted', 'macOS', 'unknown', 'Darwin', 'arm64'),
            ('github-hosted', 'Linux', 'X64', 'Darwin', 'x86_64'),
            ('github-hosted', 'macOS', 'X64', 'Linux', 'x86_64'),
        ]
        for environment, runner_os, runner_arch, system, arch in cases:
            with self.subTest(environment=environment, runner_os=runner_os, runner_arch=runner_arch, system=system, arch=arch), patch.dict(os.environ, {
                'RUNNER_ENVIRONMENT': environment, 'RUNNER_OS': runner_os, 'RUNNER_ARCH': runner_arch}, clear=True), \
                patch.object(smoke.platform, 'system', return_value=system), \
                patch.object(smoke.platform, 'machine', return_value=arch), patch.object(smoke, 'command') as cmd, \
                patch.object(smoke.tempfile, 'mkdtemp') as create:
                with self.assertRaisesRegex(RuntimeError, 'fresh GitHub-hosted'):
                    smoke.main()
                cmd.assert_not_called()
                create.assert_not_called()

    def test_native_arm_and_intel_runners_launch_matching_artifacts(self):
        for arch in ('arm64', 'x86_64'):
            with self.subTest(arch=arch):
                commands = self.exercise(None, arch=arch)
                self.assertEqual(sum(command[0] == 'lipo' for command in commands), 3)

    def test_each_executable_must_include_the_native_runner_architecture(self):
        for arch in ('arm64', 'x86_64'):
            for target in range(3):
                with self.subTest(arch=arch, target=target):
                    commands = self.exercise('architecture', arch=arch, wrong_target=target)
                    self.assertEqual(sum(command[0] == 'lipo' for command in commands), target + 1)

    def test_unknown_scope_refuses_before_fixture_or_commands(self):
        with patch.dict(os.environ, {'BUILD_SMOKE_MACOS_SCOPE': 'arbitrary'}, clear=True), \
             patch.object(smoke.tempfile, 'mkdtemp') as create, patch.object(smoke, 'command') as command:
            with self.assertRaisesRegex(RuntimeError, 'Unknown packaged smoke scope'): smoke.main()
        create.assert_not_called()
        command.assert_not_called()

    def test_correction_scope_selects_only_missing_provider_and_worktree_journey(self):
        self.exercise(None, 'fixture-correction')
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            child = Mock(pid=12345, returncode=0)
            child.poll.return_value = 0
            child.wait.return_value = 0
            with patch.object(smoke, 'REPORT_TREE', root), patch.object(smoke, 'REPORT', root), \
                 patch.object(smoke.subprocess, 'Popen', return_value=child) as spawn:
                smoke.run_tests('fixture-correction', ['build-smoke-multi-agent.e2e.ts', 'build-smoke-providers.e2e.ts'], {})
            args = spawn.call_args.args[0]
            self.assertEqual(args[args.index('--grep') + 1],
                'child agent creation updates sidebar and chat isolation|mock provider completes the hello-world task')
            self.assertNotIn('--grep-invert', args)
            self.assertIn('--retries=0', args)
            self.assertEqual(json.loads((root / 'fixture-correction.json').read_text())['argv'], args)

    def exercise(self, failure, scope='full', arch='arm64', wrong_target=0):
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
                    wrong = failure == 'architecture' and sum(cmd[0] == 'lipo' for cmd in commands) == wrong_target + 1
                    return ('x86_64' if arch == 'arm64' else 'arm64').encode() if wrong else arch.encode()
                return b''
            with patch.dict(os.environ, {'RUNNER_ENVIRONMENT': 'github-hosted', 'RUNNER_OS': 'macOS',
                'RUNNER_ARCH': 'ARM64' if arch == 'arm64' else 'X64', 'RUNNER_TEMP': temp, 'RUNNER_NAME': 'fixture',
                'GITHUB_SHA': 'source', 'GITHUB_RUN_ID': '1', 'GITHUB_RUN_ATTEMPT': '1',
                'BUILD_SMOKE_MACOS_SCOPE': scope}, clear=True), \
                patch.object(smoke.platform, 'system', return_value='Darwin'), \
                patch.object(smoke.platform, 'machine', return_value=arch), \
                patch.object(smoke, 'REPORT_TREE', root / 'report'), patch.object(smoke, 'REPORT', root / 'report'), patch.object(smoke.sys, 'argv', ['runner', temp]), \
                patch.object(smoke, 'command', side_effect=command), patch.object(smoke, 'run_tests') as run:
                if failure:
                    with self.assertRaisesRegex(RuntimeError, f'Actual executable lacks {arch}' if failure == 'architecture' else 'injected ' + failure): smoke.main()
                    run.assert_not_called()
                else:
                    smoke.main()
                    self.assertEqual(json.loads((root / 'report/admission.json').read_text())['scope'], scope)
                    architectures = json.loads((root / 'report/executables.json').read_text())
                    self.assertEqual(list(architectures.values()), [[arch]] * 3)
                    if scope == 'fixture-correction':
                        run.assert_called_once()
                        self.assertEqual(run.call_args.args[:2], ('fixture-correction',
                            ['build-smoke-multi-agent.e2e.ts', 'build-smoke-providers.e2e.ts']))
                    else:
                        self.assertEqual([call.args[0] for call in run.call_args_list], ['journeys', 'fixture-suite'])
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
