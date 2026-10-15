"""Diagnostic-only Linux x86_64 ancestor observer; never dumps memory or arguments.

libunwind's remote API reads stack memory internally to unwind. Output is limited
to instruction addresses, module offsets, symbol names and OS state. A default
SIGALRM terminates this observer after three seconds in capture, even in native
code; Linux then releases its ptrace attachments (no EXITKILL). The original test
continues independently. No ptrace permissions or security settings are changed.
"""
import ctypes as C
import hashlib
import json
import os
from pathlib import Path
import platform
import signal
import subprocess
import sys
import time

MAX_THREADS = 16
MAX_FRAMES = 32
CAPTURE_SECONDS = 3
MAX_BYTES = 262144


def identity(pid):
    raw = Path(f'/proc/{pid}/stat').read_text()
    fields = raw[raw.rfind(')') + 2:].split()
    return {'pid': pid, 'ppid': int(fields[1]), 'state': fields[0],
            'startTicks': int(fields[19]), 'userTicks': int(fields[11]),
            'systemTicks': int(fields[12]), 'threads': int(fields[17])}


def same_process(a, b):
    return a['pid'] == b['pid'] and a['startTicks'] == b['startTicks']


def descendant(pid, ancestor):
    for _ in range(32):
        if pid == ancestor:
            return True
        if pid <= 1:
            break
        pid = identity(pid)['ppid']
    return False


class Journal:
    def __init__(self, path):
        self.file = path.open('x', buffering=1)
        self.bytes = 0
        self.dropped = 0

    def emit(self, event, **data):
        row = json.dumps({'monotonicNs': time.monotonic_ns(), 'wallNs': time.time_ns(),
                          'event': event, **data}) + '\n'
        size = len(row.encode())
        if self.bytes + size <= MAX_BYTES:
            self.file.write(row)
            self.bytes += size
        else:
            self.dropped += 1


class Unwinder:
    def __init__(self):
        if platform.machine() != 'x86_64' or sys.platform != 'linux':
            raise RuntimeError('Only the pinned Linux x86_64 libunwind ABI is supported')
        self.libc = C.CDLL(None, use_errno=True)
        self.libc.ptrace.argtypes = [C.c_uint, C.c_int, C.c_void_p, C.c_void_p]
        self.libc.ptrace.restype = C.c_long
        self.u = C.CDLL('libunwind-x86_64.so.8', mode=C.RTLD_GLOBAL)
        self.p = C.CDLL('libunwind-ptrace.so.0')
        def bind(lib, name, args, result):
            f = getattr(lib, name)
            f.argtypes, f.restype = args, result
            return f
        self.create = bind(self.u, '_Ux86_64_create_addr_space', [C.c_void_p, C.c_int], C.c_void_p)
        self.destroy = bind(self.u, '_Ux86_64_destroy_addr_space', [C.c_void_p], None)
        self.init = bind(self.u, '_Ux86_64_init_remote', [C.c_void_p]*3, C.c_int)
        self.step = bind(self.u, '_Ux86_64_step', [C.c_void_p], C.c_int)
        self.reg = bind(self.u, '_Ux86_64_get_reg', [C.c_void_p, C.c_int, C.POINTER(C.c_uint64)], C.c_int)
        self.name = bind(self.u, '_Ux86_64_get_proc_name',
                         [C.c_void_p, C.c_char_p, C.c_size_t, C.POINTER(C.c_uint64)], C.c_int)
        self.context = bind(self.p, '_UPT_create', [C.c_int], C.c_void_p)
        self.free_context = bind(self.p, '_UPT_destroy', [C.c_void_p], None)
        self.accessors = C.addressof(C.c_char.in_dll(self.p, '_UPT_accessors'))

    def ptrace(self, request, tid):
        C.set_errno(0)
        rc = self.libc.ptrace(request, tid, None, None)
        return {'result': rc, 'errno': C.get_errno()}

    def frames(self, tid, journal, mappings):
        space = self.create(self.accessors, 0)
        ctx = self.context(tid)
        if not space or not ctx:
            if ctx:
                self.free_context(ctx)
            if space:
                self.destroy(space)
            raise RuntimeError('libunwind allocation failed')
        try:
            # libunwind 1.6 x86_64: 127 opaque uint64 words; RIP is register 16.
            cursor = (C.c_uint64 * 127)()
            result = self.init(C.byref(cursor), space, ctx)
            journal.emit('unwind-init', tid=tid, result=result)
            if result:
                return 0
            frames = 0
            for index in range(MAX_FRAMES):
                ip, offset, buf = C.c_uint64(), C.c_uint64(), C.create_string_buffer(256)
                reg = self.reg(C.byref(cursor), 16, C.byref(ip))
                named = self.name(C.byref(cursor), buf, len(buf), C.byref(offset))
                module = next((m for m in mappings if m['start'] <= ip.value < m['end']), None)
                location = None if module is None else {
                    'file': module['file'], 'inode': module['inode'],
                    'fileOffset': hex(ip.value - module['start'] + module['offset'])}
                journal.emit('frame', tid=tid, index=index, ip=hex(ip.value), module=location, registerResult=reg,
                             symbolResult=named, symbol=buf.value.decode(errors='replace'),
                             symbolOffset=offset.value)
                frames += int(reg == 0 and ip.value != 0)
                stepped = self.step(C.byref(cursor))
                if stepped <= 0:
                    journal.emit('unwind-end', tid=tid, result=stepped)
                    break
            else:
                journal.emit('frame-limit', tid=tid, limit=MAX_FRAMES)
            return frames
        finally:
            self.free_context(ctx)
            self.destroy(space)


