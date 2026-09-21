import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Wire-contract tests for external-editors.ipc.ts.
 *
 * Per PROTOCOL.md §5.14, installed-editor / GUI-app detection is delegated to
 * the daemon via `host.findApp` (macOS .app bundle probe) and
 * `host.listInstalledEditors` (editor catalog enumeration, source/flatpakId).
 * These tests assert the exact request shape sent on the wire and feed back
 * PROTOCOL-shaped mock responses — the FE consumes `installed` verbatim with
 * no client-side aliasing, and degrades to an empty/false result on RPC
 * failure rather than falling back to a local probe.
 */

const { backendMocks, mockRequest, loggerSpies } = vi.hoisted(() => {
  const request = vi.fn();
  return {
    backendMocks: { client: { request } },
    mockRequest: request,
    loggerSpies: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
});

vi.mock('../../../backend/main/backend.ipc', () => ({
  getBackendClient: () => backendMocks.client,
  onBackendReconnected: vi.fn(() => () => {}),
}));

vi.mock('$lib/utils/logger', () => ({
  Logger: class MockLogger {
    debug = loggerSpies.debug;
    info = loggerSpies.info;
    warn = loggerSpies.warn;
    error = loggerSpies.error;
  },
}));

type ExternalEditorsModule = typeof import('../external-editors.ipc');

async function loadFreshModule(): Promise<ExternalEditorsModule> {
  vi.resetModules();
  return (await import('../external-editors.ipc')) as ExternalEditorsModule;
}

describe('isAppInstalledMacOS (host.findApp wire contract)', () => {
  beforeEach(() => {
    backendMocks.client = { request: mockRequest };
    mockRequest.mockReset();
    loggerSpies.debug.mockReset();
    loggerSpies.info.mockReset();
    loggerSpies.warn.mockReset();
    loggerSpies.error.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends `host.findApp` with `{ name }` and consumes `installed:true` verbatim', async () => {
    mockRequest.mockResolvedValue({
      installed: true,
      path: '/Applications/Visual Studio Code.app',
      source: 'macAppBundle',
    });

    const { isAppInstalledMacOS } = await loadFreshModule();
    const result = await isAppInstalledMacOS('Visual Studio Code');

    expect(result).toBe(true);
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest).toHaveBeenCalledWith('host.findApp', {
      name: 'Visual Studio Code',
    });
  });

  it('consumes `installed:false` verbatim (does not heal/alias to `available`)', async () => {
    mockRequest.mockResolvedValue({ installed: false });

    const { isAppInstalledMacOS } = await loadFreshModule();
    const result = await isAppInstalledMacOS('Nonexistent App');

    expect(result).toBe(false);
    expect(mockRequest).toHaveBeenCalledWith('host.findApp', {
      name: 'Nonexistent App',
    });
  });

  it('degrades to `false` (no local fs probe) when the wire call rejects', async () => {
    mockRequest.mockRejectedValue(new Error('transport down'));

    const { isAppInstalledMacOS } = await loadFreshModule();
    const result = await isAppInstalledMacOS('Cursor');

    expect(result).toBe(false);
    expect(mockRequest).toHaveBeenCalledWith('host.findApp', { name: 'Cursor' });
  });

  it('does not treat an `available:true` payload as installed (no client aliasing)', async () => {
    // A non-PROTOCOL response with `available` instead of `installed` must
    // NOT be silently aliased — the FE only honors the documented `installed`
    // field.
    mockRequest.mockResolvedValue({ available: true, path: '/Applications/Foo.app' });

    const { isAppInstalledMacOS } = await loadFreshModule();
    const result = await isAppInstalledMacOS('Foo');

    expect(result).toBe(false);
  });
});

