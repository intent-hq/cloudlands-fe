import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { m } from '$shared/paraglide/messages.js';
import { PTT_MAX_RECORDING_MS } from '../voice-recorder';
import { VOICE_DOUBLE_PRESS_WINDOW_MS, VOICE_HOLD_THRESHOLD_MS } from '../gesture-decoder';
import {
  cancelPttRecording,
  handleVoiceKeyDown,
  handleVoiceKeyUp,
  isPttRecordingActive,
  PTT_MIN_RECORDING_MS,
  resetPttRecording,
  startPttRecording,
  stopPttRecording,
  type PttContext,
} from '../ptt-controller';

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported(): boolean {
    return true;
  }

  readonly mimeType = 'audio/webm;codecs=opus';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(public stream: FakeMediaStream) {
    FakeMediaRecorder.instances.push(this);
  }

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

let getUserMedia: ReturnType<typeof vi.fn>;

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
  FakeMediaRecorder.instances = [];
  getUserMedia = vi.fn(async () => new FakeMediaStream());
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
});

afterEach(() => {
  resetPttRecording();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Let the controller's recorder.start() promise settle (fake-timer safe). */
const settle = () => vi.advanceTimersByTimeAsync(0);

/** Advance both the decoder timers and the recorder's Date.now clock. */
const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

const finishedPayload = (dispatched: { type: string; payload?: unknown }[]) => {
  const action = dispatched.find((a) => a.type === 'hardwareConsole/pttRecordingFinished');
  return (action?.payload as [Record<string, unknown>] | undefined)?.[0];
};

describe('voice-key gestures (controller-integrated)', () => {
  it('press & hold: first keydown starts recording, release delivers the finished seam', async () => {
    const { context, dispatched } = makeContext();
    handleVoiceKeyDown(context);
    expect(types(dispatched)).toEqual(['hardwareConsole/pttRecordingStarted']);
    expect(isPttRecordingActive()).toBe(true);
    await advance(VOICE_HOLD_THRESHOLD_MS);

    handleVoiceKeyUp(context);
    expect(types(dispatched)).toEqual([
      'hardwareConsole/pttRecordingStarted',
      'hardwareConsole/pttRecordingStopped',
      'hardwareConsole/pttRecordingFinished',
    ]);
    const finished = finishedPayload(dispatched) as {
      blob: Blob;
      mimeType: string;
      stopReason: string;
      autoSend: boolean;
    };
    expect(finished.blob.size).toBeGreaterThan(0);
    expect(finished.mimeType).toBe('audio/webm;codecs=opus');
    expect(finished.stopReason).toBe('hold-release');
    expect(finished.autoSend).toBe(false);
    expect(isPttRecordingActive()).toBe(false);
  });

  it('tap latches: recording continues after release; a later tap stops it', async () => {
    const { context, dispatched } = makeContext();
    handleVoiceKeyDown(context);
    await advance(50);
    handleVoiceKeyUp(context);
    await advance(VOICE_DOUBLE_PRESS_WINDOW_MS + PTT_MIN_RECORDING_MS);
    expect(isPttRecordingActive()).toBe(true);

    handleVoiceKeyDown(context);
    await advance(50);
    handleVoiceKeyUp(context);
    await advance(VOICE_DOUBLE_PRESS_WINDOW_MS);
    const finished = finishedPayload(dispatched) as { stopReason: string; autoSend: boolean };
    expect(finished.stopReason).toBe('latch-stop');
    expect(finished.autoSend).toBe(false);
    expect(isPttRecordingActive()).toBe(false);
  });

  it('double press while latched stops with autoSend', async () => {
    const { context, dispatched } = makeContext();
    handleVoiceKeyDown(context);
    await advance(50);
    handleVoiceKeyUp(context);
    await advance(VOICE_DOUBLE_PRESS_WINDOW_MS + PTT_MIN_RECORDING_MS);

    handleVoiceKeyDown(context);
    await advance(20);
    handleVoiceKeyUp(context);
    await advance(20);
    handleVoiceKeyDown(context);
    await advance(20);
    handleVoiceKeyUp(context);
    const finished = finishedPayload(dispatched) as { stopReason: string; autoSend: boolean };
    expect(finished.stopReason).toBe('double-press');
    expect(finished.autoSend).toBe(true);
    expect(types(dispatched)).not.toContain('hardwareConsole/pttSendRequested');
  });

  it('double press while idle sends the composer as-is (short audio discarded)', async () => {
    const { context, dispatched } = makeContext();
    handleVoiceKeyDown(context);
    await advance(20);
    handleVoiceKeyUp(context);
    await advance(20);
    handleVoiceKeyDown(context);
    await advance(20);
    handleVoiceKeyUp(context);
    expect(types(dispatched)).toEqual([
      'hardwareConsole/pttRecordingStarted',
      'hardwareConsole/pttRecordingStopped',
      'hardwareConsole/pttSendRequested',
    ]);
    expect(isPttRecordingActive()).toBe(false);
  });

  it('double press & hold records through the second press and sends on release', async () => {
    const { context, dispatched } = makeContext();
    handleVoiceKeyDown(context);
    await advance(50);
    handleVoiceKeyUp(context);
    await advance(50);
    handleVoiceKeyDown(context);
    await advance(VOICE_HOLD_THRESHOLD_MS + PTT_MIN_RECORDING_MS);
    handleVoiceKeyUp(context);
    const finished = finishedPayload(dispatched) as { stopReason: string; autoSend: boolean };
    expect(finished.stopReason).toBe('double-hold-release');
    expect(finished.autoSend).toBe(true);
  });

  it('linked Codex Mic pair: duplicate keydown/keyup collapse to one gesture', async () => {
    const { context, dispatched } = makeContext();
    handleVoiceKeyDown(context);
    handleVoiceKeyDown(context);
    await advance(VOICE_HOLD_THRESHOLD_MS);
    handleVoiceKeyUp(context);
    expect(isPttRecordingActive()).toBe(true);
    handleVoiceKeyUp(context);
    expect(FakeMediaRecorder.instances).toHaveLength(1);
    expect(
      types(dispatched).filter((type) => type === 'hardwareConsole/pttRecordingFinished'),
    ).toHaveLength(1);
  });

  it('the max-duration auto-stop mid-latch finishes with auto-stop and resets the gesture', async () => {
    const { context, dispatched } = makeContext();
    handleVoiceKeyDown(context);
    await advance(50);
    handleVoiceKeyUp(context);
    await advance(PTT_MAX_RECORDING_MS);
    const finished = finishedPayload(dispatched) as { stopReason: string; autoSend: boolean };
    expect(finished.stopReason).toBe('auto-stop');
    expect(finished.autoSend).toBe(false);
    // The abandoned latch gesture is reset: the next press starts fresh.
    handleVoiceKeyDown(context);
    expect(
      types(dispatched).filter((type) => type === 'hardwareConsole/pttRecordingStarted'),
    ).toHaveLength(2);
  });
});

describe('recording session (trigger-agnostic API)', () => {
  it('start/stop finishes with a manual outcome', async () => {
    const { context, dispatched } = makeContext();
    startPttRecording(context);
    await advance(PTT_MIN_RECORDING_MS);
    stopPttRecording();
    const finished = finishedPayload(dispatched) as { stopReason: string; autoSend: boolean };
    expect(finished.stopReason).toBe('manual');
    expect(finished.autoSend).toBe(false);
    expect(isPttRecordingActive()).toBe(false);
  });

  it('a second start while a session is live is a no-op', async () => {
    const { context, dispatched } = makeContext();
    startPttRecording(context);
    startPttRecording(context);
    await settle();
    startPttRecording(context);
    expect(types(dispatched)).toEqual(['hardwareConsole/pttRecordingStarted']);
    expect(FakeMediaRecorder.instances).toHaveLength(1);
  });

  it('audio shorter than the minimum duration is discarded without a finished seam', async () => {
    const { context, dispatched } = makeContext();
    startPttRecording(context);
    await advance(PTT_MIN_RECORDING_MS - 1);
    stopPttRecording();
    expect(types(dispatched)).toEqual([
      'hardwareConsole/pttRecordingStarted',
      'hardwareConsole/pttRecordingStopped',
    ]);
  });

  it('stop racing the mic acquisition discards the session cleanly', async () => {
    let resolveMedia!: (stream: FakeMediaStream) => void;
    getUserMedia.mockReturnValueOnce(
      new Promise<FakeMediaStream>((resolve) => {
        resolveMedia = resolve;
      }),
    );
    const { context, dispatched } = makeContext();
    startPttRecording(context);
    stopPttRecording();
    resolveMedia(new FakeMediaStream());
    await settle();
    expect(types(dispatched)).toEqual([
      'hardwareConsole/pttRecordingStarted',
      'hardwareConsole/pttRecordingStopped',
    ]);
    expect(isPttRecordingActive()).toBe(false);
  });

  it('a send gesture racing the mic acquisition still fires the send', async () => {
    let resolveMedia!: (stream: FakeMediaStream) => void;
    getUserMedia.mockReturnValueOnce(
      new Promise<FakeMediaStream>((resolve) => {
        resolveMedia = resolve;
      }),
    );
    const { context, dispatched } = makeContext();
    handleVoiceKeyDown(context);
    handleVoiceKeyUp(context);
    handleVoiceKeyDown(context);
    handleVoiceKeyUp(context);
    resolveMedia(new FakeMediaStream());
    await settle();
    expect(types(dispatched)).toEqual([
      'hardwareConsole/pttRecordingStarted',
      'hardwareConsole/pttRecordingStopped',
      'hardwareConsole/pttSendRequested',
    ]);
  });

  it('permission denial stops the indicator and hints mic access denied', async () => {
    getUserMedia.mockRejectedValueOnce(
      Object.assign(new Error('denied'), { name: 'NotAllowedError' }),
    );
    const { context, dispatched, showHint } = makeContext();
    handleVoiceKeyDown(context);
    await settle();
    expect(types(dispatched)).toEqual([
      'hardwareConsole/pttRecordingStarted',
      'hardwareConsole/pttRecordingStopped',
    ]);
    expect(showHint).toHaveBeenCalledWith(m.hardwareConsole_ptt_micDenied_message());
    expect(isPttRecordingActive()).toBe(false);
  });

  it('other acquisition failures hint the generic recording-failed message', async () => {
    getUserMedia.mockRejectedValueOnce(
      Object.assign(new Error('no mic'), { name: 'NotFoundError' }),
    );
    const { context, showHint } = makeContext();
    handleVoiceKeyDown(context);
    await settle();
    expect(showHint).toHaveBeenCalledWith(m.hardwareConsole_ptt_recordingFailed_message());
  });

  it('cancel (device disconnect mid-hold) discards without a finished seam', async () => {
    const { context, dispatched } = makeContext();
    handleVoiceKeyDown(context);
    await settle();
    cancelPttRecording(context);
    expect(types(dispatched)).toEqual([
      'hardwareConsole/pttRecordingStarted',
      'hardwareConsole/pttRecordingStopped',
    ]);
    expect(isPttRecordingActive()).toBe(false);
    // The gesture state is gone too: a lingering keyup is ignored.
    handleVoiceKeyUp(context);
    expect(types(dispatched)).toHaveLength(2);
  });

  it('cancel with no live session is a no-op', () => {
    const { context, dispatched } = makeContext();
    cancelPttRecording(context);
    stopPttRecording();
    expect(dispatched).toHaveLength(0);
  });

  it('a new session can start after the previous one finished', async () => {
    const { context, dispatched } = makeContext();
    startPttRecording(context);
    await advance(PTT_MIN_RECORDING_MS);
    stopPttRecording();
    startPttRecording(context);
    await advance(PTT_MIN_RECORDING_MS);
    stopPttRecording();
    expect(
      types(dispatched).filter((type) => type === 'hardwareConsole/pttRecordingFinished'),
    ).toHaveLength(2);
  });
});
