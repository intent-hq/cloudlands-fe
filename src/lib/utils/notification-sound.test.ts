/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { playNotificationSound, setNotificationSoundPath } from './notification-sound';
import { readLocalNotificationSound } from './local-notification-audio';
import { mockInvoke, registerMockIpcHandler, resetMockIpcRouter } from '$shared/ipc-mock-router';
import bundledUrl from '../../assets/sounds/agent-complete.mp3?url';

const decode = vi.fn();
const resume = vi.fn();
const sources: Array<{
  buffer: unknown;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  onended: (() => void) | null;
}> = [];
const gains: Array<{
  gain: { value: number };
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}> = [];
const audios: Array<{
  src: string;
  volume: number;
  currentTime: number;
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
}> = [];
const nativeInvoke = vi.fn(mockInvoke);
const createBufferSource = () => {
  const source = {
    buffer: null,
    start: vi.fn(),
    stop: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    onended: null,
  };
  sources.push(source);
  return source;
};
const createGain = () => {
  const gain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
  gains.push(gain);
  return gain;
};

beforeEach(() => {
  setNotificationSoundPath('/reset.mp3');
  setNotificationSoundPath('');
  vi.clearAllMocks();
  sources.length = 0;
  gains.length = 0;
  decode.mockResolvedValue({ duration: 1 });
  resume.mockResolvedValue(undefined);
  vi.stubGlobal('electronAPI', { versions: { electron: '42.0.0' }, invoke: nativeInvoke });
  vi.stubGlobal(
    'AudioContext',
    class {
      destination = {};
      decodeAudioData = decode;
      resume = resume;
      createBufferSource = createBufferSource;
      createGain = createGain;
    },
  );
  vi.stubGlobal(
    'Audio',
    class {
      volume = 1;
      currentTime = 0;
      play = vi.fn(async () => {});
      pause = vi.fn();
      constructor(public src: string) {
        audios.push(this);
      }
    },
  );
  registerMockIpcHandler('notification:read-sound', () => ({ success: true, data: '/+OQAA==' }));
});
afterEach(() => {
  setNotificationSoundPath('/disposed.mp3');
  vi.unstubAllGlobals();
  resetMockIpcRouter();
  vi.useRealTimers();
});

const fallback = () => audios.at(-1)!;

