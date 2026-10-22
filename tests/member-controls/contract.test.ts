/** @vitest-environment node */
// Pure checks only: no daemon, TLS, browser, subprocess, download or namespace.
import { describe, expect, it, vi } from 'vitest';
// vitest's app config aliases ws to a browser stub. Load the installed Node
// module for constants only; no constructor, network or workload is invoked.
vi.mock('ws', async () => {
  const { createRequire } = await import('node:module');
  const ws = createRequire(import.meta.url)('ws');
  return { ...ws, default: ws };
});
import { readFileSync } from 'node:fs';
import { checkRelease } from './acquire.mjs';
import { OriginalSocketHold, digest, forbidden, sanitizeEvidence } from './wire.mjs';
const plan = JSON.parse(readFileSync(new URL('./plan.json', import.meta.url), 'utf8'));
describe('new disposable member harness contracts (inert)', () => {
  it('has no preparation-to-execution approval transfer', () => {
    for (const key of ['buildReady', 'buildAuthorized', 'startAuthorized', 'launchReady'])
      expect(plan[key]).toBe(false);
    expect(
      readFileSync(
        new URL('../../.github/workflows/member-controls-disposable.yml', import.meta.url),
        'utf8',
      ),
    ).toContain('if: ${{ false }}');
    expect(plan.budgets).toMatchObject({
      actionMs: 15000,
      statusMs: 30000,
      retries: 0,
      uiSeconds: 1800,
      cleanupSeconds: 600,
    });
  });
  it('requires release, tag, asset ID, size and published digest together', () => {
    const c = plan.candidate,
      asset = { id: c.assetId, name: c.name, size: c.bytes, digest: `sha256:${c.sha256}` };
    const release = { id: c.releaseId, tag_name: `v${c.version}`, draft: false, assets: [asset] };
    expect(() => checkRelease(release, { sha: c.commit }, asset)).not.toThrow();
    for (const changed of [
      { ...asset, id: 1 },
      { ...asset, size: c.bytes - 1 },
      { ...asset, digest: 'sha256:wrong' },
    ])
      expect(() => checkRelease(release, { sha: c.commit }, changed)).toThrow();
    expect(() => checkRelease(release, { sha: 'another-source' }, asset)).toThrow();
  });
  it('preserves original response bytes and refuses a second owned hold', () => {
    const hold = new OriginalSocketHold(),
      sent: Buffer[] = [];
    const bytes = Buffer.from('{"jsonrpc":"2.0","id":3,"result":{"host":"canonical.example"}}');
    hold.arm();
    expect(() => hold.arm()).toThrow();
    expect(
      hold.take({
        bytes,
        upstream: { readyState: 1 },
        downstream: { readyState: 1, send: (b: Buffer) => sent.push(b) },
        socketId: 'actual-original',
        requestId: 3,
      }),
    ).toBe(true);
    expect(hold.release()).toMatchObject({
      disposition: 'delivered-original-socket',
      sha256: digest(bytes),
    });
    expect(sent).toEqual([bytes]);
    expect(() => hold.release()).toThrow();
  });
  it('closed-origin discard never retargets or proves stale delivery', () => {
    const hold = new OriginalSocketHold();
    hold.arm();
    hold.take({
      bytes: Buffer.from('actual-held-data'),
      upstream: { readyState: 3 },
      downstream: {
        readyState: 3,
        send: () => {
          throw new Error('must not deliver');
        },
      },
      socketId: 'closed',
      requestId: 4,
    });
    expect(hold.release()).toMatchObject({
      disposition: 'closed-origin-discard',
      staleSagaDeliveryProved: false,
    });
  });
  it('owner status reads do not confer account mutation permission', () => {
    for (const method of [
      'sourceControl.connect',
      'sourceControl.cancelAuth',
      'sourceControl.revoke',
      'github.connect',
      'github.pollForToken',
    ])
      expect(forbidden({ method })).toBe(true);
    expect(forbidden({ method: 'sourceControl.authStatus' })).toBe(false);
  });
  it('redacts rendered invite capabilities and secret fields before evidence persistence', () => {
    const row = sanitizeEvidence({
      aria: 'link https://join.invalid/invite/one?secret=private#token',
      token: 'private',
      nested: { secret: 'private' },
    });
    expect(JSON.stringify(row)).not.toContain('private');
    expect(row.aria).toContain('https://join.invalid/invite/one');
  });
});
