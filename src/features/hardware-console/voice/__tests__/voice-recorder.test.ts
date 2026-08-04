import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PTT_MAX_RECORDING_MS,
  VoiceRecorder,
  isVoiceRecordingSupported,
  pickRecorderMimeType,
  type VoiceRecordingResult,
} from '../voice-recorder';

/** Minimal MediaRecorder fake: capture handlers, manual stop/error firing. */
class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static supportedTypes: string[] = ['audio/webm;codecs=opus', 'audio/webm'];
  static isTypeSupported(type: string): boolean {
    return FakeMediaRecorder.supportedTypes.includes(type);
  }

  readonly mimeType: string;
  started = false;
  stopped = false;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(
    public stream: FakeMediaStream,
    options?: { mimeType?: string },
  ) {
    this.mimeType = options?.mimeType ?? 'audio/webm';
    FakeMediaRecorder.instances.push(this);
  }

  start(): void {
    this.started = true;
  }

  stop(): void {
    this.stopped = true;
    this.ondataavailable?.({ data: new Blob(['chunk'], { type: this.mimeType }) });
    this.onstop?.();
  }
}

class FakeMediaStreamTrack {
  stopped = false;
  stop(): void {
    this.stopped = true;
  }
}

class FakeMediaStream {
  tracks = [new FakeMediaStreamTrack()];
  getTracks(): FakeMediaStreamTrack[] {
    return this.tracks;
  }
}

