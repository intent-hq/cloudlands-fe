/**
 * Main-process driver for the streaming dock dictation helper
 * (`intent-dock-speech`, resources/speech/dock-speech.swift).
 *
 * One handle owns one helper process and one microphone session. The caller
 * (the dock evidence session IPC) guards which draft a handle belongs to;
 * this module guarantees the lifecycle: `ended` is delivered exactly once and
 * last, `stop()` resolves only after every final transcript has been
 * delivered, and every exit path kills the helper so the microphone closes.
 * Nothing here sends a message, focuses a window or activates the app.
 */
import { app } from 'electron';
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  DOCK_SPEECH_SILENCE_MS,
  parseDockSpeechEvent,
  type DockSpeechAuthorization,
  type DockSpeechCapability,
  type DockSpeechCommand,
  type DockSpeechEndReason,
  type DockSpeechEngine,
  type DockSpeechErrorCode,
  type DockSpeechEvent,
} from '../../../shared/dock-speech';
import { Logger } from '../../../shared/logger';

const logger = new Logger('DockSpeech');

const HELPER_NAME = 'intent-dock-speech';
const PROBE_TIMEOUT_MS = 5_000;
/** Above the helper's own 8 s finalization watchdog. */
export const DOCK_SPEECH_STOP_TIMEOUT_MS = 10_000;
const DOCK_SPEECH_CANCEL_GRACE_MS = 1_000;

type Spawn = (command: string, args: string[]) => ChildProcessWithoutNullStreams;
type ExecFile = (
  command: string,
  args: string[],
  options: { timeout: number },
  callback: (error: Error | null, stdout: string) => void,
) => void;

export interface DockSpeechDeps {
  platform?: NodeJS.Platform;
  /** Explicit helper path; `null` means not installed. Defaults to the bundled/dev location. */
  helperPath?: string | null;
  spawn?: Spawn;
  execFile?: ExecFile;
}

type DockSpeechEnded = Extract<DockSpeechEvent, { type: 'ended' }>;

export interface DockSpeechStartOptions {
  sessionId: string;
  locale?: string;
  contextualStrings?: string[];
  silenceMs?: number;
  maxMs?: number;
  /** Mic audio is written here only while dictation is live (for the screen recorder). */
  micAudioPath?: string;
  onEvent: (event: DockSpeechEvent) => void;
}

export interface DockSpeechHandle {
  readonly sessionId: string;
  /** Stamp a click on the audio clock; echoed as a `mark` event. */
  mark(markId: string): void;
  /** Annotating activity: resets the silence auto-stop without stamping anything. */
  activity(): void;
  /** Finalization barrier: resolves after all finals and `ended`. */
  stop(): Promise<DockSpeechEnded>;
  /** Drops unfinalized speech; resolves with `ended`. */
  cancel(): Promise<DockSpeechEnded>;
  /** Kill immediately (window closed, draft gone). Idempotent. */
  dispose(): void;
  readonly ended: Promise<DockSpeechEnded>;
}

function helperCandidates(): string[] {
  if (app.isPackaged) return [path.join(process.resourcesPath, 'speech-helper', HELPER_NAME)];
  return [
    path.join(app.getAppPath(), '..', '..', 'resources', 'speech-helper', HELPER_NAME),
    path.join(app.getAppPath(), 'resources', 'speech-helper', HELPER_NAME),
  ];
}

async function resolveHelperPath(deps: DockSpeechDeps): Promise<string | null> {
  if (deps.helperPath !== undefined) return deps.helperPath;
  for (const candidate of helperCandidates()) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try the next location.
    }
  }
  return null;
}

const AUTHORIZATIONS = new Set(['authorized', 'denied', 'restricted', 'notDetermined']);
const authorization = (value: unknown): DockSpeechAuthorization | null =>
  typeof value === 'string' && AUTHORIZATIONS.has(value)
    ? (value as DockSpeechAuthorization)
    : null;

function unavailable(reason: DockSpeechErrorCode): DockSpeechCapability {
  return {
    available: false,
    engine: null,
    speech: null,
    microphone: null,
    locale: null,
    onDevice: false,
    reason,
  };
}

