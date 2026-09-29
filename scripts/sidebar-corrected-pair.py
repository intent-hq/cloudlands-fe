"""PROPOSED hosted-only controller. Never executed during preparation."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import selectors
import shutil
import signal
import stat
import subprocess
import sys
import time

REF = 'd7bdc3034e43b7db7e167ae4d46cd163f843dd59'
TREE = '6d790487dd4832c337183eddfaaae246dc054617'
SPECS = ['test/workspace-tab-strip-status-geometry.spec.ts']
TITLES = ['keeps the normal first-tab curve, both flares, and 24px panel gutter across the geometry matrix',
          'preserves the collapsed-sidebar first-tab clearance across zoom']
CACHES = ['node_modules/.vite-harness/workspace-tab-strip-status-geometry']
SOURCE_BLOBS = {
    SPECS[0]: '2977be06d6a05ad03049e185c184228ace7cfba1',
    'test/sidebar-shell-import.ts': 'd83ad3a85afd181576a2ded03d92680a44ac20e0',
    'test/vite-harness-cache.mjs': '8e3fe1680a2efdab8df46ff5e1cb5ca56cbc70dc',
    'playwright.config.ts': '2d3277409456705bd53bd19388d292b76c340329',
    'pnpm-lock.yaml': '152e7eeb5fad1097a0d916d169521aaa1ff3f59c',
}
subject = Path(sys.argv[1]).resolve()
workers = int(sys.argv[2])
root = Path(sys.argv[3]).resolve()
assert workers == 2 and not root.exists()
root.mkdir(mode=0o700)
receipts = root / 'receipts'
payload = root / 'payload'
receipts.mkdir(mode=0o700)
payload.mkdir(mode=0o700)

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

def run(cell):
    out = payload / cell
    out.mkdir(mode=0o700)
    args = ['pnpm', 'run', 'test:playwright', *SPECS, '--project=chromium',
            '--workers=' + str(workers), '--retries=0', '--repeat-each=1',
            '--trace=on', '--reporter=list,json', '--output=' + str(out / 'test-results'),
            '--grep=' + '|'.join(TITLES)]
    env = dict(os.environ)
    for forbidden in ('WORKSPACE_TAB_STRIP_REF', 'NODE_V8_COVERAGE'):
        assert not env.get(forbidden), forbidden
    env['STRIP_OBSERVATION_ROOT'] = str(payload / 'events')
    env['PLAYWRIGHT_JSON_OUTPUT_FILE'] = str(out / 'results.json')
    record(cell + '-start', {'argv': args, 'cwd': str(subject), 'time': now(),
                           'workers': workers, 'primarySeconds': 300,
                           'killAfterSeconds': 10, 'outerStepMinutes': 10,
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
    primary_deadline = start + 300
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
    assert (out / 'results.json').stat().st_size <= 8 * 1024 * 1024
    report = json.loads((out / 'results.json').read_text())
    cases = []
    def visit(suites):
        for suite in suites:
            for spec in suite.get('specs', []):
                for test in spec.get('tests', []):
                    cases.append((spec, test))
            visit(suite.get('suites', []))
    visit(report['suites'])
    assert len(cases) == 2 and not report.get('errors')
    assert report['config']['workers'] == 2
    assert sorted(spec['title'] for spec, test in cases) == sorted(TITLES)
    rows = []
    for spec, test in cases:
        assert Path(spec['file']).name == Path(SPECS[0]).name
        assert test['projectName'] == 'chromium' and test['expectedStatus'] == 'passed'
        assert len(test['results']) == 1
        result = test['results'][0]
        assert result['retry'] == 0 and result['status'] in ('passed', 'failed', 'timedOut')
        rows.append({'title': spec['title'], 'worker': result['workerIndex'],
                     'status': result['status'], 'retry': result['retry'], 'parallel': result.get('parallelIndex')})
    record(cell + '-result-observation', {'nativeExit': code, 'cases': rows,
        'actualWorkers': sorted({row['worker'] for row in rows}),
        'limits': 'A pass is one exposure; failure is evidence, not acceptance. Overlap requires lifecycle records.'})
    return rows

def reconcile_observers(cases, files, raw_stdout):
    """Pure data validation, not a causal verdict or a filesystem/process operation."""
    assert len(cases) == 2 and sorted(row['title'] for row in cases) == sorted(TITLES)
    expected = {}
    for row in cases:
        assert type(row['worker']) is int and row['worker'] in (0, 1)
        assert type(row['parallel']) is int and row['parallel'] in (0, 1)
        assert row['retry'] == 0
        expected.setdefault(row['worker'], []).append((row['title'], row['parallel'], row['retry']))
    assert len(files) == len(expected), 'missing/extra worker file'
    # Count every candidate, including malformed/truncated messages; never regex-filter bad ones away.
    prefix = b'STRIP_OBSERVER_FINAL '
    segments = raw_stdout.split(prefix)
    acknowledgements = []
    for segment in segments[1:]:
        assert b'\n' in segment, 'truncated finalization acknowledgement'
        line = segment.split(b'\n', 1)[0]
        assert len(line) <= 8192
        ack = json.loads(line)
        assert ack['kind'] == 'observer-finalization'
        assert ack['footerWritten'] is True and ack['captureComplete'] is True
        assert type(ack['syncExit']) is int and ack['syncExit'] == 0
        assert type(ack['closeExit']) is int and ack['closeExit'] == 0
        assert not ack['errors'] and not ack['captureErrors']
        acknowledgements.append(ack)
    assert len(acknowledgements) == len(expected), 'missing/duplicate acknowledgement'
    seen_workers = set()
    seen_pids = set()
    bound = []
    for file in files:
        raw, metadata = file['raw'], file['metadata']
        assert len(raw) <= 4 * 1024 * 1024 and raw.endswith(b'\n')
        rows = [json.loads(line) for line in raw.splitlines()]
        assert 2 <= len(rows) <= 12001
        initial, terminal = rows[0], rows[-1]
        worker = initial['worker']
        assert type(worker) is int and worker in expected and worker not in seen_workers
        seen_workers.add(worker)
        assert initial['kind'] == 'worker-start'
        assert type(initial['pid']) is int and initial['pid'] > 0
        assert isinstance(initial['startTicks'], str) and initial['startTicks'].isdigit()
        process_id = (initial['pid'], initial['startTicks'])
        assert process_id not in seen_pids
        seen_pids.add(process_id)
        identity_fields = ('worker', 'parallel', 'pid', 'startTicks', 'processTimeOrigin', 'server')
        identity = {key: initial[key] for key in identity_fields}
        assert initial['server'] == str(initial['pid']) + ':' + initial['startTicks'] + ':1'
        assert all({key: row[key] for key in identity_fields} == identity for row in rows)
        assert terminal['kind'] == 'observer-terminal' and terminal['captureComplete'] is True
        assert not terminal['errors'] and not any(row['kind'] == 'observer-error' for row in rows)
        assert all(row['kind'] != 'observer-terminal' for row in rows[:-1])
        assert terminal['count'] == len(rows) - 1
        assert terminal['bytes'] == sum(len(line) + 1 for line in raw.splitlines()[:-1])
        assert [row['seq'] for row in rows[:-1]] == list(range(len(rows) - 1))
        actual = []
        for row in rows:
            if 'workerIndex' in row:
                assert row['workerIndex'] == worker and row['parallelIndex'] == initial['parallel']
            if row['kind'] == 'page-attached-before-navigation':
                actual.append((row['title'], row['parallelIndex'], row['retry']))
        assert sorted(actual) == sorted(expected[worker]), 'missing/duplicate/mismatched case coverage'
        matches = [ack for ack in acknowledgements if ack['worker'] == worker]
        assert len(matches) == 1
        ack = matches[0]
        assert {key: ack[key] for key in identity_fields} == identity
        binding = ack['file']
        assert binding['name'] == file['name'] == 'worker-' + str(worker) + '-' + str(initial['pid']) + '.jsonl'
        assert binding['bytes'] == len(raw) and binding['sha256'] == hashlib.sha256(raw).hexdigest()
        assert binding['mode'] == 0o600 and binding['nlink'] == 1
        assert all(binding[key] == metadata[key] for key in ('dev', 'ino', 'uid', 'gid', 'mode', 'nlink'))
        bound.append({'identity': identity, 'cases': actual, 'file': binding,
                      'syncExit': ack['syncExit'], 'closeExit': ack['closeExit']})
    assert seen_workers == set(expected)
    return {'workers': bound, 'coverageComplete': True,
            'overlap': 'UNPROVED; requires reviewed actual server/cache intervals, even with two workers',
            'durability': 'Acknowledged event-file fsync and close only; stdout acknowledgement persistence depends on captured native stream'}

ownership_settled = True
observed_test_exit = None
accepted = False
try:
    assert os.environ.get('GITHUB_RUN_ATTEMPT') == '1'
    route_path = Path(os.environ['MATRIX_ROUTE_RECEIPT'])
    assert not route_path.is_symlink() and route_path.stat().st_size <= 2 * 1024 * 1024
    route_raw = route_path.read_bytes()
    route_binding = json.loads(route_raw)
    assert route_binding['accepted'] is True and route_binding['subject'] == REF
    assert route_binding['head'] == os.environ['MATRIX_CONTROLLER_SHA']
    assert route_binding['merge'] == os.environ['GITHUB_SHA']
    assert route_binding['workflowSha'] == os.environ['GITHUB_WORKFLOW_SHA']
    assert route_binding['runId'] == os.environ['GITHUB_RUN_ID']
    assert route_binding['runNumber'] == os.environ['GITHUB_RUN_NUMBER'] == '3'
    assert route_binding['attempt'] == os.environ['GITHUB_RUN_ATTEMPT'] == '1'
    record('route-binding', {'sha256': hashlib.sha256(route_raw).hexdigest(), 'receipt': route_binding})
    assert git('rev-parse', 'HEAD') == REF and git('rev-parse', 'HEAD^{tree}') == TREE
    assert git('status', '--porcelain', '--untracked-files=no') == ''
    for path, blob in SOURCE_BLOBS.items():
        data = (subject / path).read_bytes()
        assert hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest() == blob
    tool_paths = {name: shutil.which(name) for name in ('node', 'pnpm', 'python3')}
    tools = {name: {'path': p, 'realpath': str(Path(p).resolve()),
                    'sha256': hashlib.sha256(Path(p).resolve().read_bytes()).hexdigest()}
             for name, p in tool_paths.items()}
    versions = {}
    for name in ('node', 'pnpm'):
        versions[name] = subprocess.check_output([name, '--version'], timeout=10).decode().strip()
    assert versions == {'node': 'v24.21.0', 'pnpm': '10.30.3'}
    browser_query = "const p=require('playwright'); console.log(JSON.stringify({version:require('playwright/package.json').version,package:require.resolve('playwright/package.json'),executable:p.chromium.executablePath()}))"
    browser = json.loads(subprocess.check_output(['node', '-e', browser_query], cwd=subject, timeout=10))
    assert browser['version'] == '1.62.1'
    exe = Path(browser['executable']).resolve()
    assert exe.is_file() and exe.stat().st_size <= 512 * 1024 * 1024
    browser['sha256'] = hashlib.sha256(exe.read_bytes()).hexdigest()
    registry_path = (Path(browser['package']).parent.parent / 'playwright-core' / 'browsers.json').resolve()
    registry_bytes = registry_path.read_bytes()
    registry = json.loads(registry_bytes)
    selected = [b for b in registry['browsers'] if b['name'] in ('chromium', 'chromium-headless-shell', 'ffmpeg')]
    assert {b['name'] for b in selected} == {'chromium', 'chromium-headless-shell', 'ffmpeg'}
    assert not os.environ.get('PLAYWRIGHT_BROWSERS_PATH')
    tool_roots = [Path.home() / '.cache/ms-playwright' / (b['name'].replace('-', '_') + '-' + b['revision']) for b in selected]
    assert all(p.is_dir() for p in tool_roots)
    record('browser-registry', {'path': str(registry_path), 'sha256': hashlib.sha256(registry_bytes).hexdigest(), 'entries': selected})
    record('browser-payload-before', inventory(tool_roots, 3 * 1024 * 1024 * 1024, 30000))
    record('browser-tool', browser)
    record('tool-versions', versions)
    record('inputs', {'ref': REF, 'tree': TREE, 'tools': tools, 'environment':
                      {k: os.environ.get(k) for k in ('CI', 'NODE_OPTIONS', 'RUNNER_NAME',
                       'RUNNER_OS', 'RUNNER_ARCH', 'ImageOS', 'ImageVersion', 'GITHUB_SHA', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT')}})
    generated_paths = [subject / 'src/shared/paraglide', subject / 'src/preload/index.ts']
    generated = inventory(generated_paths, 64 * 1024 * 1024, 12000)
    record('generated-before', generated)
    cache_paths = [subject / p for p in CACHES]
    cold = inventory(cache_paths, 256 * 1024 * 1024, 8192)
    record('cold-before', cold)
    assert all(x.get('absent') for x in cold)
    # Only exact reviewed observation overlay; subject commit remains fixed and recorded.
    control = Path(__file__).resolve().parent.parent
    overlay = ['test/workspace-tab-strip-status-geometry.spec.ts', 'test/strip-observation.mjs']
    rows = {x['path']: x for x in route_binding['controllerAndExecutedRouteFiles']}
    for name in overlay:
        src, dst = control / name, subject / name
        data = src.read_bytes()
        assert hashlib.sha256(data).hexdigest() == rows[name]['sha256']
        if name == SPECS[0]:
            st = dst.lstat()
            assert stat.S_ISREG(st.st_mode) and st.st_uid == os.getuid() and st.st_nlink == 1
            assert git('hash-object', str(dst)) == SOURCE_BLOBS[name]
            fd = os.open(dst, os.O_WRONLY | os.O_NOFOLLOW)
            assert os.fstat(fd).st_ino == st.st_ino and os.fstat(fd).st_dev == st.st_dev
            with os.fdopen(fd, 'wb') as stream:
                stream.write(data); stream.truncate()
        else:
            fd = os.open(dst, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, 'wb') as stream: stream.write(data)
    record('observed-source-overlay', [rows[name] for name in overlay])
    (payload / 'events').mkdir(mode=0o700)
    actual_cases = run('cold')
    record('cold-after', inventory(cache_paths, 256 * 1024 * 1024, 8192))
    generated_after = inventory(generated_paths, 64 * 1024 * 1024, 12000)
    record('generated-after', generated_after)
    assert generated_after == generated
    assert git('diff', '--name-only').splitlines() == [SPECS[0]]
    for name in overlay:
        assert hashlib.sha256((subject / name).read_bytes()).hexdigest() == rows[name]['sha256']
    event_manifest = inventory([payload / 'events'], 8 * 1024 * 1024, 4)
    record('observer-manifest', event_manifest)
    event_files = sorted((payload / 'events').glob('*.jsonl'))
    event_data = []
    for path in event_files:
        st = path.lstat()
        assert stat.S_ISREG(st.st_mode) and st.st_uid == os.getuid() and st.st_nlink == 1
        assert st.st_size <= 4 * 1024 * 1024 and stat.S_IMODE(st.st_mode) == 0o600
        event_data.append({'name': path.name, 'raw': path.read_bytes(), 'metadata':
            {'dev': st.st_dev, 'ino': st.st_ino, 'uid': st.st_uid, 'gid': st.st_gid,
             'mode': stat.S_IMODE(st.st_mode), 'nlink': st.st_nlink}})
    stdout_path = payload / 'cold/stdout.raw'
    assert stdout_path.stat().st_size <= 8 * 1024 * 1024
    coverage = reconcile_observers(actual_cases, event_data, stdout_path.read_bytes())
    record('observer-coverage-and-finalization', coverage)
    accepted = True
except Exception as error:
    record('stop', {'type': type(error).__name__, 'message': str(error), 'time': now()})
finally:
    try:
        assert ownership_settled, 'Payload/cache ownership incomplete; no live-mutating inventory or upload credit'
        record('payload-manifest', inventory([payload], 64 * 1024 * 1024, 128))
        if os.environ.get('GITHUB_OUTPUT'):
            with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
                output.write('upload_payload=true\n')
    except Exception as error:
        record('payload-stop', {'type': type(error).__name__, 'message': str(error)})
        accepted = False
    record('pair-result', {'observationComplete': accepted, 'testPassOrCauseAccepted': False, 'time': now(), 'noRetry': True})
sys.exit(observed_test_exit if accepted and observed_test_exit in (0, 1) else 1)
