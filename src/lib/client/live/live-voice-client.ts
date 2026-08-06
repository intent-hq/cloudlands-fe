/**
 * Live voice domain backed by the intentd daemon (`voice.transcribe`,
 * PROTOCOL §5.41).
 *
 * Daemon-owned speech-to-text: the recorded audio Blob is base64-encoded
 * (standard alphabet, padded — the daemon decodes it verbatim) and shipped
 * with its container MIME type plus optional domain-vocabulary context
 * (`prompt` / `keyterms`) and, since v5.1, an optional `workspaceId` that
 * opts the call into workspace-vocabulary injection. Errors are NOT
 * folded: the transcription flow surfaces them as toasts (no-key hint,
 * provider failure).
 */
import type {
  AppClient,
  VoiceClient,
  VoiceTranscribeContext,
  VoiceTranscribeResult,
  VoiceWorkspaceVocabularyResult,
} from '../app-client';
import { backendRequest } from './backend-transport';

/**
 * Transcription can legitimately take longer than the flat 30s transport
 * default (large recordings, slow providers), so give the daemon's own
 * provider round-trip room to produce a structured result or error.
 */
export const VOICE_TRANSCRIBE_TIMEOUT_MS = 120_000;

/** Read a Blob's bytes; falls back to FileReader where `Blob.arrayBuffer`
 * is unavailable (jsdom). */
function readBlobBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error('Blob read failed'));
    reader.readAsArrayBuffer(blob);
  });
}

/** Base64-encode a Blob (standard alphabet, padded), chunked to keep the
 * argument list of `String.fromCharCode` bounded on large recordings. */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await readBlobBytes(blob));
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export class LiveVoiceClient implements VoiceClient {
  async transcribe(
    audio: Blob,
    mimeType: string,
    context?: VoiceTranscribeContext,
    workspaceId?: string,
  ): Promise<VoiceTranscribeResult> {
    const params: Record<string, unknown> = {
      audio: await blobToBase64(audio),
      mimeType,
    };
    // Omit `context` entirely when the caller gathered nothing — the request
    // should mirror the documented shape (§5.41: context? is optional).
    if (context && (context.prompt !== undefined || context.keyterms !== undefined)) {
      params.context = context;
    }
    // Omit `workspaceId` when absent/blank (incl. whitespace-only) — §5.41:
    // workspaceId? is optional opt-in workspace-vocabulary injection (v5.1).
    if (typeof workspaceId === 'string' && workspaceId.trim().length > 0) {
      params.workspaceId = workspaceId;
    }
    return backendRequest<VoiceTranscribeResult>('voice.transcribe', params, {
      timeoutMs: VOICE_TRANSCRIBE_TIMEOUT_MS,
    });
  }

  async getWorkspaceVocabulary(workspaceId: string): Promise<VoiceWorkspaceVocabularyResult> {
    return backendRequest<VoiceWorkspaceVocabularyResult>('voice.getWorkspaceVocabulary', {
      workspaceId,
    });
  }
}

// Tied to AppClient["voice"] so the seam composition catches drift in CI.
const _interfaceCheck: AppClient['voice'] | undefined = undefined as LiveVoiceClient | undefined;
void _interfaceCheck;