describe('notification audio playback', () => {
  it('reads the exact desktop IPC payload, decodes it, and applies volume through a gain node', async () => {
    await playNotificationSound(0.3, '/Users/me/custom.mp3');
    expect(nativeInvoke).toHaveBeenCalledExactlyOnceWith('notification:read-sound', {
      path: '/Users/me/custom.mp3',
    });
    expect([...new Uint8Array(decode.mock.calls[0][0])]).toEqual([255, 227, 144, 0]);
    expect(gains[0].gain.value).toBe(0.3);
    expect(sources[0].start).toHaveBeenCalledOnce();
    expect(sources[0].buffer).toEqual({ duration: 1 });
    await playNotificationSound(2, '/Users/me/custom.mp3');
    expect(nativeInvoke).toHaveBeenCalledTimes(1);
    expect(gains[1].gain.value).toBe(1);
    expect(sources[0].stop).toHaveBeenCalledOnce();
  });

  it('stops old audio on selection changes and restores the bundled source when cleared', async () => {
    await playNotificationSound(0.6, '/first.mp3');
    setNotificationSoundPath('/second.mp3');
    expect(sources[0].stop).toHaveBeenCalledOnce();
    await playNotificationSound(0.2, '/second.mp3');
    expect(nativeInvoke).toHaveBeenLastCalledWith('notification:read-sound', {
      path: '/second.mp3',
    });
    setNotificationSoundPath('');
    expect(sources[1].stop).toHaveBeenCalledOnce();
    await playNotificationSound(0.4);
    expect(fallback()).toMatchObject({ src: bundledUrl, volume: 0.4, currentTime: 0 });
    expect(fallback().play).toHaveBeenCalledOnce();
  });

  it.each(['missing', 'decode', 'invalid-response', 'unavailable'])(
    'falls back safely for %s custom audio and retries the saved path later',
    async (failure) => {
      if (failure === 'missing')
        registerMockIpcHandler('notification:read-sound', () => ({ success: false }));
      if (failure === 'decode') decode.mockRejectedValueOnce(new Error('invalid MP3'));
      if (failure === 'invalid-response')
        registerMockIpcHandler('notification:read-sound', () => ({
          success: true,
          data: 'file:///private',
        }));
      if (failure === 'unavailable') nativeInvoke.mockRejectedValueOnce(new Error('no handler'));
      await playNotificationSound(0.7, '/saved.mp3');
      expect(fallback().src).toBe(bundledUrl);
      expect(fallback().play).toHaveBeenCalled();
      registerMockIpcHandler('notification:read-sound', () => ({
        success: true,
        data: '/+OQAA==',
      }));
      await playNotificationSound(0.7, '/saved.mp3');
      expect(nativeInvoke).toHaveBeenLastCalledWith('notification:read-sound', {
        path: '/saved.mp3',
      });
      expect(sources.at(-1)?.start).toHaveBeenCalledOnce();
    },
  );

  it('uses only the bundled sound in browser mode without touching native IPC', async () => {
    vi.stubGlobal('electronAPI', { versions: { electron: '0.0.0-browser' }, invoke: nativeInvoke });
    await playNotificationSound(0.5, '/desktop-only.mp3');
    expect(nativeInvoke).not.toHaveBeenCalled();
    expect(decode).not.toHaveBeenCalled();
    expect(fallback().play).toHaveBeenCalled();
  });

  it('does not play stale audio or a stale fallback when the preference changes during a read', async () => {
    let resolve!: (value: unknown) => void;
    registerMockIpcHandler(
      'notification:read-sound',
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = playNotificationSound(0.5, '/slow.mp3');
    setNotificationSoundPath('');
    resolve({ success: true, data: '/+OQAA==' });
    await pending;
    expect(decode).not.toHaveBeenCalled();
    expect(sources).toHaveLength(0);
    expect(fallback()?.play).not.toHaveBeenCalled();
  });

  it('shares in-flight reads and lets only the latest notification play', async () => {
    let resolve!: (value: unknown) => void;
    registerMockIpcHandler(
      'notification:read-sound',
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const first = playNotificationSound(0.1, '/slow.mp3');
    const second = playNotificationSound(0.9, '/slow.mp3');
    resolve({ success: true, data: '/+OQAA==' });
    await Promise.all([first, second]);
    expect(nativeInvoke).toHaveBeenCalledOnce();
    expect(sources).toHaveLength(1);
    expect(gains[0].gain.value).toBe(0.9);
  });

  it('honors a mute/focus change during loading before starting audio', async () => {
    let resolve!: (value: unknown) => void;
    registerMockIpcHandler(
      'notification:read-sound',
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    let allowed = true;
    const pending = playNotificationSound(0.5, '/slow.mp3', () => allowed);
    allowed = false;
    resolve({ success: true, data: '/+OQAA==' });
    await pending;
    expect(sources).toHaveLength(0);
    expect(fallback()?.play).not.toHaveBeenCalled();
  });

  it('times out an unavailable mount and never plays its late result', async () => {
    vi.useFakeTimers();
    let resolve!: (value: unknown) => void;
    registerMockIpcHandler(
      'notification:read-sound',
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = playNotificationSound(0.5, '/mount/slow.mp3');
    await vi.advanceTimersByTimeAsync(5000);
    await pending;
    expect(fallback().play).toHaveBeenCalledOnce();
    resolve({ success: true, data: '/+OQAA==' });
    await Promise.resolve();
    expect(decode).not.toHaveBeenCalled();
  });

  it('does not stop a newer sound when an older audio-device resume fails', async () => {
    let reject!: (reason: Error) => void;
    resume.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    const old = playNotificationSound(0.1, '/old.mp3');
    await vi.waitFor(() => expect(resume).toHaveBeenCalledOnce());
    await playNotificationSound(0.8, '/new.mp3');
    reject(new Error('old device failure'));
    await old;
    expect(sources).toHaveLength(1);
    expect(sources[0].start).toHaveBeenCalledOnce();
    expect(sources[0].stop).not.toHaveBeenCalled();
  });

  it('falls back if an audio-device resume never settles', async () => {
    vi.useFakeTimers();
    resume.mockReturnValueOnce(new Promise(() => {}));
    const pending = playNotificationSound(0.5, '/device.mp3');
    await vi.advanceTimersByTimeAsync(1000);
    await pending;
    expect(fallback().play).toHaveBeenCalledOnce();
    expect(sources).toHaveLength(0);
  });

  it('contains autoplay failures and rejects oversized IPC data before decoding', async () => {
    await playNotificationSound(0.5);
    fallback().play.mockRejectedValueOnce(new DOMException('blocked', 'NotAllowedError'));
    await expect(playNotificationSound(0.5)).resolves.toBeUndefined();
    registerMockIpcHandler('notification:read-sound', () => ({
      success: true,
      data: 'A'.repeat(7_000_000),
    }));
    await expect(readLocalNotificationSound('/large.mp3')).rejects.toThrow();
    expect(decode).not.toHaveBeenCalled();
  });
});
