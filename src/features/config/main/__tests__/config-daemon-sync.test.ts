import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Wire-contract tests for the config-daemon-sync rewire (PROTOCOL.md §5.12).
 * The legacy `workspace-config` electron-store is retired; the daemon-owned
 * sub-keys of AppConfig now hydrate from and push to the daemon settings
 * catalog via `settings.get` / `settings.update`.
 */

const requestMock = vi.hoisted(() => vi.fn(async () => ({ path: '', value: null })));

vi.mock('../../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: requestMock }),
}));

vi.mock('../../../../shared/logger', () => ({
  Logger: class {
    info() {}
    warn() {}
    error() {}
    debug() {}
  },
}));

function makeConfigManagerStub() {
  const state: Record<string, unknown> = {
    'ai.apiUrl': 'https://api.example',
    'ai.model': 'opus-x',
    'ai.temperature': 0.5,
    'ai.maxTokens': 1024,
    'ai.streamingSpeed': 20,
    'permissions.rules': [{ pattern: 'ls', action: 'allow' }],
    userRules: { enabled: true, rules: [] },
    workspaceRules: { enabled: true, content: '', updatedAt: 't' },
  };
  return {
    get: (path: string) => state[path],
    set: (path: string, value: unknown) => {
      state[path] = value;
    },
    __state: state,
  } as any;
}

describe('config-daemon-sync ↔ daemon settings.* (PROTOCOL.md §5.12)', () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockImplementation(async () => ({ path: '', value: null }));
    vi.resetModules();
  });

  it('hydrateFromDaemon reads each non-secret daemon-owned key via settings.get and applies values', async () => {
    requestMock.mockImplementation(async (_method: string, params: { path: string }) => ({
      path: params.path,
      value: `hydrated:${params.path}`,
    }));
    const { hydrateFromDaemon, NON_SECRET_DAEMON_KEYS } = await import('../config-daemon-sync');
    const cm = makeConfigManagerStub();
    await hydrateFromDaemon(cm);
    const getCalls = requestMock.mock.calls.filter((c) => c[0] === 'settings.get');
    expect(getCalls.map((c) => (c[1] as { path: string }).path).sort()).toEqual(
      [...NON_SECRET_DAEMON_KEYS].sort(),
    );
    expect(cm.__state['ai.apiUrl']).toBe('hydrated:ai.apiUrl');
    expect(cm.__state['userRules']).toBe('hydrated:userRules');
  });

  it('hydrateFromDaemon never reads the sensitive ai.apiToken (no plaintext in FE)', async () => {
    requestMock.mockImplementation(async (_method: string, params: { path: string }) => ({
      path: params.path,
      value: null,
    }));
    const { hydrateFromDaemon } = await import('../config-daemon-sync');
    await hydrateFromDaemon(makeConfigManagerStub());
    const paths = requestMock.mock.calls.map((c) => (c[1] as { path: string }).path);
    expect(paths).not.toContain('ai.apiToken');
  });

  it('pushDaemonKey forwards a single-change batch to settings.update', async () => {
    const { pushDaemonKey } = await import('../config-daemon-sync');
    await pushDaemonKey('ai.apiToken', 'dummy-token');
    expect(requestMock).toHaveBeenCalledWith('settings.update', {
      changes: [{ path: 'ai.apiToken', value: 'dummy-token' }],
    });
  });

  it('pushDaemonKey is a no-op for keys that are not daemon-owned', async () => {
    const { pushDaemonKey } = await import('../config-daemon-sync');
    await pushDaemonKey('appearance.theme', 'dark');
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('pushAllDaemonKeys batches every non-secret daemon key into one settings.update call', async () => {
    const { pushAllDaemonKeys, NON_SECRET_DAEMON_KEYS } = await import('../config-daemon-sync');
    const cm = makeConfigManagerStub();
    await pushAllDaemonKeys(cm);
    expect(requestMock).toHaveBeenCalledTimes(1);
    const [, body] = requestMock.mock.calls[0];
    const payload = body as { changes: Array<{ path: string; value: unknown }> };
    expect(payload.changes.map((c) => c.path).sort()).toEqual([...NON_SECRET_DAEMON_KEYS].sort());
  });

  it('isDaemonOwnedKey identifies the routed sub-keys', async () => {
    const { isDaemonOwnedKey } = await import('../config-daemon-sync');
    expect(isDaemonOwnedKey('ai.apiToken')).toBe(true);
    expect(isDaemonOwnedKey('permissions.rules')).toBe(true);
    expect(isDaemonOwnedKey('userRules')).toBe(true);
    expect(isDaemonOwnedKey('appearance.theme')).toBe(false);
    expect(isDaemonOwnedKey('editor.tabSize')).toBe(false);
  });
});
