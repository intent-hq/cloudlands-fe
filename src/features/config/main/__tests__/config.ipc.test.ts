import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CONFIG_CHANNELS } from '../../../../shared/ipc/channels';

type Handler = (event: { sender: { backendId: string } }, payload?: unknown) => Promise<unknown>;

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  localRequest: vi.fn(),
  remoteRequest: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => mocks.handlers.set(channel, handler),
  },
}));

vi.mock('../../../backend/main/backend.ipc', () => {
  const localClient = { request: mocks.localRequest };
  const remoteClient = { request: mocks.remoteRequest };
  const clientFor = (id: string) =>
    id === 'remote-1' ? remoteClient : id === 'local' ? localClient : undefined;
  return {
    getBackendClient: () => localClient,
    getBackendClientForConnection: clientFor,
    getBackendClientForId: (id: string) => {
      const client = clientFor(id);
      if (!client) throw new Error(`Backend client is not connected: ${id}`);
      return client;
    },
    getLocalBackendClient: () => localClient,
    getBackendIdForIpcSender: (sender: { backendId?: string }) => sender.backendId ?? 'local',
    getPrimaryBackendId: () => 'local',
  };
});

vi.mock('../../../../shared/logger', () => ({
  Logger: class {
    info() {}
    warn() {}
    error() {}
    debug() {}
  },
}));

vi.mock('../../../../shared/main/ipc-debug-tracker', () => ({
  ipcDebugTracker: {
    trackCall: vi.fn(),
    trackSuccess: vi.fn(),
    trackValidationError: vi.fn(),
  },
}));

vi.mock('$shared/paraglide/messages.js', () => ({
  m: { config_ipc_valueUndefined_error: () => 'Value cannot be undefined' },
}));

function handler(channel: string): Handler {
  const registered = mocks.handlers.get(channel);
  if (!registered) throw new Error(`Missing handler: ${channel}`);
  return registered;
}

describe('config IPC backend routing', () => {
  beforeEach(async () => {
    vi.resetModules();
    mocks.handlers.clear();
    mocks.localRequest.mockReset();
    mocks.remoteRequest.mockReset();
    mocks.localRequest.mockImplementation(async (method: string, params: { path?: string }) =>
      method === 'settings.get' ? { path: params.path, value: [`local:${params.path}`] } : {},
    );
    mocks.remoteRequest.mockImplementation(async (method: string, params: { path?: string }) =>
      method === 'settings.get' ? { path: params.path, value: [`remote:${params.path}`] } : {},
    );
    const { setupConfigIPC } = await import('../config.ipc');
    await setupConfigIPC();
    mocks.localRequest.mockClear();
    mocks.remoteRequest.mockClear();
  });

  it('routes permissions.rules reads and writes only to the remote sender backend', async () => {
    const event = { sender: { backendId: 'remote-1' } };

    await expect(
      handler(CONFIG_CHANNELS.GET)(event, { key: 'permissions.rules' }),
    ).resolves.toEqual(['remote:permissions.rules']);
    await expect(
      handler(CONFIG_CHANNELS.SET)(event, {
        key: 'permissions.rules',
        value: [{ pattern: 'git push', action: 'ask' }],
      }),
    ).resolves.toEqual({ success: true });

    expect(mocks.remoteRequest).toHaveBeenNthCalledWith(1, 'settings.get', {
      path: 'permissions.rules',
    });
    expect(mocks.remoteRequest).toHaveBeenNthCalledWith(2, 'settings.update', {
      changes: [{ path: 'permissions.rules', value: [{ pattern: 'git push', action: 'ask' }] }],
    });
    expect(mocks.localRequest).not.toHaveBeenCalled();
  });

  it('keeps FE-only config in shared memory without calling either daemon', async () => {
    const remoteEvent = { sender: { backendId: 'remote-1' } };
    const localEvent = { sender: { backendId: 'local' } };

    await expect(
      handler(CONFIG_CHANNELS.SET)(remoteEvent, { key: 'appearance.theme', value: 'light' }),
    ).resolves.toEqual({ success: true });
    await expect(
      handler(CONFIG_CHANNELS.GET)(localEvent, { key: 'appearance.theme' }),
    ).resolves.toBe('light');
    expect(mocks.localRequest).not.toHaveBeenCalled();
    expect(mocks.remoteRequest).not.toHaveBeenCalled();
  });
});
