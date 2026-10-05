/**
 * Regression-first reproduction: real pool hello providers + real client-identity
 * and local-prefs, with only sockets/windows replaced. No production daemon runs.
 * Canonical responses are protocol fixtures, not proof of the ClementOS incident.
 */
import { app, BrowserWindow } from 'electron';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type HelloOptions = {
  config: unknown;
  helloParams: () => Promise<Record<string, unknown>>;
  onHelloResult: (result: unknown) => unknown;
};
// eslint-disable-next-line themis/collection-state-shape -- test-only constructor recorder, not Redux state
const fixture = vi.hoisted(() => ({ options: [] as HelloOptions[], userData: '' }));

vi.mock('../../../../shared/paraglide/messages.js', async (original) => original());
vi.mock('../json-rpc-client', () => ({
  JsonRpcClient: class {
    constructor(private readonly options: HelloOptions) {
      fixture.options.push(options);
    }
    on(): this {
      return this;
    }
    off(): this {
      return this;
    }
    start(): void {}
    dispose(): void {}
    request = vi.fn(async () => ({}));
    registerMethod(): () => void {
      return () => {};
    }
    getConfig(): unknown {
      return this.options.config;
    }
    getStatus(): string {
      return 'disconnected';
    }
    getConnectedVia(): null {
      return null;
    }
    getReconnectAttempts(): number {
      return 0;
    }
    isConnectionLimited(): boolean {
      return false;
    }
    getConnectionLimitRetryAfterMs(): null {
      return null;
    }
  },
}));
vi.mock('../intentd-sidecar', () => ({
  onSidecarGaveUp: vi.fn(),
  onSidecarStartupFailed: vi.fn(() => () => {}),
  getSidecarRunLog: vi.fn(() => ({ available: false })),
  getSidecarStartupFailure: vi.fn(() => null),
  getLocalDaemonProtocolVersion: vi.fn(() => null),
  spawnSidecarOnDemand: vi.fn(),
}));
vi.mock('../intentd-version-pin', () => ({ readPinnedVersion: () => '0.1.0' }));
vi.mock('../../../browser/main/browser-exec-reverse', () => ({
  registerBrowserExecReverseHandler: vi.fn(),
}));
vi.mock('../connections-store', async (original) => ({
  ...(await original<typeof import('../connections-store')>()),
  list: vi.fn(async () =>
    ['backend-a', 'backend-b'].map((id) => ({
      id,
      isLocal: false,
      host: `${id}.example`,
      hosts: [`${id}.example`],
      port: 443,
      fingerprint: 'AA:BB:CC',
    })),
  ),
  getDecryptedToken: vi.fn(async () => 'test-only-token'),
  setDaemonVersion: vi.fn(async () => false),
  setUpdateSupported: vi.fn(async () => false),
  setTcAddress: vi.fn(async () => false),
  setHosts: vi.fn(async () => false),
  getDetectHosts: vi.fn(async () => false),
}));

const RAW = '11111111-2222-4333-8444-555555555555';
const A = `principal-a:${RAW}`;
const B = `principal-b:${RAW}`;
const helloResult = (clientId: string) => ({
  clientId,
  protocolVersion: '2.2',
  server: {
    locality: 'remote',
    hasDisplay: true,
    osArch: 'linux/x86_64',
    version: '0.1.0',
    protocolVersion: '2.2',
    capabilities: { liveState: true },
  },
});

