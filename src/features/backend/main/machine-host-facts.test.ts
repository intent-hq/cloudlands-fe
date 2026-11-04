import { describe, expect, it } from 'vitest';
import { extractHostOs, extractInstalledProviders } from './machine-host-facts';

describe('extractHostOs', () => {
  it('reads the host.status os field', () => {
    expect(extractHostOs({ os: 'macos', arch: 'aarch64', hostname: 'studio' })).toBe('macos');
  });

  it('is null when the result has no usable os', () => {
    expect(extractHostOs({ arch: 'x86_64' })).toBeNull();
    expect(extractHostOs({ os: '' })).toBeNull();
    expect(extractHostOs({ os: 7 })).toBeNull();
    expect(extractHostOs(null)).toBeNull();
    expect(extractHostOs('linux')).toBeNull();
  });
});

describe('extractInstalledProviders', () => {
  it('keeps only installed providers, in registry order, with their display names', () => {
    expect(
      extractInstalledProviders({
        providers: [
          { id: 'claude-code', displayName: 'Claude Code', installed: true, npxOnly: true },
          { id: 'pi', displayName: 'Pi', installed: false },
          { id: 'codex', displayName: 'Codex', installed: true },
        ],
        npx: { resolvedPath: '/usr/bin/npx' },
      }),
    ).toEqual([
      { id: 'claude-code', displayName: 'Claude Code' },
      { id: 'codex', displayName: 'Codex' },
    ]);
  });

  it('treats a gated provider (unavailableReason) as not available', () => {
    expect(
      extractInstalledProviders({
        providers: [
          { id: 'pi', displayName: 'Pi', installed: true, unavailableReason: 'pi CLI too old' },
        ],
      }),
    ).toEqual([]);
  });

  it('treats a provider gated off by the daemon (gatedOff) as not available', () => {
    expect(
      extractInstalledProviders({
        providers: [
          { id: 'cortex', displayName: 'Cortex', installed: true, gatedOff: 'disabled' },
          { id: 'codex', displayName: 'Codex', installed: true },
        ],
      }),
    ).toEqual([{ id: 'codex', displayName: 'Codex' }]);
  });

  it('falls back to the id when a row has no display name and skips rows without an id', () => {
    expect(
      extractInstalledProviders({
        providers: [{ id: 'grok', installed: true }, { installed: true }, null],
      }),
    ).toEqual([{ id: 'grok', displayName: 'grok' }]);
  });

  it('is null (unknown) for a malformed result rather than an empty list', () => {
    expect(extractInstalledProviders({})).toBeNull();
    expect(extractInstalledProviders(null)).toBeNull();
    expect(extractInstalledProviders({ providers: 'all' })).toBeNull();
  });
});
