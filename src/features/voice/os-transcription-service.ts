/**
 * OS transcription engine seam — local macOS Speech.framework dictation via
 * the `voice:transcribe-local` IPC channel (voice-local.ipc.ts in the main
 * process) instead of the daemon's cloud `voice.transcribe`.
 *
 * The recorded blob (webm/opus from MediaRecorder) is converted to 16 kHz
 * mono WAV in the renderer (see utils/wav-encoder.ts) because AVFoundation
 * cannot read webm. Failures throw `OsTranscriptionError` with the main
 * process's typed error code so the transcription flow can surface targeted
 * messages (e.g. point at System Settings on authorization-denied).
 *
 * Dependency-light per src/store AGENTS.md: imports the generated invoke
 * seam and the WAV utility only.
 */
import { invoke } from '$shared/generated/ipc-client';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { arrayBufferToBase64, blobToWav } from './utils/wav-encoder';

export interface OsTranscribeResult {
  text: string;
  durationMs: number | null;
}

/** Typed failure from the OS engine; `code` mirrors voice-local.ipc.ts. */
export class OsTranscriptionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'OsTranscriptionError';
  }
}

interface VoiceLocalAvailableResponse {
  success: boolean;
  available?: boolean;
}

interface VoiceTranscribeLocalResponse {
  success: boolean;
  text?: string;
  durationMs?: number | null;
  error?: { code?: string; message?: string };
}

/** SFSpeechRecognizer authorization statuses (mirrors voice-local.ipc.ts). */
export type OsSpeechAuthorizationStatus =
  | 'authorized'
  | 'denied'
  | 'restricted'
  | 'notDetermined';

interface VoiceRequestLocalAuthorizationResponse {
  success: boolean;
  status?: OsSpeechAuthorizationStatus;
  error?: { code?: string; message?: string };
}

/** Whether the local OS engine can run (macOS host with the bundled helper). */
export async function isOsTranscriptionAvailable(): Promise<boolean> {
  try {
    const response = await invoke<VoiceLocalAvailableResponse>(
      IPC_CHANNELS.VOICE.LOCAL_AVAILABLE,
      {},
    );
    return response?.success === true && response.available === true;
  } catch {
    return false;
  }
}

/**
 * Request macOS speech-recognition authorization (the enable-time TCC
 * prompt). Resolves with the resulting status; throws `OsTranscriptionError`
 * with the main process's typed code when the request itself fails
 * (unsupported-platform, helper-missing, authorization-failed).
 */
export async function requestOsSpeechAuthorization(): Promise<OsSpeechAuthorizationStatus> {
  const response = await invoke<VoiceRequestLocalAuthorizationResponse>(
    IPC_CHANNELS.VOICE.REQUEST_LOCAL_AUTHORIZATION,
    {},
  );
  if (!response || response.success !== true || typeof response.status !== 'string') {
    throw new OsTranscriptionError(
      response?.error?.code ?? 'authorization-failed',
      response?.error?.message ?? 'speech authorization request failed',
    );
  }
  return response.status;
}

/**
 * Transcribe a finished dictation with the OS engine. Converts the blob to
 * WAV, ships it over IPC as base64, and returns the transcript. Vocabulary/
 * context keyterms are forwarded as SFSpeechRecognizer contextual strings.
 */
export async function transcribeWithOs(
  audio: Blob,
  contextualStrings?: string[],
): Promise<OsTranscribeResult> {
  let wav: ArrayBuffer;
  try {
    wav = await blobToWav(audio);
  } catch (error) {
    throw new OsTranscriptionError(
      'audio-unreadable',
      error instanceof Error ? error.message : 'failed to decode the recorded audio',
    );
  }
  const response = await invoke<VoiceTranscribeLocalResponse>(
    IPC_CHANNELS.VOICE.TRANSCRIBE_LOCAL,
    {
      audioBase64: arrayBufferToBase64(wav),
      mimeType: 'audio/wav',
      ...(contextualStrings && contextualStrings.length > 0 ? { contextualStrings } : {}),
    },
  );
  if (!response || response.success !== true) {
    throw new OsTranscriptionError(
      response?.error?.code ?? 'recognition-failed',
      response?.error?.message ?? 'OS transcription failed',
    );
  }
  return {
    text: typeof response.text === 'string' ? response.text : '',
    durationMs: typeof response.durationMs === 'number' ? response.durationMs : null,
  };
}