async function drainPrefs() {
  await (await import('../../../../main/local-prefs')).__drainLocalPrefsWriteChainForTesting();
}
async function pool() {
  const mod = await import('../backend.ipc');
  mod.__setBackendWindowHooksForTesting({ openOrFocus: vi.fn(async () => {}) });
  mod.getBackendClient();
  await mod.openBackendWindow('backend-a');
  await mod.openBackendWindow('backend-b');
  expect(fixture.options).toHaveLength(3);
  return { mod, local: fixture.options[0], a: fixture.options[1], b: fixture.options[2] };
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  fixture.options = [];
  vi.mocked((await import('../connections-store')).getDecryptedToken).mockResolvedValue(
    'test-only-token',
  );
  fixture.userData = await mkdtemp(join(tmpdir(), 'identity-isolation-'));
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([]);
  vi.spyOn(app, 'getPath').mockReturnValue(fixture.userData);
  await (await import('../../../../main/local-prefs')).setLocalPref('backendClientId', RAW);
});
afterEach(async () => {
  await drainPrefs();
  await rm(fixture.userData, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('pooled canonical client identity isolation', () => {
  it('keeps raw identity and same-principal canonical rehello stable without competing backends', async () => {
    const { local, a } = await pool();
    expect((await local.helloParams()).clientId).toBe(RAW);
    expect((await a.helloParams()).clientId).toBe(RAW);
    await a.onHelloResult(helloResult(A));
    expect((await a.helloParams()).clientId).toBe(A);
    await a.onHelloResult(helloResult(A));
    expect((await a.helloParams()).clientId).toBe(A);
  });

  it('does not change the local desktop identity after a remote principal hello', async () => {
    const { local, a } = await pool();
    await local.onHelloResult(helloResult(RAW));
    await a.onHelloResult(helloResult(A));
    expect((await local.helloParams()).clientId).toBe(RAW);
  });

  it.each([
    ['a', 'b'],
    ['b', 'a'],
  ] as const)(
    'keeps concurrent backend identities independent when %s replies before %s',
    async (first, last) => {
      const peers = await pool();
      const [aRequest, bRequest] = await Promise.all([
        peers.a.helloParams(),
        peers.b.helloParams(),
      ]);
      expect(aRequest.clientId).toBe(RAW);
      expect(bRequest.clientId).toBe(RAW);
      const results = { a: A, b: B };
      await peers[first].onHelloResult(helloResult(results[first]));
      await peers[last].onHelloResult(helloResult(results[last]));
      expect.soft((await peers.a.helloParams()).clientId).toBe(A);
      expect.soft((await peers.b.helloParams()).clientId).toBe(B);
      expect.soft((await peers.local.helloParams()).clientId).toBe(RAW);
    },
  );

  it('does not present another principal canonical ID when first connecting a backend', async () => {
    const { a, b } = await pool();
    await a.onHelloResult(helloResult(A));
    expect((await b.helloParams()).clientId).toBe(RAW);
  });

  it('retains each identity after a pool rebuild and app restart', async () => {
    const { mod, a, b } = await pool();
    await a.onHelloResult(helloResult(A));
    await b.onHelloResult(helloResult(B));
    mod.disconnectBackendClient('backend-a');
    await mod.openBackendWindow('backend-a');
    expect.soft((await fixture.options[3].helloParams()).clientId).toBe(A);
    await drainPrefs();
    vi.resetModules();
    fixture.options = [];
    const restarted = await pool();
    expect.soft((await restarted.local.helloParams()).clientId).toBe(RAW);
    expect.soft((await restarted.a.helloParams()).clientId).toBe(A);
    expect.soft((await restarted.b.helloParams()).clientId).toBe(B);
  });

  it('does not let an older pending backend reply replace a later backend identity', async () => {
    const { a, b } = await pool();
    await a.helloParams();
    await b.helloParams();
    await b.onHelloResult(helloResult(B));
    // A was started earlier but its authenticated response arrives last.
    await a.onHelloResult(helloResult(A));
    expect((await b.helloParams()).clientId).toBe(B);
  });
  it('starts a fresh identity context when the same backend changes credentials', async () => {
    const { mod, a } = await pool();
    await a.onHelloResult(helloResult(A));
    const store = await import('../connections-store');
    vi.mocked(store.getDecryptedToken).mockResolvedValue('different-principal-token');
    mod.disconnectBackendClient('backend-a');
    await mod.openBackendWindow('backend-a');
    const replacement = fixture.options[3];
    expect((await replacement.helloParams()).clientId).toBe(RAW);
    await replacement.onHelloResult(helloResult(B));
    await a.onHelloResult(helloResult('obsolete-canonical'));
    expect((await replacement.helloParams()).clientId).toBe(B);
    vi.mocked(store.getDecryptedToken).mockResolvedValue('test-only-token');
    mod.disconnectBackendClient('backend-a');
    await mod.openBackendWindow('backend-a');
    expect((await fixture.options[4].helloParams()).clientId).toBe(A);
  });

  it('ignores late canonical replies from replaced pool members in the same context', async () => {
    const { mod, a } = await pool();
    await a.onHelloResult(helloResult(A));
    mod.disconnectBackendClient('backend-a');
    await mod.openBackendWindow('backend-a');
    const replacement = fixture.options[3];
    await replacement.onHelloResult(helloResult('current-canonical'));
    await a.onHelloResult(helloResult('obsolete-canonical'));
    expect((await replacement.helloParams()).clientId).toBe('current-canonical');
  });

  it('preserves opaque legacy seed bytes without rewriting them after canonical replies', async () => {
    const legacy = 'unknown:principal:opaque:legacy-id';
    const prefs = await import('../../../../main/local-prefs');
    await prefs.setLocalPref('backendClientId', legacy);
    const { local, a, b } = await pool();
    expect((await a.helloParams()).clientId).toBe(legacy);
    await a.onHelloResult(helloResult(`authenticated-a:${legacy}`));
    expect((await b.helloParams()).clientId).toBe(legacy);
    expect((await local.helloParams()).clientId).toBe(legacy);
    await drainPrefs();
    expect(await prefs.getLocalPref('backendClientId')).toBe(legacy);
  });
});
