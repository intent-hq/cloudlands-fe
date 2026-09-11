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

  it('persists a daemon-minted clientId and presents it thereafter', async () => {
    const { getOrCreateClientId, persistClientId } = await import('./client-identity');
    await getOrCreateClientId();
    await persistClientId('cli-9b21');
    expect(await getOrCreateClientId()).toBe('cli-9b21');

    await (await import('../../../main/local-prefs')).__drainLocalPrefsWriteChainForTesting();
    vi.resetModules();
    mockElectron();
    expect(await (await import('./client-identity')).getOrCreateClientId()).toBe('cli-9b21');
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
