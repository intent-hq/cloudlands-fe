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
import { access, mkdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
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
/** A still from the recording's own stream: the helper waits up to 1.5 s for a frame. */
const STREAM_STILL_TIMEOUT_MS = 4_000;

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
  readFile: (file: string) => Promise<Buffer>;
  removeFile: (file: string) => Promise<void>;
  ensureDir: (dir: string) => Promise<void>;
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface DockScreenRecorder {
  /** Synchronous reciprocal lease: no new selector while a clip owns startup/stream/finalization. */
  reserveSelection(): (() => void) | null;
  capability(): Promise<DockRecordingCapability>;
  /**
   * Screenshot with the dock and controls excluded, so the composer stays visible.
   * `{ok:false, error:'unavailable', detail:'os-version'}` (macOS < 14) is the only
   * result a caller may answer with its hide-and-capture fallback; `permission` and
   * `failed` (including `detail:'exclusion-missing'` when any requested window is not
   * shareable — no image is produced) are real outcomes and must surface.
   *
   * While a clip owns the screen stream (starting, recording or finishing), the still
   * comes from that stream (its newest raw frame, before marks) and never from a second
   * ScreenCaptureKit capture, which would stop the recording. Not recording yet or any
   * more, it fails (`recording-busy`) rather than fall back.
   */
  captureStill(request: DockStillRequest): Promise<DockNativeResult<DockCapturedPixels>>;
  start(request: DockRecordingStartRequest): Promise<DockNativeResult<{ startedAt: number }>>;
  setMicrophone(clipId: string, on: boolean): Promise<DockNativeResult<{ micActive: boolean }>>;
  /**
   * Pause or resume the live clip. Paused time is cut from the clip and from its
   * duration limit; resolves with the helper's resulting state.
   */
  setPaused(clipId: string, paused: boolean): Promise<DockNativeResult<{ paused: boolean }>>;
  setMarks(clipId: string, marks: readonly DockRecordingMark[]): boolean;
  /** Strict: `{ok:false, detail:'exclusion-missing'}` when any requested window is gone. */
  setExcludedWindows(clipId: string, windowIds: readonly number[]): Promise<DockNativeResult<void>>;
  elapsedMs(clipId: string): number | null;
  stop(clipId: string): Promise<DockNativeResult<DockRecordedClip>>;
  cancel(clipId: string): Promise<void>;
  onEnded(
    listener: (clipId: string, result: DockNativeResult<DockRecordedClip>) => void,
  ): () => void;
  /** Live microphone signal of the recording clip: input level (0…1) and whether it is open. */
  onSignal(listener: (clipId: string, signal: DockRecordingSignal) => void): () => void;
  dispose(): Promise<void>;
}

interface DockRecordingSignal {
  level: number;
  /** The microphone is open (authorized, available) for this clip. */
  mic: boolean;
}

type HelperEvent = Record<string, unknown> & { event?: unknown };

interface ActiveClip {
  clipId: string;
  displayId: number;
  outputPath: string;
  cleanPath: string;
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
  pauseReplies: ((paused: boolean) => void)[];
  /** Stills asked of this clip's stream, by request id; null when the clip ended. */
  stillReplies: Map<string, (event: HelperEvent | null) => void>;
  /**
   * Every still path main issued and has not removed yet (by request id), including
   * ones whose reply came too late. Only these paths are ever removed.
   */
  stillFiles: Map<string, string>;
  timers: Set<unknown>;
  /** Wall time spent paused before the current pause, and when that pause began. */
  pausedMs: number;
  pausedAt: number | null;
  /** The recording-limit backstop, rescheduled around pauses. */
  limitTimer: unknown;
  mic: boolean;
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
  execFile: async (file, args, options) => {
    let closed: Promise<void> | undefined;
    try {
      return await new Promise<{ stdout: string }>((resolve, reject) => {
        const child = nodeExecFile(file, args, {
          timeout: options?.timeoutMs ?? 5_000, maxBuffer: options?.maxBuffer ?? MAX_LINE,
        }, (error, stdout) => error ? reject(error) : resolve({ stdout }));
        closed = new Promise<void>((done) => child.once('close', () => done()));
      });
    } finally { await closed; }
  },
  fileSize: async (file) => (await stat(file)).size,
  readFile: (file) => readFile(file),
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

/** The system's reason for stopping an interrupted stream, as the helper reported it. */
function interruption(
  clip: { clipId: string },
  event: Record<string, unknown>,
): { endedError?: { domain: string; code: number; detail: string } } {
  const domain = typeof event.errorDomain === 'string' ? event.errorDomain : '';
  const code = typeof event.errorCode === 'number' ? event.errorCode : NaN;
  const detail = typeof event.errorDetail === 'string' ? event.errorDetail.slice(0, 200) : '';
  logger.warn('Recording interrupted by the system', { clipId: clip.clipId, domain, code, detail });
  return domain && Number.isFinite(code) ? { endedError: { domain, code, detail } } : {};
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
  const signalListeners = new Set<(clipId: string, signal: DockRecordingSignal) => void>();
  let active: ActiveClip | null = null;

  const signal = (clip: ActiveClip, level: number) => {
    for (const listener of signalListeners) {
      try {
        listener(clip.clipId, { level, mic: clip.mic });
      } catch (error) {
        logger.warn('Clip signal listener failed', { error });
      }
    }
  };

  /** Recorded (unpaused) wall time of the clip so far. */
  const recordedMs = (clip: ActiveClip): number =>
    clip.startedAt === null
      ? 0
      : Math.max(0, (clip.pausedAt ?? deps.now()) - clip.startedAt - clip.pausedMs);

  const scheduleLimit = (clip: ActiveClip) => {
    if (clip.limitTimer !== undefined) {
      deps.clearTimeout(clip.limitTimer);
      clip.timers.delete(clip.limitTimer);
      clip.limitTimer = undefined;
    }
    if (clip.pausedAt !== null) return;
    const handle = deps.setTimeout(
      () => {
        clip.timers.delete(handle);
        clip.limitTimer = undefined;
        if (clip.phase === 'recording') requestStop(clip);
      },
      Math.max(0, clip.maxMs - recordedMs(clip)) + LIMIT_GRACE_MS,
    );
    clip.timers.add(handle);
    clip.limitTimer = handle;
  };

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
    for (const reply of clip.pauseReplies.splice(0)) reply(false);
    for (const reply of clip.stillReplies.values()) reply(null);
    clip.stillReplies.clear();
    clip.resolveStarted(
      clip.startedAt !== null && !clip.cancelled
        ? { ok: true, value: { startedAt: clip.startedAt } }
        : result.ok
          ? fail('failed', 'ended-before-start')
          : result,
    );
    clip.resolveEnded(result);
    if (active === clip) active = null;
    if (!result.ok) {
      void deps.removeFile(clip.outputPath).catch(() => undefined);
      void deps.removeFile(clip.cleanPath).catch(() => undefined);
    }
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
    let cleanSize: number;
    try {
      size = await deps.fileSize(clip.outputPath);
      cleanSize = await deps.fileSize(clip.cleanPath);
    } catch {
      settle(clip, fail('failed', 'missing-file'));
      return;
    }
    if (!Number.isFinite(durationMs) || durationMs <= 0 || size <= 0 || clip.startedAt === null) {
      settle(clip, fail('failed', 'empty-clip'));
      return;
    }
    // Backstop for the helper's size stop: a clip the app cannot play back is never offered.
    if (size > DOCK_RECORDING_MAX_BYTES || cleanSize > DOCK_RECORDING_MAX_BYTES) {
      settle(clip, fail('limit', 'too-large'));
      return;
    }
    const width = Number(event.width), height = Number(event.height);
    const clearAtMs = Array.isArray(event.clearAtMs) ? event.clearAtMs.filter((time): time is number =>
      typeof time === 'number' && Number.isFinite(time) && time >= 0 && time <= durationMs) : [];
    if (!(cleanSize > 0 && Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0)) {
      settle(clip, fail('failed', 'invalid-clean-source'));
      return;
    }
    settle(clip, {
      ok: true,
      value: {
        original: { sourcePath: clip.cleanPath, size: cleanSize, width, height, clearAtMs,
          // Old helpers' positive primary append proves clean append happened first;
          // a negative primary flag cannot prove the separate clean track is empty.
          ...(typeof event.hasCleanMicAudio === 'boolean' ? { hasMicAudio: event.hasCleanMicAudio }
            : event.hasMicAudio === true ? { hasMicAudio: true } : {}),
        },
        clipId: clip.clipId,
        sourcePath: clip.outputPath,
        mimeType: 'video/mp4',
        size,
        durationMs: Math.min(clip.maxMs, Math.round(durationMs)),
        hasMicAudio: event.hasMicAudio === true,
        startedAt: clip.startedAt,
        endedReason: endReason(event.reason),
        ...(endReason(event.reason) === 'interrupted' ? interruption(clip, event) : {}),
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
        scheduleLimit(clip);
        return;
      case 'mic':
        clip.mic = event.active === true;
        if (!clip.mic) signal(clip, 0);
        clip.micReplies.shift()?.(clip.mic);
        return;
      case 'paused': {
        const paused = event.paused === true;
        if (clip.phase === 'recording' && paused !== (clip.pausedAt !== null)) {
          if (paused) clip.pausedAt = deps.now();
          else if (clip.pausedAt !== null) {
            clip.pausedMs += deps.now() - clip.pausedAt;
            clip.pausedAt = null;
          }
          scheduleLimit(clip);
          if (paused) signal(clip, 0);
        }
        clip.pauseReplies.shift()?.(paused);
        return;
      }
      case 'level': {
        const level = Number(event.level);
        if (clip.phase === 'recording' && clip.pausedAt === null && Number.isFinite(level))
          signal(clip, Math.min(1, Math.max(0, level)));
        return;
      }
      case 'still': {
        const id = typeof event.id === 'string' ? event.id : '';
        const reply = clip.stillReplies.get(id);
        if (reply) {
          clip.stillReplies.delete(id);
          reply(event);
          return;
        }
        // Too late (main stopped waiting): its file, if any, is removed by our own path.
        dropStillFile(clip, id);
        return;
      }
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

  let stillSequence = 0;
  const dropStillFile = (clip: ActiveClip, id: string) => {
    const file = clip.stillFiles.get(id);
    if (file === undefined) return;
    clip.stillFiles.delete(id);
    void deps.removeFile(file).catch(() => undefined);
  };
  /** The still from the clip's own stream (the helper writes it next to the clip). */
  const streamStill = async (
    clip: ActiveClip,
    request: DockStillRequest,
  ): Promise<DockNativeResult<DockCapturedPixels>> => {
    if (clip.phase !== 'recording') return fail('failed', 'recording-busy');
    if (clip.displayId !== request.displayId) return fail('unavailable', 'display');
    stillSequence += 1;
    const id = `still-${stillSequence}`;
    const file = `${clip.outputPath.replace(/\.mp4$/, '')}.${id}.png`;
    clip.stillFiles.set(id, file);
    const reply = new Promise<HelperEvent | null>((resolve) => {
      clip.stillReplies.set(id, resolve);
      later(clip, STREAM_STILL_TIMEOUT_MS, () => {
        if (clip.stillReplies.delete(id)) resolve(null);
      });
    });
    const asked = send(clip, {
      cmd: 'still',
      id,
      path: file,
      windowIds: validWindowIds(request.excludeWindowIds),
    });
    if (!asked) {
      clip.stillReplies.delete(id);
      dropStillFile(clip, id);
      return fail('failed', 'helper-gone');
    }
    const raw = await reply;
    // Timed out or ended: the path stays known, so a late reply or the helper's exit
    // removes whatever it wrote.
    if (!raw) return fail('failed', 'still-timeout');
    try {
      if (raw.ok !== true)
        return fail(errorCode(raw.code), typeof raw.detail === 'string' ? raw.detail : 'still');
      if (raw.path !== file) return fail('failed', 'malformed');
      const png = await deps.readFile(file);
      return stillPixels({ ...raw, base64: png.toString('base64') });
    } catch (error) {
      logger.warn('Recording still could not be read', { error });
      return fail('failed', 'still-read');
    } finally {
      dropStillFile(clip, id);
    }
  };

  const captureStill = async (
    request: DockStillRequest,
  ): Promise<DockNativeResult<DockCapturedPixels>> => {
    if (deps.platform !== 'darwin') return fail('unavailable', 'platform');
    if (!Number.isSafeInteger(request.displayId) || request.displayId <= 0)
      return fail('unavailable', 'display');
    // One screen capture at a time: a recording's stream answers for itself.
    if (selectionOwner || standaloneStillOwner) return fail('failed', 'capture-busy');
    if (active) return streamStill(active, request);
    if (reservation) return fail('failed', 'recording-busy');
    const token = Symbol(); standaloneStillOwner = token;
    try {
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
    return stillPixels(raw);
    } finally { if (standaloneStillOwner === token) standaloneStillOwner = null; }
  };

  const stillPixels = (raw: Record<string, unknown>): DockNativeResult<DockCapturedPixels> => {
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
  let selectionOwner: symbol | null = null;
  let standaloneStillOwner: symbol | null = null;
  const reserveSelection = (): (() => void) | null => {
    if (active || reservation || selectionOwner || standaloneStillOwner) return null;
    const token = Symbol(); selectionOwner = token;
    return () => { if (selectionOwner === token) selectionOwner = null; };
  };

  const start = (
    request: DockRecordingStartRequest,
  ): Promise<DockNativeResult<{ startedAt: number }>> => {
    if (selectionOwner || standaloneStillOwner) return Promise.resolve(fail('failed', 'capture-busy'));
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
      '--clean-output',
      outputPath.replace(/\.mp4$/, '.original.mp4'),
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
      displayId: request.displayId,
      outputPath,
      cleanPath: outputPath.replace(/\.mp4$/, '.original.mp4'),
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
      pauseReplies: [],
      stillReplies: new Map(),
      stillFiles: new Map(),
      timers: new Set(),
      pausedMs: 0,
      pausedAt: null,
      limitTimer: undefined,
      mic: false,
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
      // The helper is gone: nothing more is written; remove every still it may have left.
      for (const id of [...clip.stillFiles.keys()]) dropStillFile(clip, id);
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

  const setPaused = async (
    clipId: string,
    paused: boolean,
  ): Promise<DockNativeResult<{ paused: boolean }>> => {
    const clip = current(clipId);
    if (!clip || clip.phase !== 'recording') return fail('failed', 'not-recording');
    if (!send(clip, { cmd: paused ? 'pause' : 'resume' })) return fail('failed', 'helper-gone');
    const state = await new Promise<boolean | null>((resolve) => {
      clip.pauseReplies.push(resolve);
      later(clip, REPLY_TIMEOUT_MS, () => {
        const index = clip.pauseReplies.indexOf(resolve);
        if (index >= 0) clip.pauseReplies.splice(index, 1);
        resolve(null);
      });
    });
    if (state === null) return fail('failed', 'timeout');
    return state === paused ? { ok: true, value: { paused } } : fail('failed', 'not-recording');
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
    return Math.min(clip.maxMs, recordedMs(clip));
  };

  const ended = new Map<string, Promise<DockNativeResult<DockRecordedClip>>>();
  // Result-cache pressure must not release files an upload may still be reading.
  // Ownership lasts until explicit cancellation/release or recorder disposal.
  const completedFiles = new Map<string, readonly string[]>();

  const removeCompletedFiles = async (clipId: string): Promise<void> => {
    const paths = completedFiles.get(clipId);
    completedFiles.delete(clipId);
    if (paths)
      await Promise.all(paths.map((file) => deps.removeFile(file).catch(() => undefined)));
  };

  const retireEnded = async (clipId: string): Promise<void> => {
    ended.delete(clipId);
    await removeCompletedFiles(clipId);
  };

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
      if (!ended.has(clipId) && !completedFiles.has(clipId)) {
        abort(clipId);
        if (reservation?.clipId === clipId) await reservation.promise;
        return;
      }
      await retireEnded(clipId);
      return;
    }
    clip.cancelled = true;
    // A helper already finalizing ignores `cancel`; its clip is then discarded below.
    if (send(clip, { cmd: 'cancel' }))
      later(clip, FINISH_TIMEOUT_MS, () => kill(clip, 'cancelled'));
    else kill(clip, 'cancelled');
    await clip.ended;
    await retireEnded(clipId);
    await deps.removeFile(clip.outputPath).catch(() => undefined);
    await deps.removeFile(clip.cleanPath).catch(() => undefined);
  };

  // Remember the last few outcomes so a late `stop` after an auto-limit still resolves.
  listeners.add((clipId, result) => {
    if (result.ok) {
      // finished() constructs these from main-owned temporary paths, never
      // daemon durable attachment paths.
      const paths = new Set([
        result.value.sourcePath,
        ...(result.value.original ? [result.value.original.sourcePath] : []),
      ]);
      completedFiles.set(clipId, [...paths]);
    }
    ended.set(clipId, Promise.resolve(result));
    while (ended.size > 4) ended.delete(ended.keys().next().value as string);
  });

  return {
    reserveSelection,
    capability,
    captureStill,
    start,
    setMicrophone,
    setPaused,
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
    onSignal(listener) {
      const wrapped = (clipId: string, value: DockRecordingSignal) => listener(clipId, value);
      signalListeners.add(wrapped);
      return () => signalListeners.delete(wrapped);
    },
    async dispose() {
      if (active) await cancel(active.clipId);
      await Promise.all([...completedFiles.keys()].map(retireEnded));
      ended.clear();
    },
  };
}
