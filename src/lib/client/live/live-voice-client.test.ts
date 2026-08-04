/**
 * Wire-contract tests for the live voice domain (`voice.transcribe`,
 * PROTOCOL §5.41).
 *
 * Asserts (a) the exact JSON-RPC request the client emits — base64-encoded
 * `audio` (standard alphabet, padded), the container `mimeType`, `context`
 * present only when the caller gathered hints — and (b) the daemon-shaped
 * result passes through untransformed. Errors are NOT folded: the
 * transcription flow surfaces them as toasts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./backend-transport', () => ({
  backendRequest: vi.fn(),
  backendSubscribe: vi.fn(() => Promise.resolve({ subscriptionId: 'sub-1' })),
  backendUnsubscribe: vi.fn(() => Promise.resolve()),
  onBackendNotification: vi.fn(() => () => {}),
}));

import { backendRequest } from './backend-transport';
import { blobToBase64, LiveVoiceClient, VOICE_TRANSCRIBE_TIMEOUT_MS } from './live-voice-client';

const mockedRequest = vi.mocked(backendRequest);

/** Daemon-canonical `voice.transcribe` result shape (PROTOCOL §5.41). */
const TRANSCRIBE_RESULT = {
  text: 'Bump the cloudlands-fe submodule and rerun clippy.',
  provider: 'elevenlabs' as const,
  durationMs: 3200,
};

/** [1,2,3] encodes to "AQID" in standard padded base64. */
const AUDIO_BLOB = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' });

describe('LiveVoiceClient (fake transport)', () => {
  afterEach(() => vi.clearAllMocks());

  it('transcribe forwards voice.transcribe with base64 audio + mimeType', async () => {
    mockedRequest.mockResolvedValueOnce(TRANSCRIBE_RESULT);
    const client = new LiveVoiceClient();

    const result = await client.transcribe(AUDIO_BLOB, 'audio/webm');

    expect(mockedRequest).toHaveBeenCalledWith(
      'voice.transcribe',
      { audio: 'AQID', mimeType: 'audio/webm' },
      { timeoutMs: VOICE_TRANSCRIBE_TIMEOUT_MS },
    );
    expect(result).toEqual(TRANSCRIBE_RESULT);
  });

  it('transcribe omits context entirely when none is provided (§5.41 optional shape)', async () => {
    mockedRequest.mockResolvedValueOnce(TRANSCRIBE_RESULT);
    const client = new LiveVoiceClient();

    await client.transcribe(AUDIO_BLOB, 'audio/webm');
    await client.transcribe(AUDIO_BLOB, 'audio/webm', {});

    for (const call of mockedRequest.mock.calls) {
      const params = call[1] as Record<string, unknown>;
      expect('context' in params).toBe(false);
    }
  });

  it('transcribe forwards context.keyterms and context.prompt when gathered', async () => {
    mockedRequest.mockResolvedValueOnce(TRANSCRIBE_RESULT);
    const client = new LiveVoiceClient();

    await client.transcribe(AUDIO_BLOB, 'audio/webm', {
      keyterms: ['cloudlands-fe', 'submodule', 'clippy'],
      prompt: 'Dictation in the "Feature add" workspace on branch feature-add.',
    });

    expect(mockedRequest).toHaveBeenCalledWith(
      'voice.transcribe',
      {
        audio: 'AQID',
        mimeType: 'audio/webm',
        context: {
          keyterms: ['cloudlands-fe', 'submodule', 'clippy'],
          prompt: 'Dictation in the "Feature add" workspace on branch feature-add.',
        },
      },
      { timeoutMs: VOICE_TRANSCRIBE_TIMEOUT_MS },
    );
  });

  it('passes a null durationMs result through untransformed (always-present contract)', async () => {
    const nullDuration = { ...TRANSCRIBE_RESULT, provider: 'openai' as const, durationMs: null };
    mockedRequest.mockResolvedValueOnce(nullDuration);
    const client = new LiveVoiceClient();

    const result = await client.transcribe(AUDIO_BLOB, 'audio/wav');

    expect(result).toEqual(nullDuration);
  });

  it('propagates transport/daemon errors (the flow surfaces them as toasts)', async () => {
    mockedRequest.mockRejectedValueOnce(
      new Error('voice: no API key found for elevenlabs (set voice.elevenlabs.apiKey or ELEVENLABS_API_KEY)'),
    );
    const client = new LiveVoiceClient();

    await expect(client.transcribe(AUDIO_BLOB, 'audio/webm')).rejects.toThrow(/no API key/);
  });

  it('blobToBase64 produces standard padded base64 across chunk boundaries', async () => {
    // 100_000 bytes exercises the 0x8000 chunking path.
    const bytes = new Uint8Array(100_000).map((_, i) => i % 251);
    const encoded = await blobToBase64(new Blob([bytes]));
    const decoded = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
    expect(decoded).toEqual(bytes);
    expect(encoded).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  });
});
