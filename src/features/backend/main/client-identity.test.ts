import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

/**
 * Stable §5.17 client identity: a UUID minted once per install, persisted in
 * the FE-local prefs file, and re-presented on every `client.hello`. Regression
 * coverage for the New Workspace draft-loss bug: without a persisted clientId
 * every reload minted a fresh identity and orphaned `drafts.*` state (§5.16).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let tmpDir: string;

/** Re-mock electron so local-prefs writes land in this test's temp userData. */
function mockElectron(): void {
  vi.doMock('electron', () => ({
    app: { getPath: () => tmpDir },
  }));
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'client-identity-'));
  vi.resetModules();
  mockElectron();
});

afterEach(async () => {
  const { __drainLocalPrefsWriteChainForTesting } = await import('../../../main/local-prefs');
  await __drainLocalPrefsWriteChainForTesting();
  await fs.rm(tmpDir, { recursive: true, force: true });
  vi.doUnmock('electron');
});

describe('client-identity (§5.17 stable clientId)', () => {
  it('mints a UUID on first use and persists it to local-prefs', async () => {
    const { getOrCreateClientId } = await import('./client-identity');
    const id = await getOrCreateClientId();
    expect(id).toMatch(UUID_RE);

    const { __drainLocalPrefsWriteChainForTesting } = await import('../../../main/local-prefs');
    await __drainLocalPrefsWriteChainForTesting();
    const raw = JSON.parse(await fs.readFile(path.join(tmpDir, 'local-prefs.json'), 'utf8'));
    expect(raw.backendClientId).toBe(id);
  });

  it('returns the same clientId on repeated and concurrent calls', async () => {
    const { getOrCreateClientId } = await import('./client-identity');
    const [a, b] = await Promise.all([getOrCreateClientId(), getOrCreateClientId()]);
    expect(b).toBe(a);
    expect(await getOrCreateClientId()).toBe(a);
  });

  it('re-reads the persisted clientId after an app restart (module reload)', async () => {
    const first = await (await import('./client-identity')).getOrCreateClientId();
    await (await import('../../../main/local-prefs')).__drainLocalPrefsWriteChainForTesting();

    // Simulate an app restart: fresh module registry, same userData dir.
    vi.resetModules();
    mockElectron();
    const second = await (await import('./client-identity')).getOrCreateClientId();
    expect(second).toBe(first);
  });

  it('persists a daemon-minted clientId only for its transport context', async () => {
    const { getOrCreateClientId, persistClientId } = await import('./client-identity');
    const seed = await getOrCreateClientId();
    const config = { transport: 'uds' as const, socketPath: '/test/daemon.sock' };
    await persistClientId('cli-9b21', config);
    expect(await getOrCreateClientId(config)).toBe('cli-9b21');
    expect(await getOrCreateClientId()).toBe(seed);

    await (await import('../../../main/local-prefs')).__drainLocalPrefsWriteChainForTesting();
    vi.resetModules();
    mockElectron();
    expect(await (await import('./client-identity')).getOrCreateClientId(config)).toBe('cli-9b21');
  });
  it('isolates credentials, certificate pins, endpoints and local sockets across restart', async () => {
    const identity = await import('./client-identity');
    const seed = await identity.getOrCreateClientId();
    const config = {
      transport: 'wss' as const,
      host: 'daemon.test',
      port: 443,
      fingerprint: 'AA:BB',
      token: 'private-fixture-token',
    };
    await identity.persistClientId('canonical-one', config);
    const variants = [
      { ...config, token: 'another-principal-token' },
      { ...config, fingerprint: 'CC:DD' },
      { ...config, host: 'another-daemon.test' },
      { ...config, port: 444 },
      { transport: 'uds' as const, socketPath: '/different/daemon.sock' },
    ];
    for (const variant of variants) expect(await identity.getOrCreateClientId(variant)).toBe(seed);
    await identity.persistClientId('canonical-two', variants[0]);
    await (await import('../../../main/local-prefs')).__drainLocalPrefsWriteChainForTesting();
    const serialized = await fs.readFile(path.join(tmpDir, 'local-prefs.json'), 'utf8');
    for (const secret of [config.token, 'another-principal-token', config.host]) {
      expect(serialized).not.toContain(secret);
    }
    vi.resetModules();
    mockElectron();
    const restarted = await import('./client-identity');
    expect(await restarted.getOrCreateClientId(config)).toBe('canonical-one');
    expect(await restarted.getOrCreateClientId(variants[0])).toBe('canonical-two');
    expect(await restarted.getOrCreateClientId()).toBe(seed);
  });

  it('captures the transport context before asynchronous preferences work', async () => {
    const identity = await import('./client-identity');
    const original = { transport: 'wss' as const, host: 'one', token: 'first-principal' };
    const mutable = { ...original };
    const pendingWrite = identity.persistClientId('first-canonical', mutable);
    mutable.token = 'second-principal';
    await pendingWrite;
    const pendingRead = identity.getOrCreateClientId(mutable);
    mutable.token = original.token;
    expect(await pendingRead).toBe(await identity.getOrCreateClientId());
    expect(await identity.getOrCreateClientId(original)).toBe('first-canonical');
  });

  it('preserves concurrent canonical writes and normalizes certificate formatting', async () => {
    const identity = await import('./client-identity');
    const first = { transport: 'wss' as const, host: 'one', token: 'one', fingerprint: 'AA:BB' };
    const second = { ...first, token: 'two' };
    await Promise.all([
      identity.persistClientId('canonical-one', first),
      identity.persistClientId('canonical-two', second),
    ]);
    await (await import('../../../main/local-prefs')).__drainLocalPrefsWriteChainForTesting();
    vi.resetModules();
    mockElectron();
    const restarted = await import('./client-identity');
    expect(await restarted.getOrCreateClientId({ ...first, fingerprint: 'aabb' })).toBe(
      'canonical-one',
    );
    expect(await restarted.getOrCreateClientId(second)).toBe('canonical-two');
  });
});

