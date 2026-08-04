/**
 * Local OS transcription IPC — macOS Speech.framework via the bundled
 * `intent-speech-helper` CLI (resources/speech/transcribe.swift).
 *
 * `voice:local-available` reports whether the engine can run on this host
 * (macOS + helper binary present) — a pure fs probe, it never spawns the
 * helper. `voice:transcribe-local` writes the renderer's recorded audio to a
 * temp file, spawns the helper, and returns its JSON result.
 * `voice:request-local-authorization` spawns the helper in its
 * authorization-only mode (`--request-authorization`) so the macOS speech
 * recognition TCC prompt fires when the user ENABLES the OS engine, not
 * mid-dictation. Responses are shaped `{ success, ... }` (safe-handler
 * idiom) so renderer callers surface typed error codes instead of opaque
 * IPC rejections. Error codes mirror the helper's:
 *   unsupported-platform | helper-missing | authorization-denied |
 *   recognizer-unavailable | audio-unreadable | recognition-failed
 */
import { app, ipcMain } from 'electron';
import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { VOICE_CHANNELS } from '../../../shared/ipc/channels';
import {
  VoiceLocalAvailableSchema,
  VoiceRequestLocalAuthorizationSchema,
  VoiceTranscribeLocalSchema,
} from '../../../main/ipc-schemas';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import { Logger } from '../../../shared/logger';

const logger = new Logger('VoiceLocalIPC');

/**
 * Helper exit ceiling: the helper's own per-attempt watchdogs cap at
 * 30s (on-device) + 60s (server fallback) = 90s worst case.
 */
const HELPER_TIMEOUT_MS = 120_000;

const KNOWN_ERROR_CODES = new Set([
  'authorization-denied',
  'recognizer-unavailable',
  'audio-unreadable',
  'recognition-failed',
  'bad-arguments',
]);

export interface VoiceTranscribeLocalSuccess {
  success: true;
  text: string;
  durationMs: number | null;
}

export interface VoiceTranscribeLocalFailure {
  success: false;
  error: { code: string; message: string };
}

/** SFSpeechRecognizer authorization statuses reported by the helper. */
export type OsSpeechAuthorizationStatus =
  | 'authorized'
  | 'denied'
  | 'restricted'
  | 'notDetermined';

const AUTHORIZATION_STATUSES = new Set<string>([
  'authorized',
  'denied',
  'restricted',
  'notDetermined',
]);

export interface VoiceRequestLocalAuthorizationSuccess {
  success: true;
  status: OsSpeechAuthorizationStatus;
}

/**
 * Where the helper binary may live. Packaged: mac extraResources. Dev: the
 * staging dir from build-speech-helper.cjs at the project root — the dev
 * launcher starts Electron with `dist/main/index.js`, so app.getAppPath()
 * is `<root>/dist/main` and the root sits two levels up (same resolution as
 * system.ipc.ts's CLI install path); the appPath-relative candidate covers
 * `electron .` launches where appPath IS the project root.
 */
function helperPathCandidates(): string[] {
  if (app.isPackaged) {
    return [path.join(process.resourcesPath, 'speech-helper', 'intent-speech-helper')];
  }
  return [
    path.join(app.getAppPath(), '..', '..', 'resources', 'speech-helper', 'intent-speech-helper'),
    path.join(app.getAppPath(), 'resources', 'speech-helper', 'intent-speech-helper'),
  ];
}

/** First existing candidate, or null when the helper is not built/bundled. */
async function resolveHelperPath(): Promise<string | null> {
  for (const candidate of helperPathCandidates()) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Not here — try the next candidate.
    }
  }
  return null;
}

const MIME_EXTENSIONS: ReadonlyArray<[RegExp, string]> = [
  [/audio\/wav|audio\/x-wav|audio\/wave/i, '.wav'],
  [/audio\/mp4|audio\/m4a|audio\/x-m4a|audio\/aac/i, '.m4a'],
  [/audio\/mpeg|audio\/mp3/i, '.mp3'],
  [/audio\/webm/i, '.webm'],
  [/audio\/ogg/i, '.ogg'],
];

function extensionForMime(mimeType: string): string {
  for (const [pattern, ext] of MIME_EXTENSIONS) {
    if (pattern.test(mimeType)) return ext;
  }
  return '.dat';
}

function runHelper(
  helperPath: string,
  args: string[],
): Promise<{ stdout: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    execFile(
      helperPath,
      args,
      { timeout: HELPER_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        if (error && typeof error.code !== 'number') {
          // Spawn failure or timeout kill — no parseable helper output.
          reject(error);
          return;
        }
        resolve({ stdout, exitCode: error && typeof error.code === 'number' ? error.code : 0 });
      },
    );
  });
}

