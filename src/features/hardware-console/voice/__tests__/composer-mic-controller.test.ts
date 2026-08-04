/**
 * Composer mic latch controller: click-to-latch state machine on top of the
 * shared PTT session API — start/stop/cancel toggling, ownership vs the
 * hardware voice key (mutual exclusion with a hint), auto-stop staleness,
 * and unsupported-environment hinting.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { m } from '$shared/paraglide/messages.js';
import { PTT_MAX_RECORDING_MS } from '../voice-recorder';
import {
  handleVoiceKeyDown,
  isPttRecordingActive,
  PTT_MIN_RECORDING_MS,
  resetPttRecording,
  type PttContext,
} from '../ptt-controller';
import {
  cancelComposerMicRecording,
  isComposerMicRecording,
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

const types = (dispatched: { type: string }[]) => dispatched.map((action) => action.type);

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
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

describe('toggleComposerMicRecording', () => {
  it('click starts a session; a second click stops it into the finished seam', async () => {
    const { context, dispatched } = makeContext();
    expect(toggleComposerMicRecording(context)).toBe('started');
    expect(isComposerMicRecording()).toBe(true);
    await advance(PTT_MIN_RECORDING_MS);

    expect(toggleComposerMicRecording(context)).toBe('stopped');
    expect(types(dispatched)).toEqual([
      'hardwareConsole/pttRecordingStarted',
      'hardwareConsole/pttRecordingStopped',
      'hardwareConsole/pttRecordingFinished',
    ]);
    const finished = dispatched.find((a) => a.type === 'hardwareConsole/pttRecordingFinished');
    const payload = (finished?.payload as [{ stopReason: string; autoSend: boolean }])[0];
    expect(payload.stopReason).toBe('manual');
    expect(payload.autoSend).toBe(false);
    expect(isComposerMicRecording()).toBe(false);
  });

  it('is blocked with a hint while the hardware voice key owns the session', async () => {
    const hardware = makeContext();
    handleVoiceKeyDown(hardware.context);
    expect(isPttRecordingActive()).toBe(true);
    expect(isComposerMicRecording()).toBe(false);

    const { context, showHint } = makeContext();
    expect(toggleComposerMicRecording(context)).toBe('blocked');
    expect(showHint).toHaveBeenCalledWith(m.chat_richInput_micBusy_message());
    expect(isPttRecordingActive()).toBe(true);
  });

  it('is blocked with a hint when recording is unsupported', () => {
    vi.stubGlobal('navigator', {});
    const { context, showHint } = makeContext();
    expect(toggleComposerMicRecording(context)).toBe('blocked');
    expect(showHint).toHaveBeenCalledWith(m.hardwareConsole_ptt_unavailable_message());
  });

  it('auto-stop at the cap invalidates ownership; the next click starts fresh', async () => {
    const { context, dispatched } = makeContext();
    toggleComposerMicRecording(context);
    await advance(PTT_MAX_RECORDING_MS);
    expect(isPttRecordingActive()).toBe(false);
    expect(isComposerMicRecording()).toBe(false);

    expect(toggleComposerMicRecording(context)).toBe('started');
    expect(
      types(dispatched).filter((type) => type === 'hardwareConsole/pttRecordingStarted'),
    ).toHaveLength(2);
  });
});

describe('cancelComposerMicRecording', () => {
  it('discards the owned session without a finished seam (Esc)', async () => {
    const { context, dispatched } = makeContext();
    toggleComposerMicRecording(context);
    await advance(PTT_MIN_RECORDING_MS);
    expect(cancelComposerMicRecording(context)).toBe(true);
    expect(types(dispatched)).toEqual([
      'hardwareConsole/pttRecordingStarted',
      'hardwareConsole/pttRecordingStopped',
    ]);
    expect(isPttRecordingActive()).toBe(false);
    expect(isComposerMicRecording()).toBe(false);
  });

  it('leaves a hardware-owned session alone and reports false', () => {
    const hardware = makeContext();
    handleVoiceKeyDown(hardware.context);
    const { context } = makeContext();
    expect(cancelComposerMicRecording(context)).toBe(false);
    expect(isPttRecordingActive()).toBe(true);
  });

  it('is a no-op while idle', () => {
    const { context, dispatched } = makeContext();
    expect(cancelComposerMicRecording(context)).toBe(false);
    expect(dispatched).toHaveLength(0);
  });
});
