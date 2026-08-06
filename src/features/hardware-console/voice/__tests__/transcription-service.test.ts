/**
 * Tests for the push-to-talk transcription flow (`voice.transcribe`,
 * PROTOCOL §5.41): context gathering off store state, the exact wire request
 * through the AppClient seam (channel + params), HUD lifecycle, composer
 * insertion (insert-for-review, never auto-send), and the error toasts
 * (no-key hint → Settings, provider failure).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCollection } from '$lib/store-shim/utils/collections/collection-utils';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { m } from '$shared/paraglide/messages.js';

interface MockVoiceState {
  workspace: { activeWorkspaceId: string | null; workspaces: ReturnType<typeof createCollection> };
  workspaceAgents: {
    byWorkspaceId: Record<
      string,
      { foregroundAgentIds: string[]; activeAgentId: string | null }
    >;
  };
  agentSessions: { byAgentId: Record<string, { name?: string }> };
  voiceSettings?: {
    engine?: string;
    vocabulary?: string[] | null;
    isLoading?: boolean;
    osEngineAvailable?: boolean;
    provider?: string;
    keyConfigured?: Record<string, boolean>;
  };
}

function baseState(): MockVoiceState {
  return {
    workspace: {
      activeWorkspaceId: 'ws-1',
      workspaces: createCollection('id', [
        { id: 'ws-1', title: 'Feature add', branch: 'feature-add' } as never,
      ]),
    },
    workspaceAgents: {
      byWorkspaceId: {
        'ws-1': { foregroundAgentIds: ['agent-a', 'agent-b'], activeAgentId: 'agent-a' },
      },
    },
    agentSessions: {
      byAgentId: { 'agent-a': { name: 'Coordinator' }, 'agent-b': { name: 'PTT hold action' } },
    },
  };
}

let mockState: MockVoiceState = baseState();
const dispatched: { type: string; payload?: unknown }[] = [];

vi.mock('$store/renderer/store', () => ({
  store: {
    get state() {
      return mockState;
    },
    dispatch: vi.fn((action: { type: string }) => {
      dispatched.push(action);
      return action;
    }),
  },
}));

const toastError = vi.fn();
vi.mock('svelte-sonner', () => ({ toast: { error: toastError, info: vi.fn() } }));

const transcribeWithOsMock = vi.fn();
vi.mock('$features/voice/os-transcription-service', async (importOriginal) => {
  const original = await importOriginal<typeof import('$features/voice/os-transcription-service')>();
  return {
    ...original,
    transcribeWithOs: (...args: unknown[]) =>
      (transcribeWithOsMock as (...a: unknown[]) => Promise<unknown>)(...args),
  };
});

const getWorkspaceVocabularyTermsMock = vi.fn<(workspaceId: string) => Promise<string[]>>(() =>
  Promise.resolve([]),
);
vi.mock('$features/voice/workspace-vocabulary-service', () => ({
  getWorkspaceVocabularyTerms: (workspaceId: string) =>
    getWorkspaceVocabularyTermsMock(workspaceId),
}));

import {
  actionHudHidden,
  actionHudShown,
  pttRecordingFinished,
  pttSendRequested,
  voiceTranscriptionFinished,
  voiceTranscriptionStarted,
} from '$store/renderer/slices/hardware-console/hardware-console-slice';
import {
  createVoiceTranscriptionMiddleware,
  gatherTranscriptionContext,
  handleFinishedRecording,
  mergeOsContextualStrings,
  resolveTargetAgentId,
  runTranscriptionFlow,
} from '../transcription-service';
import {
  clearPromptDictationTarget,
  hasPromptDictationTarget,
  setPromptDictationTarget,
} from '../prompt-dictation-target';
import {
  cancelActiveTranscription,
  hasActiveTranscriptionSession,
  resetTranscriptionCancellation,
} from '../transcription-cancellation';

/** [1,2,3] encodes to "AQID" in standard padded base64. */
const RECORDING = {
  blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' }),
  mimeType: 'audio/webm',
  durationMs: 1800,
};

/** `pttRecordingFinished` payload shape (recording + gesture outcome). */
const FINISHED_PAYLOAD = { ...RECORDING, stopReason: 'hold-release' as const, autoSend: false };

/** Daemon-canonical `voice.transcribe` result (PROTOCOL §5.41). */
const TRANSCRIBE_RESULT = {
  text: 'Bump the cloudlands-fe submodule and rerun clippy.',
  provider: 'elevenlabs' as const,
  durationMs: 3200,
};

beforeEach(() => {
  mockState = baseState();
  dispatched.length = 0;
  getWorkspaceVocabularyTermsMock.mockResolvedValue([]);
});

