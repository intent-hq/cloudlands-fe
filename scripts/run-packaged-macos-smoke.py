#!/usr/bin/env python3
"""Run fixture-only smoke journeys on a fresh hosted macOS VM, never a developer host."""
import hashlib
import json
import os
from pathlib import Path
import platform
import plistlib
import shutil
import signal
import subprocess
import sys
import tarfile
import tempfile
import time

REPORT_TREE = Path('e2e-reports')
REPORT = REPORT_TREE / 'packaged-run'
FIXTURE_ROOT = None
SUITE_SECONDS = 780
ARCHIVE_LIMIT = 256 * 1024**2
REPORT_LIMIT = 2 * 1024**3
# 780 admission + 2*780 suites + 40 termination + 120 evidence + 60 recording
# = 2560s, leaving 140s inside the unchanged 45-minute step.

def report_bytes():
    return sum(p.stat().st_size for p in REPORT_TREE.rglob('*') if p.is_file() and not p.is_symlink())

class BoundedArchiveWriter:
    """Charge actual compressed bytes, including gzip headers/footer and tar overhead."""
    def __init__(self, raw):
        self.raw = raw
        self.name = raw.name
        self.failed = False
    def tell(self):
        return self.raw.tell()
    def flush(self):
        return self.raw.flush()
    def write(self, data):
        archive_bytes = self.tell() + len(data)
        output_bytes = report_bytes() + len(data)
        if self.failed or archive_bytes > ARCHIVE_LIMIT or output_bytes > REPORT_LIMIT - 1024**2:
            self.failed = True
            raise RuntimeError(f'Actual archive/report byte limit exceeded at {self.name}: archiveBytes={archive_bytes}/{ARCHIVE_LIMIT}, reportBytes={output_bytes}/{REPORT_LIMIT - 1024**2}; capture incomplete')
        try:
            written = self.raw.write(data)
            if written != len(data): raise OSError('Short archive write')
            return written
        except BaseException:
            self.failed = True
            raise

def stop_test_child(child):
    """Only the session/group created by this runner; never discover/adopt one."""
    receipt = {'pid': child.pid, 'requested': [], 'directChildWait': None,
               'descendants': 'not proven absent; disposable job must not be reused'}
    try:
        if child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)
            receipt['requested'].append('SIGTERM')
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                # The unreaped direct child still anchors this created group.
                os.killpg(child.pid, signal.SIGKILL)
                receipt['requested'].append('SIGKILL')
                child.wait(timeout=10)
        receipt['directChildWait'] = child.wait(timeout=1)
    except BaseException as error:
        receipt['error'] = str(error)
        receipt['settlement'] = 'unknown'
    return receipt

