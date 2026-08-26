import { describe, expect, it } from 'vitest';
import { GENERATED_CLIENT_PROBE_PATH, buildWaitOnTargets } from './dev-electron-lib.mjs';

describe('GENERATED_CLIENT_PROBE_PATH', () => {
  it('points at the first generated SvelteKit client node', () => {
    // The path the renderer's failed dynamic import reported in
    // intent-hq/monorepo#3524 — node 0 is the root layout, imported by every
    // route, so it proves the generated client tree is servable.
    expect(GENERATED_CLIENT_PROBE_PATH).toBe('/.svelte-kit/generated/client/nodes/0.js');
  });
});

describe('buildWaitOnTargets', () => {
  it('gates on the TCP listener, the generated-client HTTP probe, and the sentinels', () => {
    expect(
      buildWaitOnTargets('5190', ['/repo/dist/.dev-ready-main', '/repo/dist/.dev-ready-preload']),
    ).toEqual([
      'tcp:127.0.0.1:5190',
      'http-get://127.0.0.1:5190/.svelte-kit/generated/client/nodes/0.js',
      '/repo/dist/.dev-ready-main',
      '/repo/dist/.dev-ready-preload',
    ]);
  });

  it('probes over 127.0.0.1, never localhost (IPv6 binding issues on Linux)', () => {
    for (const target of buildWaitOnTargets(4173, [])) {
      expect(target).toContain('127.0.0.1');
      expect(target).not.toContain('localhost');
    }
  });

  it('uses http-get so wait-on retries until the module actually returns 2xx', () => {
    const [, probe] = buildWaitOnTargets(5190, []);
    expect(probe.startsWith('http-get://')).toBe(true);
  });
});