afterEach(() => {
  clearPromptDictationTarget();
  resetTranscriptionCancellation();
  document.body.innerHTML = '';
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Mount a `[role="dialog"]` overlay with a focused textarea (modal focus). */
function focusEditableInDialog(): HTMLTextAreaElement {
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  const textarea = document.createElement('textarea');
  dialog.appendChild(textarea);
  document.body.appendChild(dialog);
  textarea.focus();
  return textarea;
}

describe('gatherTranscriptionContext', () => {
  it('composes keyterms from workspace title, branch, and visible agent names', () => {
    const context = gatherTranscriptionContext(mockState as never);
    expect(context).toEqual({
      keyterms: ['Feature add', 'feature-add', 'Coordinator', 'PTT hold action'],
      prompt: 'Dictation in the "Feature add" workspace on branch feature-add.',
    });
  });

  it('dedupes keyterms case-insensitively and skips blank names', () => {
    mockState.agentSessions.byAgentId = {
      'agent-a': { name: 'FEATURE ADD' },
      'agent-b': { name: '  ' },
    };
    const context = gatherTranscriptionContext(mockState as never);
    expect(context?.keyterms).toEqual(['Feature add', 'feature-add']);
  });

  it('returns undefined without an active workspace (context omitted per §5.41)', () => {
    mockState.workspace.activeWorkspaceId = null;
    expect(gatherTranscriptionContext(mockState as never)).toBeUndefined();
  });
});

describe('mergeOsContextualStrings', () => {
  it('merges in the §5.41 parity order: vocabulary → workspace terms → keyterms', () => {
    expect(
      mergeOsContextualStrings(['intentd', 'clippy'], ['TOON', 'cloudlands-fe'], ['Feature add']),
    ).toEqual(['intentd', 'clippy', 'TOON', 'cloudlands-fe', 'Feature add']);
  });

  it('dedupes case-insensitively (first spelling wins) and drops blank terms', () => {
    expect(
      mergeOsContextualStrings(
        ['Cloudlands', '  ', 'intentd'],
        ['INTENTD', 'toon'],
        ['CLOUDLANDS', ' intentd ', 'TOON', 'x'],
      ),
    ).toEqual(['Cloudlands', 'intentd', 'toon', 'x']);
  });

  it('handles a null vocabulary, null workspace terms, and missing keyterms', () => {
    expect(mergeOsContextualStrings(null, null, ['a'])).toEqual(['a']);
    expect(mergeOsContextualStrings(['b'], undefined, undefined)).toEqual(['b']);
    expect(mergeOsContextualStrings(null, ['ws'], undefined)).toEqual(['ws']);
    expect(mergeOsContextualStrings(null, null, undefined)).toEqual([]);
  });
});

describe('resolveTargetAgentId', () => {
  it('resolves the active workspace active agent', () => {
    expect(resolveTargetAgentId(mockState as never)).toBe('agent-a');
  });

  it('is null without an active workspace', () => {
    mockState.workspace.activeWorkspaceId = null;
    expect(resolveTargetAgentId(mockState as never)).toBeNull();
  });
});

describe('handleFinishedRecording', () => {
  it('sends the exact §5.41 wire request through the AppClient seam and inserts the transcript', async () => {
    // Real LiveVoiceClient path: stub the electron bridge under the transport.
    const mockInvoke = vi.fn().mockResolvedValue({ ok: true, result: TRANSCRIBE_RESULT });
    vi.stubGlobal('window', { electronAPI: { invoke: mockInvoke, on: vi.fn(), offById: vi.fn() } });

    const focusComposer = vi.fn();
    const insertText = vi.fn().mockReturnValue(true);
    vi.useFakeTimers();
    const flow = handleFinishedRecording(RECORDING, { focusComposer, insertText });
    await vi.advanceTimersByTimeAsync(1000);
    await flow;

    expect(mockInvoke).toHaveBeenCalledWith(IPC_CHANNELS.BACKEND.REQUEST, {
      method: 'voice.transcribe',
      params: {
        audio: 'AQID',
        mimeType: 'audio/webm',
        context: {
          keyterms: ['Feature add', 'feature-add', 'Coordinator', 'PTT hold action'],
          prompt: 'Dictation in the "Feature add" workspace on branch feature-add.',
        },
        workspaceId: 'ws-1',
      },
      timeoutMs: 120_000,
    });
    expect(focusComposer).toHaveBeenCalledWith('agent-a');
    expect(insertText).toHaveBeenCalledWith(TRANSCRIBE_RESULT.text);
    expect(toastError).not.toHaveBeenCalled();
  });

  it('routes to the OS engine (context keyterms as contextual strings) when engine="os"', async () => {
    mockState.voiceSettings = { engine: 'os' };
    transcribeWithOsMock.mockResolvedValue({ text: 'local transcript', durationMs: 900 });
    const mockInvoke = vi.fn();
    vi.stubGlobal('window', { electronAPI: { invoke: mockInvoke, on: vi.fn(), offById: vi.fn() } });

    const focusComposer = vi.fn();
    const insertText = vi.fn().mockReturnValue(true);
    vi.useFakeTimers();
    const flow = handleFinishedRecording(RECORDING, { focusComposer, insertText });
    await vi.advanceTimersByTimeAsync(1000);
    await flow;

    expect(transcribeWithOsMock).toHaveBeenCalledWith(
      RECORDING.blob,
      ['Feature add', 'feature-add', 'Coordinator', 'PTT hold action'],
      undefined,
    );
    // The daemon wire path must not be touched by the OS engine.
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(insertText).toHaveBeenCalledWith('local transcript');
    expect(toastError).not.toHaveBeenCalled();
  });

  it('forwards the hydrated voice.language to the OS engine as the recognizer locale', async () => {
    mockState.voiceSettings = { engine: 'os', language: 'de' };
    transcribeWithOsMock.mockResolvedValue({ text: 'hallo welt', durationMs: 900 });
    vi.stubGlobal('window', { electronAPI: { invoke: vi.fn(), on: vi.fn(), offById: vi.fn() } });

    vi.useFakeTimers();
    const flow = handleFinishedRecording(RECORDING, {
      focusComposer: vi.fn(),
      insertText: vi.fn().mockReturnValue(true),
    });
    await vi.advanceTimersByTimeAsync(1000);
    await flow;

    expect(transcribeWithOsMock).toHaveBeenCalledWith(
      RECORDING.blob,
      expect.any(Array),
      'de',
    );
  });

  it('omits the OS engine locale when voice.language is blank or unset (system locale)', async () => {
    mockState.voiceSettings = { engine: 'os', language: '  ' };
    transcribeWithOsMock.mockResolvedValue({ text: 'ok', durationMs: 900 });
    vi.stubGlobal('window', { electronAPI: { invoke: vi.fn(), on: vi.fn(), offById: vi.fn() } });

    vi.useFakeTimers();
    const flow = handleFinishedRecording(RECORDING, {
      focusComposer: vi.fn(),
      insertText: vi.fn().mockReturnValue(true),
    });
    await vi.advanceTimersByTimeAsync(1000);
    await flow;

    expect(transcribeWithOsMock).toHaveBeenCalledWith(
      RECORDING.blob,
      expect.any(Array),
      undefined,
    );
  });

  it('biases the hydrated voice.vocabulary into the OS engine contextual strings (vocabulary first, deduped)', async () => {
    mockState.voiceSettings = {
      engine: 'os',
      vocabulary: ['intentd', 'Cloudlands', 'feature-add'],
    };
    transcribeWithOsMock.mockResolvedValue({ text: 'local transcript', durationMs: 900 });
    vi.stubGlobal('window', { electronAPI: { invoke: vi.fn(), on: vi.fn(), offById: vi.fn() } });

    vi.useFakeTimers();
    const flow = handleFinishedRecording(RECORDING, {
      focusComposer: vi.fn(),
      insertText: vi.fn().mockReturnValue(true),
    });
    await vi.advanceTimersByTimeAsync(1000);
    await flow;

    expect(transcribeWithOsMock).toHaveBeenCalledWith(
      RECORDING.blob,
      ['intentd', 'Cloudlands', 'feature-add', 'Feature add', 'Coordinator', 'PTT hold action'],
      undefined,
    );
  });

  it('merges the workspace vocabulary between user vocabulary and keyterms on the OS path (§5.41 parity)', async () => {
    mockState.voiceSettings = { engine: 'os', vocabulary: ['intentd'] };
    getWorkspaceVocabularyTermsMock.mockResolvedValue(['TOON', 'clippy', 'intentd']);
    transcribeWithOsMock.mockResolvedValue({ text: 'local transcript', durationMs: 900 });
    vi.stubGlobal('window', { electronAPI: { invoke: vi.fn(), on: vi.fn(), offById: vi.fn() } });

    vi.useFakeTimers();
    const flow = handleFinishedRecording(RECORDING, {
      focusComposer: vi.fn(),
      insertText: vi.fn().mockReturnValue(true),
    });
    await vi.advanceTimersByTimeAsync(1000);
    await flow;

    expect(getWorkspaceVocabularyTermsMock).toHaveBeenCalledWith('ws-1');
    expect(transcribeWithOsMock).toHaveBeenCalledWith(
      RECORDING.blob,
      // user vocabulary → workspace terms (deduped) → dynamic keyterms
      ['intentd', 'TOON', 'clippy', 'Feature add', 'feature-add', 'Coordinator', 'PTT hold action'],
      undefined,
    );
  });

  it('proceeds without workspace terms when the vocabulary fetch degrades to [] (resilient fallback)', async () => {
    mockState.voiceSettings = { engine: 'os', vocabulary: ['intentd'] };
    // The service seam folds fetch failures to [] — the flow never rejects.
    getWorkspaceVocabularyTermsMock.mockResolvedValue([]);
    transcribeWithOsMock.mockResolvedValue({ text: 'local transcript', durationMs: 900 });
    vi.stubGlobal('window', { electronAPI: { invoke: vi.fn(), on: vi.fn(), offById: vi.fn() } });

    const insertText = vi.fn().mockReturnValue(true);
    vi.useFakeTimers();
    const flow = handleFinishedRecording(RECORDING, { focusComposer: vi.fn(), insertText });
    await vi.advanceTimersByTimeAsync(1000);
    await flow;

    expect(transcribeWithOsMock).toHaveBeenCalledWith(
      RECORDING.blob,
      ['intentd', 'Feature add', 'feature-add', 'Coordinator', 'PTT hold action'],
      undefined,
    );
    expect(insertText).toHaveBeenCalledWith('local transcript');
    expect(toastError).not.toHaveBeenCalled();
  });

  it('skips the workspace vocabulary fetch without an active workspace', async () => {
    mockState.workspace.activeWorkspaceId = null;
    mockState.voiceSettings = { engine: 'os', vocabulary: ['intentd'] };
    transcribeWithOsMock.mockResolvedValue({ text: 'local transcript', durationMs: 900 });
    vi.stubGlobal('window', { electronAPI: { invoke: vi.fn(), on: vi.fn(), offById: vi.fn() } });

    vi.useFakeTimers();
    const flow = handleFinishedRecording(RECORDING, {
      focusComposer: vi.fn(),
      insertText: vi.fn().mockReturnValue(true),
    });
    await vi.advanceTimersByTimeAsync(1000);
    await flow;

    expect(getWorkspaceVocabularyTermsMock).not.toHaveBeenCalled();
    expect(transcribeWithOsMock).toHaveBeenCalledWith(RECORDING.blob, ['intentd'], undefined);
  });

  it('falls back to the OS engine when the daemon provider key is missing and OS is available', async () => {
    mockState.voiceSettings = {
      engine: 'daemon',
      isLoading: false,
      osEngineAvailable: true,
      provider: 'elevenlabs',
      keyConfigured: { elevenlabs: false, openai: false },
    };
    transcribeWithOsMock.mockResolvedValue({ text: 'fallback transcript', durationMs: 900 });
    const mockInvoke = vi.fn();
    vi.stubGlobal('window', { electronAPI: { invoke: mockInvoke, on: vi.fn(), offById: vi.fn() } });

    const insertText = vi.fn().mockReturnValue(true);
    vi.useFakeTimers();
    const flow = handleFinishedRecording(RECORDING, { focusComposer: vi.fn(), insertText });
    await vi.advanceTimersByTimeAsync(1000);
    await flow;

    // The daemon wire path must not be touched — the missing key would fail.
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(transcribeWithOsMock).toHaveBeenCalled();
    expect(insertText).toHaveBeenCalledWith('fallback transcript');
    expect(toastError).not.toHaveBeenCalled();
  });

  it('stays on the daemon when the selected provider key is configured (no OS detour)', async () => {
    mockState.voiceSettings = {
      engine: 'daemon',
      isLoading: false,
      osEngineAvailable: true,
      provider: 'elevenlabs',
      keyConfigured: { elevenlabs: true, openai: false },
    };
    const transcribe = vi.fn().mockResolvedValue(TRANSCRIBE_RESULT);
    const insertText = vi.fn().mockReturnValue(true);
    vi.useFakeTimers();
    const flow = handleFinishedRecording(RECORDING, {
      transcribe,
      focusComposer: vi.fn(),
      insertText,
    });
    await vi.advanceTimersByTimeAsync(1000);
    await flow;

    expect(transcribe).toHaveBeenCalled();
    expect(transcribeWithOsMock).not.toHaveBeenCalled();
  });

  it('surfaces helper-missing from the OS engine as the unavailable toast — never a silent cloud fallback', async () => {
    mockState.voiceSettings = { engine: 'os' };
    const { OsTranscriptionError } = await import('$features/voice/os-transcription-service');
    transcribeWithOsMock.mockRejectedValue(
      new OsTranscriptionError('helper-missing', 'speech helper not found'),
    );
    const mockInvoke = vi.fn();
    vi.stubGlobal('window', { electronAPI: { invoke: mockInvoke, on: vi.fn(), offById: vi.fn() } });

    vi.useFakeTimers();
    const flow = handleFinishedRecording(RECORDING, {
      focusComposer: vi.fn(),
      insertText: vi.fn().mockReturnValue(true),
    });
    await vi.advanceTimersByTimeAsync(1000);
    await flow;

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      m.hardwareConsole_voice_osUnavailable_error(),
      expect.objectContaining({
        description: 'speech helper not found',
        action: expect.objectContaining({
          label: m.hardwareConsole_voice_openSettings_label(),
        }),
      }),
    );
  });

  it('clears the transcribing state and surfaces a toast when the OS helper crashes (TCC SIGABRT regression)', async () => {
    // A TCC-killed helper reaches the renderer as a recognition-failed
    // OsTranscriptionError (voice-local.ipc.ts folds the signal exit into
    // the failure envelope). The flow must settle: HUD hidden, transcribing
    // flag reset, failure toast shown — never a stuck "Transcribing…".
    mockState.voiceSettings = { engine: 'os' };
    const { OsTranscriptionError } = await import('$features/voice/os-transcription-service');
    transcribeWithOsMock.mockRejectedValue(
      new OsTranscriptionError('recognition-failed', 'speech helper invocation failed'),
    );
    vi.stubGlobal('window', { electronAPI: { invoke: vi.fn(), on: vi.fn(), offById: vi.fn() } });

    vi.useFakeTimers();
    const flow = handleFinishedRecording(RECORDING, {
      focusComposer: vi.fn(),
      insertText: vi.fn().mockReturnValue(true),
    });
    await vi.advanceTimersByTimeAsync(1000);
    await flow;

    expect(dispatched.some((action) => action.type === voiceTranscriptionFinished.type)).toBe(
      true,
    );
    expect(dispatched.some((action) => action.type === actionHudHidden.type)).toBe(true);
    expect(toastError).toHaveBeenCalledWith(
      m.hardwareConsole_voice_transcribeFailed_error(),
      expect.objectContaining({ description: 'speech helper invocation failed' }),
    );
  });

  it('clears the transcribing state even when the post-transcription insertion throws', async () => {
    // The finally-backed settle: an unexpected throw after a successful
    // transcription (e.g. insertion machinery) must still reset the state.
    // No active workspace → the insertion runs synchronously, so its throw
    // propagates into the flow instead of a timer callback.
    mockState.workspace.activeWorkspaceId = null;
    const transcribe = vi.fn().mockResolvedValue(TRANSCRIBE_RESULT);
    const insertText = vi.fn(() => {
      throw new Error('boom');
    });
    await handleFinishedRecording(RECORDING, {
      transcribe,
      insertText,
      focusComposer: vi.fn(),
    });
    expect(dispatched.some((action) => action.type === voiceTranscriptionFinished.type)).toBe(
      true,
    );
    expect(dispatched.some((action) => action.type === actionHudHidden.type)).toBe(true);
    expect(toastError).toHaveBeenCalledWith(
      m.hardwareConsole_voice_transcribeFailed_error(),
      expect.objectContaining({ description: 'boom' }),
    );
  });

  it('surfaces authorization-denied from the OS engine as the System Settings toast', async () => {
    mockState.voiceSettings = { engine: 'os' };
    const { OsTranscriptionError } = await import('$features/voice/os-transcription-service');
    transcribeWithOsMock.mockRejectedValue(
      new OsTranscriptionError('authorization-denied', 'speech recognition authorization status: 1'),
    );
    vi.stubGlobal('window', { electronAPI: { invoke: vi.fn(), on: vi.fn(), offById: vi.fn() } });

    vi.useFakeTimers();
    const flow = handleFinishedRecording(RECORDING, {
      focusComposer: vi.fn(),
      insertText: vi.fn().mockReturnValue(true),
    });
    await vi.advanceTimersByTimeAsync(1000);
    await flow;

    expect(toastError).toHaveBeenCalledWith(
      m.hardwareConsole_voice_osAuthDenied_error(),
      expect.objectContaining({
        description: 'speech recognition authorization status: 1',
        action: expect.objectContaining({
          label: m.hardwareConsole_voice_openSettings_label(),
        }),
      }),
    );
  });

  it('shows the Transcribing… HUD while in flight and hides it after settle', async () => {
    const transcribe = vi.fn().mockResolvedValue(TRANSCRIBE_RESULT);
    const insertText = vi.fn().mockReturnValue(true);
    vi.useFakeTimers();
    const flow = handleFinishedRecording(RECORDING, {
      transcribe,
      insertText,
      focusComposer: vi.fn(),
    });
    expect(dispatched).toContainEqual(
      expect.objectContaining({
        type: actionHudShown.type,
        payload: [m.hardwareConsole_voice_transcribing_label()],
      }),
    );
    expect(dispatched.some((action) => action.type === voiceTranscriptionStarted.type)).toBe(true);
    expect(dispatched.some((action) => action.type === voiceTranscriptionFinished.type)).toBe(
      false,
    );
    await vi.advanceTimersByTimeAsync(1000);
    await flow;
    expect(dispatched.some((action) => action.type === actionHudHidden.type)).toBe(true);
    expect(dispatched.some((action) => action.type === voiceTranscriptionFinished.type)).toBe(
      true,
    );
  });

  it('surfaces the structured no-API-key error (data.code, PROTOCOL §5.41 v4.4+) as a Settings hint toast', async () => {
    const transcribe = vi.fn().mockRejectedValue(
      Object.assign(new Error('Internal error'), {
        data: {
          code: 'voice-no-api-key',
          detail:
            'voice: no API key found for elevenlabs (set voice.elevenlabs.apiKey or ELEVENLABS_API_KEY)',
        },
      }),
    );
    await handleFinishedRecording(RECORDING, {
      transcribe,
      insertText: vi.fn(),
      focusComposer: vi.fn(),
    });
    expect(toastError).toHaveBeenCalledWith(
      m.hardwareConsole_voice_noKey_error(),
      expect.objectContaining({
        description:
          'voice: no API key found for elevenlabs (set voice.elevenlabs.apiKey or ELEVENLABS_API_KEY)',
      }),
    );
    expect(dispatched.some((action) => action.type === actionHudHidden.type)).toBe(true);
    expect(dispatched.some((action) => action.type === voiceTranscriptionFinished.type)).toBe(
      true,
    );
  });

  it('surfaces the plain-string no-API-key error (older daemons) via the message sniff fallback', async () => {
    const transcribe = vi.fn().mockRejectedValue(
      Object.assign(new Error('Internal error'), {
        data: 'voice: no API key found for elevenlabs (set voice.elevenlabs.apiKey or ELEVENLABS_API_KEY)',
      }),
    );
    await handleFinishedRecording(RECORDING, {
      transcribe,
      insertText: vi.fn(),
      focusComposer: vi.fn(),
    });
    expect(toastError).toHaveBeenCalledWith(
      m.hardwareConsole_voice_noKey_error(),
      expect.objectContaining({ description: expect.stringMatching(/no API key/) }),
    );
    expect(dispatched.some((action) => action.type === actionHudHidden.type)).toBe(true);
    expect(dispatched.some((action) => action.type === voiceTranscriptionFinished.type)).toBe(
      true,
    );
  });

  it('does not show the no-key toast for a structured error with a different data.code', async () => {
    const transcribe = vi.fn().mockRejectedValue(
      Object.assign(new Error('Invalid params'), {
        data: { code: 'invalid-params', detail: 'audio must be non-empty base64' },
      }),
    );
    await handleFinishedRecording(RECORDING, {
      transcribe,
      insertText: vi.fn(),
      focusComposer: vi.fn(),
    });
    expect(toastError).toHaveBeenCalledWith(
      m.hardwareConsole_voice_transcribeFailed_error(),
      expect.objectContaining({ description: 'audio must be non-empty base64' }),
    );
  });

  it('surfaces provider failures as an error toast with the daemon detail', async () => {
    const transcribe = vi.fn().mockRejectedValue(
      Object.assign(new Error('Internal error'), {
        data: 'elevenlabs returned 401 Unauthorized: invalid key',
      }),
    );
    await handleFinishedRecording(RECORDING, {
      transcribe,
      insertText: vi.fn(),
      focusComposer: vi.fn(),
    });
    expect(toastError).toHaveBeenCalledWith(
      m.hardwareConsole_voice_transcribeFailed_error(),
      expect.objectContaining({ description: 'elevenlabs returned 401 Unauthorized: invalid key' }),
    );
  });

  it('retries insertion after composer focus and toasts (with the text) when it never lands', async () => {
    const transcribe = vi.fn().mockResolvedValue(TRANSCRIBE_RESULT);
    const insertText = vi.fn().mockReturnValue(false);
    vi.useFakeTimers();
    const flow = handleFinishedRecording(RECORDING, {
      transcribe,
      insertText,
      focusComposer: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(1000);
    await flow;
    expect(insertText).toHaveBeenCalledTimes(2);
    expect(toastError).toHaveBeenCalledWith(
      m.hardwareConsole_voice_insertFailed_error(),
      expect.objectContaining({ description: TRANSCRIBE_RESULT.text }),
    );
  });

  it('skips insertion for an empty transcript', async () => {
    const transcribe = vi.fn().mockResolvedValue({ ...TRANSCRIBE_RESULT, text: '  ' });
    const insertText = vi.fn();
    await handleFinishedRecording(RECORDING, {
      transcribe,
      insertText,
      focusComposer: vi.fn(),
    });
    expect(insertText).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('with autoSend, triggers the composer send after a successful insertion', async () => {
    const transcribe = vi.fn().mockResolvedValue(TRANSCRIBE_RESULT);
    const insertText = vi.fn().mockReturnValue(true);
    const sendComposer = vi.fn().mockReturnValue(true);
    vi.useFakeTimers();
    const flow = handleFinishedRecording(
      RECORDING,
      { transcribe, insertText, sendComposer, focusComposer: vi.fn() },
      { autoSend: true },
    );
    await vi.advanceTimersByTimeAsync(1000);
    await flow;
    expect(insertText).toHaveBeenCalledWith(TRANSCRIBE_RESULT.text);
    expect(sendComposer).toHaveBeenCalledTimes(1);
  });

  it('without autoSend, never triggers the composer send', async () => {
    const transcribe = vi.fn().mockResolvedValue(TRANSCRIBE_RESULT);
    const sendComposer = vi.fn();
    vi.useFakeTimers();
    const flow = handleFinishedRecording(RECORDING, {
      transcribe,
      insertText: vi.fn().mockReturnValue(true),
      sendComposer,
      focusComposer: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(1000);
    await flow;
    expect(sendComposer).not.toHaveBeenCalled();
  });

  it('with autoSend, does not send when insertion never lands (transcript preserved in toast)', async () => {
    const transcribe = vi.fn().mockResolvedValue(TRANSCRIBE_RESULT);
    const sendComposer = vi.fn();
    vi.useFakeTimers();
    const flow = handleFinishedRecording(
      RECORDING,
      { transcribe, insertText: vi.fn().mockReturnValue(false), sendComposer, focusComposer: vi.fn() },
      { autoSend: true },
    );
    await vi.advanceTimersByTimeAsync(1000);
    await flow;
    expect(sendComposer).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      m.hardwareConsole_voice_insertFailed_error(),
      expect.objectContaining({ description: TRANSCRIBE_RESULT.text }),
    );
  });
});

describe('handleFinishedRecording with a prompt dictation target', () => {
  it('routes the transcript into the prompt editor, not the agent composer', async () => {
    const transcribe = vi.fn().mockResolvedValue(TRANSCRIBE_RESULT);
    const insertText = vi.fn().mockReturnValue(true);
    const focusComposer = vi.fn();
    const promptFocus = vi.fn();
    setPromptDictationTarget({ focus: promptFocus });

    vi.useFakeTimers();
    const flow = handleFinishedRecording(RECORDING, { transcribe, insertText, focusComposer });
    await vi.advanceTimersByTimeAsync(1000);
    await flow;

    // The agent-composer focus path is never touched; the prompt's editor
    // is focused and receives the caret insertion instead.
    expect(focusComposer).not.toHaveBeenCalled();
    expect(promptFocus).toHaveBeenCalled();
    expect(insertText).toHaveBeenCalledWith(TRANSCRIBE_RESULT.text);
    expect(toastError).not.toHaveBeenCalled();
  });

  it('consumes the target (one-shot): the next dictation routes to the composer again', async () => {
    const transcribe = vi.fn().mockResolvedValue(TRANSCRIBE_RESULT);
    const insertText = vi.fn().mockReturnValue(true);
    const focusComposer = vi.fn();
    setPromptDictationTarget({ focus: vi.fn() });

    vi.useFakeTimers();
    let flow = handleFinishedRecording(RECORDING, { transcribe, insertText, focusComposer });
    await vi.advanceTimersByTimeAsync(1000);
    await flow;
    expect(hasPromptDictationTarget()).toBe(false);

    flow = handleFinishedRecording(RECORDING, { transcribe, insertText, focusComposer });
    await vi.advanceTimersByTimeAsync(1000);
    await flow;
    expect(focusComposer).toHaveBeenCalledWith('agent-a');
  });

  it('never auto-sends into a prompt target (workspace creation is explicit)', async () => {
    const transcribe = vi.fn().mockResolvedValue(TRANSCRIBE_RESULT);
    const insertText = vi.fn().mockReturnValue(true);
    const sendComposer = vi.fn();
    setPromptDictationTarget({ focus: vi.fn() });

    vi.useFakeTimers();
    const flow = handleFinishedRecording(
      RECORDING,
      { transcribe, insertText, sendComposer, focusComposer: vi.fn() },
      { autoSend: true },
    );
    await vi.advanceTimersByTimeAsync(1000);
    await flow;
    expect(insertText).toHaveBeenCalledWith(TRANSCRIBE_RESULT.text);
    expect(sendComposer).not.toHaveBeenCalled();
  });

  it('toasts (with the text) when the prompt insertion never lands', async () => {
    const transcribe = vi.fn().mockResolvedValue(TRANSCRIBE_RESULT);
    const insertText = vi.fn().mockReturnValue(false);
    const promptFocus = vi.fn();
    setPromptDictationTarget({ focus: promptFocus });

    vi.useFakeTimers();
    const flow = handleFinishedRecording(RECORDING, {
      transcribe,
      insertText,
      focusComposer: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(1000);
    await flow;
    expect(insertText).toHaveBeenCalledTimes(2);
    expect(toastError).toHaveBeenCalledWith(
      m.hardwareConsole_voice_insertFailed_error(),
      expect.objectContaining({ description: TRANSCRIBE_RESULT.text }),
    );
  });
});

describe('handleFinishedRecording with focus inside a modal dialog', () => {
  // Regression for intent-hq/monorepo#1461: dictating with the New Space
  // modal open must land in the modal's editor, never steal focus into the
  // chat composer behind it.
  it('inserts at the focused editable without focusing the agent composer', async () => {
    focusEditableInDialog();
    const transcribe = vi.fn().mockResolvedValue(TRANSCRIBE_RESULT);
    const insertText = vi.fn().mockReturnValue(true);
    const focusComposer = vi.fn();

    vi.useFakeTimers();
    const flow = handleFinishedRecording(RECORDING, { transcribe, insertText, focusComposer });
    await vi.advanceTimersByTimeAsync(1000);
    await flow;

    expect(focusComposer).not.toHaveBeenCalled();
    expect(insertText).toHaveBeenCalledWith(TRANSCRIBE_RESULT.text);
    expect(toastError).not.toHaveBeenCalled();
  });

  it('captures the dialog focus synchronously at recording-finish time', async () => {
    // Focus is inside the dialog when the recording finishes but moves away
    // before the transcription resolves — the routing decision must stick.
    focusEditableInDialog();
    let resolve!: (value: { text: string }) => void;
    const transcribe = vi.fn().mockReturnValue(
      new Promise<{ text: string }>((res) => {
        resolve = res;
      }),
    );
    const insertText = vi.fn().mockReturnValue(true);
    const focusComposer = vi.fn();

    vi.useFakeTimers();
    const flow = handleFinishedRecording(RECORDING, { transcribe, insertText, focusComposer });
    document.body.innerHTML = '';
    resolve(TRANSCRIBE_RESULT);
    await vi.advanceTimersByTimeAsync(1000);
    await flow;

    expect(focusComposer).not.toHaveBeenCalled();
    expect(insertText).toHaveBeenCalledWith(TRANSCRIBE_RESULT.text);
  });

  it('suppresses autoSend (a synthetic Enter must not submit the modal form)', async () => {
    focusEditableInDialog();
    const transcribe = vi.fn().mockResolvedValue(TRANSCRIBE_RESULT);
    const insertText = vi.fn().mockReturnValue(true);
    const sendComposer = vi.fn();

    vi.useFakeTimers();
    const flow = handleFinishedRecording(
      RECORDING,
      { transcribe, insertText, sendComposer, focusComposer: vi.fn() },
      { autoSend: true },
    );
    await vi.advanceTimersByTimeAsync(1000);
    await flow;

    expect(insertText).toHaveBeenCalledWith(TRANSCRIBE_RESULT.text);
    expect(sendComposer).not.toHaveBeenCalled();
  });

  it('suppresses the empty-transcript autoSend send as well', async () => {
    focusEditableInDialog();
    const transcribe = vi.fn().mockResolvedValue({ ...TRANSCRIBE_RESULT, text: '  ' });
    const sendComposer = vi.fn().mockReturnValue(true);

    vi.useFakeTimers();
    const flow = handleFinishedRecording(
      RECORDING,
      { transcribe, insertText: vi.fn(), sendComposer, focusComposer: vi.fn() },
      { autoSend: true },
    );
    await vi.advanceTimersByTimeAsync(1000);
    await flow;

    expect(sendComposer).not.toHaveBeenCalled();
  });

  it('a registered prompt dictation target still wins over the dialog focus', async () => {
    focusEditableInDialog();
    const transcribe = vi.fn().mockResolvedValue(TRANSCRIBE_RESULT);
    const insertText = vi.fn().mockReturnValue(true);
    const promptFocus = vi.fn();
    setPromptDictationTarget({ focus: promptFocus });

    vi.useFakeTimers();
    const flow = handleFinishedRecording(RECORDING, {
      transcribe,
      insertText,
      focusComposer: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(1000);
    await flow;

    expect(promptFocus).toHaveBeenCalled();
    expect(insertText).toHaveBeenCalledWith(TRANSCRIBE_RESULT.text);
  });

  it('keeps the agent-composer routing when focus is outside any dialog', async () => {
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();
    const transcribe = vi.fn().mockResolvedValue(TRANSCRIBE_RESULT);
    const insertText = vi.fn().mockReturnValue(true);
    const focusComposer = vi.fn();
    const sendComposer = vi.fn().mockReturnValue(true);

    vi.useFakeTimers();
    const flow = handleFinishedRecording(
      RECORDING,
      { transcribe, insertText, focusComposer, sendComposer },
      { autoSend: true },
    );
    await vi.advanceTimersByTimeAsync(1000);
    await flow;

    expect(focusComposer).toHaveBeenCalledWith('agent-a');
    expect(insertText).toHaveBeenCalledWith(TRANSCRIBE_RESULT.text);
    expect(sendComposer).toHaveBeenCalledTimes(1);
  });
});

describe('cancelActiveTranscription during an in-flight transcription', () => {
  /** A transcribe seam that stays pending until the test resolves/rejects it. */
  function deferredTranscribe() {
    let resolve!: (value: { text: string }) => void;
    let reject!: (error: unknown) => void;
    const transcribe = vi.fn().mockReturnValue(
      new Promise<{ text: string }>((res, rej) => {
        resolve = res;
        reject = rej;
      }),
    );
    return { transcribe, resolve: (value: { text: string }) => resolve(value), reject: (error: unknown) => reject(error) };
  }

  it('clears the transcribing state immediately and discards the late result', async () => {
    const { transcribe, resolve } = deferredTranscribe();
    const insertText = vi.fn().mockReturnValue(true);
    vi.useFakeTimers();
    const flow = handleFinishedRecording(RECORDING, {
      transcribe,
      insertText,
      focusComposer: vi.fn(),
    });
    expect(hasActiveTranscriptionSession()).toBe(true);
    expect(dispatched.some((action) => action.type === voiceTranscriptionStarted.type)).toBe(true);

    // Cancel while the RPC is hung: the in-flight state settles right away
    // (spinner returns to idle, a new recording can start) …
    expect(cancelActiveTranscription()).toBe(true);
    expect(hasActiveTranscriptionSession()).toBe(false);
    expect(dispatched.some((action) => action.type === voiceTranscriptionFinished.type)).toBe(
      true,
    );
    expect(dispatched.some((action) => action.type === actionHudHidden.type)).toBe(true);

    // … and the eventually-arriving result is DISCARDED, never inserted.
    resolve(TRANSCRIBE_RESULT);
    await vi.advanceTimersByTimeAsync(1000);
    await flow;
    expect(insertText).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('discards a late transcript from a cancelled session even for a prompt target', async () => {
    const { transcribe, resolve } = deferredTranscribe();
    const insertText = vi.fn().mockReturnValue(true);
    const promptFocus = vi.fn();
    setPromptDictationTarget({ focus: promptFocus });
    vi.useFakeTimers();
    const flow = handleFinishedRecording(RECORDING, {
      transcribe,
      insertText,
      focusComposer: vi.fn(),
    });
    expect(cancelActiveTranscription()).toBe(true);
    resolve(TRANSCRIBE_RESULT);
    await vi.advanceTimersByTimeAsync(1000);
    await flow;
    expect(promptFocus).not.toHaveBeenCalled();
    expect(insertText).not.toHaveBeenCalled();
  });

  it('swallows a late failure from a cancelled session (no error toast)', async () => {
    const { transcribe, reject } = deferredTranscribe();
    vi.useFakeTimers();
    const flow = handleFinishedRecording(RECORDING, {
      transcribe,
      insertText: vi.fn(),
      focusComposer: vi.fn(),
    });
    expect(cancelActiveTranscription()).toBe(true);
    reject(new Error('provider timed out'));
    await vi.advanceTimersByTimeAsync(1000);
    await flow;
    expect(toastError).not.toHaveBeenCalled();
    // The cancel already settled the state; the late failure adds nothing.
    expect(
      dispatched.filter((action) => action.type === voiceTranscriptionFinished.type),
    ).toHaveLength(1);
  });

  it('a superseding dictation is unaffected by the cancelled session\u2019s late result', async () => {
    const first = deferredTranscribe();
    const insertText = vi.fn().mockReturnValue(true);
    vi.useFakeTimers();
    const firstFlow = handleFinishedRecording(RECORDING, {
      transcribe: first.transcribe,
      insertText,
      focusComposer: vi.fn(),
    });
    expect(cancelActiveTranscription()).toBe(true);

    // A new dictation starts and completes normally …
    const second = vi.fn().mockResolvedValue({ ...TRANSCRIBE_RESULT, text: 'second dictation' });
    const secondFlow = handleFinishedRecording(RECORDING, {
      transcribe: second,
      insertText,
      focusComposer: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(1000);
    await secondFlow;
    expect(insertText).toHaveBeenCalledWith('second dictation');

    // … while the cancelled session's late result is still discarded.
    first.resolve(TRANSCRIBE_RESULT);
    await vi.advanceTimersByTimeAsync(1000);
    await firstFlow;
    expect(insertText).not.toHaveBeenCalledWith(TRANSCRIBE_RESULT.text);
  });

  it('returns false when nothing is in flight', () => {
    expect(hasActiveTranscriptionSession()).toBe(false);
    expect(cancelActiveTranscription()).toBe(false);
  });
});

describe('runTranscriptionFlow', () => {
  it('without a recording and with autoSend, sends the composer content as-is', async () => {
    const transcribe = vi.fn();
    const sendComposer = vi.fn().mockReturnValue(true);
    const focusComposer = vi.fn();
    vi.useFakeTimers();
    const flow = runTranscriptionFlow(null, { autoSend: true }, {
      transcribe,
      sendComposer,
      focusComposer,
    });
    await vi.advanceTimersByTimeAsync(1000);
    await flow;
    expect(transcribe).not.toHaveBeenCalled();
    expect(focusComposer).toHaveBeenCalledWith('agent-a');
    expect(sendComposer).toHaveBeenCalled();
  });

  it('without a recording and with autoSend, suppresses the send when focus is inside a dialog', async () => {
    // Regression for the intent-hq/monorepo#1461 follow-up: a send gesture
    // with no transcribable audio must not focus/send the chat composer
    // behind a focused modal dialog — the send is simply suppressed.
    focusEditableInDialog();
    const sendComposer = vi.fn().mockReturnValue(true);
    const focusComposer = vi.fn();
    vi.useFakeTimers();
    const flow = runTranscriptionFlow(null, { autoSend: true }, {
      sendComposer,
      focusComposer,
    });
    await vi.advanceTimersByTimeAsync(1000);
    await flow;
    expect(focusComposer).not.toHaveBeenCalled();
    expect(sendComposer).not.toHaveBeenCalled();
  });

  it('without a recording and without autoSend, does nothing', async () => {
    const transcribe = vi.fn();
    const sendComposer = vi.fn();
    await runTranscriptionFlow(null, {}, { transcribe, sendComposer, focusComposer: vi.fn() });
    expect(transcribe).not.toHaveBeenCalled();
    expect(sendComposer).not.toHaveBeenCalled();
  });

  it('with a recording, runs the full transcribe → insert flow (autoSend carried through)', async () => {
    const transcribe = vi.fn().mockResolvedValue(TRANSCRIBE_RESULT);
    const insertText = vi.fn().mockReturnValue(true);
    const sendComposer = vi.fn().mockReturnValue(true);
    vi.useFakeTimers();
    const flow = runTranscriptionFlow(RECORDING, { autoSend: true }, {
      transcribe,
      insertText,
      sendComposer,
      focusComposer: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(1000);
    await flow;
    expect(insertText).toHaveBeenCalledWith(TRANSCRIBE_RESULT.text);
    expect(sendComposer).toHaveBeenCalledTimes(1);
  });
});

describe('createVoiceTranscriptionMiddleware', () => {
  it('runs the flow for voiceRecordingFinished and passes other actions through', async () => {
    const transcribe = vi.fn().mockResolvedValue(TRANSCRIBE_RESULT);
    const insertText = vi.fn().mockReturnValue(true);
    const middleware = createVoiceTranscriptionMiddleware({
      transcribe,
      insertText,
      focusComposer: vi.fn(),
    });
    const next = vi.fn((action: unknown) => action);
    const invoke = middleware(undefined as never)(next);

    const unrelated = { type: 'other/action' };
    expect(invoke(unrelated as never)).toBe(unrelated);
    expect(transcribe).not.toHaveBeenCalled();

    invoke(pttRecordingFinished(FINISHED_PAYLOAD) as never);
    expect(next).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(transcribe).toHaveBeenCalledWith(
      RECORDING.blob,
      RECORDING.mimeType,
      expect.objectContaining({ keyterms: expect.arrayContaining(['Feature add']) }),
      'ws-1',
    ));
  });

  it('carries the payload autoSend flag through to the flow', async () => {
    const transcribe = vi.fn().mockResolvedValue(TRANSCRIBE_RESULT);
    const sendComposer = vi.fn().mockReturnValue(true);
    const middleware = createVoiceTranscriptionMiddleware({
      transcribe,
      insertText: vi.fn().mockReturnValue(true),
      sendComposer,
      focusComposer: vi.fn(),
    });
    const invoke = middleware(undefined as never)((action: unknown) => action);
    invoke(
      pttRecordingFinished({
        ...RECORDING,
        stopReason: 'double-hold-release',
        autoSend: true,
      }) as never,
    );
    await vi.waitFor(() => expect(sendComposer).toHaveBeenCalled());
  });

  it('sends the composer as-is on pttSendRequested (no transcription)', async () => {
    const transcribe = vi.fn();
    const sendComposer = vi.fn().mockReturnValue(true);
    const focusComposer = vi.fn();
    const middleware = createVoiceTranscriptionMiddleware({
      transcribe,
      sendComposer,
      focusComposer,
    });
    vi.useFakeTimers();
    const invoke = middleware(undefined as never)((action: unknown) => action);
    invoke(pttSendRequested() as never);
    await vi.advanceTimersByTimeAsync(1000);
    expect(transcribe).not.toHaveBeenCalled();
    expect(focusComposer).toHaveBeenCalledWith('agent-a');
    expect(sendComposer).toHaveBeenCalled();
  });
});
