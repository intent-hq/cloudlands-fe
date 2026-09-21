import { describe, expect, it } from 'vitest';
import {
  GENERATED_CLIENT_PROBE_PATH,
  WAIT_ON_TIMEOUT_MS,
  buildWaitOnEnv,
  buildWaitOnTargets,
  resolveWaitOnTimeoutMs,
} from './dev-electron-lib.mjs';

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

describe('WAIT_ON_TIMEOUT_MS', () => {
  it('bounds the wait so a wedged probe fails loudly instead of hanging forever', () => {
    expect(WAIT_ON_TIMEOUT_MS).toBe(300000);
  });
});

describe('resolveWaitOnTimeoutMs', () => {
  it('uses the default when the override is unset', () => {
    expect(resolveWaitOnTimeoutMs({})).toBe(300000);
  });

  it('uses a positive integer override', () => {
    expect(resolveWaitOnTimeoutMs({ DEV_WAIT_ON_TIMEOUT_MS: '600000' })).toBe(600000);
  });

  it.each(['abc', '0', '-5'])('warns and uses the default for invalid value %s', (value) => {
    const warnings: string[] = [];
    expect(
      resolveWaitOnTimeoutMs({ DEV_WAIT_ON_TIMEOUT_MS: value }, (warning) =>
        warnings.push(warning),
      ),
    ).toBe(300000);
    expect(warnings).toEqual([
      `Invalid DEV_WAIT_ON_TIMEOUT_MS=${JSON.stringify(value)}; using 300000ms.`,
    ]);
  });
});

describe('buildWaitOnEnv', () => {
  it('adds 127.0.0.1 to NO_PROXY so the http-get probe bypasses any proxy', () => {
    expect(buildWaitOnEnv({}).NO_PROXY).toBe('127.0.0.1');
  });

  it('appends to an existing NO_PROXY without dropping entries', () => {
    expect(buildWaitOnEnv({ NO_PROXY: 'internal.example' }).NO_PROXY).toBe(
      'internal.example,127.0.0.1',
    );
  });

  it('honors lowercase no_proxy when NO_PROXY is unset', () => {
    expect(buildWaitOnEnv({ no_proxy: 'internal.example' }).NO_PROXY).toBe(
      'internal.example,127.0.0.1',
    );
  });

  it('preserves the rest of the environment', () => {
    const env = buildWaitOnEnv({ HTTP_PROXY: 'http://proxy:3128', PATH: '/bin' });
    expect(env.HTTP_PROXY).toBe('http://proxy:3128');
    expect(env.PATH).toBe('/bin');
  });
});