describe('getInstalledFlatpakApps (host.listInstalledEditors wire contract)', () => {
  beforeEach(() => {
    backendMocks.client = { request: mockRequest };
    mockRequest.mockReset();
    loggerSpies.debug.mockReset();
    loggerSpies.info.mockReset();
    loggerSpies.warn.mockReset();
    loggerSpies.error.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends `host.listInstalledEditors` with no params and harvests flatpakIds from installed flatpak entries', async () => {
    mockRequest.mockResolvedValue({
      editors: [
        {
          id: 'vscode',
          installed: true,
          path: '/Applications/Visual Studio Code.app',
          source: 'macAppBundle',
        },
        { id: 'cursor', installed: false },
        { id: 'zed', installed: true, flatpakId: 'dev.zed.Zed', source: 'flatpak' },
        { id: 'sublime', installed: true, flatpakId: 'com.sublimetext.three', source: 'flatpak' },
      ],
    });

    const { getInstalledFlatpakApps } = await loadFreshModule();
    const ids = await getInstalledFlatpakApps();

    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest).toHaveBeenCalledWith('host.listInstalledEditors');
    expect(ids.has('dev.zed.Zed')).toBe(true);
    expect(ids.has('com.sublimetext.three')).toBe(true);
    expect(ids.size).toBe(2);
  });

  it('excludes flatpak entries that are not installed', async () => {
    mockRequest.mockResolvedValue({
      editors: [
        { id: 'zed', installed: false, flatpakId: 'dev.zed.Zed', source: 'flatpak' },
        { id: 'sublime', installed: true, flatpakId: 'com.sublimetext.three', source: 'flatpak' },
      ],
    });

    const { getInstalledFlatpakApps } = await loadFreshModule();
    const ids = await getInstalledFlatpakApps();

    expect(ids.has('dev.zed.Zed')).toBe(false);
    expect(ids.has('com.sublimetext.three')).toBe(true);
  });

  it('ignores non-flatpak sources even when a flatpakId field is present', async () => {
    mockRequest.mockResolvedValue({
      editors: [
        {
          id: 'vscode',
          installed: true,
          path: '/usr/bin/code',
          source: 'binary',
          flatpakId: 'com.visualstudio.code',
        },
      ],
    });

    const { getInstalledFlatpakApps } = await loadFreshModule();
    const ids = await getInstalledFlatpakApps();

    expect(ids.size).toBe(0);
  });

  it('degrades to an empty set (no `flatpak list` shell-out) when the wire call rejects', async () => {
    mockRequest.mockRejectedValue(new Error('transport down'));

    const { getInstalledFlatpakApps } = await loadFreshModule();
    const ids = await getInstalledFlatpakApps();

    expect(ids.size).toBe(0);
    expect(mockRequest).toHaveBeenCalledWith('host.listInstalledEditors');
  });

  it('does not cache a rejected installed-editors probe', async () => {
    mockRequest.mockRejectedValueOnce(new Error('transport down')).mockResolvedValueOnce({
      editors: [{ id: 'zed', installed: true, flatpakId: 'dev.zed.Zed', source: 'flatpak' }],
    });

    const { getInstalledFlatpakApps } = await loadFreshModule();

    expect((await getInstalledFlatpakApps()).size).toBe(0);
    expect((await getInstalledFlatpakApps()).has('dev.zed.Zed')).toBe(true);
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it('treats a malformed installed-editors response as an uncached probe failure', async () => {
    mockRequest.mockResolvedValueOnce({ installed: true }).mockResolvedValueOnce({ editors: [] });

    const { getInstalledFlatpakApps } = await loadFreshModule();

    expect((await getInstalledFlatpakApps()).size).toBe(0);
    expect((await getInstalledFlatpakApps()).size).toBe(0);
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it('shares one host.listInstalledEditors request across concurrent callers', async () => {
    let resolveProbe!: (value: { editors: Array<Record<string, unknown>> }) => void;
    mockRequest.mockReturnValue(
      new Promise((resolve) => {
        resolveProbe = resolve;
      }),
    );

    const { getInstalledFlatpakApps } = await loadFreshModule();
    const first = getInstalledFlatpakApps();
    const second = getInstalledFlatpakApps();
    resolveProbe({
      editors: [{ id: 'zed', installed: true, flatpakId: 'dev.zed.Zed', source: 'flatpak' }],
    });

    const [firstIds, secondIds] = await Promise.all([first, second]);
    expect(firstIds).toBe(secondIds);
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('force refresh bypasses an authoritative negative editor TTL', async () => {
    mockRequest.mockResolvedValueOnce({ editors: [] }).mockResolvedValueOnce({
      editors: [{ id: 'zed', installed: true, flatpakId: 'dev.zed.Zed', source: 'flatpak' }],
    });

    const { getInstalledFlatpakApps } = await loadFreshModule();

    expect((await getInstalledFlatpakApps()).size).toBe(0);
    expect((await getInstalledFlatpakApps(true)).has('dev.zed.Zed')).toBe(true);
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it('caches the editors response within the TTL so a second call is wire-free', async () => {
    mockRequest.mockResolvedValue({
      editors: [{ id: 'zed', installed: true, flatpakId: 'dev.zed.Zed', source: 'flatpak' }],
    });

    const { getInstalledFlatpakApps } = await loadFreshModule();
    const first = await getInstalledFlatpakApps();
    const second = await getInstalledFlatpakApps();

    expect(first).toBe(second);
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('invalidates the editors cache when the backend client identity changes', async () => {
    mockRequest.mockResolvedValue({ editors: [] });
    const { getInstalledFlatpakApps } = await loadFreshModule();
    expect((await getInstalledFlatpakApps()).size).toBe(0);

    const replacementRequest = vi.fn().mockResolvedValue({
      editors: [{ id: 'zed', installed: true, flatpakId: 'dev.zed.Zed', source: 'flatpak' }],
    });
    backendMocks.client = { request: replacementRequest };

    expect((await getInstalledFlatpakApps()).has('dev.zed.Zed')).toBe(true);
    expect(replacementRequest).toHaveBeenCalledTimes(1);
  });
});
