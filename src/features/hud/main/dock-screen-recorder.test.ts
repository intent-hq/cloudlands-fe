import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/fake/project/dist/main' },
}));

import {
  cgWindowIdFromMediaSourceId,
  createDockScreenRecorder,
  type DockScreenRecorderDeps,
} from './dock-screen-recorder';
import {
  DOCK_RECORDING_AUDIO_BITRATE,
  DOCK_RECORDING_MAX_BYTES,
  DOCK_RECORDING_MAX_MS,
  DOCK_RECORDING_SIZE_STOP_RATIO,
  DOCK_RECORDING_VIDEO_BITRATE,
} from '../../../shared/dock-recording';

class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  commands: Record<string, unknown>[] = [];
  killed: string[] = [];
  constructor() {
    super();
    this.stdin.setEncoding('utf8');
    this.stdin.on('data', (chunk: string) => {
      for (const line of chunk.split('\n').filter(Boolean))
        this.commands.push(JSON.parse(line) as Record<string, unknown>);
    });
  }
  emitLine(event: Record<string, unknown> | string) {
    this.stdout.write(`${typeof event === 'string' ? event : JSON.stringify(event)}\n`);
  }
  close(code: number | null, signal: string | null = null) {
    this.stdout.end();
    this.emit('close', code, signal);
  }
  kill(signal: string) {
    this.killed.push(signal);
    return true;
  }
}

function harness(overrides: Partial<DockScreenRecorderDeps> = {}) {
  const children: FakeChild[] = [];
  const spawnArgs: string[][] = [];
  const timers = new Map<number, { fn: () => void; ms: number }>();
  const removed: string[] = [];
  let nextTimer = 1;
  let now = 1_000;
  const deps: Partial<DockScreenRecorderDeps> = {
    platform: 'darwin',
    resolveHelper: async () => '/helper/intent-dock-recorder',
    spawn: (_file, args) => {
      const child = new FakeChild();
      children.push(child);
      spawnArgs.push(args);
      return child as never;
    },
    execFile: async () => ({ stdout: '' }),
    fileSize: async () => 4096,
    removeFile: async (file) => {
      removed.push(file);
    },
    ensureDir: async () => undefined,
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = nextTimer++;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout: (id) => timers.delete(id as number),
    ...overrides,
  };
  const recorder = createDockScreenRecorder(deps);
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const fireTimer = (ms: number) => {
    // Latest first: several timers can share a duration (start vs finish timeout).
    for (const [id, timer] of [...timers].reverse())
      if (timer.ms === ms) {
        timers.delete(id);
        timer.fn();
        return true;
      }
    return false;
  };
  return {
    recorder,
    children,
    spawnArgs,
    removed,
    flush,
    fireTimer,
    advance: (ms: number) => (now += ms),
  };
}

const request = {
  clipId: 'clip_1',
  displayId: 69733378,
  excludeWindowIds: [42, 42, 77, -1],
  includeMic: false,
  outputDir: '/tmp/clips',
};

async function started(h: ReturnType<typeof harness>) {
  const start = h.recorder.start(request);
  await h.flush();
  h.children[0].emitLine({ event: 'started', captureApi: 'sck-stream+avcapture-mic/1' });
  return start;
}

