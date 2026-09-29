// Prospective passive diagnostics. No request interception, body reads or added waits.
import * as fs from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';

export function closeObserved(io) {
  const status = { syncExit: 0, closeExit: 0, errors: [] };
  try { io.sync(); } catch (error) { status.syncExit = 1; status.errors.push(String(error).slice(0, 256)); }
  // Always attempt close, including when fsync fails. Neither result is inferred.
  try { io.close(); } catch (error) { status.closeExit = 1; status.errors.push(String(error).slice(0, 256)); }
  return status;
}

export function createRecorder(io, identity) {
  let count = 0, bytes = 0, stopped = false, closed = false, previousTime = -Infinity;
  const errors = [];
  function event(kind, fields = {}) {
    if (stopped || closed) return;
    try {
      const timeMs = io.now();
      if (!Number.isFinite(timeMs) || timeMs < previousTime) throw new Error('observer-clock');
      previousTime = timeMs;
      const row = { ...identity, seq: count, kind, timeMs, ...fields };
      const raw = JSON.stringify(row) + '\n';
      const length = io.bytes(raw);
      if (count >= 12000 || length > 8192 || bytes + length > 4 * 1024 * 1024 - 8192) {
        stopped = true;
        errors.push('event-or-byte-cap');
        return;
      }
      io.write(raw);
      count++; bytes += length;
    } catch (error) {
      stopped = true;
      errors.push(String(error).slice(0, 256));
    }
  }
  function finish() {
    if (closed) return;
    closed = true;
    let footerWritten = false, finalization = { syncExit: null, closeExit: null, errors: [] };
    try {
      const timeMs = io.now();
      if (!Number.isFinite(timeMs) || timeMs < previousTime) throw new Error('observer-final-clock');
      io.write(JSON.stringify({ ...identity, kind: 'observer-terminal', timeMs,
        count, bytes, captureComplete: !stopped && errors.length === 0, errors }) + '\n');
      footerWritten = true;
    } catch (error) { errors.push(String(error).slice(0, 256)); }
    finally {
      try { finalization = io.close(); }
      catch (error) { finalization.errors.push(String(error).slice(0, 256)); }
    }
    // The in-file footer is provisional. Only the independent captured acknowledgement
    // after both actual operations may establish finalization; absence remains incomplete.
    try { io.confirm({ ...identity, kind: 'observer-finalization', footerWritten,
      captureComplete: !stopped && errors.length === 0, captureErrors: errors, ...finalization }); }
    catch (_) { /* Missing acknowledgement is STOP; original test outcome is preserved. */ }
  }
  return { event, finish };
}

export function safeURL(raw, origin) {
  try {
    const url = new URL(raw, origin);
    if (url.origin !== origin || url.hostname !== '127.0.0.1') return null;
    // Retain module cache/version query only; no arbitrary query or request body.
    const query = ['v', 't'].map(k => [k, url.searchParams.get(k)])
      .filter(([, v]) => v !== null && /^[a-zA-Z0-9._-]{1,64}$/.test(v));
    return { path: url.pathname.slice(0, 1024), query };
  } catch (_) { return null; }
}

export function attachPage(page, origin, recorder, caseIdentity) {
  const requests = new WeakMap(), frames = new WeakMap();
  let nextRequest = 0, nextFrame = 0, documentGeneration = 0;
  const frameId = frame => {
    if (!frames.has(frame)) frames.set(frame, ++nextFrame);
    return frames.get(frame);
  };
  const emit = (kind, data) => recorder.event(kind, { ...caseIdentity, ...data });
  const guarded = fn => (...args) => {
    try { fn(...args); } catch (error) { emit('observer-error', { error: String(error).slice(0, 512) }); }
  };
  const request = guarded(req => {
    const url = safeURL(req.url(), origin);
    if (!url) return;
    const kind = req.resourceType();
    if (!['script', 'document'].includes(kind)) return;
    const id = ++nextRequest;
    requests.set(req, id);
    emit('request', { id, url, resourceType: kind, frame: frameId(req.frame()), documentGeneration });
  });
  const response = guarded(res => {
    const req = res.request(), id = requests.get(req);
    if (id) emit('response', { id, status: res.status() });
  });
  const failed = guarded(req => {
    const id = requests.get(req);
    if (id) emit('requestfailed', { id, reason: String(req.failure()?.errorText ?? 'unknown').slice(0, 512) });
  });
  const navigation = guarded(frame => {
    const url = safeURL(frame.url(), origin);
    if (url) {
      if (frame === page.mainFrame()) documentGeneration++;
      emit('navigation', { frame: frameId(frame), documentGeneration, url,
        qualification: 'Observed frame navigation counter, not a browser document token' });
    }
  });
  const pageError = guarded(error => emit('page-error', { error: String(error).slice(0, 512) }));
  const crash = guarded(() => emit('page-crash', {}));
  const listeners = [['request', request], ['response', response], ['requestfailed', failed],
    ['framenavigated', navigation], ['pageerror', pageError], ['crash', crash]];
  for (const [name, fn] of listeners) page.on(name, fn);
  emit('page-attached-before-navigation', {});
  return () => { for (const [name, fn] of listeners) page.off(name, fn); };
}