/** Capability without prompting and without opening the microphone. */
export async function probeDockSpeech(
  options: { locale?: string } = {},
  deps: DockSpeechDeps = {},
): Promise<DockSpeechCapability> {
  if ((deps.platform ?? process.platform) !== 'darwin') return unavailable('unsupported-platform');
  const helperPath = await resolveHelperPath(deps);
  if (!helperPath) return unavailable('helper-missing');
  const run = deps.execFile ?? (execFile as unknown as ExecFile);
  const args = ['--probe', ...(options.locale ? ['--locale', options.locale] : [])];
  const stdout = await new Promise<string | null>((resolve) => {
    run(helperPath, args, { timeout: PROBE_TIMEOUT_MS }, (error, out) => {
      if (error) logger.warn('dock speech probe failed', { error: error.message });
      resolve(error ? null : out);
    });
  });
  let raw: Record<string, unknown> | null = null;
  try {
    raw = stdout
      ? (JSON.parse(stdout.trim().split('\n').at(-1) ?? '') as Record<string, unknown>)
      : null;
  } catch {
    raw = null;
  }
  if (!raw) return unavailable('helper-exited');
  const speech = authorization(raw.speech);
  const microphone = authorization(raw.microphone);
  const engine: DockSpeechEngine | null =
    raw.engine === 'analyzer' || raw.engine === 'recognizer' ? raw.engine : null;
  const base = {
    engine,
    speech,
    microphone,
    locale: typeof raw.locale === 'string' ? raw.locale : null,
    onDevice: raw.onDevice === true,
  };
  const reason: DockSpeechErrorCode | undefined =
    speech === 'denied'
      ? 'speech-permission-denied'
      : speech === 'restricted'
        ? 'speech-permission-restricted'
        : microphone === 'denied'
          ? 'microphone-permission-denied'
          : microphone === 'restricted'
            ? 'microphone-permission-restricted'
            : raw.inputDevice === false
              ? 'no-input-device'
              : !engine
                ? options.locale
                  ? 'locale-unsupported'
                  : 'recognizer-unavailable'
                : undefined;
  return reason ? { available: false, ...base, reason } : { available: true, ...base };
}

/**
 * Start a dictation session. Failures that happen before the helper runs
 * (platform, missing binary, spawn error) arrive as `error` + `ended`
 * events, the same as failures inside the helper.
 */
