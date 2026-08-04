/**
 * Wire-contract test for the composer mic latch flow: a latch stop's
 * `pttRecordingFinished` runs through the transcription middleware and must
 * send the exact `voice.transcribe` request (PROTOCOL §5.41) on the backend
 * channel, then insert the §5.41-shaped mock transcript into the composer.
 * Follows the ipc-mock-router suite pattern (assert the exact request, feed
 * a contract-shaped response back); the transport under `voice.transcribe`
 * is the backend bridge, so the stub sits on its `invoke` boundary.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCollection } from '$lib/store-shim/utils/collections/collection-utils';
import { IPC_CHANNELS } from '$shared/ipc-registry';

const mockState = {
  workspace: {
    activeWorkspaceId: 'ws-1',
    workspaces: createCollection('id', [
      { id: 'ws-1', title: 'Feature add', branch: 'feature-add' } as never,
    ]),
  },
  workspaceAgents: {
    byWorkspaceId: { 'ws-1': { foregroundAgentIds: ['agent-a'], activeAgentId: 'agent-a' } },
  },
  agentSessions: { byAgentId: { 'agent-a': { name: 'Coordinator' } } },
};

vi.mock('$store/renderer/store', () => ({
  store: {
    get state() {
      return mockState;
    },
    dispatch: vi.fn((action: { type: string }) => action),
  },
}));
vi.mock('svelte-sonner', () => ({ toast: { error: vi.fn(), info: vi.fn() } }));

import { voiceTranscriptionStarted } from '$store/renderer/slices/hardware-console/hardware-console-slice';
import { createVoiceTranscriptionMiddleware } from '../transcription-service';
import { resetPttRecording, PTT_MIN_RECORDING_MS, type PttContext } from '../ptt-controller';
import {
  resetComposerMic,
  toggleComposerMicRecording,
} from '../composer-mic-controller';

class FakeMediaRecorder {
  static isTypeSupported(): boolean {
    return true;
  }

  readonly mimeType = 'audio/webm;codecs=opus';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(public stream: FakeMediaStream) {}

  start(): void {}

  stop(): void {
    // [1,2,3] encodes to "AQID" in standard padded base64.
    this.ondataavailable?.({
      data: new Blob([new Uint8Array([1, 2, 3])], { type: this.mimeType }),
    });
    this.onstop?.();
  }
}

class FakeMediaStream {
  tracks = [{ stopped: false, stop(): void { this.stopped = true; } }];
  getTracks() {
    return this.tracks;
  }
}

/** Daemon-canonical `voice.transcribe` result (PROTOCOL §5.41). */
const TRANSCRIBE_RESULT = {
  text: 'Bump the cloudlands-fe submodule.',
  provider: 'elevenlabs' as const,
  durationMs: 900,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: vi.fn(async () => new FakeMediaStream()) },
  });
});

afterEach(() => {
  resetComposerMic();
  resetPttRecording();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('composer mic latch → voice.transcribe wire contract', () => {
  it('latch stop sends the exact §5.41 request and inserts the mock transcript', async () => {
    const mockInvoke = vi.fn().mockResolvedValue({ ok: true, result: TRANSCRIBE_RESULT });
    vi.stubGlobal('window', {
      electronAPI: { invoke: mockInvoke, on: vi.fn(), offById: vi.fn() },
    });

    const focusComposer = vi.fn();
    const insertText = vi.fn().mockReturnValue(true);
    const seen: { type: string }[] = [];
    const middleware = createVoiceTranscriptionMiddleware({
      focusComposer,
      insertText,
      dispatch: (action) => seen.push(action as { type: string }),
    });
    const invoke = middleware(undefined as never)((action: unknown) => action);
    // The composer wires its dispatch straight into the store's middleware
    // chain; the test context mirrors that so latch actions reach the flow.
    const context: PttContext = {
      dispatch: (action) => invoke(action as never),
      showHint: vi.fn(),
    };

    expect(toggleComposerMicRecording(context)).toBe('started');
    await vi.advanceTimersByTimeAsync(PTT_MIN_RECORDING_MS);
    expect(toggleComposerMicRecording(context)).toBe('stopped');
    await vi.advanceTimersByTimeAsync(1000);

    expect(mockInvoke).toHaveBeenCalledWith(IPC_CHANNELS.BACKEND.REQUEST, {
      method: 'voice.transcribe',
      params: {
        audio: 'AQID',
        mimeType: 'audio/webm;codecs=opus',
        context: {
          keyterms: ['Feature add', 'feature-add', 'Coordinator'],
          prompt: 'Dictation in the "Feature add" workspace on branch feature-add.',
        },
      },
      timeoutMs: 120_000,
    });
    // Transcript lands via the insertion seam (caret semantics live in
    // transcript-insertion.ts) — never a composer replace.
    expect(focusComposer).toHaveBeenCalledWith('agent-a');
    expect(insertText).toHaveBeenCalledWith(TRANSCRIBE_RESULT.text);
    // The in-flight flag drove the button's transcribing state.
    expect(seen.some((action) => action.type === voiceTranscriptionStarted.type)).toBe(true);
  });
});
