#!/usr/bin/env python3
"""Run fixture-only smoke journeys on a fresh hosted macOS VM, never a developer host."""
import hashlib
import json
import os
from pathlib import Path
import platform
import plistlib
import shutil
import subprocess
import sys
import tempfile
import time

REPORT = Path('e2e-reports/packaged-run')

def record(name, value):
    REPORT.mkdir(parents=True, exist_ok=True)
    (REPORT / f'{name}.json').write_text(json.dumps(value, indent=2) + '\n')

def command(args, timeout=60):
    result = subprocess.run(args, capture_output=True, timeout=timeout, check=False)
    if result.returncode:
        raise RuntimeError(f'{args[0]} exited {result.returncode}: {result.stderr.decode(errors="replace")[:8192]}')
    return result.stdout

def test_environment(root, executable):
    # Explicit allowlist: no GitHub/Apple/provider tokens, NODE_OPTIONS, daemon
    # socket overrides, SSH agent, inherited cloud profiles, or real API keys.
    env = {key: os.environ[key] for key in ('PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'DISPLAY', '__CF_USER_TEXT_ENCODING') if key in os.environ}
    env.update(CI='true', TESTING='true', GIT_TERMINAL_PROMPT='0',
               GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=str(root / 'gitconfig'),
               TMPDIR=str(root / 'tmp'), XDG_CONFIG_HOME=str(root / 'config'),
               XDG_DATA_HOME=str(root / 'data'), XDG_CACHE_HOME=str(root / 'cache'),
               PACKAGED_APP_PATH=str(executable), BUILD_SMOKE_VALIDATE_JOURNEYS='1',
               DEFAULT_PROVIDER_OVERRIDE='mock', PLAYWRIGHT_HTML_OPEN='never')
    return env

def run_tests(label, files, env):
    log = REPORT / f'{label}.log'
    args = ['pnpm', 'exec', 'playwright', 'test', '--config=e2e/build-smoke.config.ts',
            '--retries=0', '--workers=1', '--max-failures=1', *files]
    env = {**env, 'BUILD_SMOKE_REPORT_DIR': str(REPORT / label)}
    if label == 'fixture-suite':
        args += ['--grep-invert', '(auggie|claude-code|codex|opencode) provider']
    started = time.monotonic()
    # Playwright owns each app handle. A timeout is a failed, unsettled run;
    # the job ends and its disposable VM is retired, never reused for a retry.
    with log.open('wb') as output:
        child = subprocess.Popen(args, env=env, stdout=output, stderr=subprocess.STDOUT)
        try:
            while child.poll() is None:
                size = sum(p.stat().st_size for p in Path('e2e-reports').rglob('*') if p.is_file())
                fixture_size = sum(p.stat().st_size for p in Path(env['TMPDIR']).parent.rglob('*') if p.is_file())
                free = shutil.disk_usage(env['TMPDIR']).free
                if time.monotonic() - started > 1200 or size > 2 * 1024**3 or fixture_size > 20 * 1024**3 or free < 4 * 1024**3:
                    raise RuntimeError('Smoke time/report/free-disk limit reached; process settlement unknown')
                time.sleep(1)
            record(label, {'argv': args, 'pid': child.pid, 'exitCode': child.returncode,
                           'seconds': time.monotonic() - started, 'directChildWait': child.wait()})
            if child.returncode:
                raise RuntimeError(f'{label} failed; see {log}')
        except BaseException as error:
            record(label + '-failure', {'pid': child.pid, 'exitCode': child.poll(), 'error': str(error),
                                       'settlement': 'unknown' if child.poll() is None else 'direct child returned'})
            raise

def main():
    if (os.environ.get('RUNNER_ENVIRONMENT') != 'github-hosted' or
        os.environ.get('RUNNER_OS') != 'macOS' or os.environ.get('RUNNER_ARCH') != 'ARM64' or
        platform.system() != 'Darwin' or platform.machine() != 'arm64'):
        raise RuntimeError('Requires a fresh GitHub-hosted macOS arm64 job')
    REPORT.mkdir(parents=True, exist_ok=True)
    root = Path(tempfile.mkdtemp(prefix='packaged-smoke-', dir=os.environ['RUNNER_TEMP']))
    for name in ('tmp', 'config', 'data', 'cache', 'mount'):
        (root / name).mkdir(mode=0o700)
    (root / 'gitconfig').write_text('[user]\nname = Packaged Smoke\nemail = smoke@test.invalid\n[commit]\ngpgsign = false\n')
    dmgs = list(Path(sys.argv[1]).glob('*.dmg'))
    if len(dmgs) != 1 or dmgs[0].is_symlink() or dmgs[0].stat().st_size > 1024**3:
        raise RuntimeError('Expected exactly one bounded signed DMG')
    dmg = dmgs[0].resolve()
    with dmg.open('rb') as source:
        digest = hashlib.file_digest(source, 'sha256').hexdigest()
    record('admission', {'source': os.environ['GITHUB_SHA'], 'run': os.environ['GITHUB_RUN_ID'],
                         'attempt': os.environ['GITHUB_RUN_ATTEMPT'], 'dmgSha256': digest,
                         'dmgBytes': dmg.stat().st_size, 'fixtureRoot': str(root),
                         'platform': platform.platform(), 'arch': platform.machine(),
                         'runner': os.environ['RUNNER_NAME']})
    mounted = False
    primary = None
    try:
        command(['hdiutil', 'verify', str(dmg)], 120)
        info = plistlib.loads(command(['hdiutil', 'attach', '-readonly', '-nobrowse', '-noautoopen',
                                      '-mountpoint', str(root / 'mount'), '-plist', str(dmg)], 60))
        mounted = True
        mounts = [row for row in info['system-entities'] if row.get('mount-point')]
        if len(mounts) != 1 or mounts[0]['mount-point'] != str(root / 'mount'):
            raise RuntimeError('Mounted image identity mismatch')
        record('attachment', info)
        app = root / 'Intent.app'
        command(['ditto', str(root / 'mount/Intent.app'), str(app)], 120)
    except BaseException as error:
        primary = error
        raise
    finally:
        if mounted:
            try:
                command(['hdiutil', 'detach', str(root / 'mount')], 60)
                record('detach', {'mount': str(root / 'mount'), 'exitCode': 0, 'beforeAppLaunch': True})
            except BaseException as cleanup:
                record('detach-failure', {'primary': str(primary) if primary else None, 'cleanup': str(cleanup), 'settlement': 'unknown'})
                if primary is None:
                    raise
                # The pending primary is re-raised; cleanup remains independently recorded.
    command(['codesign', '--verify', '--deep', '--strict', str(app)], 120)
    command(['spctl', '--assess', '--type', 'execute', '--verbose=2', str(app)], 120)
    executable = app / 'Contents/MacOS/Intent'
    targets = [executable, app / 'Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework',
               app / 'Contents/Resources/intentd/intentd']
    architectures = {}
    for target in targets:
        arches = command(['lipo', '-archs', str(target)]).decode().strip().split()
        if 'arm64' not in arches:
            raise RuntimeError(f'Actual executable lacks arm64: {target}')
        architectures[str(target.relative_to(app))] = arches
    record('executables', architectures)
    env = test_environment(root, executable)
    run_tests('journeys', ['build-smoke-commit.e2e.ts', 'build-smoke-editorial-workspace.e2e.ts',
                           'build-smoke-multi-agent.e2e.ts'], env)
    run_tests('fixture-suite', ['build-smoke-agent-chat.e2e.ts', 'build-smoke-followup.e2e.ts',
                                'build-smoke-navigation.e2e.ts', 'build-smoke-providers.e2e.ts'], env)
    # Credentials are deliberately absent; live-provider/remote PR cases are not
    # part of this fixture-only suite and cannot be counted as passing.

if __name__ == '__main__':
    try:
        main()
    except BaseException as error:
        record('failure', {'error': str(error), 'historicalEnvironmentReused': False})
        raise