def retain_fixtures(root):
    """Preserve fixture DBs/repos/profiles, never the copied app or external links."""
    started = time.monotonic()
    total = 0
    files = 0
    entries = 0
    omitted = []
    excluded_caches = []
    archive_path = REPORT / 'fixture-state.tar.gz'
    # Unbuffered output makes each writer debit visible to the directory check.
    with archive_path.open('xb', buffering=0) as raw, tarfile.open(fileobj=BoundedArchiveWriter(raw), mode='w:gz', dereference=False) as archive:
        # Capture home first. Only npm's reproducible content/dependency caches are
        # excluded from the archive, but remains charged by the whole-root
        # 20 GiB growth guard. No other home subtree is excluded.
        for name in ('home', 'tmp', 'config', 'data', 'cache', 'gitconfig'):
            base = root / name
            if name == 'home':
                def home_paths():
                    for directory, dirs, names in os.walk(base, followlinks=False):
                        if Path(directory) == base / '.npm' and '_cacache' in dirs:
                            dirs.remove('_cacache')
                            excluded_caches.append('home/.npm/_cacache')
                        parts = Path(directory).relative_to(base).parts
                        if (len(parts) == 3 and parts[:2] == ('.npm', '_npx') and
                            len(parts[2]) == 16 and all(c in '0123456789abcdef' for c in parts[2]) and
                            'node_modules' in dirs and all(
                                (Path(directory) / manifest).is_file() and
                                not (Path(directory) / manifest).is_symlink()
                                for manifest in ('package.json', 'package-lock.json'))):
                            # Preserve the cache's manifests and npm diagnostic logs.
                            # Never omit node_modules in an actual worktree.
                            dirs.remove('node_modules')
                            excluded_caches.append((Path(directory) / 'node_modules').relative_to(root).as_posix())
                        for child in dirs + names:
                            yield Path(directory) / child
                paths = home_paths()
            else:
                paths = [base] if base.is_file() else base.rglob('*')
            for path in paths:
                entries += 1
                relative = path.relative_to(root).as_posix()
                elapsed = time.monotonic() - started
                if entries > 20000 or elapsed > 120:
                    raise RuntimeError(f'Fixture evidence entry/time bound exceeded at {relative}: entries={entries}/20000, seconds={elapsed}/120; archive incomplete')
                if path.is_symlink() or not path.is_file():
                    if not path.is_dir(): omitted.append(relative)
                    continue
                size = path.stat().st_size
                total += size
                files += 1
                elapsed = time.monotonic() - started
                if size > 64 * 1024**2 or total > 256 * 1024**2 or files > 20000 or elapsed > 120:
                    raise RuntimeError(f'Fixture evidence bound exceeded at {relative}: fileBytes={size}/{64 * 1024**2}, inputBytes={total}/{256 * 1024**2}, files={files}/20000, seconds={elapsed}/120; partial archive is not complete')
                archive.add(path, arcname=relative, recursive=False)
    archive_bytes = archive_path.stat().st_size
    output_bytes = report_bytes()
    if archive_bytes > ARCHIVE_LIMIT or output_bytes > REPORT_LIMIT:
        raise RuntimeError(f'Final archive/report byte limit exceeded at {archive_path}: archiveBytes={archive_bytes}/{ARCHIVE_LIMIT}, reportBytes={output_bytes}/{REPORT_LIMIT}; capture incomplete')
    record('fixture-state', {'files': files, 'inputBytes': total, 'archiveBytes': archive_path.stat().st_size,
                            'omittedNonregular': omitted,
                            'excludedReproducibleCaches': excluded_caches,
                            'consistency': 'post-test copy; see shutdown receipts for settlement'})
    if report_bytes() > REPORT_LIMIT:
        raise RuntimeError('Final report byte limit exceeded after capture receipt')

def record(name, value):
    REPORT.mkdir(parents=True, exist_ok=True)
    path = REPORT / f'{name}.json'
    data = (json.dumps(value, indent=2) + '\n').encode('utf8')
    old_size = path.stat().st_size if path.exists() else 0
    if report_bytes() - old_size + len(data) > REPORT_LIMIT:
        raise RuntimeError('Report receipt does not fit total output bound')
    path.write_bytes(data)
    if report_bytes() > REPORT_LIMIT: raise RuntimeError('Final report byte limit exceeded')

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
               HOME=str(root / 'home'),
               INTENTD_WORKSPACES_DIR=str(root / 'home/intent/workspaces'),
               BUILD_SMOKE_WORKSPACES_ROOT=str(root / 'home/intent/workspaces'),
               GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=str(root / 'gitconfig'),
               TMPDIR=str(root / 'tmp'), XDG_CONFIG_HOME=str(root / 'config'),
               XDG_DATA_HOME=str(root / 'data'), XDG_CACHE_HOME=str(root / 'cache'),
               PACKAGED_APP_PATH=str(executable), BUILD_SMOKE_VALIDATE_JOURNEYS='1',
               BUILD_SMOKE_RETAIN_FIXTURES='1',
               DEFAULT_PROVIDER_OVERRIDE='mock', PLAYWRIGHT_HTML_OPEN='never')
    return env