export function startDockSpeech(
  options: DockSpeechStartOptions,
  deps: DockSpeechDeps = {},
): DockSpeechHandle {
  let child: ChildProcessWithoutNullStreams | null = null;
  let endedEvent: DockSpeechEnded | null = null;
  let requested: 'stop' | 'cancel' | null = null;
  let killTimer: ReturnType<typeof setTimeout> | null = null;
  let resolveEnded!: (event: DockSpeechEnded) => void;
  const ended = new Promise<DockSpeechEnded>((resolve) => (resolveEnded = resolve));
  const queued: DockSpeechCommand[] = [];
  let lastElapsedMs = 0;

  const deliver = (event: DockSpeechEvent) => {
    if (endedEvent) return;
    if ('elapsedMs' in event) lastElapsedMs = Math.max(lastElapsedMs, event.elapsedMs);
    if (event.type === 'ended') {
      endedEvent = event;
      if (killTimer) clearTimeout(killTimer);
      killTimer = null;
      child?.stdin.end();
      // The helper exits after `ended`; make sure the mic is released anyway.
      const exiting = child;
      if (exiting && exiting.exitCode === null)
        setTimeout(() => exiting.exitCode === null && exiting.kill('SIGKILL'), 2_000).unref?.();
    }
    try {
      options.onEvent(event);
    } catch (error) {
      logger.error('dock speech listener failed', { error });
    }
    if (event.type === 'ended') resolveEnded(event);
  };

  const finish = (
    code: DockSpeechErrorCode | null,
    message: string,
    reason: DockSpeechEndReason,
  ) => {
    if (endedEvent) return;
    if (code) deliver({ type: 'error', code, message, fatal: true });
    deliver({ type: 'ended', reason, elapsedMs: lastElapsedMs });
  };

  const write = (command: DockSpeechCommand) => {
    if (endedEvent) return;
    if (!child) {
      queued.push(command);
      return;
    }
    if (child.stdin.writable) child.stdin.write(`${JSON.stringify(command)}\n`);
  };

  const kill = () => {
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  };

  const launch = async () => {
    if ((deps.platform ?? process.platform) !== 'darwin')
      return finish('unsupported-platform', 'streaming dictation requires macOS', 'error');
    const helperPath = await resolveHelperPath(deps);
    if (endedEvent) return;
    if (!helperPath) return finish('helper-missing', `${HELPER_NAME} is not installed`, 'error');
    if (requested === 'cancel') return finish(null, '', 'cancelled');
    try {
      child = (deps.spawn ?? ((command, args) => spawn(command, args, { stdio: 'pipe' })))(
        helperPath,
        ['--serve'],
      );
    } catch (error) {
      return finish('helper-exited', `cannot start ${HELPER_NAME}: ${String(error)}`, 'error');
    }
    const proc = child;
    let buffer = '';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) {
          const event = parseDockSpeechEvent(line);
          if (event) deliver(event);
          else logger.warn('dock speech: dropped malformed event', { line: line.slice(0, 200) });
        }
        newline = buffer.indexOf('\n');
      }
    });
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (chunk: string) => {
      const text = chunk.trim();
      if (text) logger.warn('dock speech helper stderr', { stderr: text });
    });
    proc.stdin.on('error', () => {
      // EPIPE after the helper exits; the exit handler reports it.
    });
    proc.on('error', (error) =>
      finish('helper-exited', `${HELPER_NAME} failed: ${error.message}`, 'error'),
    );
    proc.on('exit', (code, signal) => {
      if (killTimer) clearTimeout(killTimer);
      if (requested === 'cancel') return finish(null, '', 'cancelled');
      finish('helper-exited', `${HELPER_NAME} exited (${signal ?? code}) before ending`, 'error');
    });
    write({
      cmd: 'start',
      sessionId: options.sessionId,
      ...(options.locale ? { locale: options.locale } : {}),
      ...(options.contextualStrings?.length
        ? { contextualStrings: options.contextualStrings }
        : {}),
      silenceMs: options.silenceMs ?? DOCK_SPEECH_SILENCE_MS,
      ...(options.maxMs ? { maxMs: options.maxMs } : {}),
      ...(options.micAudioPath ? { micAudioPath: options.micAudioPath } : {}),
    });
    for (const command of queued.splice(0)) write(command);
  };

  void launch().catch((error: unknown) => finish('helper-exited', String(error), 'error'));

  return {
    sessionId: options.sessionId,
    ended,
    mark(markId: string) {
      if (!requested && markId) write({ cmd: 'mark', markId });
    },
    activity() {
      if (!requested) write({ cmd: 'activity' });
    },
    stop() {
      if (!requested && !endedEvent) {
        requested = 'stop';
        write({ cmd: 'stop' });
        killTimer = setTimeout(() => {
          logger.warn('dock speech: finalization timed out; killing helper');
          // Never a clean stop: consumers keep the words already delivered but
          // must not treat the stop barrier as passed.
          finish('recognition-failed', 'finalization timed out', 'error');
          kill();
        }, DOCK_SPEECH_STOP_TIMEOUT_MS);
      }
      return ended;
    },
    cancel() {
      if (!endedEvent && requested !== 'cancel') {
        if (killTimer) clearTimeout(killTimer);
        requested = 'cancel';
        write({ cmd: 'cancel' });
        killTimer = setTimeout(() => {
          finish(null, '', 'cancelled');
          kill();
        }, DOCK_SPEECH_CANCEL_GRACE_MS);
      }
      return ended;
    },
    dispose() {
      requested = 'cancel';
      finish(null, '', 'cancelled');
      kill();
    },
  };
}
