import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANTIGRAVITY_CHANNELS } from '../../../shared/ipc/channels';
import { setupAntigravityIPC } from './antigravity.ipc';
import { LOCAL_CONNECTION_ID } from '../../../shared/types/connections';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, payload?: unknown) => Promise<unknown>>(),
  backend: vi.fn(),
  request: vi.fn(),
  dispose: vi.fn(),
  construct: vi.fn(),
  window: vi.fn(),
  open: vi.fn(),
}));
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, payload?: unknown) => Promise<unknown>) =>
      mocks.handlers.set(channel, handler),
  },
  BrowserWindow: { fromWebContents: mocks.window },
  shell: { openExternal: mocks.open },
}));
vi.mock('../../backend/main/backend.ipc', () => ({ getBackendClientForIpcEvent: mocks.backend }));
vi.mock('../../../main/utils/daemon-model-catalog', () => ({ getProviderModelsEnvelope: vi.fn() }));
vi.mock('./setup-session', () => ({
  AntigravitySetupSession: class {
    request = mocks.request;
    dispose = mocks.dispose;
    constructor(...args: unknown[]) {
      mocks.construct(...args);
    }
  },
}));

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
const arch = Object.getOwnPropertyDescriptor(process, 'arch')!;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.handlers.clear();
  Object.defineProperty(process, 'platform', { ...platform, value: 'darwin' });
  Object.defineProperty(process, 'arch', { ...arch, value: 'arm64' });
  mocks.window.mockReturnValue({});
  mocks.request.mockResolvedValue({ ok: false, code: 'updateRequired' });
  const client = { getConfig: () => ({ transport: 'uds', socketPath: '/fixture' }) };
  mocks.backend.mockReturnValue({ backendId: LOCAL_CONNECTION_ID, client });
  setupAntigravityIPC();
});
afterEach(() => {
  Object.defineProperty(process, 'platform', platform);
  Object.defineProperty(process, 'arch', arch);
});

function event() {
  const sender = Object.assign(new EventEmitter(), { isDestroyed: () => false, mainFrame: {} });
  return { sender, senderFrame: sender.mainFrame };
}
const call = (sender: ReturnType<typeof event>, action = 'status') =>
  mocks.handlers.get(ANTIGRAVITY_CHANNELS.SETUP)!(sender, { action });

describe('Antigravity setup IPC routing', () => {
  it('uses an app-owned session and closes it with its window', async () => {
    const request = event();
    await call(request);
    await call(request);
    expect(mocks.construct).toHaveBeenCalledOnce();
    const [, current] = mocks.construct.mock.calls[0];
    expect(current()).toBe(true);
    request.sender.emit('destroyed');
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });
  it('rejects remote backends even if they have a UDS-shaped configuration', async () => {
    mocks.backend.mockReturnValue({
      backendId: 'remote',
      client: { getConfig: () => ({ transport: 'uds' }) },
    });
    expect(await call(event(), 'start')).toEqual({ ok: false, code: 'remoteHost' });
    expect(mocks.construct).not.toHaveBeenCalled();
  });
  it('rejects a local backend ID when its actual transport is remote', async () => {
    mocks.backend.mockReturnValue({
      backendId: LOCAL_CONNECTION_ID,
      client: { getConfig: () => ({ transport: 'wss' }) },
    });
    expect(await call(event(), 'start')).toEqual({ ok: false, code: 'remoteHost' });
    expect(mocks.construct).not.toHaveBeenCalled();
  });
  it('requires a supported platform, an app window, and its main frame', async () => {
    Object.defineProperty(process, 'arch', { ...arch, value: 'x64' });
    expect(await call(event(), 'start')).toEqual({ ok: false, code: 'unsupportedHost' });
    const subframe = event();
    subframe.senderFrame = {};
    expect(await call(subframe, 'start')).toEqual({ ok: false, code: 'invalidOperation' });
    mocks.window.mockReturnValue(null);
    expect(await call(event(), 'start')).toEqual({ ok: false, code: 'invalidOperation' });
    expect(mocks.construct).not.toHaveBeenCalled();
  });
  it('invalidates its owner when the window changes backend', async () => {
    const request = event();
    await call(request);
    const [, current] = mocks.construct.mock.calls[0];
    mocks.backend.mockReturnValue({ backendId: 'remote', client: {} });
    expect(current()).toBe(false);
    expect(await call(request)).toEqual({ ok: false, code: 'connectionLost' });
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });
  it('does not accumulate window cleanup listeners across retries', async () => {
    const request = event();
    for (let i = 0; i < 3; i++) {
      await call(request);
      await mocks.handlers.get(ANTIGRAVITY_CHANNELS.CLOSE_SETUP)!(request);
    }
    expect(request.sender.listenerCount('destroyed')).toBe(1);
  });
  it('a late response from a closed connection cannot close its replacement', async () => {
    const request = event();
    let release!: (value: unknown) => void;
    mocks.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const old = call(request);
    await Promise.resolve();
    await mocks.handlers.get(ANTIGRAVITY_CHANNELS.CLOSE_SETUP)!(request);
    await call(request);
    expect(mocks.construct).toHaveBeenCalledTimes(2);
    expect(mocks.dispose).toHaveBeenCalledOnce();
    release({ ok: false, code: 'connectionLost' });
    await old;
    expect(mocks.dispose).toHaveBeenCalledOnce();
    request.sender.emit('destroyed');
  });
});