export function stripObservation() {
  const root = process.env.STRIP_OBSERVATION_ROOT;
  const no = { event() {}, create() {}, listen() {}, close() {}, finish() {}, page() { return () => {}; } };
  if (!root) return no;
  let recorder;
  try {
    const st = fs.lstatSync(root);
    if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== process.getuid() || (st.mode & 0o777) !== 0o700)
      throw new Error('observation-root-identity');
    const worker = Number(process.env.TEST_WORKER_INDEX), parallel = Number(process.env.TEST_PARALLEL_INDEX);
    if (![worker, parallel].every(Number.isSafeInteger) || worker < 0 || worker > 1 || parallel < 0 || parallel > 1)
      throw new Error('worker-identity');
    // Self only: kernel start ticks identify PID reuse; never enumerate /proc.
    const self = fs.readFileSync('/proc/self/stat', 'utf8');
    if (self.length > 4096) throw new Error('self-stat-cap');
    const startTicks = self.slice(self.lastIndexOf(')') + 2).split(' ')[19];
    if (!/^\d+$/.test(startTicks)) throw new Error('self-start-identity');
    const identity = { worker, parallel, pid: process.pid, startTicks,
      processTimeOrigin: performance.timeOrigin, server: `${process.pid}:${startTicks}:1` };
    const path = resolve(root, `worker-${worker}-${process.pid}.jsonl`);
    const fd = fs.openSync(path, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
    const file = fs.fstatSync(fd), hash = createHash('sha256');
    let retainedBytes = 0;
    recorder = createRecorder({ now: () => performance.timeOrigin + performance.now(),
      bytes: Buffer.byteLength, write: raw => {
        fs.writeFileSync(fd, raw); hash.update(raw); retainedBytes += Buffer.byteLength(raw);
      },
      close: () => closeObserved({ sync: () => fs.fsyncSync(fd), close: () => fs.closeSync(fd) }),
      confirm: status => process.stdout.write('\nSTRIP_OBSERVER_FINAL ' + JSON.stringify({ ...status,
        file: { name: `worker-${worker}-${process.pid}.jsonl`, dev: file.dev, ino: file.ino,
          uid: file.uid, gid: file.gid, mode: file.mode & 0o777, nlink: file.nlink,
          bytes: retainedBytes, sha256: hash.digest('hex') } }) + '\n'),
    }, identity);
    recorder.event('worker-start');
    process.once('exit', () => recorder.finish());
    const cache = () => {
      const named = resolve(process.cwd(), 'node_modules/.vite-harness/workspace-tab-strip-status-geometry');
      try {
        const s = fs.lstatSync(named);
        return { named, realpath: fs.realpathSync(named), dev: s.dev, ino: s.ino,
          symlink: s.isSymbolicLink(), absent: false };
      } catch (error) {
        if (error.code === 'ENOENT') return { named, absent: true };
        return { named, error: String(error).slice(0, 256) };
      }
    };
    return {
      event: recorder.event,
      create: () => recorder.event('server-create-start', { cache: cache() }),
      listen: server => recorder.event('server-listen', { cache: cache(), origin: server.resolvedUrls?.local[0],
        optimizer: 'No public per-optimizer PID/start observation; correlate bounded original stdout only' }),
      close: () => recorder.event('server-close-complete', { cache: cache() }),
      finish: recorder.finish,
      page: (page, origin, info) => {
        try {
          return attachPage(page, new URL(origin).origin, recorder,
            { title: info.title, workerIndex: info.workerIndex, parallelIndex: info.parallelIndex, retry: info.retry });
        } catch (error) {
          recorder.event('observer-error', { error: String(error).slice(0, 512) });
          return () => {};
        }
      },
    };
  } catch (_) {
    // Do not mask the original test outcome. Missing worker receipt means observation STOP.
    if (recorder) recorder.event('observer-error', { error: 'adapter-initialization' });
    return no;
  }
}
