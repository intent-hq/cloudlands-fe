"""Hosted cold/warm root-harness validation; owned process-group cleanup only."""
import datetime
import hashlib
import json
import os
import re
from pathlib import Path
import selectors
import signal
import stat
import subprocess
import sys
import time

# Keep the helper beside this script; importlib also supports focused Python controls.
import importlib.util
_membership_spec = importlib.util.spec_from_file_location(
    'sidebar_membership', Path(__file__).with_name('sidebar-membership.py'))
membership = importlib.util.module_from_spec(_membership_spec)
_membership_spec.loader.exec_module(membership)

SPECS = ['test/workspace-tab-strip-status-geometry.spec.ts',
         'test/sidebar-shell-background.spec.ts', 'test/sidebar-shell-import.spec.ts',
         'test/vite-harness-cache.spec.ts']
CACHES = ['node_modules/.vite-harness/' + name for name in
          ('workspace-tab-strip-status-geometry', 'sidebar-shell-background',
           'sidebar-import-controls', 'sidebar-import-failure')]
def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def record(name, value):
    path = receipts / (name + '.json')
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')

def git(*args):
    return subprocess.check_output(['git', '-C', str(subject), *args], timeout=10).decode().strip()

def inventory(paths, byte_cap, entry_cap):
    result = []
    used = 0
    for base in paths:
        if not base.exists():
            assert not base.is_symlink()
            result.append({'path': str(base), 'absent': True})
            continue
        pending = [base]
        while pending:
            p = pending.pop()
            s = p.lstat()
            assert not stat.S_ISLNK(s.st_mode), str(p)
            assert s.st_uid == os.getuid(), str(p)
            row = {'path': str(p), 'dev': s.st_dev, 'ino': s.st_ino,
                   'mode': stat.S_IMODE(s.st_mode), 'uid': s.st_uid, 'gid': s.st_gid,
                   'nlink': s.st_nlink, 'bytes': s.st_size, 'mtimeNs': s.st_mtime_ns}
            if stat.S_ISDIR(s.st_mode):
                pending.extend(sorted(p.iterdir(), reverse=True))
            else:
                assert stat.S_ISREG(s.st_mode) and s.st_nlink == 1
                used += s.st_size
                assert used <= byte_cap
                row['sha256'] = hashlib.sha256(p.read_bytes()).hexdigest()
            result.append(row)
            assert len(result) <= entry_cap
    return result

def process_group_absent(group):
    try:
        os.killpg(group, 0)
        return False
    except ProcessLookupError:
        return True