def run_tests(label, files, env):
    log = REPORT / f'{label}.log'
    args = ['pnpm', 'exec', 'playwright', 'test', '--config=e2e/build-smoke.config.ts',
            '--retries=0', '--workers=1', '--max-failures=1', *files]
    env = {**env, 'BUILD_SMOKE_REPORT_DIR': str(REPORT / label)}
    if label == 'fixture-suite':
        args += ['--grep-invert', '(auggie|claude-code|codex|opencode) provider']
    elif label == 'fixture-correction':
        args += ['--grep', 'child agent creation updates sidebar and chat isolation|mock provider completes the hello-world task']
    started = time.monotonic()
    # Playwright owns each app handle. A timeout is a failed, unsettled run;
    # the job ends and its disposable VM is retired, never reused for a retry.
    with log.open('wb') as output:
        child = subprocess.Popen(args, env=env, stdout=output, stderr=subprocess.STDOUT,
                                 start_new_session=True)
        try:
            while child.poll() is None:
                size = sum(p.stat().st_size for p in Path('e2e-reports').rglob('*') if p.is_file())
                fixture_size = sum(p.stat().st_size for p in Path(env['TMPDIR']).parent.rglob('*') if p.is_file())
                free = shutil.disk_usage(env['TMPDIR']).free
                # Reserve 256 MiB for fixture collection and 1 MiB for receipts.
                if time.monotonic() - started > SUITE_SECONDS or size > 2 * 1024**3 - 257 * 1024**2 or fixture_size > 20 * 1024**3 or free < 4 * 1024**3:
                    raise RuntimeError('Smoke time/report/free-disk limit reached; process settlement unknown')
                time.sleep(1)
            record(label, {'argv': args, 'pid': child.pid, 'exitCode': child.returncode,
                           'seconds': time.monotonic() - started, 'directChildWait': child.wait()})
            if child.returncode:
                raise RuntimeError(f'{label} failed; see {log}')
        except BaseException as error:
            cleanup = stop_test_child(child)
            record(label + '-failure', {'pid': child.pid, 'exitCode': child.poll(), 'error': str(error),
                                       'cleanup': cleanup,
                                       'settlement': 'unknown' if child.poll() is None else 'direct child returned'})
            raise

def main():
    global FIXTURE_ROOT
    scope = os.environ.get('BUILD_SMOKE_MACOS_SCOPE', 'full')
    if scope not in ('full', 'fixture-correction'):
        raise RuntimeError('Unknown packaged smoke scope')
    if (os.environ.get('RUNNER_ENVIRONMENT') != 'github-hosted' or
        os.environ.get('RUNNER_OS') != 'macOS' or os.environ.get('RUNNER_ARCH') != 'ARM64' or
        platform.system() != 'Darwin' or platform.machine() != 'arm64'):
        raise RuntimeError('Requires a fresh GitHub-hosted macOS arm64 job')
    REPORT.mkdir(parents=True, exist_ok=True)
    root = Path(tempfile.mkdtemp(prefix='smoke-', dir=os.environ['RUNNER_TEMP']))
    FIXTURE_ROOT = root
    for name in ('tmp', 'config', 'data', 'cache', 'home', 'mount'):
        (root / name).mkdir(mode=0o700)
    (root / 'home/intent/workspaces').mkdir(parents=True, mode=0o700)
    (root / 'gitconfig').write_text('[user]\nname = Packaged Smoke\nemail = smoke@test.invalid\n[commit]\ngpgsign = false\n')
    dmgs = list(Path(sys.argv[1]).glob('*.dmg'))
    if len(dmgs) != 1 or dmgs[0].is_symlink() or dmgs[0].stat().st_size > 1024**3:
        raise RuntimeError('Expected exactly one bounded signed DMG')
    dmg = dmgs[0].resolve()
    with dmg.open('rb') as source:
        digest = hashlib.file_digest(source, 'sha256').hexdigest()
    record('admission', {'source': os.environ['GITHUB_SHA'], 'run': os.environ['GITHUB_RUN_ID'],
                         'attempt': os.environ['GITHUB_RUN_ATTEMPT'], 'scope': scope, 'dmgSha256': digest,
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
    if scope == 'fixture-correction':
        run_tests('fixture-correction', ['build-smoke-multi-agent.e2e.ts', 'build-smoke-providers.e2e.ts'], env)
    else:
        run_tests('journeys', ['build-smoke-commit.e2e.ts', 'build-smoke-editorial-workspace.e2e.ts',
                           'build-smoke-multi-agent.e2e.ts'], env)
        run_tests('fixture-suite', ['build-smoke-agent-chat.e2e.ts', 'build-smoke-followup.e2e.ts',
                                'build-smoke-navigation.e2e.ts', 'build-smoke-providers.e2e.ts'], env)
    # Credentials are deliberately absent; live-provider/remote PR cases are not
    # part of this fixture-only suite and cannot be counted as passing.

if __name__ == '__main__':
    primary = None
    try:
        main()
    except BaseException as error:
        primary = error
        record('failure', {'error': str(error), 'historicalEnvironmentReused': False})
        raise
    finally:
        if FIXTURE_ROOT is not None:
            try:
                retain_fixtures(FIXTURE_ROOT)
            except BaseException as recording:
                record('fixture-state-failure', {'primary': str(primary) if primary else None,
                                                'recording': str(recording), 'complete': False})
                if primary is None:
                    raise