describe('dock screen recorder', () => {
  it('reports unsupported platforms and missing helpers without spawning', async () => {
    const linux = harness({ platform: 'linux' });
    expect(await linux.recorder.capability()).toEqual({ supported: false, reason: 'platform' });
    expect(await linux.recorder.start(request)).toMatchObject({ ok: false, error: 'unavailable' });

    const missing = harness({ resolveHelper: async () => null });
    expect(await missing.recorder.capability()).toEqual({
      supported: false,
      reason: 'helper-missing',
    });
    expect(await missing.recorder.start(request)).toEqual({
      ok: false,
      error: 'unavailable',
      detail: 'helper-missing',
    });
    expect(missing.children).toHaveLength(0);
  });

  it('parses the helper capability probe, including old macOS', async () => {
    const h = harness({
      execFile: async () => ({
        stdout:
          '{"supported":true,"micSupported":true,"stillSupported":true,"captureApi":"sck-stream+avcapture-mic/1","osVersion":"26.6.2","screenPermission":false,"micPermission":"authorized"}\n',
      }),
    });
    expect(await h.recorder.capability()).toEqual({
      supported: true,
      micSupported: true,
      stillSupported: true,
      captureApi: 'sck-stream+avcapture-mic/1',
      osVersion: '26.6.2',
      screenPermission: false,
      micPermission: 'authorized',
    });
    const old = harness({
      execFile: async () => ({ stdout: '{"supported":false,"osVersion":"12.1.0"}' }),
    });
    expect(await old.recorder.capability()).toMatchObject({
      supported: false,
      reason: 'os-version',
    });
  });

  it('spawns the helper with display, limits and deduplicated exclusions; resolves on first frame', async () => {
    const h = harness();
    const result = await started(h);
    expect(result).toEqual({ ok: true, value: { startedAt: 1_000 } });
    expect(h.spawnArgs[0]).toEqual([
      'record',
      '--output',
      '/tmp/clips/clip_1.mp4',
      '--display',
      '69733378',
      '--max-ms',
      '120000',
      // The app's 128 MiB playback cap; the helper stops at 90 % of it.
      '--max-bytes',
      String(128 * 1024 * 1024),
      '--size-stop-percent',
      '90',
      '--video-bitrate',
      '7000000',
      '--audio-bitrate',
      '96000',
      '--fps',
      '30',
      '--max-edge',
      '4096',
      '--mic-capable',
      '--exclude-window',
      '42',
      '--exclude-window',
      '77',
    ]);
    h.advance(2_500);
    expect(h.recorder.elapsedMs('clip_1')).toBe(2_500);
    expect(h.recorder.elapsedMs('other')).toBeNull();
  });

  it('is idempotent per clip and refuses a second clip while live', async () => {
    const h = harness();
    const first = h.recorder.start(request);
    const again = h.recorder.start(request);
    await h.flush();
    expect(h.children).toHaveLength(1);
    h.children[0].emitLine({ event: 'started' });
    expect(await first).toEqual(await again);
    expect(await h.recorder.start({ ...request, clipId: 'clip_2' })).toEqual({
      ok: false,
      error: 'failed',
      detail: 'busy',
    });
    expect(await h.recorder.start({ ...request, clipId: '../x' })).toMatchObject({ ok: false });
  });

  it('maps a permission error before the first frame and removes the file', async () => {
    const h = harness();
    const start = h.recorder.start(request);
    await h.flush();
    h.children[0].emitLine({ event: 'error', code: 'permission', detail: 'screen-recording' });
    expect(await start).toEqual({ ok: false, error: 'permission', detail: 'screen-recording' });
    await h.flush();
    expect(h.removed).toContain('/tmp/clips/clip_1.mp4');
    // A new clip can start after the failure.
    void h.recorder.start({ ...request, clipId: 'clip_2' });
    await h.flush();
    expect(h.children).toHaveLength(2);
  });

  it('stops with real bytes, duration and mic metadata; stop is idempotent', async () => {
    const h = harness({ fileSize: async () => 734_003 });
    await started(h);
    const ends: unknown[] = [];
    h.recorder.onEnded((clipId, result) => ends.push([clipId, result.ok]));
    const stop = h.recorder.stop('clip_1');
    const stopAgain = h.recorder.stop('clip_1');
    await h.flush();
    expect(h.children[0].commands).toEqual([{ cmd: 'stop' }]);
    h.children[0].emitLine({
      event: 'finished',
      reason: 'stopped',
      durationMs: 14_200,
      hasMicAudio: true,
      bytes: 1,
      captureApi: 'sck-stream+avcapture-mic/1',
    });
    h.children[0].close(0);
    const result = await stop;
    expect(result).toEqual({
      ok: true,
      value: {
        clipId: 'clip_1',
        sourcePath: '/tmp/clips/clip_1.mp4',
        mimeType: 'video/mp4',
        size: 734_003,
        durationMs: 14_200,
        hasMicAudio: true,
        startedAt: 1_000,
        endedReason: 'stopped',
        captureApi: 'sck-stream+avcapture-mic/1',
      },
    });
    expect(await stopAgain).toEqual(result);
    expect(await h.recorder.stop('clip_1')).toEqual(result);
    expect(ends).toEqual([['clip_1', true]]);
    expect(h.removed).toEqual([]);
  });

  it('reports the helper auto-stop at the limit, and a late stop returns it', async () => {
    const h = harness();
    await started(h);
    const ended = new Promise((resolve) => h.recorder.onEnded((_id, result) => resolve(result)));
    h.children[0].emitLine({ event: 'finished', reason: 'limit', durationMs: 120_004 });
    h.children[0].close(0);
    const result = await ended;
    expect(result).toMatchObject({
      ok: true,
      value: { endedReason: 'limit', durationMs: 120_000 },
    });
    expect(await h.recorder.stop('clip_1')).toEqual(result);
  });

  it('asks the helper to stop if it overruns the limit, and kills a hung helper', async () => {
    const h = harness();
    await started(h);
    expect(h.fireTimer(123_000)).toBe(true);
    await h.flush();
    expect(h.children[0].commands).toEqual([{ cmd: 'stop' }]);
    expect(h.fireTimer(15_000)).toBe(true);
    expect(h.children[0].killed).toEqual(['SIGKILL']);
    expect(await h.recorder.stop('clip_1')).toEqual({
      ok: false,
      error: 'failed',
      detail: 'finish-timeout',
    });
    await h.flush();
    expect(h.removed).toContain('/tmp/clips/clip_1.mp4');
  });

  it('fails a helper that never produces a first frame', async () => {
    const h = harness();
    const start = h.recorder.start(request);
    await h.flush();
    expect(h.fireTimer(15_000)).toBe(true);
    expect(await start).toEqual({ ok: false, error: 'failed', detail: 'start-timeout' });
    expect(h.children[0].killed).toEqual(['SIGKILL']);
  });

  it('reports a crash mid-recording once and cleans up', async () => {
    const h = harness();
    await started(h);
    const ends: unknown[] = [];
    h.recorder.onEnded((_id, result) => ends.push(result));
    h.children[0].stdout.write('not json\n{"event":');
    h.children[0].close(null, 'SIGSEGV');
    await h.flush();
    expect(ends).toEqual([{ ok: false, error: 'failed', detail: 'helper-exit:SIGSEGV' }]);
    expect(h.removed).toContain('/tmp/clips/clip_1.mp4');
    expect(h.recorder.elapsedMs('clip_1')).toBeNull();
  });

  it('rejects a finished clip whose file is missing or empty', async () => {
    const h = harness({ fileSize: async () => 0 });
    await started(h);
    const stop = h.recorder.stop('clip_1');
    await h.flush();
    h.children[0].emitLine({ event: 'finished', reason: 'stopped', durationMs: 900 });
    h.children[0].close(0);
    expect(await stop).toEqual({ ok: false, error: 'failed', detail: 'empty-clip' });
  });

  it('cancel discards a live clip, a stop-before-start, and an unplaced finished clip', async () => {
    const live = harness();
    await started(live);
    const cancel = live.recorder.cancel('clip_1');
    await live.flush();
    expect(live.children[0].commands).toEqual([{ cmd: 'cancel' }]);
    live.children[0].emitLine({ event: 'cancelled' });
    live.children[0].close(0);
    await cancel;
    expect(live.removed).toContain('/tmp/clips/clip_1.mp4');
    await live.recorder.cancel('clip_1');

    const early = harness();
    const start = early.recorder.start(request);
    await early.flush();
    const stop = early.recorder.stop('clip_1');
    await early.flush();
    expect(early.children[0].commands).toEqual([{ cmd: 'cancel' }]);
    early.children[0].emitLine({ event: 'cancelled' });
    early.children[0].close(0);
    expect(await start).toMatchObject({ ok: false });
    expect(await stop).toMatchObject({ ok: false, detail: 'cancelled' });

    const done = harness();
    await started(done);
    const finished = done.recorder.stop('clip_1');
    await done.flush();
    done.children[0].emitLine({ event: 'finished', reason: 'stopped', durationMs: 5_000 });
    done.children[0].close(0);
    expect(await finished).toMatchObject({ ok: true });
    await done.recorder.cancel('clip_1');
    expect(done.removed).toEqual(['/tmp/clips/clip_1.mp4']);
  });

  it('a stop or cancel before the helper is reserved leaves no helper, file or clip', async () => {
    let releaseHelper!: (value: string) => void;
    const h = harness({
      resolveHelper: () => new Promise<string>((resolve) => (releaseHelper = resolve)),
    });
    const ends: unknown[] = [];
    h.recorder.onEnded((clipId) => ends.push(clipId));
    const start = h.recorder.start(request);
    // A repeated start while reserving joins the same reservation; another clip is busy.
    expect(h.recorder.start(request)).toBe(start);
    expect(await h.recorder.start({ ...request, clipId: 'clip_2' })).toMatchObject({
      detail: 'busy',
    });
    const stop = h.recorder.stop('clip_1');
    releaseHelper('/helper/intent-dock-recorder');
    expect(await start).toEqual({ ok: false, error: 'failed', detail: 'cancelled' });
    expect(await stop).toEqual({ ok: false, error: 'failed', detail: 'cancelled' });
    expect(h.children).toHaveLength(0);
    expect(h.recorder.elapsedMs('clip_1')).toBeNull();
    // Idle again: a new clip starts normally.
    const next = h.recorder.start({ ...request, clipId: 'clip_3' });
    releaseHelper('/helper/intent-dock-recorder');
    await h.flush();
    expect(h.children).toHaveLength(1);
    h.children[0].emitLine({ event: 'started' });
    expect(await next).toMatchObject({ ok: true });

    // Cancel (dock retired) that arrives before start was even called refuses that start.
    const early = harness();
    await early.recorder.cancel('clip_1');
    expect(await early.recorder.start(request)).toMatchObject({ detail: 'cancelled' });
    expect(early.children).toHaveLength(0);
    expect(ends).toEqual([]);
  });

  it('never offers a clip larger than the playback cap', async () => {
    const h = harness({ fileSize: async () => 128 * 1024 * 1024 + 1 });
    await started(h);
    const stop = h.recorder.stop('clip_1');
    await h.flush();
    h.children[0].emitLine({ event: 'finished', reason: 'stopped', durationMs: 119_000 });
    h.children[0].close(0);
    expect(await stop).toEqual({ ok: false, error: 'limit', detail: 'too-large' });
    expect(h.removed).toEqual(['/tmp/clips/clip_1.mp4']);
  });

  it('a full-length clip at the encoder ceilings stays under the size stop', () => {
    const fullClipBytes =
      ((DOCK_RECORDING_VIDEO_BITRATE + DOCK_RECORDING_AUDIO_BITRATE) / 8) *
      (DOCK_RECORDING_MAX_MS / 1000);
    expect(fullClipBytes).toBeLessThan(DOCK_RECORDING_SIZE_STOP_RATIO * DOCK_RECORDING_MAX_BYTES);
  });

  it('cancel during finalization discards the clip instead of returning it', async () => {
    const h = harness();
    await started(h);
    const stop = h.recorder.stop('clip_1');
    const cancel = h.recorder.cancel('clip_1');
    await h.flush();
    h.children[0].emitLine({ event: 'finished', reason: 'stopped', durationMs: 3_000 });
    h.children[0].close(0);
    expect(await stop).toMatchObject({ ok: false, detail: 'cancelled' });
    await cancel;
    expect(h.removed).toContain('/tmp/clips/clip_1.mp4');
  });

  it('toggles the microphone only on request and reports the helper verdict', async () => {
    const h = harness();
    await started(h);
    const on = h.recorder.setMicrophone('clip_1', true);
    await h.flush();
    expect(h.children[0].commands).toEqual([{ cmd: 'mic', on: true }]);
    h.children[0].emitLine({ event: 'mic', active: false, reason: 'permission' });
    expect(await on).toEqual({ ok: true, value: { micActive: false } });

    const again = h.recorder.setMicrophone('clip_1', true);
    await h.flush();
    h.children[0].emitLine({ event: 'mic', active: true });
    expect(await again).toEqual({ ok: true, value: { micActive: true } });

    const off = h.recorder.setMicrophone('clip_1', false);
    await h.flush();
    h.children[0].emitLine({ event: 'mic', active: false });
    expect(await off).toEqual({ ok: true, value: { micActive: false } });
    expect(await h.recorder.setMicrophone('other', true)).toMatchObject({ ok: false });
  });

  it('passes includeMic at start, and forwards authoritative marks and exclusion updates', async () => {
    const h = harness();
    const start = h.recorder.start({ ...request, includeMic: true });
    await h.flush();
    expect(h.spawnArgs[0]).toContain('--mic');
    const marks = [
      {
        n: 1,
        tool: 'box' as const,
        geometry: { kind: 'rect' as const, x: 10, y: 20, w: 30, h: 40 },
        imageWidth: 2880,
        imageHeight: 1800,
      },
    ];
    expect(h.recorder.setMarks('clip_1', marks)).toBe(true);
    h.children[0].emitLine({ event: 'started' });
    await start;
    const exclude = h.recorder.setExcludedWindows('clip_1', [42, 99, 99]);
    await h.flush();
    h.children[0].emitLine({ event: 'exclude', ok: true, missing: [] });
    expect(await exclude).toEqual({ ok: true, value: undefined });
    expect(h.children[0].commands).toEqual([
      { cmd: 'marks', marks },
      { cmd: 'exclude', windowIds: [42, 99] },
    ]);
    expect(h.recorder.setMarks('other', marks)).toBe(false);

    const missing = h.recorder.setExcludedWindows('clip_1', [42, 1234]);
    await h.flush();
    h.children[0].emitLine({
      event: 'exclude',
      ok: false,
      missing: [1234],
      detail: 'exclusion-missing',
    });
    expect(await missing).toEqual({ ok: false, error: 'failed', detail: 'exclusion-missing' });
  });

  it('fails a recording whose requested exclusion is missing, without a file', async () => {
    const h = harness();
    const start = h.recorder.start(request);
    await h.flush();
    h.children[0].emitLine({ event: 'error', code: 'failed', detail: 'exclusion-missing' });
    h.children[0].close(1);
    expect(await start).toEqual({ ok: false, error: 'failed', detail: 'exclusion-missing' });
    await h.flush();
    expect(h.removed).toContain('/tmp/clips/clip_1.mp4');
  });

  it('dispose cancels the live clip', async () => {
    const h = harness();
    await started(h);
    const dispose = h.recorder.dispose();
    await h.flush();
    h.children[0].emitLine({ event: 'cancelled' });
    h.children[0].close(0);
    await dispose;
    expect(h.children[0].commands).toEqual([{ cmd: 'cancel' }]);
    expect(h.recorder.elapsedMs('clip_1')).toBeNull();
  });

  it('captures a still with exclusions and keeps unsupported distinct from real failures', async () => {
    const calls: { args: string[]; options?: { timeoutMs?: number; maxBuffer?: number } }[] = [];
    let reply = '';
    const h = harness({
      execFile: async (_file, args, options) => {
        calls.push({ args, options });
        return { stdout: reply };
      },
    });
    const hash = 'ab'.repeat(32);
    reply = JSON.stringify({
      ok: true,
      base64: 'iVBORw0KGgo=',
      width: 2880,
      height: 1800,
      displayScale: 2,
      capturedAt: '2026-10-29T18:12:04Z',
      hash,
    });
    expect(await h.recorder.captureStill({ displayId: 1, excludeWindowIds: [9, 9, 0] })).toEqual({
      ok: true,
      value: {
        base64: 'iVBORw0KGgo=',
        mimeType: 'image/png',
        width: 2880,
        height: 1800,
        displayScale: 2,
        capturedAt: '2026-10-29T18:12:04Z',
        hash,
      },
    });
    expect(calls[0].args).toEqual([
      'still',
      '--display',
      '1',
      '--max-edge',
      '4096',
      '--exclude-window',
      '9',
    ]);
    expect(calls[0].options?.maxBuffer).toBeGreaterThan(64 * 1024 * 1024);

    reply = '{"ok":false,"code":"unsupported","detail":"os-version"}';
    expect(await h.recorder.captureStill({ displayId: 1, excludeWindowIds: [] })).toEqual({
      ok: false,
      error: 'unavailable',
      detail: 'os-version',
    });
    reply = '{"ok":false,"code":"permission","detail":"screen-recording"}';
    expect(await h.recorder.captureStill({ displayId: 1, excludeWindowIds: [] })).toEqual({
      ok: false,
      error: 'permission',
      detail: 'screen-recording',
    });
    reply = '{"ok":false,"code":"failed","detail":"exclusion-missing"}';
    expect(await h.recorder.captureStill({ displayId: 1, excludeWindowIds: [9] })).toEqual({
      ok: false,
      error: 'failed',
      detail: 'exclusion-missing',
    });
    reply = '{"ok":true,"base64":"","width":0}';
    expect(await h.recorder.captureStill({ displayId: 1, excludeWindowIds: [] })).toEqual({
      ok: false,
      error: 'failed',
      detail: 'malformed',
    });
    const broken = harness({
      execFile: async () => {
        throw new Error('killed');
      },
    });
    expect(await broken.recorder.captureStill({ displayId: 1, excludeWindowIds: [] })).toEqual({
      ok: false,
      error: 'failed',
      detail: 'helper',
    });
  });

  it('parses Electron media source ids into CGWindowIDs', () => {
    expect(cgWindowIdFromMediaSourceId('window:12345:0')).toBe(12345);
    expect(cgWindowIdFromMediaSourceId('screen:1:0')).toBeNull();
    expect(cgWindowIdFromMediaSourceId('window:0:0')).toBeNull();
    expect(cgWindowIdFromMediaSourceId('window:99999999999:0')).toBeNull();
  });
});
