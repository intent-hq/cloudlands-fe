/**
 * Prompt mic latch controller: the workspace-creation prompt's
 * click-to-latch dictation on top of the shared PTT session API — the
 * dictation-target registration lifecycle (stop registers, Esc clears, a
 * later session never sees a stale target), ownership vs other triggers,
 * and unsupported-environment hinting.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { m } from '$shared/paraglide/messages.js';
import {
  handleVoiceKeyDown,
  isPttRecordingActive,
  PTT_MIN_RECORDING_MS,
  resetPttRecording,
  startPttRecording,
  type PttContext,
} from '../ptt-controller';
import {
  cancelPromptMicRecording,
  isPromptMicRecording,
  resetPromptMic,
  togglePromptMicRecording,
} from '../prompt-mic-controller';
import { hasPromptDictationTarget, setPromptDictationTarget } from '../prompt-dictation-target';

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
    this.ondataavailable?.({ data: new Blob(['chunk'], { type: this.mimeType }) });
    this.onstop?.();
  }
}

class FakeMediaStream {
  tracks = [{ stopped: false, stop(): void { this.stopped = true; } }];
  getTracks() {
    return this.tracks;
  }
}

function makeContext() {
  const dispatched: { type: string; payload?: unknown }[] = [];
  const showHint = vi.fn();
  const context: PttContext = {
    dispatch: (action) => {
      dispatched.push(action as { type: string; payload?: unknown });
      return action;
    },
    showHint,
  };
  return { context, dispatched, showHint };
}

const TARGET = { focus: vi.fn() };

const types = (dispatched: { type: string }[]) => dispatched.map((action) => action.type);

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: vi.fn(async () => new FakeMediaStream()) },
  });
});

afterEach(() => {
  resetPromptMic();
  resetPttRecording();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

describe('togglePromptMicRecording', () => {
  it('click starts a session; the stop click registers the target and finishes', async () => {
    const { context, dispatched } = makeContext();
    expect(togglePromptMicRecording(context, TARGET)).toBe('started');
    expect(isPromptMicRecording()).toBe(true);
    expect(hasPromptDictationTarget()).toBe(false);
    await advance(PTT_MIN_RECORDING_MS);

    expect(togglePromptMicRecording(context, TARGET)).toBe('stopped');
    expect(hasPromptDictationTarget()).toBe(true);
    expect(types(dispatched)).toEqual([
      'hardwareConsole/pttRecordingStarted',
      'hardwareConsole/pttRecordingStopped',
      'hardwareConsole/pttRecordingFinished',
    ]);
    expect(isPromptMicRecording()).toBe(false);
  });

  it('is blocked with a hint while another trigger owns the session', () => {
    const hardware = makeContext();
    handleVoiceKeyDown(hardware.context);
    expect(isPttRecordingActive()).toBe(true);
    expect(isPromptMicRecording()).toBe(false);

    const { context, showHint } = makeContext();
    expect(togglePromptMicRecording(context, TARGET)).toBe('blocked');
    expect(showHint).toHaveBeenCalledWith(m.chat_richInput_micBusy_message());
    expect(hasPromptDictationTarget()).toBe(false);
  });

  it('is blocked with a hint when recording is unsupported', () => {
    vi.stubGlobal('navigator', {});
    const { context, showHint } = makeContext();
    expect(togglePromptMicRecording(context, TARGET)).toBe('blocked');
    expect(showHint).toHaveBeenCalledWith(m.hardwareConsole_ptt_unavailable_message());
  });
});

describe('cancelPromptMicRecording', () => {
  it('discards the owned session and drops the registered target (Esc)', async () => {
    const { context, dispatched } = makeContext();
    togglePromptMicRecording(context, TARGET);
    setPromptDictationTarget(TARGET);
    await advance(PTT_MIN_RECORDING_MS);
    expect(cancelPromptMicRecording(context)).toBe(true);
    expect(hasPromptDictationTarget()).toBe(false);
    expect(types(dispatched)).toEqual([
      'hardwareConsole/pttRecordingStarted',
      'hardwareConsole/pttRecordingStopped',
    ]);
    expect(isPttRecordingActive()).toBe(false);
  });

  it('leaves a session owned by another trigger alone and reports false', () => {
    const hardware = makeContext();
    handleVoiceKeyDown(hardware.context);
    const { context } = makeContext();
    expect(cancelPromptMicRecording(context)).toBe(false);
    expect(isPttRecordingActive()).toBe(true);
  });

  it('is a no-op while idle', () => {
    const { context, dispatched } = makeContext();
    expect(cancelPromptMicRecording(context)).toBe(false);
    expect(dispatched).toHaveLength(0);
  });
});

describe('stale target hygiene', () => {
  it('a leftover target is cleared when the next session starts', async () => {
    // A too-short recording fires no pttRecordingFinished, so a target
    // registered at its stop is never consumed. The next session start
    // must clear it so a later transcript cannot land in the prompt.
    const { context } = makeContext();
    togglePromptMicRecording(context, TARGET);
    togglePromptMicRecording(context, TARGET); // < PTT_MIN_RECORDING_MS
    await advance(PTT_MIN_RECORDING_MS);
    expect(hasPromptDictationTarget()).toBe(true);

    startPttRecording(context);
    expect(hasPromptDictationTarget()).toBe(false);
  });
});
