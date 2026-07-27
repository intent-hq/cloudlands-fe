import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { PROVIDERS_CHANNELS } from '../../../../shared/ipc/channels';
import { CLAUDE_CODE_NPX_MISSING_WARNING } from '../../../../shared/constants/claude-code';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Function>(),
  findBinary: vi.fn(),
  ensureManagedCodexAcp: vi.fn(),
  backendRequest: vi.fn(),
  findAuggiePathAsync: vi.fn(),
  hostExec: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Function) => {
      mocks.handlers.set(channel, handler);
    }),
  },
}));

vi.mock('../../../../shared/main/find-binary', () => ({
  findBinary: mocks.findBinary,
  getCommonNpmPaths: vi.fn(() => []),
}));

vi.mock('../../../codex/main/codex-acp-manager', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../codex/main/codex-acp-manager')>()),
  ensureManagedCodexAcp: mocks.ensureManagedCodexAcp,
}));

vi.mock('../../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: mocks.backendRequest }),
}));

vi.mock('../../../auggie/main/auggie.ipc', () => ({
  findAuggiePathAsync: mocks.findAuggiePathAsync,
}));

vi.mock('../../../../shared/main/host-exec', () => ({
  hostExec: mocks.hostExec,
}));

vi.mock('../../../feature-codes/main/feature-codes.service', () => ({
  featureCodesService: { isFeatureEnabled: vi.fn(() => false) },
}));

/** host.providerDiscovery body with every provider uninstalled. */
const EMPTY_DISCOVERY = {
  providers: [
    'auggie',
    'claude-code',
    'codex',
    'cortex',
    'opencode',
    'pi',
    'droid',
    'grok',
    'unsloth',
  ].map(
    (id) => ({
      id,
      displayName: id,
      command: id,
      installed: false,
      resolvedPath: null,
      gatedOff: null,
      hasNpxFallback: false,
    }),
  ),
  npx: { resolvedPath: null, version: null, versionOk: false },
};

/** Provider ids the daemon's providerAuthStatus sweep covers. */
const AUTH_PROVIDER_IDS = [
  'auggie',
  'claude-code',
  'codex',
  'opencode',
  'pi',
  'droid',
  'grok',
] as const;

/**
 * PROTOCOL-shaped `host.providerAuthStatus` sweep response: every provider
 * defaults to the wire's `null` (unknown) unless overridden.
 */
function authSweep(
  verdicts: Partial<Record<(typeof AUTH_PROVIDER_IDS)[number], boolean | null>> = {},
) {
  return {
    providers: AUTH_PROVIDER_IDS.map((id) => ({
      id,
      authenticated: verdicts[id] ?? null,
    })),
  };
}

/** Route `getBackendClient().request` calls by daemon method. */
function routeBackend(responses: Record<string, unknown | ((params: unknown) => unknown)>): void {
  mocks.backendRequest.mockImplementation(async (method: string, params?: unknown) => {
    if (!(method in responses)) throw new Error(`unexpected daemon method: ${method}`);
    const entry = responses[method];
    return typeof entry === 'function' ? (entry as (p: unknown) => unknown)(params) : entry;
  });
}

