import { describe, expect, it } from 'vitest';
import {
  extractEnabledProviderIds,
  extractHostArch,
  extractHostOs,
  extractInstalledProviders,
  onlyEnabledProviders,
} from './machine-host-facts';

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

describe('extractHostArch', () => {
  it('reads the host.status arch field and is null when absent', () => {
    expect(extractHostArch({ os: 'linux', arch: 'x86_64' })).toBe('x86_64');
    expect(extractHostArch({ os: 'linux' })).toBeNull();
    expect(extractHostArch({ arch: '' })).toBeNull();
    expect(extractHostArch(null)).toBeNull();
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

describe('extractEnabledProviderIds', () => {
  it('reads host.executionContext enabledProviderIds', () => {
    expect(
      extractEnabledProviderIds({
        defaultProviderId: null,
        enabledProviderIds: ['claude-code', 'codex'],
      }),
    ).toEqual(['claude-code', 'codex']);
    expect(extractEnabledProviderIds({ enabledProviderIds: [] })).toEqual([]);
  });

  it('is null (unknown) when the projection is missing or malformed, as on an older host', () => {
    expect(extractEnabledProviderIds({ defaultProviderId: null })).toBeNull();
    expect(extractEnabledProviderIds({ enabledProviderIds: 'codex' })).toBeNull();
    expect(extractEnabledProviderIds({ enabledProviderIds: ['codex', 7] })).toBeNull();
    expect(extractEnabledProviderIds({ enabledProviderIds: ['codex', ''] })).toBeNull();
    expect(extractEnabledProviderIds(null)).toBeNull();
  });
});

describe('onlyEnabledProviders', () => {
  const installed = [
    { id: 'claude-code', displayName: 'Claude Code' },
    { id: 'codex', displayName: 'Codex' },
  ];

  it('hides an installed provider that is disabled on that host', () => {
    expect(onlyEnabledProviders(installed, ['claude-code'])).toEqual([
      { id: 'claude-code', displayName: 'Claude Code' },
    ]);
    expect(onlyEnabledProviders(installed, [])).toEqual([]);
  });

  it('keeps every installed provider when enablement is unknown', () => {
    expect(onlyEnabledProviders(installed, null)).toEqual(installed);
  });

  it('stays unknown while the installed providers are unknown', () => {
    expect(onlyEnabledProviders(null, ['codex'])).toBeNull();
  });
});