def run(cell, manifest=None):
    collecting = cell == 'collection'
    primary_seconds = 60 if collecting else 600
    out = payload / cell
    out.mkdir(mode=0o700)
    args = ['pnpm', 'exec', 'playwright', 'test', *SPECS, '--project=chromium',
            '--workers=' + str(workers), '--retries=0', '--repeat-each=1',
            '--trace=on', '--reporter=list,json,' + str(
                Path(__file__).with_name('sidebar-membership-reporter.mjs').resolve()),
            '--output=' + str(out / 'test-results')]
    if collecting:
        args.append('--list')
    env = dict(os.environ)
    for forbidden in ('WORKSPACE_TAB_STRIP_REF', 'NODE_V8_COVERAGE'):
        assert not env.get(forbidden), forbidden
    env['PLAYWRIGHT_JSON_OUTPUT_FILE'] = str(out / 'results.json')
    env['SIDEBAR_MEMBERSHIP_OUTPUT_FILE'] = str(out / 'native-membership.json')
    record(cell + '-start', {'argv': args, 'cwd': str(subject), 'time': now(),
                           'workers': workers, 'primarySeconds': primary_seconds,
                           'killAfterSeconds': 10, 'outerStepMinutes': 23,
                           'traceQualification': 'Always tracing adds observation overhead.'})
    global ownership_settled, observed_test_exit
    native = None
    sel = selectors.DefaultSelector()
    streams = {}
    counts = {'stdout': 0, 'stderr': 0}
    eof = {'stdout': False, 'stderr': False}
    failures = []
    stream_chunks = []
    signals = []
    code = None
    absent = None
    reaped = False
    stop = None
    original_error = None
    primary_observed_exit = None

    def fail(where, error):
        failures.append({'where': where, 'type': type(error).__name__, 'message': str(error)})

    def drain(seconds):
        nonlocal stop
        if not sel.get_map():
            time.sleep(min(0.05, max(0, seconds)))
            return
        for item, unused in sel.select(max(0, min(0.25, seconds))):
            key = item.data
            try:
                data = os.read(item.fileobj.fileno(), 65536)
                if not data:
                    eof[key] = True
                    sel.unregister(item.fileobj)
                    continue
                if counts[key] + len(data) > 8 * 1024 * 1024:
                    stop = stop or key + '-limit'
                    # Continue bounded draining during cleanup; never call discarded bytes complete.
                    continue
                if key not in streams:
                    stop = stop or key + '-retention-unavailable'
                    continue
                if len(stream_chunks) >= 4096:
                    stop = stop or 'stream-index-limit'
                    continue
                streams[key].write(data)
                stream_chunks.append({'stream': key, 'offset': counts[key], 'bytes': len(data),
                                      'monotonic': time.monotonic(), 'time': now()})
                counts[key] += len(data)
            except BaseException as error:
                fail('stream-' + key, error)
                stop = stop or 'stream-error'
                try:
                    sel.unregister(item.fileobj)
                except BaseException as unregister_error:
                    fail('unregister-' + key, unregister_error)

    def state():
        nonlocal code, absent
        try:
            code = native.poll()
        except BaseException as error:
            fail('poll', error)
            code = None
        try:
            absent = process_group_absent(native.pid)
        except BaseException as error:
            fail('group-observation', error)
            absent = None
        return code is not None and absent is True and all(eof.values())

    def send(sig):
        row = {'signal': sig.name, 'time': now(), 'monotonic': time.monotonic()}
        try:
            os.killpg(native.pid, sig)
            row['result'] = 'sent'
        except ProcessLookupError:
            row['result'] = 'absent-at-signal'
        except BaseException as error:
            row['result'] = 'error'
            fail('signal-' + sig.name, error)
        signals.append(row)

    # One anchor before launch, never reset by EOF, parent exit, I/O failure or cleanup.
    start = time.monotonic()
    primary_deadline = start + primary_seconds
    ownership_settled = False
    try:
        native = subprocess.Popen(args, cwd=subject, env=env, stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE, start_new_session=True)
        record(cell + '-identity', {'pid': native.pid, 'group': native.pid, 'time': now(),
                                   'startMonotonic': start, 'primaryDeadline': primary_deadline})
        for pipe, key in ((native.stdout, 'stdout'), (native.stderr, 'stderr')):
            os.set_blocking(pipe.fileno(), False)
            sel.register(pipe, selectors.EVENT_READ, key)
            streams[key] = open(out / (key + '.raw'), 'xb')
        while True:
            current = time.monotonic()
            if current >= primary_deadline:
                stop = 'primary-timeout'
                break
            if state():
                primary_observed_exit = code
                break
            if failures:
                stop = 'state-error'
                break
            if code is not None:
                primary_observed_exit = code
                if absent is not True:
                    stop = 'parent-exited-with-residual-or-unknown-group'
                break
            drain(primary_deadline - current)
            if stop:
                break
    except BaseException as error:
        original_error = {'type': type(error).__name__, 'message': str(error)}
        stop = stop or 'launch-or-run-exception'
    finally:
        cleanup_start = time.monotonic()
        # Early errors get at most 10+10; late observations cannot move the original cap.
        term_deadline = min(cleanup_start, primary_deadline) + 10
        final_deadline = term_deadline + 10
        if native is not None:
            # Attach any pipe whose setup was interrupted; this services the ORIGINAL child.
            # Never retry a failed raw-file creation/write or identity receipt.
            for pipe, key in ((native.stdout, 'stdout'), (native.stderr, 'stderr')):
                if pipe is not None and not eof[key] and pipe.fileno() not in sel.get_map():
                    try:
                        os.set_blocking(pipe.fileno(), False)
                        sel.register(pipe, selectors.EVENT_READ, key)
                    except BaseException as error:
                        fail('cleanup-pipe-' + key, error)
            drain_broken = False

            def grace(deadline):
                nonlocal drain_broken
                while time.monotonic() < deadline:
                    try:
                        if drain_broken:
                            time.sleep(min(0.05, max(0, deadline - time.monotonic())))
                        else:
                            drain(deadline - time.monotonic())
                    except BaseException as error:
                        fail('cleanup-drain', error)
                        drain_broken = True
                    if state():
                        return

            complete = state()
            if not complete:
                if absent is not True or code is None:
                    send(signal.SIGTERM)
                grace(term_deadline)
                if not state():
                    if absent is not True or code is None:
                        send(signal.SIGKILL)
                    grace(final_deadline)
            try:
                code = native.wait(timeout=max(0, final_deadline - time.monotonic()))
                reaped = True
            except BaseException as error:
                fail('final-direct-wait', error)
            state()
            ownership_settled = reaped and absent is True
        # No identity from a failed Popen is not proof of historical non-dispatch.
        for key, stream in streams.items():
            try:
                stream.close()
            except BaseException as error:
                fail('close-' + key, error)
        if native is not None:
            for pipe in (native.stdout, native.stderr):
                if pipe is not None:
                    try:
                        pipe.close()
                    except BaseException as error:
                        fail('close-pipe', error)
        try:
            sel.close()
        except BaseException as error:
            fail('close-selector', error)
        terminal = {'primaryExit': code, 'primaryObservedExitBeforeCleanup': primary_observed_exit,
                    'stop': stop, 'originalError': original_error, 'cleanupErrors': failures,
                    'time': now(), 'elapsedSeconds': time.monotonic() - start,
                    'startMonotonic': start, 'primaryDeadline': primary_deadline,
                    'cleanupStart': cleanup_start, 'termDeadline': term_deadline,
                    'finalDeadline': final_deadline, 'completedWithinDeadline': time.monotonic() <= final_deadline,
                    'signals': signals,
                    'streamChunks': stream_chunks,
                    'bothEOF': eof, 'bytes': counts, 'waitReaped': reaped,
                    'capturedGroupAbsent': absent, 'ownershipSettled': ownership_settled,
                    'limits': 'Sampled group only; cancellation/uninterruptible I/O may prevent receipts; no detached/whole-runner assurance.'}
        # Single terminal write attempt. A failed write propagates STOP, never a receipt retry.
        record(cell + '-terminal', terminal)
        receipt_within_deadline = time.monotonic() <= final_deadline
    if ownership_settled:
        record(cell + '-cache-at-terminal', inventory([subject / p for p in CACHES],
                                                    256 * 1024 * 1024, 8192))
    assert stop is None and original_error is None and not failures
    assert code in (0, 1) and all(eof.values()) and ownership_settled
    observed_test_exit = code
    assert terminal['completedWithinDeadline'] and receipt_within_deadline, 'late cleanup or terminal receipt'
    report = membership.load_report(out)
    if collecting:
        manifest = membership.collect_membership(report, workers, subject, SPECS, code)
        record('membership', manifest)
        return manifest
    rows = membership.validate_report(report, manifest, workers, subject, SPECS, code)
    cache_starts = []
    for line in (out / 'stdout.raw').read_text().splitlines():
        if 'HARNESS_CACHE ' in line:
            # list reporter may prepend its progress prefix; the selected JSON is scalar only.
            cache_starts.append(json.loads(re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', line.split('HARNESS_CACHE ', 1)[1])))
    original_names = {'workspace-tab-strip-status-geometry', 'sidebar-shell-background'}
    original_starts = [row for row in cache_starts if row['name'] in original_names]
    assert {row['name'] for row in original_starts} == original_names
    first_by_path = {}
    for row in original_starts:
        first_by_path.setdefault(row['cacheDir'], row)
    assert all(row['populated'] is (cell == 'warm') for row in first_by_path.values()), 'actual per-worker cache state differs'
    record(cell + '-results', {'cases': rows, 'nativeExit': code, 'cacheStarts': cache_starts})
    assert code == 0 and all(row['status'] == 'passed' for row in rows)

def main():
    global subject, workers, root, receipts, payload, ownership_settled, observed_test_exit
    subject = Path.cwd().resolve()
    workers = int(sys.argv[1])
    assert workers in (1, 2)
    root = Path(sys.argv[2]).resolve()
    root.mkdir(mode=0o700)
    receipts = root / 'receipts'
    payload = root / 'payload'
    receipts.mkdir(mode=0o700)
    payload.mkdir(mode=0o700)
    ownership_settled = True
    observed_test_exit = None
    try:
        head = git('rev-parse', 'HEAD')
        record('source', {'head': head, 'tree': git('rev-parse', 'HEAD^{tree}'),
            'parents': git('show', '-s', '--format=%P'),
            'inputs': git('ls-tree', 'HEAD', '--', *SPECS, 'test/vite-harness-cache.mjs',
                'test/sidebar-shell-import.ts', 'test/sidebar-shell-server.ts',
                'playwright.config.ts', 'playwright/root-spec-pattern.mjs',
                'scripts/sidebar-corrected-pair.py', 'scripts/sidebar-membership.py',
                'scripts/sidebar-membership-reporter.mjs',
                'package.json', 'pnpm-lock.yaml'),
            'run': os.environ.get('GITHUB_RUN_ID'), 'attempt': os.environ.get('GITHUB_RUN_ATTEMPT'),
            'eventMerge': os.environ.get('GITHUB_SHA'), 'runner': os.environ.get('RUNNER_NAME'),
            'node': subprocess.check_output(['node', '--version'], timeout=10).decode().strip(),
            'pnpm': subprocess.check_output(['pnpm', '--version'], timeout=10).decode().strip()})
        assert not git('status', '--porcelain', '--untracked-files=no')
        cold = inventory([subject / p for p in CACHES], 256 * 1024 * 1024, 16384)
        record('cold-cache', cold)
        membership.require_cold_caches(cold, cold)
        manifest = run('collection')
        assert git('rev-parse', 'HEAD') == head
        assert not git('status', '--porcelain', '--untracked-files=no')
        after_collection = inventory([subject / p for p in CACHES], 256 * 1024 * 1024, 16384)
        record('cold-cache-after-collection', after_collection)
        membership.require_cold_caches(cold, after_collection)
        run('cold', manifest)
        warm = inventory([subject / p for p in CACHES], 256 * 1024 * 1024, 16384)
        record('warm-cache', warm)
        assert warm == json.loads((receipts / 'cold-cache-at-terminal.json').read_text())
        assert any('sha256' in row for row in warm), 'warm run must reuse actual optimizer files'
        run('warm', manifest)
        assert git('rev-parse', 'HEAD') == head
        assert not git('status', '--porcelain', '--untracked-files=no')
    finally:
        # Validate the upload cap even on failure; do not delete the original failure evidence.
        inventory([root], 256 * 1024 * 1024, 4096)


if __name__ == '__main__':
    main()
