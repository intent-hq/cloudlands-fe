import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PROVIDERS_CHANNELS } from '../../../../shared/ipc/channels';
import { CLAUDE_CODE_NPX_MISSING_WARNING } from '../../../../shared/constants/claude-code';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Function>(),
  findBinary: vi.fn(),
  findBinaryStrict: vi.fn(),
  backendRequest: vi.fn(),
  clientForEvent: vi.fn(),
  findAuggiePathStrict: vi.fn(),
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
  findBinaryStrict: mocks.findBinaryStrict,
  getCommonNpmPaths: vi.fn(() => []),
}));

vi.mock('../../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: mocks.backendRequest }),
  getBackendClientForIpcEvent: mocks.clientForEvent,
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));

vi.mock('../../../auggie/main/auggie-path', () => ({
  findAuggiePathStrict: mocks.findAuggiePathStrict,
}));

vi.mock('../../../../shared/main/host-exec', () => ({
  hostExec: mocks.hostExec,
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
  ].map((id) => ({
    id,
    displayName: id,
    command: id,
    installed: false,
    resolvedPath: null,
    gatedOff: null,
    hasNpxFallback: false,
  })),
  npx: { resolvedPath: null, version: null, versionOk: false },
};

/** Provider ids the daemon's providerAuthStatus sweep covers. */
const AUTH_PROVIDER_IDS = [
  'antigravity',
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
  it.each([true, false, null])(
    'reads Antigravity discovery and auth=%s from the daemon without local probes',
    async (authenticated) => {
      routeBackend({
        'host.providerDiscovery': {
          ...EMPTY_DISCOVERY,
          providers: [
            ...EMPTY_DISCOVERY.providers,
            {
              id: 'antigravity',
              installed: true,
              hasNpxFallback: false,
              resolvedPath: '/configured/agy_acp_server.par',
            },
          ],
        },
        'host.providerAuthStatus': authSweep({ antigravity: authenticated }),
      });
      const { setupProviderAvailabilityIPC } = await import('../provider-availability.service');
      setupProviderAvailabilityIPC();
      const result = await mocks.handlers.get(PROVIDERS_CHANNELS.CHECK_SINGLE)!(
        {},
        { providerId: 'antigravity', force: true },
      );
      expect(result).toMatchObject({
        success: true,
        data: { available: true, hasNpxFallback: false, authenticated: authenticated ?? undefined },
      });
      expect(result.data).not.toHaveProperty('authDetails');
      expect(mocks.findBinary).not.toHaveBeenCalled();
      expect(mocks.hostExec).not.toHaveBeenCalled();
      expect(mocks.backendRequest).toHaveBeenCalledWith('host.providerAuthStatus', {
        providerId: 'antigravity',
        force: true,
      });
    },
  );

  it('does not treat agy presence as an installed Antigravity ACP server', async () => {
    routeBackend({ 'host.providerDiscovery': EMPTY_DISCOVERY });
    mocks.findBinary.mockResolvedValue('/usr/bin/agy');
    const { setupProviderAvailabilityIPC } = await import('../provider-availability.service');
    setupProviderAvailabilityIPC();
    const result = await mocks.handlers.get(PROVIDERS_CHANNELS.CHECK_SINGLE)!({}, 'antigravity');
    expect(result).toMatchObject({ success: true, data: { available: false } });
    expect(mocks.findBinary).not.toHaveBeenCalled();
    expect(mocks.backendRequest).not.toHaveBeenCalledWith(
      'host.providerAuthStatus',
      expect.anything(),
    );
  });
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.handlers.clear();
    mocks.findBinary.mockResolvedValue(null);
    mocks.findBinaryStrict.mockResolvedValue(null);
    mocks.findAuggiePathStrict.mockResolvedValue(null);
    mocks.hostExec.mockResolvedValue({ stdout: '', stderr: '', exitCode: 1 });
    mocks.backendRequest.mockRejectedValue(new Error('unrouted daemon method'));
  });

  it('keys the Codex single check off the daemon-resolved codex CLI', async () => {
    const { setupProviderAvailabilityIPC } = await import('../provider-availability.service');
    setupProviderAvailabilityIPC();
    const handler = mocks.handlers.get(PROVIDERS_CHANNELS.CHECK_SINGLE);
    if (!handler) throw new Error('provider check handler was not registered');

    const result = await handler({}, 'codex');

    expect(result).toEqual({
      success: true,
      providerId: 'codex',
      data: { available: false, hasNpxFallback: true },
    });
    expect(mocks.findBinaryStrict).toHaveBeenCalledWith('codex', expect.any(Object));
  });

  describe('transient probe failures (CHECK_SINGLE returns a failure envelope, never available:false)', () => {
    // A daemon RPC failure/timeout during a probe proves nothing about
    // availability. The handler must return success:false — which the saga
    // maps to checkSingleProviderFailure, preserving the last-known status —
    // instead of success:true with a fabricated available:false.
    const setup = async () => {
      const { setupProviderAvailabilityIPC } = await import('../provider-availability.service');
      setupProviderAvailabilityIPC();
      const handler = mocks.handlers.get(PROVIDERS_CHANNELS.CHECK_SINGLE);
      if (!handler) throw new Error('provider check handler was not registered');
      return handler;
    };

    it.each(['codex', 'cortex', 'opencode', 'pi', 'droid', 'grok', 'unsloth'])(
      'returns a failure envelope when the %s binary probe RPC fails',
      async (providerId) => {
        routeBackend({});
        mocks.findBinaryStrict.mockRejectedValue(new Error('transport down'));
        const handler = await setup();

        const result = await handler({}, providerId);

        expect(result).toEqual({
          success: false,
          providerId,
          error: 'transport down',
        });
      },
    );

    it('returns a failure envelope when the auggie host.checkAuggie RPC fails', async () => {
      routeBackend({});
      mocks.findAuggiePathStrict.mockRejectedValue(new Error('transport down'));
      const handler = await setup();

      const result = await handler({}, 'auggie');

      expect(result).toEqual({
        success: false,
        providerId: 'auggie',
        error: 'transport down',
      });
    });
  });

  describe('Claude daemon discovery', () => {
    const discovery = (
      row: { installed: boolean; resolvedPath?: string | null; gatedOff?: string | null } | null,
    ) => ({
      ...EMPTY_DISCOVERY,
      npx: row?.resolvedPath
        ? { resolvedPath: row.resolvedPath, version: '10.0.0', versionOk: true }
        : EMPTY_DISCOVERY.npx,
      providers: EMPTY_DISCOVERY.providers.flatMap((provider) =>
        provider.id !== 'claude-code' ? [provider] : row ? [{ ...provider, ...row }] : [],
      ),
    });

    it.each([
      [
        'bundled runtime without a standalone CLI',
        { installed: true, resolvedPath: '/usr/bin/npx' },
      ],
      ['valid adapter override without npx', { installed: true, resolvedPath: undefined }],
    ])('uses discovery for %s and preserves auth tri-state', async (_label, row) => {
      for (const authenticated of [true, false, null]) {
        routeBackend({
          'host.providerDiscovery': discovery(row),
          'host.providerAuthStatus': authSweep({ 'claude-code': authenticated }),
        });
        mocks.backendRequest.mockClear();
        const { setupProviderAvailabilityIPC } = await import('../provider-availability.service');
        setupProviderAvailabilityIPC();
        const single = await mocks.handlers.get(PROVIDERS_CHANNELS.CHECK_SINGLE)!(
          {},
          { providerId: 'claude-code', force: false },
        );
        expect(single).toEqual({
          success: true,
          providerId: 'claude-code',
          data: {
            available: true,
            hasNpxFallback: false,
            authenticated: authenticated ?? undefined,
          },
        });
        expect(
          mocks.backendRequest.mock.calls.filter(([method]) => method === 'host.providerDiscovery'),
        ).toEqual([['host.providerDiscovery', {}]]);
        expect(mocks.backendRequest).toHaveBeenCalledWith('host.providerAuthStatus', {
          providerId: 'claude-code',
          force: false,
        });
      }
      expect(mocks.findBinaryStrict).not.toHaveBeenCalled();
      expect(mocks.findBinary).not.toHaveBeenCalled();
    });

    it.each([
      ['uninstalled', { installed: false }, CLAUDE_CODE_NPX_MISSING_WARNING],
      ['gated', { installed: false, gatedOff: 'TEST_GATE' }, undefined],
      ['missing', null, undefined],
    ])(
      'keeps a %s row unavailable without binary probes or duplicate discovery',
      async (_label, row, warning) => {
        routeBackend({
          'host.providerDiscovery': discovery(row),
          'host.providerAuthStatus': authSweep({ 'claude-code': true }),
        });
        mocks.backendRequest.mockClear();
        const { setupProviderAvailabilityIPC } = await import('../provider-availability.service');
        setupProviderAvailabilityIPC();
        const single = await mocks.handlers.get(PROVIDERS_CHANNELS.CHECK_SINGLE)!(
          {},
          'claude-code',
        );
        expect(single).toEqual({
          success: true,
          providerId: 'claude-code',
          data: { available: false, hasNpxFallback: false, warning },
        });
        expect(single.data.authenticated).toBeUndefined();
        expect(mocks.backendRequest.mock.calls).toEqual([['host.providerDiscovery', {}]]);
        expect(mocks.findBinaryStrict).not.toHaveBeenCalled();
        expect(mocks.findBinary).not.toHaveBeenCalled();
      },
    );

    it('does not claim npx is missing when discovery has no npx verdict', async () => {
      routeBackend({
        'host.providerDiscovery': { ...discovery({ installed: false }), npx: undefined },
      });
      const { setupProviderAvailabilityIPC } = await import('../provider-availability.service');
      setupProviderAvailabilityIPC();
      const result = await mocks.handlers.get(PROVIDERS_CHANNELS.CHECK_SINGLE)!({}, 'claude-code');
      expect(result).toMatchObject({ success: true, data: { available: false } });
      expect(result.data.warning).toBeUndefined();
      expect(mocks.findBinaryStrict).not.toHaveBeenCalled();
    });

    it('preserves the single-check failure envelope when discovery fails', async () => {
      mocks.backendRequest.mockRejectedValue(new Error('discovery transport down'));
      const { setupProviderAvailabilityIPC } = await import('../provider-availability.service');
      setupProviderAvailabilityIPC();
      expect(await mocks.handlers.get(PROVIDERS_CHANNELS.CHECK_SINGLE)!({}, 'claude-code')).toEqual(
        {
          success: false,
          providerId: 'claude-code',
          error: 'discovery transport down',
        },
      );
      expect(mocks.findBinaryStrict).not.toHaveBeenCalled();
    });
  });

  it('rechecks a single provider with a forced providerAuthStatus verdict', async () => {
    routeBackend({
      'host.providerAuthStatus': { providers: [{ id: 'codex', authenticated: true }] },
    });
    mocks.findBinaryStrict.mockImplementation(async (name: string) =>
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
      data: { available: true, authenticated: true, hasNpxFallback: true },
    });
  });

  it('rides the daemon auth cache when the request carries force:false', async () => {
    routeBackend({
      'host.providerAuthStatus': { providers: [{ id: 'codex', authenticated: true }] },
    });
    mocks.findBinaryStrict.mockImplementation(async (name: string) =>
      name === 'codex' ? '/usr/local/bin/codex' : null,
    );

    const { setupProviderAvailabilityIPC } = await import('../provider-availability.service');
    setupProviderAvailabilityIPC();
    const handler = mocks.handlers.get(PROVIDERS_CHANNELS.CHECK_SINGLE);
    if (!handler) throw new Error('provider check handler was not registered');

    const result = await handler({}, { providerId: 'codex', force: false });

    // Passive bulk loads (onboarding first mount) must not re-probe every
    // CLI — they read the daemon's cached verdict.
    expect(mocks.backendRequest).toHaveBeenCalledWith('host.providerAuthStatus', {
      providerId: 'codex',
      force: false,
    });
    expect(result).toEqual({
      success: true,
      providerId: 'codex',
      data: { available: true, authenticated: true, hasNpxFallback: true },
    });
  });

  it('single recheck surfaces a logged-out verdict as authenticated:false', async () => {
    routeBackend({
      'host.providerAuthStatus': { providers: [{ id: 'droid', authenticated: false }] },
    });
    mocks.findBinaryStrict.mockImplementation(async (name: string) =>
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

  it('single recheck attaches the host.providerAuthStatus identity line and omits it without one', async () => {
    routeBackend({
      'host.providerDiscovery': {
        ...EMPTY_DISCOVERY,
        providers: [{ ...EMPTY_DISCOVERY.providers[1], installed: true }],
      },
      'host.providerAuthStatus': {
        providers: [
          {
            id: 'claude-code',
            authenticated: true,
            identity: { email: 'dev@example.com', orgName: 'Example Org', subscriptionType: 'max' },
          },
        ],
      },
    });

    const { setupProviderAvailabilityIPC } = await import('../provider-availability.service');
    setupProviderAvailabilityIPC();
    const handler = mocks.handlers.get(PROVIDERS_CHANNELS.CHECK_SINGLE);
    if (!handler) throw new Error('provider check handler was not registered');

    const withIdentity = await handler({}, 'claude-code');
    expect(withIdentity).toEqual({
      success: true,
      providerId: 'claude-code',
      data: {
        available: true,
        hasNpxFallback: false,
        authenticated: true,
        authDetails: 'dev@example.com · Example Org',
      },
    });

    // The same recheck against a daemon that sent no `identity` object
    // yields no authDetails key at all.
    routeBackend({
      'host.providerDiscovery': {
        ...EMPTY_DISCOVERY,
        providers: [{ ...EMPTY_DISCOVERY.providers[1], installed: true }],
      },
      'host.providerAuthStatus': { providers: [{ id: 'claude-code', authenticated: true }] },
    });
    const withoutIdentity = await handler({}, 'claude-code');
    expect(withoutIdentity).toEqual({
      success: true,
      providerId: 'claude-code',
      data: { available: true, hasNpxFallback: false, authenticated: true },
    });
    expect(withoutIdentity.data).not.toHaveProperty('authDetails');
  });

  it('single recheck resolves unsloth off both opencode and unsloth binaries without an auth probe', async () => {
    routeBackend({});
    mocks.findBinaryStrict.mockImplementation(async (name: string) =>
      name === 'opencode' || name === 'unsloth' ? `/usr/local/bin/${name}` : null,
    );

    const { setupProviderAvailabilityIPC } = await import('../provider-availability.service');
    setupProviderAvailabilityIPC();
    const handler = mocks.handlers.get(PROVIDERS_CHANNELS.CHECK_SINGLE);
    if (!handler) throw new Error('provider check handler was not registered');

    const result = await handler({}, 'unsloth');

    // Local-only provider: available ⇒ authenticated, no providerAuthStatus call.
    expect(mocks.backendRequest).not.toHaveBeenCalledWith(
      'host.providerAuthStatus',
      expect.anything(),
    );
    expect(result).toEqual({
      success: true,
      providerId: 'unsloth',
      data: { available: true, authenticated: true },
    });
  });

  it('single recheck reports unsloth unavailable when opencode is missing', async () => {
    routeBackend({});
    mocks.findBinaryStrict.mockImplementation(async (name: string) =>
      name === 'unsloth' ? '/usr/local/bin/unsloth' : null,
    );

    const { setupProviderAvailabilityIPC } = await import('../provider-availability.service');
    setupProviderAvailabilityIPC();
    const handler = mocks.handlers.get(PROVIDERS_CHANNELS.CHECK_SINGLE);
    if (!handler) throw new Error('provider check handler was not registered');

    const result = await handler({}, 'unsloth');

    expect(result).toEqual({ success: true, providerId: 'unsloth', data: { available: false } });
  });

  it('single recheck reports unsloth unavailable when the unsloth CLI is missing', async () => {
    routeBackend({});
    mocks.findBinaryStrict.mockImplementation(async (name: string) =>
      name === 'opencode' ? '/usr/local/bin/opencode' : null,
    );

    const { setupProviderAvailabilityIPC } = await import('../provider-availability.service');
    setupProviderAvailabilityIPC();
    const handler = mocks.handlers.get(PROVIDERS_CHANNELS.CHECK_SINGLE);
    if (!handler) throw new Error('provider check handler was not registered');

    const result = await handler({}, 'unsloth');

    expect(result).toEqual({ success: true, providerId: 'unsloth', data: { available: false } });
  });

  it('single recheck reports unsloth unavailable when neither binary is present', async () => {
    routeBackend({});
    mocks.findBinaryStrict.mockResolvedValue(null);

    const { setupProviderAvailabilityIPC } = await import('../provider-availability.service');
    setupProviderAvailabilityIPC();
    const handler = mocks.handlers.get(PROVIDERS_CHANNELS.CHECK_SINGLE);
    if (!handler) throw new Error('provider check handler was not registered');

    const result = await handler({}, 'unsloth');

    expect(result).toEqual({ success: true, providerId: 'unsloth', data: { available: false } });
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

  it('single recheck probes cortex directly (no feature-code gate)', async () => {
    routeBackend({});
    mocks.findBinaryStrict.mockImplementation(async (name: string) =>
      name === 'cortex' ? '/usr/local/bin/cortex' : null,
    );

    const { setupProviderAvailabilityIPC } = await import('../provider-availability.service');
    setupProviderAvailabilityIPC();
    const handler = mocks.handlers.get(PROVIDERS_CHANNELS.CHECK_SINGLE);
    if (!handler) throw new Error('provider check handler was not registered');

    const result = await handler({}, 'cortex');

    expect(result).toEqual({ success: true, providerId: 'cortex', data: { available: true } });
  });
});

describe('onboarding adapter preparation IPC', () => {
  it('captures the sender backend before discovery and never follows a later host switch', async () => {
    const { setupProviderAvailabilityIPC } = await import('../provider-availability.service');
    setupProviderAvailabilityIPC();
    let resolveDiscovery!: (value: {
      providers: Array<{ id: string; installed: boolean }>;
    }) => void;
    const discovery = new Promise<{ providers: Array<{ id: string; installed: boolean }> }>(
      (resolve) => {
        resolveDiscovery = resolve;
      },
    );
    const requestA = vi.fn(async (method) =>
      method === 'host.providerDiscovery' ? discovery : { accepted: true },
    );
    const requestB = vi.fn();
    mocks.clientForEvent.mockReturnValue({ client: { request: requestA } });
    const event = { sender: { id: 42 } };
    const handler = mocks.handlers.get(PROVIDERS_CHANNELS.PREPARE_ADAPTERS)!;
    const result = handler(event, 'a:1');
    mocks.clientForEvent.mockReturnValue({ client: { request: requestB } });
    resolveDiscovery({ providers: [{ id: 'codex', installed: true }] });
    await result;
    expect(mocks.clientForEvent).toHaveBeenCalledWith(event);
    expect(requestA.mock.calls).toEqual([
      ['host.providerDiscovery', {}],
      ['host.prepareProviderAdapters', { providerIds: ['codex'] }],
    ]);
    expect(requestB).not.toHaveBeenCalled();
  });

  it('does not perform discovery for a malformed IPC request', async () => {
    const { setupProviderAvailabilityIPC } = await import('../provider-availability.service');
    setupProviderAvailabilityIPC();
    mocks.clientForEvent.mockClear();
    const handler = mocks.handlers.get(PROVIDERS_CHANNELS.PREPARE_ADAPTERS)!;
    await handler({}, undefined);
    await handler({}, { providerIds: ['pi'] });
    expect(mocks.clientForEvent).not.toHaveBeenCalled();
  });
});