export async function transcribeWithOsHelper(
  audioBase64: string,
  mimeType: string,
  contextualStrings?: string[],
): Promise<VoiceTranscribeLocalSuccess | VoiceTranscribeLocalFailure> {
  if (process.platform !== 'darwin') {
    return {
      success: false,
      error: { code: 'unsupported-platform', message: 'OS dictation requires macOS' },
    };
  }
  const helperPath = await resolveHelperPath();
  if (helperPath === null) {
    return {
      success: false,
      error: {
        code: 'helper-missing',
        message: `speech helper not found (checked ${helperPathCandidates().join(', ')})`,
      },
    };
  }

  const tempFile = path.join(
    os.tmpdir(),
    `intent-dictation-${Date.now()}-${Math.random().toString(36).slice(2)}${extensionForMime(mimeType)}`,
  );
  try {
    await fs.writeFile(tempFile, Buffer.from(audioBase64, 'base64'));
    const args = [tempFile];
    if (contextualStrings && contextualStrings.length > 0) {
      args.push('--contextual-strings', JSON.stringify(contextualStrings));
    }
    const { stdout, exitCode } = await runHelper(helperPath, args);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(stdout.trim());
    } catch {
      logger.error('speech helper produced unparseable output', { exitCode });
      return {
        success: false,
        error: { code: 'recognition-failed', message: 'speech helper produced no result' },
      };
    }
    if (exitCode !== 0 || typeof parsed.error === 'string') {
      const code = KNOWN_ERROR_CODES.has(parsed.error as string)
        ? (parsed.error as string)
        : 'recognition-failed';
      const message = typeof parsed.message === 'string' ? parsed.message : 'transcription failed';
      logger.warn('speech helper reported an error', { code, message });
      return { success: false, error: { code, message } };
    }
    return {
      success: true,
      text: typeof parsed.text === 'string' ? parsed.text : '',
      durationMs: typeof parsed.durationMs === 'number' ? parsed.durationMs : null,
    };
  } catch (error) {
    logger.error('speech helper invocation failed', { error });
    return {
      success: false,
      error: {
        code: 'recognition-failed',
        message: error instanceof Error ? error.message : 'speech helper invocation failed',
      },
    };
  } finally {
    await fs.unlink(tempFile).catch(() => undefined);
  }
}

/**
 * Spawn the helper in authorization-only mode: triggers the macOS speech
 * recognition TCC prompt (when not yet determined) and reports the resulting
 * status without touching any audio. Same platform/helper-missing guards as
 * the transcribe path.
 */
export async function requestOsSpeechAuthorization(): Promise<
  VoiceRequestLocalAuthorizationSuccess | VoiceTranscribeLocalFailure
> {
  if (process.platform !== 'darwin') {
    return {
      success: false,
      error: { code: 'unsupported-platform', message: 'OS dictation requires macOS' },
    };
  }
  const helperPath = await resolveHelperPath();
  if (helperPath === null) {
    return {
      success: false,
      error: {
        code: 'helper-missing',
        message: `speech helper not found (checked ${helperPathCandidates().join(', ')})`,
      },
    };
  }
  try {
    const { stdout, exitCode } = await runHelper(helperPath, ['--request-authorization']);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(stdout.trim());
    } catch {
      logger.error('speech helper produced unparseable authorization output', { exitCode });
      return {
        success: false,
        error: { code: 'authorization-failed', message: 'speech helper produced no status' },
      };
    }
    if (typeof parsed.status === 'string' && AUTHORIZATION_STATUSES.has(parsed.status)) {
      return { success: true, status: parsed.status as OsSpeechAuthorizationStatus };
    }
    logger.warn('speech helper reported an unknown authorization status', { parsed });
    return {
      success: false,
      error: { code: 'authorization-failed', message: 'unknown authorization status' },
    };
  } catch (error) {
    logger.error('speech helper authorization request failed', { error });
    return {
      success: false,
      error: {
        code: 'authorization-failed',
        message: error instanceof Error ? error.message : 'authorization request failed',
      },
    };
  }
}

/** Register the local transcription IPC handlers. */
export function registerVoiceLocalHandlers(): void {
  ipcMain.handle(
    VOICE_CHANNELS.LOCAL_AVAILABLE,
    createSafeValidatedHandler(
      VoiceLocalAvailableSchema,
      async () => ({
        success: true,
        available: process.platform === 'darwin' && (await resolveHelperPath()) !== null,
      }),
      VOICE_CHANNELS.LOCAL_AVAILABLE,
    ),
  );

  ipcMain.handle(
    VOICE_CHANNELS.TRANSCRIBE_LOCAL,
    createSafeValidatedHandler(
      VoiceTranscribeLocalSchema,
      async (_event, request) =>
        transcribeWithOsHelper(request.audioBase64, request.mimeType, request.contextualStrings),
      VOICE_CHANNELS.TRANSCRIBE_LOCAL,
    ),
  );

  ipcMain.handle(
    VOICE_CHANNELS.REQUEST_LOCAL_AUTHORIZATION,
    createSafeValidatedHandler(
      VoiceRequestLocalAuthorizationSchema,
      async () => requestOsSpeechAuthorization(),
      VOICE_CHANNELS.REQUEST_LOCAL_AUTHORIZATION,
    ),
  );
}