let getUserMedia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  FakeMediaRecorder.instances = [];
  getUserMedia = vi.fn(async () => new FakeMediaStream());
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.stubGlobal(
    'BlobEvent',
    class {} as never,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function makeRecorder(overrides: { maxDurationMs?: number } = {}) {
  const onFinished = vi.fn<(result: VoiceRecordingResult) => void>();
  const onError = vi.fn();
  const recorder = new VoiceRecorder({ onFinished, onError, ...overrides });
  return { recorder, onFinished, onError };
}

describe('environment probes', () => {
  it('isVoiceRecordingSupported requires getUserMedia and MediaRecorder', () => {
    expect(isVoiceRecordingSupported()).toBe(true);
    vi.stubGlobal('navigator', {});
    expect(isVoiceRecordingSupported()).toBe(false);
  });

  it('pickRecorderMimeType prefers webm/opus', () => {
    expect(pickRecorderMimeType()).toBe('audio/webm;codecs=opus');
    FakeMediaRecorder.supportedTypes = ['audio/webm'];
    expect(pickRecorderMimeType()).toBe('audio/webm');
    FakeMediaRecorder.supportedTypes = [];
    expect(pickRecorderMimeType()).toBeUndefined();
    FakeMediaRecorder.supportedTypes = ['audio/webm;codecs=opus', 'audio/webm'];
  });
});

describe('VoiceRecorder lifecycle', () => {
  it('start → stop delivers one blob with duration and mime type', async () => {
    let now = 10_000;
    const onFinished = vi.fn<(result: VoiceRecordingResult) => void>();
    const onError = vi.fn();
    const recorder = new VoiceRecorder({ onFinished, onError, now: () => now });

    await expect(recorder.start()).resolves.toBe('recording');
    expect(recorder.state).toBe('recording');
    expect(FakeMediaRecorder.instances[0]?.started).toBe(true);

    now += 2_500;
    recorder.stop();
    expect(onFinished).toHaveBeenCalledTimes(1);
    const result = onFinished.mock.calls[0][0];
    expect(result.durationMs).toBe(2_500);
    expect(result.mimeType).toBe('audio/webm;codecs=opus');
    expect(result.blob.size).toBeGreaterThan(0);
    expect(onError).not.toHaveBeenCalled();
    expect(recorder.state).toBe('stopped');
  });

  it('releases the microphone tracks on stop', async () => {
    const { recorder } = makeRecorder();
    await recorder.start();
    const stream = FakeMediaRecorder.instances[0].stream;
    recorder.stop();
    expect(stream.tracks.every((track) => track.stopped)).toBe(true);
  });

  it('auto-stops at the max duration cap', async () => {
    vi.useFakeTimers();
    const { recorder, onFinished } = makeRecorder();
    await recorder.start();
    vi.advanceTimersByTime(PTT_MAX_RECORDING_MS - 1);
    expect(onFinished).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onFinished).toHaveBeenCalledTimes(1);
    expect(recorder.state).toBe('stopped');
  });

  it('honors a custom maxDurationMs', async () => {
    vi.useFakeTimers();
    const { recorder, onFinished } = makeRecorder({ maxDurationMs: 1_000 });
    await recorder.start();
    vi.advanceTimersByTime(1_000);
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it('a second start on the same instance is discarded', async () => {
    const { recorder } = makeRecorder();
    await expect(recorder.start()).resolves.toBe('recording');
    await expect(recorder.start()).resolves.toBe('discarded');
    expect(FakeMediaRecorder.instances).toHaveLength(1);
  });

  it('reports getUserMedia rejection via onError (permission denied)', async () => {
    const denied = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    getUserMedia.mockRejectedValueOnce(denied);
    const { recorder, onFinished, onError } = makeRecorder();
    await expect(recorder.start()).resolves.toBe('error');
    expect(onError).toHaveBeenCalledWith(denied);
    expect(onFinished).not.toHaveBeenCalled();
    expect(recorder.state).toBe('stopped');
  });

  it('stop during mic acquisition discards the session and releases the mic', async () => {
    let resolveMedia!: (stream: FakeMediaStream) => void;
    getUserMedia.mockReturnValueOnce(
      new Promise<FakeMediaStream>((resolve) => {
        resolveMedia = resolve;
      }),
    );
    const { recorder, onFinished, onError } = makeRecorder();
    const outcome = recorder.start();
    recorder.stop();
    const stream = new FakeMediaStream();
    resolveMedia(stream);
    await expect(outcome).resolves.toBe('discarded');
    expect(stream.tracks.every((track) => track.stopped)).toBe(true);
    expect(FakeMediaRecorder.instances).toHaveLength(0);
    expect(onFinished).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('stop during a getUserMedia rejection discards silently', async () => {
    let rejectMedia!: (error: unknown) => void;
    getUserMedia.mockReturnValueOnce(
      new Promise<FakeMediaStream>((_resolve, reject) => {
        rejectMedia = reject;
      }),
    );
    const { recorder, onError } = makeRecorder();
    const outcome = recorder.start();
    recorder.stop();
    rejectMedia(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
    await expect(outcome).resolves.toBe('discarded');
    expect(onError).not.toHaveBeenCalled();
  });

  it('cancel discards the captured audio and releases the mic', async () => {
    const { recorder, onFinished, onError } = makeRecorder();
    await recorder.start();
    const stream = FakeMediaRecorder.instances[0].stream;
    recorder.cancel();
    expect(onFinished).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(stream.tracks.every((track) => track.stopped)).toBe(true);
    expect(recorder.state).toBe('stopped');
  });

  it('recorder error mid-recording tears down and reports onError', async () => {
    const { recorder, onFinished, onError } = makeRecorder();
    await recorder.start();
    const fake = FakeMediaRecorder.instances[0];
    const failure = new Error('capture failed');
    fake.onerror?.({ error: failure });
    expect(onError).toHaveBeenCalledWith(failure);
    expect(onFinished).not.toHaveBeenCalled();
    expect(fake.stream.tracks.every((track) => track.stopped)).toBe(true);
    expect(recorder.state).toBe('stopped');
  });

  it('stop after stopped is a no-op', async () => {
    const { recorder, onFinished } = makeRecorder();
    await recorder.start();
    recorder.stop();
    recorder.stop();
    recorder.cancel();
    expect(onFinished).toHaveBeenCalledTimes(1);
  });
});
