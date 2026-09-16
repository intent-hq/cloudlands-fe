import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CONFIG_CHANNELS } from '../../../../shared/ipc/channels';

type Handler = (event: { sender: { backendId: string } }, payload?: unknown) => Promise<unknown>;

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  localRequest: vi.fn(),
  remoteRequest: vi.fn(),
  reconnectHandlers: [] as Array<(backendId?: string) => void>,
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
    onBackendReconnected: (handler: () => void, backendId = 'local') => {
      mocks.reconnectHandlers.push((emittingBackendId = 'local') => {
        if (emittingBackendId === backendId) handler();
      });
      return () => {};
    },
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

/** Drain pending microtasks / zero-delay timers from fire-and-forget chains. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function answerLocal(prefix: string): void {
  mocks.localRequest.mockImplementation(async (method: string, params: { path?: string }) =>
    method === 'settings.get' ? { path: params.path, value: [`${prefix}:${params.path}`] } : {},
  );
}

describe('config IPC startup hydration', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.handlers.clear();
    mocks.localRequest.mockReset();
    mocks.remoteRequest.mockReset();
    mocks.reconnectHandlers.length = 0;
  });

  it('setupConfigIPC resolves and registers handlers before the daemon answers', async () => {
    const pending: Array<() => void> = [];
    mocks.localRequest.mockImplementation(
      (_method: string, params: { path?: string }) =>
        new Promise((resolve) => {
          pending.push(() => resolve({ path: params.path, value: [`late:${params.path}`] }));
        }),
    );

    const { setupConfigIPC, getConfigManager } = await import('../config.ipc');
    let resolved = false;
    const setupPromise = setupConfigIPC().then(() => {
      resolved = true;
    });
    await flush();

    // Startup is not gated on the daemon round-trip: the first settings.get is
    // still unanswered, yet setup has resolved with every handler registered
    // and the in-memory defaults served.
    expect(resolved).toBe(true);
    expect(pending).toHaveLength(1);
    expect(mocks.handlers.has(CONFIG_CHANNELS.GET)).toBe(true);
    expect(mocks.handlers.has(CONFIG_CHANNELS.SET)).toBe(true);
    expect(mocks.handlers.has(CONFIG_CHANNELS.GET_ALL)).toBe(true);
    expect(getConfigManager()!.get('permissions.rules')).toEqual([]);

    // The daemon answers later; the hydrated values land in ConfigManager.
    while (pending.length > 0) {
      pending.splice(0).forEach((answer) => answer());
      await flush();
    }
    await setupPromise;
    expect(getConfigManager()!.get('permissions.rules')).toEqual(['late:permissions.rules']);
    expect(getConfigManager()!.get('userRules')).toEqual(['late:userRules']);
    expect(mocks.localRequest).toHaveBeenCalledWith('settings.get', { path: 'permissions.rules' });
    expect(mocks.localRequest).toHaveBeenCalledWith('settings.get', { path: 'userRules' });
    expect(mocks.localRequest).toHaveBeenCalledWith('settings.get', { path: 'workspaceRules' });
  });

  it('re-hydrates from the local daemon on reconnect after a cold-start miss', async () => {
    // Boot-order race: the sidecar socket is not up yet, every request fails.
    mocks.localRequest.mockImplementation(async () => {
      throw new Error('connect ENOENT intentd.sock');
    });

    const { setupConfigIPC, getConfigManager } = await import('../config.ipc');
    await setupConfigIPC();
    await flush();
    expect(getConfigManager()!.get('permissions.rules')).toEqual([]);
    expect(mocks.reconnectHandlers).toHaveLength(1);

    // Daemon comes up; the reconnect listener re-runs the hydration.
    answerLocal('local');
    mocks.localRequest.mockClear();
    for (const fire of mocks.reconnectHandlers) fire();
    await flush();

    expect(getConfigManager()!.get('permissions.rules')).toEqual(['local:permissions.rules']);
    expect(mocks.localRequest).toHaveBeenCalledWith('settings.get', { path: 'permissions.rules' });
  });

  it('ignores reconnects of a remote backend for the local-pinned hydration', async () => {
    answerLocal('local');
    const { setupConfigIPC } = await import('../config.ipc');
    await setupConfigIPC();
    await flush();
    mocks.localRequest.mockClear();

    for (const fire of mocks.reconnectHandlers) fire('remote-1');
    await flush();

    expect(mocks.localRequest).not.toHaveBeenCalled();
    expect(mocks.remoteRequest).not.toHaveBeenCalled();
  });
});

describe('config IPC backend routing', () => {
  beforeEach(async () => {
    vi.resetModules();
    mocks.handlers.clear();
    mocks.localRequest.mockReset();
    mocks.remoteRequest.mockReset();
    mocks.reconnectHandlers.length = 0;
    answerLocal('local');
    mocks.remoteRequest.mockImplementation(async (method: string, params: { path?: string }) =>
      method === 'settings.get' ? { path: params.path, value: [`remote:${params.path}`] } : {},
    );
    const { setupConfigIPC } = await import('../config.ipc');
    await setupConfigIPC();
    // Let the background hydration settle before clearing the spies.
    await flush();
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

  it('fails closed (success: false) when the sender backend has no live pooled client', async () => {
    const event = { sender: { backendId: 'remote-gone' } };

    const result = await handler(CONFIG_CHANNELS.SET)(event, {
      key: 'permissions.rules',
      value: [{ pattern: 'git push', action: 'ask' }],
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Backend client is not connected: remote-gone');
    expect(mocks.localRequest).not.toHaveBeenCalled();
    expect(mocks.remoteRequest).not.toHaveBeenCalled();
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