def os_state(pid, journal):
    tids = sorted(int(p.name) for p in Path(f'/proc/{pid}/task').iterdir())
    tids = [pid] + [t for t in tids if t != pid]
    journal.emit('thread-membership', total=len(tids), selected=tids[:MAX_THREADS], limit=MAX_THREADS)
    for tid in tids[:MAX_THREADS]:
        for field in ('stat', 'wchan', 'stack'):
            try:
                p = Path(f'/proc/{pid}/task/{tid}/{field}')
                if field == 'stat':
                    value = identity(tid)
                else:
                    with p.open() as stream:
                        value = stream.read(2048)
                journal.emit('os-thread', tid=tid, field=field, value=value)
            except OSError as error:
                journal.emit('os-thread-unavailable', tid=tid, field=field, errno=error.errno)
    return tids[:MAX_THREADS]


def module_map(pid):
    with open(f'/proc/{pid}/maps') as stream:
        raw = stream.read(2097153)
    if len(raw) > 2097152:
        raise RuntimeError('Module map exceeds bound')
    modules = []
    for line in raw.splitlines():
        fields = line.split(maxsplit=5)
        if len(fields) == 6 and fields[5].startswith('/'):
            start, end = fields[0].split('-')
            modules.append({'start': int(start, 16), 'end': int(end, 16),
                            'offset': int(fields[2], 16), 'inode': fields[4],
                            'file': Path(fields[5]).name})
    return modules


def capture(pid, original, journal, unwinder):
    if not same_process(identity(pid), original) or not descendant(pid, os.getpid()):
        raise RuntimeError('Target identity or owned ancestry changed')
    journal.emit('capture-start', target=original, hardLimitSeconds=CAPTURE_SECONDS,
                 perturbation='ptrace stops one selected thread at a time; frames are not simultaneous')
    signal.signal(signal.SIGALRM, signal.SIG_DFL)
    signal.setitimer(signal.ITIMER_REAL, CAPTURE_SECONDS)
    started = time.monotonic_ns()
    count = 0
    try:
        tids = os_state(pid, journal)
        mappings = module_map(pid)
        for tid in tids:
            if (time.monotonic_ns() - started) / 1e9 > 2:
                journal.emit('soft-capture-limit', remainingThreads=len(tids)-tids.index(tid))
                break
            if not same_process(identity(pid), original):
                raise RuntimeError('Main PID changed during capture')
            thread = identity(tid)
            if Path(f'/proc/{tid}/status').read_text().split('Tgid:\t', 1)[1].splitlines()[0] != str(pid):
                raise RuntimeError('Thread no longer belongs to owned process')
            before = time.monotonic_ns()
            attached = unwinder.ptrace(16, tid)
            journal.emit('attach', tid=tid, identity=thread, **attached)
            if attached['result'] != 0:
                continue
            try:
                stop = None
                deadline = time.monotonic() + .25
                while time.monotonic() < deadline:
                    waited = os.waitpid(tid, os.WNOHANG | os.WUNTRACED | 0x40000000)
                    if waited[0]:
                        stop = waited[1]
                        break
                    time.sleep(.005)
                journal.emit('ptrace-stop', tid=tid, status=stop,
                             stopped=stop is not None and os.WIFSTOPPED(stop))
                if stop is not None and os.WIFSTOPPED(stop):
                    if not same_process(thread, identity(tid)):
                        raise RuntimeError('Thread start identity changed after attach')
                    count += unwinder.frames(tid, journal, mappings)
            finally:
                detached = unwinder.ptrace(17, tid)
                journal.emit('detach', tid=tid, durationNs=time.monotonic_ns()-before, **detached)
                if detached['result'] != 0:
                    # Do not leave an attached thread under a live observer.
                    journal.emit('detach-failed-observer-exit', tid=tid)
                    os._exit(74)
        journal.emit('capture-end', durationNs=time.monotonic_ns()-started, frames=count)
        return count
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)


def library_identity():
    result = {}
    for line in Path('/proc/self/maps').read_text().splitlines():
        parts = line.split()
        if len(parts) >= 6 and 'libunwind' in parts[-1]:
            path = Path(parts[-1])
            result[str(path)] = hashlib.sha256(path.read_bytes()).hexdigest()
    return result


