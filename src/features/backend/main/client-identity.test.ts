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
