/**
 * Splash gate unit tests — connected/timeout/startup-failure dismiss paths
 * plus the non-Electron immediate-dismiss and cleanup behaviors.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { startSplashGate, wireSplashGate, SPLASH_FALLBACK_TIMEOUT_MS } from './splash-gate';

const BACKEND = IPC_CHANNELS.BACKEND;

function makeMockApi(invokeResult: unknown, invokeShouldReject = false) {
  const listeners = new Map<string, (payload: unknown) => void>();
  let listenerSeq = 0;
  const api = {
    invoke: vi.fn(async () => {
      if (invokeShouldReject) throw new Error('bridge not ready');
      return invokeResult;
    }),
    on: vi.fn((channel: string, handler: (payload: unknown) => void) => {
      const id = `listener-${++listenerSeq}`;
      listeners.set(id, handler);
      return id;
    }),
    off: vi.fn(),
    offById: vi.fn((_channel: string, id: string) => {
      listeners.delete(id);
    }),
  };
  const emit = (channel: string, payload: unknown) => {
    for (const handler of listeners.values()) handler(payload);
    void channel;
  };
  return { api: api as unknown as Window['electronAPI'], emit, invokeMock: api.invoke };
}

describe('startSplashGate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('dismisses immediately in non-Electron environments (api: null)', () => {
    const dismiss = vi.fn();
    const stop = startSplashGate(dismiss, { api: null });
    expect(dismiss).toHaveBeenCalledTimes(1);
    stop();
  });

  it('dismisses once backend:get-status resolves connected', async () => {
    const { api } = makeMockApi({ status: 'connected' });
    const dismiss = vi.fn();
    startSplashGate(dismiss, { api });

    await vi.waitFor(() => expect(dismiss).toHaveBeenCalledTimes(1));
  });

  it('dismisses on a BACKEND.STATUS push reporting connected', async () => {
    const { api, emit } = makeMockApi({ status: 'connecting' });
    const dismiss = vi.fn();
    startSplashGate(dismiss, { api });

    // Let the initial get-status resolve (status: connecting -> no dismiss yet).
    await vi.waitFor(() => expect(api.invoke).toHaveBeenCalledWith(BACKEND.GET_STATUS));
    expect(dismiss).not.toHaveBeenCalled();

    emit(BACKEND.STATUS, { status: 'connected' });
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it('dismisses on sidecarStartupFailed from the initial check', async () => {
    const { api } = makeMockApi({ status: 'disconnected', sidecarStartupFailed: true });
    const dismiss = vi.fn();
    startSplashGate(dismiss, { api });

    await vi.waitFor(() => expect(dismiss).toHaveBeenCalledTimes(1));
  });

  it('dismisses on sidecarStartupFailed from a status push', async () => {
    const { api, emit } = makeMockApi({ status: 'connecting' });
    const dismiss = vi.fn();
    startSplashGate(dismiss, { api });

    await vi.waitFor(() => expect(api.invoke).toHaveBeenCalledWith(BACKEND.GET_STATUS));
    emit(BACKEND.STATUS, { status: 'disconnected', sidecarStartupFailed: true });
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it('dismisses after the bounded fallback timeout when the daemon never connects', async () => {
    const { api } = makeMockApi({ status: 'connecting' });
    const dismiss = vi.fn();
    startSplashGate(dismiss, { api });

    await vi.waitFor(() => expect(api.invoke).toHaveBeenCalledWith(BACKEND.GET_STATUS));
    expect(dismiss).not.toHaveBeenCalled();

    vi.advanceTimersByTime(SPLASH_FALLBACK_TIMEOUT_MS);
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it('dismisses after the fallback timeout even if get-status never resolves (bridge not ready)', () => {
    const { api } = makeMockApi(undefined, true);
    const dismiss = vi.fn();
    startSplashGate(dismiss, { api, timeoutMs: 5000 });

    vi.advanceTimersByTime(5000);
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it('never dismisses twice: timeout firing after an earlier connect is a no-op', async () => {
    const { api } = makeMockApi({ status: 'connected' });
    const dismiss = vi.fn();
    startSplashGate(dismiss, { api, timeoutMs: 5000 });

    await vi.waitFor(() => expect(dismiss).toHaveBeenCalledTimes(1));
    vi.advanceTimersByTime(5000);
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it('cleanup function removes the listener and clears the timer before settling', async () => {
    const { api } = makeMockApi(undefined, true);
    const dismiss = vi.fn();
    const stop = startSplashGate(dismiss, { api, timeoutMs: 5000 });

    stop();
    vi.advanceTimersByTime(5000);
    expect(dismiss).not.toHaveBeenCalled();
    expect(api.offById).toHaveBeenCalled();
  });
});

describe('wireSplashGate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a no-op cleanup when the splash element is missing', () => {
    const stop = wireSplashGate(null, { api: null });
    expect(() => stop()).not.toThrow();
  });

  it('adds the "mounted" class and removes the element after its fade transition, once connected', async () => {
    const splash = document.createElement('div');
    document.body.appendChild(splash);
    const { api, emit } = makeMockApi({ status: 'connecting' });

    const stop = wireSplashGate(splash, { api });

    await vi.waitFor(() => expect(api.invoke).toHaveBeenCalledWith(BACKEND.GET_STATUS));
    expect(splash.classList.contains('mounted')).toBe(false);
    expect(splash.isConnected).toBe(true);

    emit(BACKEND.STATUS, { status: 'connected' });
    expect(splash.classList.contains('mounted')).toBe(true);
    expect(splash.isConnected).toBe(true);

    splash.dispatchEvent(new Event('transitionend'));
    expect(splash.isConnected).toBe(false);

    stop();
  });

  it('dismisses immediately (non-Electron) so the splash is mounted+removed with no bridge', () => {
    const splash = document.createElement('div');
    document.body.appendChild(splash);

    wireSplashGate(splash, { api: null });

    expect(splash.classList.contains('mounted')).toBe(true);
    splash.dispatchEvent(new Event('transitionend'));
    expect(splash.isConnected).toBe(false);
  });
});