describe('provider availability service', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.handlers.clear();
    mocks.findBinary.mockResolvedValue(null);
    mocks.findAuggiePathAsync.mockResolvedValue(null);
    mocks.hostExec.mockResolvedValue({ stdout: '', stderr: '', exitCode: 1 });
    mocks.backendRequest.mockRejectedValue(new Error('unrouted daemon method'));
  });

  it('does not call managed codex-acp installation while checking Codex availability', async () => {
    const { setupProviderAvailabilityIPC } = await import('../provider-availability.service');
    setupProviderAvailabilityIPC();
    const handler = mocks.handlers.get(PROVIDERS_CHANNELS.CHECK_SINGLE);
    if (!handler) throw new Error('provider check handler was not registered');

    const result = await handler({}, 'codex');

    expect(result).toEqual({ success: true, providerId: 'codex', data: { available: false } });
    expect(mocks.findBinary).toHaveBeenCalledWith('codex', expect.any(Object));
    expect(mocks.ensureManagedCodexAcp).not.toHaveBeenCalled();
  });

  it('surfaces the npx-missing warning on the discovery path when the claude CLI is installed', async () => {
    // The daemon reports claude-code as not installed (npx-only provider,
    // npx absent), but the claude CLI itself is on the host — the aggregate
    // must still warn instead of showing a silently unavailable provider.
    routeBackend({
      'host.providerDiscovery': EMPTY_DISCOVERY,
      'host.providerAuthStatus': authSweep(),
    });
    mocks.findBinary.mockImplementation(async (name: string) =>
      name === 'claude' ? '/usr/local/bin/claude' : null,
    );

    const { getProviderAvailability } = await import('../provider-availability.service');
    const result = await getProviderAvailability();

    expect(result.providers.claudeCode.available).toBe(false);
    expect(result.providers.claudeCode.warning).toBe(CLAUDE_CODE_NPX_MISSING_WARNING);
    expect(result.npx).toEqual({ resolvedPath: null, version: null, versionOk: false });
  });

  it('does not warn on the discovery path when the claude CLI is absent', async () => {
    routeBackend({
      'host.providerDiscovery': EMPTY_DISCOVERY,
      'host.providerAuthStatus': authSweep(),
    });

    const { getProviderAvailability } = await import('../provider-availability.service');
    const result = await getProviderAvailability();

    expect(result.providers.claudeCode.available).toBe(false);
    expect(result.providers.claudeCode.warning).toBeUndefined();
  });

  it('does not warn on the discovery path when npx is present', async () => {
    routeBackend({
      'host.providerDiscovery': {
        ...EMPTY_DISCOVERY,
        npx: { resolvedPath: '/usr/local/bin/npx', version: '10.0.0', versionOk: true },
      },
      'host.providerAuthStatus': authSweep(),
    });
    mocks.findBinary.mockImplementation(async (name: string) =>
      name === 'claude' ? '/usr/local/bin/claude' : null,
    );

    const { getProviderAvailability } = await import('../provider-availability.service');
    const result = await getProviderAvailability();

    expect(result.providers.claudeCode.warning).toBeUndefined();
  });

  it('reports claude-code unavailable when discovery says installed but the claude CLI is missing', async () => {
    // The daemon reports npx-only providers as installed from npx presence
    // alone; the claude CLI prerequisite is FE-checked, so its absence must
    // override the discovery result.
    routeBackend({
      'host.providerDiscovery': {
        ...EMPTY_DISCOVERY,
        providers: EMPTY_DISCOVERY.providers.map((p) =>
          p.id === 'claude-code'
            ? { ...p, installed: true, resolvedPath: '/usr/local/bin/npx' }
            : p,
        ),
        npx: { resolvedPath: '/usr/local/bin/npx', version: '10.0.0', versionOk: true },
      },
      'host.providerAuthStatus': authSweep(),
    });

    const { getProviderAvailability } = await import('../provider-availability.service');
    const result = await getProviderAvailability();

    expect(result.providers.claudeCode.available).toBe(false);
    expect(result.providers.claudeCode.warning).toBeUndefined();
  });

  it('keeps claude-code available when discovery says installed and the claude CLI is present', async () => {
    routeBackend({
      'host.providerDiscovery': {
        ...EMPTY_DISCOVERY,
        providers: EMPTY_DISCOVERY.providers.map((p) =>
          p.id === 'claude-code'
            ? { ...p, installed: true, resolvedPath: '/usr/local/bin/npx' }
            : p,
        ),
        npx: { resolvedPath: '/usr/local/bin/npx', version: '10.0.0', versionOk: true },
      },
      'host.providerAuthStatus': authSweep(),
    });
    mocks.findBinary.mockImplementation(async (name: string) =>
      name === 'claude' ? '/usr/local/bin/claude' : null,
    );

    const { getProviderAvailability } = await import('../provider-availability.service');
    const result = await getProviderAvailability();

    expect(result.providers.claudeCode.available).toBe(true);
    expect(result.providers.claudeCode.warning).toBeUndefined();
  });

  it('reports grok availability from the daemon discovery result', async () => {
    // Grok availability comes from the daemon's provider discovery; auth
    // comes from the daemon's providerAuthStatus sweep (wire null = unknown
    // → undefined, no indicator).
    routeBackend({
      'host.providerDiscovery': {
        ...EMPTY_DISCOVERY,
        providers: EMPTY_DISCOVERY.providers.map((p) =>
          p.id === 'grok'
            ? { ...p, installed: true, resolvedPath: '/home/user/.grok/bin/grok' }
            : p,
        ),
      },
      'host.providerAuthStatus': authSweep(),
    });

    const { getProviderAvailability } = await import('../provider-availability.service');
    const result = await getProviderAvailability();

    expect(result.providers.grok.available).toBe(true);
    expect(result.providers.grok.authenticated).toBeUndefined();
  });

  it('reports unsloth availability from discovery with available ⇒ authenticated', async () => {
    // Unsloth rides the opencode binary; it is local-only (no login surface),
    // so an available provider is always authenticated.
    routeBackend({
      'host.providerDiscovery': {
        ...EMPTY_DISCOVERY,
        providers: EMPTY_DISCOVERY.providers.map((p) =>
          p.id === 'unsloth'
            ? { ...p, installed: true, resolvedPath: '/home/user/.opencode/bin/opencode' }
            : p,
        ),
      },
      'host.providerAuthStatus': authSweep(),
    });

    const { getProviderAvailability } = await import('../provider-availability.service');
    const result = await getProviderAvailability();

    expect(result.providers.unsloth.available).toBe(true);
    expect(result.providers.unsloth.authenticated).toBe(true);
  });

  it('sweeps auth verdicts from host.providerAuthStatus on the aggregate path', async () => {
    routeBackend({
      'host.providerDiscovery': {
        ...EMPTY_DISCOVERY,
        providers: EMPTY_DISCOVERY.providers.map((p) =>
          ['pi', 'droid', 'grok'].includes(p.id)
            ? { ...p, installed: true, resolvedPath: `/usr/local/bin/${p.id}` }
            : p,
        ),
      },
      'host.providerAuthStatus': authSweep({ pi: true, droid: false, grok: null }),
    });

    const { getProviderAvailability } = await import('../provider-availability.service');
    const result = await getProviderAvailability();

    // The aggregate path sends an empty params object (no providerId, no
    // force — the daemon's cache is respected).
    expect(mocks.backendRequest).toHaveBeenCalledWith('host.providerAuthStatus', {});
    // The FE runs no auth-check commands itself.
    expect(mocks.hostExec).not.toHaveBeenCalled();
    expect(result.providers.pi).toMatchObject({ available: true, authenticated: true });
    expect(result.providers.droid).toMatchObject({ available: true, authenticated: false });
    // Wire null (unknown) folds to undefined — no indicator.
    expect(result.providers.grok.authenticated).toBeUndefined();
  });

  it('does not attach auth verdicts to unavailable providers', async () => {
    routeBackend({
      'host.providerDiscovery': EMPTY_DISCOVERY,
      'host.providerAuthStatus': authSweep({ codex: true }),
    });

    const { getProviderAvailability } = await import('../provider-availability.service');
    const result = await getProviderAvailability();

    expect(result.providers.codex).toEqual(
      expect.objectContaining({ available: false }),
    );
    expect(result.providers.codex.authenticated).toBeUndefined();
  });

  it('degrades auth to unknown when the providerAuthStatus RPC fails', async () => {
    routeBackend({
      'host.providerDiscovery': {
        ...EMPTY_DISCOVERY,
        providers: EMPTY_DISCOVERY.providers.map((p) =>
          p.id === 'droid' ? { ...p, installed: true, resolvedPath: '/usr/local/bin/droid' } : p,
        ),
      },
      'host.providerAuthStatus': () => {
        throw new Error('transport down');
      },
    });

    const { getProviderAvailability } = await import('../provider-availability.service');
    const result = await getProviderAvailability();

    expect(result.providers.droid.available).toBe(true);
    expect(result.providers.droid.authenticated).toBeUndefined();
  });

  it('rechecks a single provider with a forced providerAuthStatus verdict', async () => {
    routeBackend({
      'host.providerAuthStatus': { providers: [{ id: 'codex', authenticated: true }] },
    });
    mocks.findBinary.mockImplementation(async (name: string) =>
      name === 'codex' ? '/usr/local/bin/codex' : null,
    );

    const { setupProviderAvailabilityIPC } = await import('../provider-availability.service');
    setupProviderAvailabilityIPC();
    const handler = mocks.handlers.get(PROVIDERS_CHANNELS.CHECK_SINGLE);
    if (!handler) throw new Error('provider check handler was not registered');

    const result = await handler({}, 'codex');

    // Single rechecks follow "Login" / "Check again" clicks — force bypasses
    // the daemon's auth cache.
    expect(mocks.backendRequest).toHaveBeenCalledWith('host.providerAuthStatus', {
      providerId: 'codex',
      force: true,
    });
    expect(mocks.hostExec).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      providerId: 'codex',
      data: { available: true, authenticated: true },
    });
  });

  it('single recheck surfaces a logged-out verdict as authenticated:false', async () => {
    routeBackend({
      'host.providerAuthStatus': { providers: [{ id: 'droid', authenticated: false }] },
    });
    mocks.findBinary.mockImplementation(async (name: string) =>
      name === 'droid' ? '/usr/local/bin/droid' : null,
    );

    const { setupProviderAvailabilityIPC } = await import('../provider-availability.service');
    setupProviderAvailabilityIPC();
    const handler = mocks.handlers.get(PROVIDERS_CHANNELS.CHECK_SINGLE);
    if (!handler) throw new Error('provider check handler was not registered');

    const result = await handler({}, 'droid');

    expect(result).toEqual({
      success: true,
      providerId: 'droid',
      data: { available: true, authenticated: false },
    });
  });

  it('single recheck skips the auth verdict for unavailable providers', async () => {
    routeBackend({});

    const { setupProviderAvailabilityIPC } = await import('../provider-availability.service');
    setupProviderAvailabilityIPC();
    const handler = mocks.handlers.get(PROVIDERS_CHANNELS.CHECK_SINGLE);
    if (!handler) throw new Error('provider check handler was not registered');

    const result = await handler({}, 'droid');

    expect(result).toEqual({ success: true, providerId: 'droid', data: { available: false } });
    expect(mocks.backendRequest).not.toHaveBeenCalledWith(
      'host.providerAuthStatus',
      expect.anything(),
    );
  });
});
