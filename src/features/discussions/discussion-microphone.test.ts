import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ flow: vi.fn(), busy: vi.fn(() => false) }));
vi.mock('$features/hardware-console/voice/transcription-service', () => ({
  runTranscriptionFlow: mocks.flow,
}));
vi.mock('$features/hardware-console/voice/transcription-cancellation', () => ({
  hasActiveTranscriptionSession: mocks.busy,
}));
import { createDiscussionMicrophone } from './discussion-microphone';
import {
  isPttRecordingActive,
  resetPttRecording,
  PTT_MIN_RECORDING_MS,
} from '$features/hardware-console/voice/ptt-controller';
import { PTT_MAX_RECORDING_MS } from '$features/hardware-console/voice/voice-recorder';

const stopTrack = vi.fn();
class FakeMediaRecorder {
  static isTypeSupported() {
    return true;
  }
  readonly mimeType = 'audio/webm';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() {}
  stop() {
    this.ondataavailable?.({ data: new Blob(['audio']) });
    this.onstop?.();
  }
}
function microphone(isActive = () => true) {
  const context = { dispatch: vi.fn(), showHint: vi.fn() };
  const onTranscript = vi.fn();
  const onState = vi.fn();
  return {
    context,
    onTranscript,
    onState,
    controller: createDiscussionMicrophone({
      workspaceId: 'ws',
      context,
      onTranscript,
      onState,
      isActive,
    }),
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.busy.mockReturnValue(false);
  mocks.flow.mockResolvedValue(undefined);
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] })) },
  });
});
afterEach(() => {
  resetPttRecording();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('discussion microphone lifecycle', () => {
  it('transcribes a stopped recording once into its explicit draft target', async () => {
    const mic = microphone();
    mic.controller.toggle();
    await vi.advanceTimersByTimeAsync(PTT_MIN_RECORDING_MS);
    mic.controller.toggle();
    expect(mocks.flow).toHaveBeenCalledOnce();
    const [, { target }] = mocks.flow.mock.calls[0];
    expect(target.workspaceId).toBe('ws');
    target.insertText('hello');
    expect(mic.onTranscript).toHaveBeenCalledWith('hello');
    expect(
      mic.context.dispatch.mock.calls.some(
        ([action]) => action.type === 'hardwareConsole/pttRecordingFinished',
      ),
    ).toBe(false);
    expect(stopTrack).toHaveBeenCalled();
  });
  it('keeps the explicit draft destination when the recorder automatically stops', async () => {
    const mic = microphone();
    mic.controller.toggle();
    await vi.advanceTimersByTimeAsync(PTT_MAX_RECORDING_MS);
    expect(mocks.flow).toHaveBeenCalledOnce();
    expect(mocks.flow.mock.calls[0][1].target.workspaceId).toBe('ws');
    expect(isPttRecordingActive()).toBe(false);
  });
  it('cancels on teardown and leaves another composer recording alone', async () => {
    const first = microphone();
    const second = microphone();
    first.controller.toggle();
    await vi.advanceTimersByTimeAsync(PTT_MIN_RECORDING_MS);
    second.controller.toggle();
    expect(second.context.showHint).toHaveBeenCalled();
    second.controller.cancel();
    expect(isPttRecordingActive()).toBe(true);
    first.controller.cancel();
    expect(isPttRecordingActive()).toBe(false);
    expect(stopTrack).toHaveBeenCalled();
    expect(mocks.flow).not.toHaveBeenCalled();
  });
  it('cancels an in-flight transcript and invalidates its destination', async () => {
    const cancel = vi.fn();
    mocks.flow.mockImplementation((_recording, { target }) => {
      target.onStarted(cancel);
      return new Promise(() => {});
    });
    const mic = microphone();
    mic.controller.toggle();
    await vi.advanceTimersByTimeAsync(PTT_MIN_RECORDING_MS);
    mic.controller.toggle();
    const target = mocks.flow.mock.calls[0][1].target;
    mic.controller.cancel();
    expect(cancel).toHaveBeenCalledOnce();
    expect(target.isActive()).toBe(false);
    expect(mic.onState).toHaveBeenLastCalledWith('idle');
  });
  it('discards late transcription when its destination expires, even before component cleanup', async () => {
    let identity = 'captured';
    const mic = microphone(() => identity === 'captured');
    mic.controller.toggle();
    await vi.advanceTimersByTimeAsync(PTT_MIN_RECORDING_MS);
    mic.controller.toggle();
    const target = mocks.flow.mock.calls[0][1].target;
    identity = 'replacement';
    expect(target.isActive()).toBe(false);
    target.insertText('late result');
    expect(mic.onTranscript).not.toHaveBeenCalled();
    mic.controller.toggle();
    expect(isPttRecordingActive()).toBe(false);
  });
  it('does not start when recording is unavailable or transcription is busy', () => {
    const mic = microphone();
    mocks.busy.mockReturnValue(true);
    mic.controller.toggle();
    expect(isPttRecordingActive()).toBe(false);
    mocks.busy.mockReturnValue(false);
    vi.stubGlobal('navigator', {});
    mic.controller.toggle();
    expect(isPttRecordingActive()).toBe(false);
    expect(mic.context.showHint).toHaveBeenCalledTimes(2);
  });
});