def self_test(out):
    journal = Journal(out / 'native-capability.jsonl')
    unwinder = Unwinder()
    journal.emit('capability-start', observer=identity(os.getpid()), libraries=library_identity(),
                 ptraceScope=Path('/proc/sys/kernel/yama/ptrace_scope').read_text().strip())
    child = subprocess.Popen(['/bin/sleep', '8'])
    try:
        time.sleep(.05)
        original = identity(child.pid)
        frames = capture(child.pid, original, journal, unwinder)
        after = identity(child.pid)
        if frames < 2 or not same_process(original, after) or after['state'] in ('T', 't', 'Z'):
            raise RuntimeError('Native frames and resumed owned process are required')
        journal.emit('capability-pass', frames=frames, after=after)
    finally:
        child.terminate()
        child.wait(timeout=2)
        journal.emit('owned-fixture-exit', code=child.returncode)


def rows(path):
    try:
        with path.open() as stream:
            data = stream.read(2097153)
        if len(data) > 2097152:
            raise RuntimeError('Input journal exceeds bound')
        # Last line can be an incomplete concurrent append.
        return [json.loads(line) for line in data.splitlines(keepends=True) if line.endswith('\n')]
    except FileNotFoundError:
        return []


def observe(out, command):
    journal = Journal(out / 'native-observer.jsonl')
    unwinder = Unwinder()
    journal.emit('observer-start', observer=identity(os.getpid()), libraries=library_identity())
    proc = subprocess.Popen(command)
    journal.emit('owned-command-start', process=identity(proc.pid))
    target = None
    attempted = False
    heartbeats = 0
    last_heartbeat = time.monotonic()
    last_health = 0
    readiness = json.loads((out / 'ready.json').read_text())
    while proc.poll() is None:
        now = time.monotonic()
        automation = rows(out / 'automation.jsonl')
        main = rows(out / 'main.jsonl')
        attached = next((r for r in automation if r['event'] == 'child-attached'), None)
        if attached and target is None:
            pid = attached['pid']
            target = identity(pid)
            if not descendant(pid, proc.pid):
                raise RuntimeError('Journal PID is not a descendant of the owned command')
            with open(f'/proc/{pid}/exe', 'rb') as executable:
                digest = hashlib.file_digest(executable, 'sha256').hexdigest()
            if digest != readiness['electronSha256'] or not same_process(target, identity(pid)):
                raise RuntimeError('Owned Electron executable/start identity mismatch')
            journal.emit('observer-armed', target=target, executableSha256=digest)
            (out / 'native-observer-ready.json').write_text(json.dumps({'pid': pid, 'startTicks': target['startTicks']}))
        pulses = sum(r['event'] == 'heartbeat' for r in main)
        if pulses != heartbeats:
            heartbeats = pulses
            last_heartbeat = now
        active = any(r['event'] == 'all-probes-active' for r in automation)
        passed = any(r['event'] == 'load-failure-assertion-passed' for r in automation)
        pending = [r for r in automation if r['event'] == 'evaluate-start'
                   and r['phase'] == 'observer-after-load-failure'
                   and not any(e['event'] in ('evaluate-end', 'evaluate-error') and e.get('id') == r['id'] for e in automation)]
        current = None
        if target:
            try:
                current = identity(target['pid'])
            except OSError as error:
                current = {'unavailableErrno': error.errno}
        if now - last_health >= .5:
            journal.emit('observer-health', target=current, heartbeats=heartbeats,
                         heartbeatAgeMs=round((now-last_heartbeat)*1000), active=active,
                         loadAssertionPassed=passed, pendingObserverCalls=[r['id'] for r in pending])
            last_health = now
        if not attempted and target and active and passed and pending and heartbeats >= 2 and now-last_heartbeat >= 1:
            attempted = True
            journal.emit('one-shot-trigger', pendingIds=[r['id'] for r in pending],
                         heartbeatAgeMs=round((now-last_heartbeat)*1000), current=current)
            try:
                capture(target['pid'], target, journal, unwinder)
            except (OSError, RuntimeError) as error:
                journal.emit('capture-unavailable', errorType=type(error).__name__,
                             errno=getattr(error, 'errno', None), detail=str(error)[:256])
        time.sleep(.1)
    journal.emit('owned-command-exit', code=proc.returncode, captureAttempted=attempted,
                 droppedRecords=journal.dropped)
    return proc.returncode


if __name__ == '__main__':
    out = Path(os.environ['DEV_CONSOLE_DIAGNOSTIC_DIR'])
    out.mkdir(parents=True, exist_ok=True)
    if sys.argv[1:] == ['--self-test']:
        self_test(out)
    elif len(sys.argv) > 2 and sys.argv[1] == '--':
        sys.exit(observe(out, sys.argv[2:]))
    else:
        raise SystemExit('Expected --self-test or -- COMMAND')
