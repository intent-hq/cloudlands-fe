#!/usr/bin/env python3
"""Default fixture smoke tests on a fresh hosted Linux x64 runner under Xvfb."""
import hashlib
import argparse
import importlib.util
import os
from pathlib import Path
import platform
import tempfile

spec = importlib.util.spec_from_file_location('packaged_smoke', Path(__file__).with_name('run-packaged-macos-smoke.py'))
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


def require_host():
    if (os.environ.get('RUNNER_ENVIRONMENT') != 'github-hosted' or
        os.environ.get('RUNNER_OS') != 'Linux' or os.environ.get('RUNNER_ARCH') != 'X64' or
        platform.system() != 'Linux' or platform.machine() != 'x86_64' or
        not os.environ.get('DISPLAY') or not os.environ.get('XAUTHORITY')):
        raise RuntimeError('Requires a fresh GitHub-hosted Linux x64 job under Xvfb')


def executable_identity(path):
    if path.is_symlink() or not path.is_file() or not os.access(path, os.X_OK):
        raise RuntimeError(f'Expected regular executable: {path}')
    if path.stat().st_size > 1024**3:
        raise RuntimeError(f'Executable exceeds 1 GiB: {path}')
    with path.open('rb') as source:
        header = source.read(20)
        if len(header) != 20 or header[:6] != b'\x7fELF\x02\x01' or header[18:20] != b'\x3e\x00':
            raise RuntimeError(f'Expected little-endian ELF64 x86-64: {path}')
        source.seek(0)
        digest = hashlib.file_digest(source, 'sha256').hexdigest()
    return {'path': str(path), 'bytes': path.stat().st_size, 'sha256': digest, 'arch': 'x86_64'}


def default_environment(root, executable):
    env = smoke.test_environment(root, executable)
    env.pop('BUILD_SMOKE_VALIDATE_JOURNEYS')
    # Xvfb's task-created cookie is needed after filtering service credentials.
    env['XAUTHORITY'] = os.environ['XAUTHORITY']
    return env


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--grep', default='')
    options = parser.parse_args()
    require_host()
    package = Path.cwd() / 'dist-electron/linux-unpacked'
    executable = package / 'intent'
    identities = [executable_identity(path) for path in
                  (executable, package / 'resources/intentd/intentd')]
    root = Path(tempfile.mkdtemp(prefix='smoke-linux-', dir=os.environ['RUNNER_TEMP']))
    smoke.FIXTURE_ROOT = root
    for name in ('tmp', 'config', 'data', 'cache', 'home'):
        (root / name).mkdir(mode=0o700)
    (root / 'home/intent/workspaces').mkdir(parents=True, mode=0o700)
    (root / 'gitconfig').write_text('[user]\nname = Packaged Smoke\nemail = smoke@test.invalid\n[commit]\ngpgsign = false\n')
    smoke.record('admission', {'source': os.environ['GITHUB_SHA'], 'run': os.environ['GITHUB_RUN_ID'],
                              'attempt': os.environ['GITHUB_RUN_ATTEMPT'], 'fixtureRoot': str(root),
                              'platform': platform.platform(), 'runner': os.environ['RUNNER_NAME'],
                              'executables': identities, 'optInMarker': 'absent',
                              'scope': 'all default build-smoke specs; live-provider cases excluded'})
    # 780s tests + 20s owned termination + 120s capture + 60s recording < 18min.
    # No test-name selection: the three restored journeys must run by default.
    # Both provider suites contain live-provider names; no credentials supplied.
    args = ['--grep-invert', '(auggie|claude-code|codex|opencode)']
    if options.grep:
        args += ['--grep', options.grep]
    smoke.run_tests('default-suite', args,
                    default_environment(root, executable))


if __name__ == '__main__':
    primary = None
    try:
        main()
    except BaseException as error:
        primary = error
        smoke.record('failure', {'error': str(error), 'historicalEnvironmentReused': False})
        raise
    finally:
        if smoke.FIXTURE_ROOT is not None:
            try:
                smoke.retain_fixtures(smoke.FIXTURE_ROOT)
            except BaseException as recording:
                smoke.record('fixture-state-failure', {'primary': str(primary) if primary else None,
                                                       'recording': str(recording), 'complete': False})
                if primary is None:
                    raise
