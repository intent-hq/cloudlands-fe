/**
 * Main-process owner of the dock clip recorder helper (`intent-dock-recorder`).
 *
 * One clip at a time. The helper records the dock's display with ScreenCaptureKit,
 * excluding the dock and its controls, burns numbered marks into the frames, and
 * opens the microphone only between `setMicrophone(clipId, true/false)`.
 *
 * Every operation is guarded by clipId and idempotent: repeated `start`/`stop`
 * return the same promise, `cancel` always deletes the partial or unplaced file,
 * and a crashed or hung helper is killed and reported as `failed`. The helper
 * cancels itself (and deletes its file) if this process goes away.
 *
 * A start is reserved synchronously. A `stop`/`cancel` that arrives before the helper
 * spawned (or before `start` was even called for that clipId) aborts it: no helper
 * runs and every result is `{ok:false, detail:'cancelled'}`, the caller's signal to
 * drop the clip rather than show a failed one. Before the first frame, the same
 * detail comes from the helper's own cancellation.
 */
import { execFile as nodeExecFile, spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { access, mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { app } from 'electron';
import type {
  DockCapturedPixels,
  DockEvidenceErrorCode,
  DockNativeResult,
} from '../../../shared/dock-evidence';
import {
  DOCK_RECORDING_AUDIO_BITRATE,
  DOCK_RECORDING_CAPTURE_API,
  DOCK_RECORDING_MAX_BYTES,
  DOCK_RECORDING_MAX_EDGE,
  DOCK_RECORDING_MAX_FPS,
  DOCK_RECORDING_MAX_MS,
  DOCK_RECORDING_SIZE_STOP_RATIO,
  DOCK_RECORDING_VIDEO_BITRATE,
  type DockRecordedClip,
  type DockRecordingCapability,
  type DockRecordingEndReason,
  type DockRecordingMark,
  type DockRecordingStartRequest,
  type DockStillRequest,
} from '../../../shared/dock-recording';
import { Logger } from '../../../shared/logger';

const logger = new Logger('DockScreenRecorder');

const HELPER_NAME = 'intent-dock-recorder';
const CLIP_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** Helper must write its first frame within this window (it has its own 10 s watchdog). */
const START_TIMEOUT_MS = 15_000;
/** After `stop`/`cancel`, the helper must finalize within this window or be killed. */
const FINISH_TIMEOUT_MS = 15_000;
/** Backstop beyond the helper's own limit timer. */
const LIMIT_GRACE_MS = 3_000;
const REPLY_TIMEOUT_MS = 5_000;
const MAX_LINE = 64 * 1024;
/** One PNG of a ≤4096-px display, base64 in a single JSON line. */
const MAX_STILL_OUTPUT = 96 * 1024 * 1024;
const STILL_TIMEOUT_MS = 10_000;

type Child = Pick<ChildProcessWithoutNullStreams, 'stdin' | 'stdout' | 'stderr' | 'kill' | 'on'>;

export interface DockScreenRecorderDeps {
  platform: NodeJS.Platform;
  resolveHelper: () => Promise<string | null>;
  spawn: (file: string, args: string[]) => Child;
  execFile: (
    file: string,
    args: string[],
    options?: { timeoutMs?: number; maxBuffer?: number },
  ) => Promise<{ stdout: string }>;
  fileSize: (file: string) => Promise<number>;
  removeFile: (file: string) => Promise<void>;
  ensureDir: (dir: string) => Promise<void>;
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface DockScreenRecorder {
  capability(): Promise<DockRecordingCapability>;
  /**
   * Screenshot with the dock and controls excluded, so the composer stays visible.
   * `{ok:false, error:'unavailable', detail:'os-version'}` (macOS < 14) is the only
   * result a caller may answer with its hide-and-capture fallback; `permission` and
   * `failed` (including `detail:'exclusion-missing'` when any requested window is not
   * shareable — no image is produced) are real outcomes and must surface.
   */
  captureStill(request: DockStillRequest): Promise<DockNativeResult<DockCapturedPixels>>;
  start(request: DockRecordingStartRequest): Promise<DockNativeResult<{ startedAt: number }>>;
  setMicrophone(clipId: string, on: boolean): Promise<DockNativeResult<{ micActive: boolean }>>;
  setMarks(clipId: string, marks: readonly DockRecordingMark[]): boolean;
  /** Strict: `{ok:false, detail:'exclusion-missing'}` when any requested window is gone. */
  setExcludedWindows(clipId: string, windowIds: readonly number[]): Promise<DockNativeResult<void>>;
  elapsedMs(clipId: string): number | null;
  stop(clipId: string): Promise<DockNativeResult<DockRecordedClip>>;
  cancel(clipId: string): Promise<void>;
  onEnded(
    listener: (clipId: string, result: DockNativeResult<DockRecordedClip>) => void,
  ): () => void;
  dispose(): Promise<void>;
}

type HelperEvent = Record<string, unknown> & { event?: unknown };

interface ActiveClip {
  clipId: string;
  outputPath: string;
  maxMs: number;
  child: Child;
  startedAt: number | null;
  phase: 'starting' | 'recording' | 'finishing' | 'ended';
  started: Promise<DockNativeResult<{ startedAt: number }>>;
  resolveStarted: (result: DockNativeResult<{ startedAt: number }>) => void;
  ended: Promise<DockNativeResult<DockRecordedClip>>;
  resolveEnded: (result: DockNativeResult<DockRecordedClip>) => void;
  /** Set once `cancel` was requested: the ended result is never a clip. */
  cancelled: boolean;
  micReplies: ((active: boolean) => void)[];
  excludeReplies: ((reply: { ok: boolean; detail?: string }) => void)[];
  timers: Set<unknown>;
}

const fail = <T>(error: DockEvidenceErrorCode, detail?: string): DockNativeResult<T> => ({
  ok: false,
  error,
  ...(detail ? { detail } : {}),
});

/** `BrowserWindow.getMediaSourceId()` → CGWindowID (`window:<id>:<n>`). */
export function cgWindowIdFromMediaSourceId(mediaSourceId: string): number | null {
  const match = /^window:(\d+):\d+$/.exec(mediaSourceId);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 && id <= 0xffffffff ? id : null;
}

function helperCandidates(): string[] {
  if (app.isPackaged) return [path.join(process.resourcesPath, 'dock-helper', HELPER_NAME)];
  // Same launch layouts as dock-display-geometry.ts (dist/main appPath, or the root).
  return [
    path.resolve(app.getAppPath(), '..', '..', 'resources', 'dock-helper', HELPER_NAME),
    path.join(app.getAppPath(), 'resources', 'dock-helper', HELPER_NAME),
  ];
}

const execute = promisify(nodeExecFile);

const defaultDockScreenRecorderDeps: DockScreenRecorderDeps = {
  platform: process.platform,
  async resolveHelper() {
    for (const candidate of helperCandidates()) {
      try {
        await access(candidate);
        return candidate;
      } catch {
        // Not built for this launch layout.
      }
    }
    return null;
  },
  spawn: (file, args) => nodeSpawn(file, args, { stdio: ['pipe', 'pipe', 'pipe'] }),
  execFile: (file, args, options) =>
    execute(file, args, {
      timeout: options?.timeoutMs ?? 5_000,
      maxBuffer: options?.maxBuffer ?? MAX_LINE,
    }),
  fileSize: async (file) => (await stat(file)).size,
  removeFile: (file) => rm(file, { force: true }),
  ensureDir: async (dir) => {
    await mkdir(dir, { recursive: true });
  },
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function errorCode(value: unknown): DockEvidenceErrorCode {
  return value === 'permission' || value === 'unavailable' ? value : 'failed';
}

function endReason(value: unknown): DockRecordingEndReason {
  return value === 'limit' || value === 'size-limit' || value === 'interrupted' ? value : 'stopped';
}

function parseCapability(stdout: string): DockRecordingCapability {
  const raw = JSON.parse(stdout.trim().split('\n').pop() ?? '{}') as Record<string, unknown>;
  if (raw.supported !== true)
    return { supported: false, reason: 'os-version', detail: String(raw.osVersion ?? '') };
  const micPermission = raw.micPermission;
  return {
    supported: true,
    micSupported: raw.micSupported === true,
    stillSupported: raw.stillSupported === true,
    captureApi: typeof raw.captureApi === 'string' ? raw.captureApi : DOCK_RECORDING_CAPTURE_API,
    osVersion: typeof raw.osVersion === 'string' ? raw.osVersion : '',
    screenPermission: raw.screenPermission === true,
    micPermission:
      micPermission === 'authorized' ||
      micPermission === 'denied' ||
      micPermission === 'restricted' ||
      micPermission === 'not-determined'
        ? micPermission
        : 'unknown',
  };
}

const validWindowIds = (ids: readonly number[]): number[] =>
  [...new Set(ids)]
    .filter((id) => Number.isSafeInteger(id) && id > 0 && id <= 0xffffffff)
    .slice(0, 64);

const windowArgs = (ids: readonly number[]): string[] =>
  validWindowIds(ids).flatMap((id) => ['--exclude-window', String(id)]);

export function createDockScreenRecorder(
  overrides: Partial<DockScreenRecorderDeps> = {},
): DockScreenRecorder {
  const deps: DockScreenRecorderDeps = { ...defaultDockScreenRecorderDeps, ...overrides };
  const listeners = new Set<(clipId: string, result: DockNativeResult<DockRecordedClip>) => void>();
  let active: ActiveClip | null = null;

  const later = (clip: ActiveClip, ms: number, fn: () => void) => {
    const handle = deps.setTimeout(() => {
      clip.timers.delete(handle);
      fn();
    }, ms);
    clip.timers.add(handle);
  };

  const send = (clip: ActiveClip, command: Record<string, unknown>): boolean => {
    if (clip.phase === 'ended' || clip.child.stdin.destroyed || !clip.child.stdin.writable)
      return false;
    clip.child.stdin.write(`${JSON.stringify(command)}\n`);
    return true;
  };

  const settle = (clip: ActiveClip, result: DockNativeResult<DockRecordedClip>) => {
    if (clip.phase === 'ended') return;
    clip.phase = 'ended';
    for (const handle of clip.timers) deps.clearTimeout(handle);
    clip.timers.clear();
    for (const reply of clip.micReplies.splice(0)) reply(false);
    for (const reply of clip.excludeReplies.splice(0)) reply({ ok: false, detail: 'ended' });
    clip.resolveStarted(
      clip.startedAt !== null && !clip.cancelled
        ? { ok: true, value: { startedAt: clip.startedAt } }
        : result.ok
          ? fail('failed', 'ended-before-start')
          : result,
    );
    clip.resolveEnded(result);
    if (active === clip) active = null;
    if (!result.ok) void deps.removeFile(clip.outputPath).catch(() => undefined);
    for (const listener of listeners) {
      try {
        listener(clip.clipId, result);
      } catch (error) {
        logger.warn('Clip end listener failed', { error });
      }
    }
  };

  const kill = (clip: ActiveClip, detail: string) => {
    try {
      clip.child.kill('SIGKILL');
    } catch {
      // Already gone.
    }
    settle(clip, fail('failed', detail));
  };

  const finished = async (clip: ActiveClip, event: HelperEvent) => {
    if (clip.cancelled) {
      settle(clip, fail('failed', 'cancelled'));
      return;
    }
    const durationMs = Number(event.durationMs);
    let size: number;
    try {
      size = await deps.fileSize(clip.outputPath);
    } catch {
      settle(clip, fail('failed', 'missing-file'));
      return;
    }
    if (!Number.isFinite(durationMs) || durationMs <= 0 || size <= 0 || clip.startedAt === null) {
      settle(clip, fail('failed', 'empty-clip'));
      return;
    }
    // Backstop for the helper's size stop: a clip the app cannot play back is never offered.
    if (size > DOCK_RECORDING_MAX_BYTES) {
      settle(clip, fail('limit', 'too-large'));
      return;
    }
    settle(clip, {
      ok: true,
      value: {
        clipId: clip.clipId,
        sourcePath: clip.outputPath,
        mimeType: 'video/mp4',
        size,
        durationMs: Math.min(clip.maxMs, Math.round(durationMs)),
        hasMicAudio: event.hasMicAudio === true,
        startedAt: clip.startedAt,
        endedReason: endReason(event.reason),
        captureApi:
          typeof event.captureApi === 'string' ? event.captureApi : DOCK_RECORDING_CAPTURE_API,
      },
    });
  };

  const requestStop = (clip: ActiveClip) => {
    if (clip.phase === 'ended' || clip.phase === 'finishing') return;
    clip.phase = 'finishing';
    if (!send(clip, { cmd: 'stop' })) return kill(clip, 'helper-gone');
    later(clip, FINISH_TIMEOUT_MS, () => kill(clip, 'finish-timeout'));
  };

  const onEvent = (clip: ActiveClip, event: HelperEvent) => {
    switch (event.event) {
      case 'started':
        if (clip.phase !== 'starting') return;
        clip.phase = 'recording';
        clip.startedAt = deps.now();
        clip.resolveStarted({ ok: true, value: { startedAt: clip.startedAt } });
        later(clip, clip.maxMs + LIMIT_GRACE_MS, () => {
          if (clip.phase === 'recording') requestStop(clip);
        });
        return;
      case 'mic':
        clip.micReplies.shift()?.(event.active === true);
        return;
      case 'exclude':
        clip.excludeReplies.shift()?.({
          ok: event.ok === true,
          detail: typeof event.detail === 'string' && event.detail ? event.detail : undefined,
        });
        return;
      case 'finished':
        clip.phase = 'finishing';
        void finished(clip, event);
        return;
      case 'cancelled':
        settle(clip, fail('failed', 'cancelled'));
        return;
      case 'error':
        settle(
          clip,
          fail(errorCode(event.code), typeof event.detail === 'string' ? event.detail : undefined),
        );
        return;
      default:
        return;
    }
  };

  const capability = (): Promise<DockRecordingCapability> => {
    if (deps.platform !== 'darwin')
      return Promise.resolve({ supported: false, reason: 'platform' });
    // Not cached: permission state changes while the app runs and the probe is cheap.
    return (async (): Promise<DockRecordingCapability> => {
      const helper = await deps.resolveHelper();
      if (!helper) return { supported: false, reason: 'helper-missing' };
      try {
        return parseCapability((await deps.execFile(helper, ['capability'])).stdout);
      } catch (error) {
        logger.warn('Recorder capability probe failed', { error });
        return { supported: false, reason: 'helper-missing', detail: 'probe-failed' };
      }
    })();
  };

  const captureStill = async (
    request: DockStillRequest,
  ): Promise<DockNativeResult<DockCapturedPixels>> => {
    if (deps.platform !== 'darwin') return fail('unavailable', 'platform');
    if (!Number.isSafeInteger(request.displayId) || request.displayId <= 0)
      return fail('unavailable', 'display');
    const helper = await deps.resolveHelper();
    if (!helper) return fail('unavailable', 'helper-missing');
    let raw: Record<string, unknown>;
    try {
      const { stdout } = await deps.execFile(
        helper,
        [
          'still',
          '--display',
          String(request.displayId),
          '--max-edge',
          String(DOCK_RECORDING_MAX_EDGE),
          ...windowArgs(request.excludeWindowIds),
        ],
        { timeoutMs: STILL_TIMEOUT_MS, maxBuffer: MAX_STILL_OUTPUT },
      );
      raw = JSON.parse(stdout.trim()) as Record<string, unknown>;
    } catch (error) {
      logger.warn('Still capture helper failed', { error });
      return fail('failed', 'helper');
    }
    if (raw.ok !== true) {
      if (raw.code === 'unsupported') return fail('unavailable', 'os-version');
      return fail(errorCode(raw.code), typeof raw.detail === 'string' ? raw.detail : undefined);
    }
    const { base64, width, height, displayScale, capturedAt, hash } = raw;
    if (
      typeof base64 !== 'string' ||
      base64.length === 0 ||
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      (width as number) <= 0 ||
      (height as number) <= 0 ||
      typeof displayScale !== 'number' ||
      !(displayScale > 0) ||
      typeof capturedAt !== 'string'
    )
      return fail('failed', 'malformed');
    return {
      ok: true,
      value: {
        base64,
        mimeType: 'image/png',
        width: width as number,
        height: height as number,
        displayScale,
        capturedAt,
        ...(typeof hash === 'string' && /^[0-9a-f]{64}$/.test(hash) ? { hash } : {}),
      },
    };
  };

  /** clipIds stopped or cancelled before their helper existed; a later start is refused. */
  const aborted = new Set<string>();
  const abort = (clipId: string) => {
    aborted.add(clipId);
    while (aborted.size > 16) aborted.delete(aborted.values().next().value as string);
  };
  /** The one start between its synchronous reservation and the helper spawn. */
  interface Reservation {
    clipId: string;
    promise: Promise<DockNativeResult<{ startedAt: number }>>;
  }
  let reservation: Reservation | null = null;

  const start = (
    request: DockRecordingStartRequest,
  ): Promise<DockNativeResult<{ startedAt: number }>> => {
    if (active) {
      if (active.clipId === request.clipId) return active.started;
      return Promise.resolve(fail('failed', 'busy'));
    }
    if (reservation)
      return reservation.clipId === request.clipId
        ? reservation.promise
        : Promise.resolve(fail('failed', 'busy'));
    if (aborted.has(request.clipId)) return Promise.resolve(fail('failed', 'cancelled'));
    if (!CLIP_ID.test(request.clipId)) return Promise.resolve(fail('failed', 'invalid-clip-id'));
    if (!Number.isSafeInteger(request.displayId) || request.displayId <= 0)
      return Promise.resolve(fail('unavailable', 'display'));
    if (deps.platform !== 'darwin') return Promise.resolve(fail('unavailable', 'platform'));
    const held = { clipId: request.clipId } as Reservation;
    held.promise = launch(request).finally(() => {
      if (reservation === held) reservation = null;
    });
    reservation = held;
    return held.promise;
  };

  const launch = async (
    request: DockRecordingStartRequest,
  ): Promise<DockNativeResult<{ startedAt: number }>> => {
    const helper = await deps.resolveHelper();
    if (aborted.has(request.clipId)) return fail('failed', 'cancelled');
    if (!helper) return fail('unavailable', 'helper-missing');
    const outputPath = path.join(request.outputDir, `${request.clipId}.mp4`);
    const maxMs = Math.max(
      1_000,
      Math.min(DOCK_RECORDING_MAX_MS, Math.round(request.maxMs ?? DOCK_RECORDING_MAX_MS)),
    );
    try {
      await deps.ensureDir(request.outputDir);
    } catch {
      return fail('failed', 'output-dir');
    }
    // Last check before the spawn; from here until `active` is set nothing awaits.
    if (aborted.has(request.clipId)) return fail('failed', 'cancelled');
    const args = [
      'record',
      '--output',
      outputPath,
      '--display',
      String(request.displayId),
      '--max-ms',
      String(maxMs),
      '--max-bytes',
      String(DOCK_RECORDING_MAX_BYTES),
      '--size-stop-percent',
      String(Math.round(DOCK_RECORDING_SIZE_STOP_RATIO * 100)),
      '--video-bitrate',
      String(DOCK_RECORDING_VIDEO_BITRATE),
      '--audio-bitrate',
      String(DOCK_RECORDING_AUDIO_BITRATE),
      '--fps',
      String(DOCK_RECORDING_MAX_FPS),
      '--max-edge',
      String(DOCK_RECORDING_MAX_EDGE),
      '--mic-capable',
      ...(request.includeMic ? ['--mic'] : []),
      ...windowArgs(request.excludeWindowIds),
    ];
    let child: Child;
    try {
      child = deps.spawn(helper, args);
    } catch (error) {
      logger.warn('Recorder helper failed to spawn', { error });
      return fail('failed', 'spawn');
    }
    let resolveStarted!: ActiveClip['resolveStarted'];
    let resolveEnded!: ActiveClip['resolveEnded'];
    const clip: ActiveClip = {
      clipId: request.clipId,
      outputPath,
      maxMs,
      child,
      startedAt: null,
      phase: 'starting',
      started: new Promise((resolve) => (resolveStarted = resolve)),
      resolveStarted: (result) => resolveStarted(result),
      ended: new Promise((resolve) => (resolveEnded = resolve)),
      resolveEnded: (result) => resolveEnded(result),
      cancelled: false,
      micReplies: [],
      excludeReplies: [],
      timers: new Set(),
    };
    active = clip;
    if (reservation?.clipId === clip.clipId) reservation = null;

    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      if (buffer.length > MAX_LINE * 4) buffer = buffer.slice(-MAX_LINE);
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line || line.length > MAX_LINE) continue;
        try {
          const event = JSON.parse(line) as unknown;
          if (event && typeof event === 'object') onEvent(clip, event as HelperEvent);
        } catch {
          logger.debug('Ignoring malformed recorder output line');
        }
      }
    });
    child.stderr.on('data', () => undefined);
    child.stdin.on('error', () => undefined);
    child.on('error', (error) => {
      logger.warn('Recorder helper process error', { error });
      settle(clip, fail('failed', 'process-error'));
    });
    // `close` (not `exit`) so every stdout line, including `finished`, is seen first.
    child.on('close', (code, signal) => {
      // `finished` may still be stat-ing the file; it settles on its own.
      if (clip.phase === 'finishing' && code === 0) return;
      if (clip.phase !== 'ended')
        settle(clip, fail('failed', `helper-exit:${code ?? signal ?? 'unknown'}`));
    });
    later(clip, START_TIMEOUT_MS, () => {
      if (clip.phase === 'starting') {
        kill(clip, 'start-timeout');
      }
    });
    return clip.started;
  };

  const current = (clipId: string): ActiveClip | null =>
    active && active.clipId === clipId ? active : null;

  const setMicrophone = async (
    clipId: string,
    on: boolean,
  ): Promise<DockNativeResult<{ micActive: boolean }>> => {
    const clip = current(clipId);
    if (!clip || clip.phase === 'finishing') return fail('failed', 'not-recording');
    if (clip.phase === 'starting') {
      // The helper applies it when the first frame starts the clip.
      send(clip, { cmd: 'mic', on });
      if (!on) return { ok: true, value: { micActive: false } };
      const started = await clip.started;
      if (!started.ok) return started;
    } else if (!send(clip, { cmd: 'mic', on })) {
      return fail('failed', 'helper-gone');
    }
    const micActive = await new Promise<boolean>((resolve) => {
      clip.micReplies.push(resolve);
      later(clip, REPLY_TIMEOUT_MS, () => {
        const index = clip.micReplies.indexOf(resolve);
        if (index >= 0) clip.micReplies.splice(index, 1);
        resolve(false);
      });
    });
    return { ok: true, value: { micActive: on && micActive } };
  };

  const setMarks = (clipId: string, marks: readonly DockRecordingMark[]): boolean => {
    const clip = current(clipId);
    if (!clip || clip.phase === 'finishing') return false;
    return send(clip, {
      cmd: 'marks',
      marks: marks.slice(0, 99).map(({ n, tool, geometry, imageWidth, imageHeight }) => ({
        n,
        tool,
        geometry,
        imageWidth,
        imageHeight,
      })),
    });
  };

  const setExcludedWindows = async (
    clipId: string,
    windowIds: readonly number[],
  ): Promise<DockNativeResult<void>> => {
    const clip = current(clipId);
    if (!clip || clip.phase !== 'recording') return fail('failed', 'not-recording');
    const ids = validWindowIds(windowIds);
    if (!send(clip, { cmd: 'exclude', windowIds: ids })) return fail('failed', 'helper-gone');
    const reply = await new Promise<{ ok: boolean; detail?: string }>((resolve) => {
      clip.excludeReplies.push(resolve);
      later(clip, REPLY_TIMEOUT_MS, () => {
        const index = clip.excludeReplies.indexOf(resolve);
        if (index >= 0) clip.excludeReplies.splice(index, 1);
        resolve({ ok: false, detail: 'timeout' });
      });
    });
    // 'exclusion-missing': present windows stay excluded; the caller decides whether to stop.
    return reply.ok ? { ok: true, value: undefined } : fail('failed', reply.detail ?? 'exclude');
  };

  const elapsedMs = (clipId: string): number | null => {
    const clip = current(clipId);
    if (!clip || clip.startedAt === null) return null;
    return Math.min(clip.maxMs, Math.max(0, deps.now() - clip.startedAt));
  };

  const ended = new Map<string, Promise<DockNativeResult<DockRecordedClip>>>();

  const stop = (clipId: string): Promise<DockNativeResult<DockRecordedClip>> => {
    const clip = current(clipId);
    if (!clip) {
      const known = ended.get(clipId);
      if (known) return known;
      // Not spawned yet (or not even started): abort it, so no helper ever runs.
      abort(clipId);
      const pending = reservation?.clipId === clipId ? reservation.promise : null;
      return (pending ?? Promise.resolve()).then(() => fail('failed', 'cancelled'));
    }
    if (clip.phase === 'starting') {
      clip.cancelled = true;
      if (!send(clip, { cmd: 'cancel' })) kill(clip, 'helper-gone');
      else later(clip, FINISH_TIMEOUT_MS, () => kill(clip, 'finish-timeout'));
    } else {
      requestStop(clip);
    }
    return clip.ended;
  };

  const cancel = async (clipId: string): Promise<void> => {
    const clip = current(clipId);
    if (!clip) {
      if (!ended.has(clipId)) {
        abort(clipId);
        if (reservation?.clipId === clipId) await reservation.promise;
        return;
      }
      const result = await ended.get(clipId);
      ended.delete(clipId);
      if (result?.ok) await deps.removeFile(result.value.sourcePath).catch(() => undefined);
      return;
    }
    clip.cancelled = true;
    // A helper already finalizing ignores `cancel`; its clip is then discarded below.
    if (send(clip, { cmd: 'cancel' }))
      later(clip, FINISH_TIMEOUT_MS, () => kill(clip, 'cancelled'));
    else kill(clip, 'cancelled');
    const result = await clip.ended;
    ended.delete(clipId);
    if (result.ok) await deps.removeFile(result.value.sourcePath).catch(() => undefined);
    await deps.removeFile(clip.outputPath).catch(() => undefined);
  };

  // Remember the last few outcomes so a late `stop` after an auto-limit still resolves.
  listeners.add((clipId, result) => {
    ended.set(clipId, Promise.resolve(result));
    while (ended.size > 4) ended.delete(ended.keys().next().value as string);
  });

  return {
    capability,
    captureStill,
    start,
    setMicrophone,
    setMarks,
    setExcludedWindows,
    elapsedMs,
    stop,
    cancel,
    onEnded(listener) {
      const wrapped = (clipId: string, result: DockNativeResult<DockRecordedClip>) =>
        listener(clipId, result);
      listeners.add(wrapped);
      return () => listeners.delete(wrapped);
    },
    async dispose() {
      if (active) await cancel(active.clipId);
    },
  };
}