/**
 * REV-2 (§5.17): the MAIN pooled client — the one connection that serves the
 * `browser.exec` reverse handler — hellos with the product name, the host
 * triple, and `capabilities.browserExec: true` on top of the stable clientId.
 * Auxiliary clients keep presenting the bare `{ clientId }` (asserted where
 * each is built, e.g. workspace-transfer.ipc.test.ts).
 */
describe('client-identity (REV-2 main-client hello params)', () => {
  it('builds the main hello params: stable clientId + name + hostname + browserExec', async () => {
    const { buildMainClientHelloParams, getOrCreateClientId } = await import('./client-identity');
    const params = await buildMainClientHelloParams();

    expect(params).toEqual({
      clientId: await getOrCreateClientId(),
      name: 'Intent Desktop',
      hostname: os.hostname(),
      capabilities: { browserExec: true },
    });
    // The triple learned from the local daemon is absent until captured —
    // never defaulted, so the daemon's client row stays truthful.
    expect(params).not.toHaveProperty('prettyHostname');
    expect(params).not.toHaveProperty('deviceKind');
  });

  it('adds prettyHostname/deviceKind from a local host.status result and reports changes', async () => {
    const { buildMainClientHelloParams, setLocalHostIdentity } = await import('./client-identity');

    // PROTOCOL §5.14 `host.status` shape (fields the FE reads).
    const hostStatus = {
      hostname: 'dev-box.local',
      prettyHostname: ' Clément’s Mac Studio ',
      deviceKind: 'macStudio',
      os: 'macos',
      arch: 'aarch64',
    };
    expect(setLocalHostIdentity(hostStatus)).toBe(true);
    expect(setLocalHostIdentity(hostStatus)).toBe(false);

    const params = await buildMainClientHelloParams();
    expect(params.prettyHostname).toBe('Clément’s Mac Studio');
    expect(params.deviceKind).toBe('macStudio');
    // `hostname` is this process's OS hostname, not the daemon-reported one:
    // the daemon's row identifies the machine the APP runs on.
    expect(params.hostname).toBe(os.hostname());
    expect(params.capabilities).toEqual({ browserExec: true });
  });

  it('drops an unknown deviceKind and a blank prettyHostname instead of forwarding them', async () => {
    const { buildMainClientHelloParams, setLocalHostIdentity } = await import('./client-identity');

    expect(
      setLocalHostIdentity({ hostname: 'x', prettyHostname: '   ', deviceKind: 'toaster' }),
    ).toBe(false);
    const params = await buildMainClientHelloParams();
    expect(params).not.toHaveProperty('prettyHostname');
    expect(params).not.toHaveProperty('deviceKind');

    // Losing the triple (e.g. the daemon stops reporting it) is a change too.
    expect(setLocalHostIdentity({ prettyHostname: 'Box', deviceKind: 'laptop' })).toBe(true);
    expect(setLocalHostIdentity(null)).toBe(true);
    expect(await buildMainClientHelloParams()).not.toHaveProperty('deviceKind');
  });
});
