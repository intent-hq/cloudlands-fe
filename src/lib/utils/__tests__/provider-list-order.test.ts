import { describe, expect, it } from 'vitest';

import {
  compareProvidersByDisplayName,
  groupProviderEntries,
  orderProviderEntries,
} from '../provider-list-order';

const entry = (id: string, displayName: string, visible = true) => ({
  id,
  displayName,
  visible,
});

describe('compareProvidersByDisplayName', () => {
  it('orders strictly alphabetically by display name', () => {
    expect(
      compareProvidersByDisplayName(
        { displayName: 'Anthropic Claude Code' },
        { displayName: 'Augment Auggie' },
      ),
    ).toBeLessThan(0);
  });
});

describe('orderProviderEntries', () => {
  it('sorts strictly alphabetically with no Auggie pinning', () => {
    const result = orderProviderEntries(
      [
        entry('codex', 'OpenAI Codex'),
        entry('auggie', 'Augment Auggie'),
        entry('claude-code', 'Anthropic Claude Code'),
        entry('grok', 'Grok CLI'),
      ],
      [],
    );
    expect(result.map((e) => e.id)).toEqual(['claude-code', 'auggie', 'grok', 'codex']);
  });

  it('drops providers on the hidden list when availability is known', () => {
    const result = orderProviderEntries(
      [
        entry('auggie', 'Augment Auggie'),
        entry('cortex', 'Snowflake Cortex', false),
        entry('mock', 'Mock Provider', false),
      ],
      ['mock'],
    );
    // Hidden list is authoritative once known: cortex stays despite visible=false.
    expect(result.map((e) => e.id)).toEqual(['auggie', 'cortex']);
  });

  it('falls back to the catalog visible flag before availability loads', () => {
    const result = orderProviderEntries(
      [
        entry('auggie', 'Augment Auggie'),
        entry('cortex', 'Snowflake Cortex', false),
        entry('claude-code', 'Anthropic Claude Code'),
      ],
      undefined,
    );
    expect(result.map((e) => e.id)).toEqual(['claude-code', 'auggie']);
  });

  it('does not mutate the input array', () => {
    const input = [entry('b', 'B'), entry('a', 'A')];
    orderProviderEntries(input, []);
    expect(input.map((e) => e.id)).toEqual(['b', 'a']);
  });
});

describe('groupProviderEntries', () => {
  it('partitions providers and sorts alphabetically within each group', () => {
    const enabledIds = new Set(['enabled-z', 'enabled-a']);
    const result = groupProviderEntries(
      [
        entry('supported-z', 'Zulu Supported'),
        entry('discovered-z', 'Zulu Discovered'),
        entry('enabled-z', 'Zulu Enabled'),
        entry('supported-a', 'Alpha Supported'),
        entry('discovered-a', 'Alpha Discovered'),
        entry('enabled-a', 'Alpha Enabled'),
      ],
      {
        isProviderEnabled: (providerId) => enabledIds.has(providerId),
        availabilityByProviderId: {
          'enabled-z': { available: false },
          'enabled-a': { available: true },
          'discovered-z': { available: true },
          'discovered-a': { available: true },
          'supported-z': { available: false },
          'supported-a': { available: false },
        },
      },
    );

    expect(result.enabled.map((provider) => provider.id)).toEqual(['enabled-a', 'enabled-z']);
    expect(result.discovered.map((provider) => provider.id)).toEqual([
      'discovered-a',
      'discovered-z',
    ]);
    expect(result.supported.map((provider) => provider.id)).toEqual(['supported-a', 'supported-z']);
  });

  it('groups an available active provider as enabled even when it is not enabled explicitly', () => {
    const result = groupProviderEntries([entry('auggie', 'Augment Auggie')], {
      isProviderEnabled: () => false,
      availabilityByProviderId: { auggie: { available: true } },
      activeProviderId: 'auggie',
    });

    expect(result.enabled.map((provider) => provider.id)).toEqual(['auggie']);
    expect(result.discovered).toEqual([]);
  });

  it('pins the active provider first while keeping the remaining enabled providers alphabetical', () => {
    const result = groupProviderEntries(
      [
        entry('middle', 'Middle Enabled'),
        entry('active', 'Zulu Active'),
        entry('alpha', 'Alpha Enabled'),
      ],
      {
        isProviderEnabled: () => true,
        availabilityByProviderId: {},
        activeProviderId: 'active',
      },
    );

    expect(result.enabled.map((provider) => provider.id)).toEqual(['active', 'alpha', 'middle']);
  });

  it('keeps enabled providers purely alphabetical when there is no active provider', () => {
    const result = groupProviderEntries(
      [entry('zulu', 'Zulu Enabled'), entry('alpha', 'Alpha Enabled')],
      {
        isProviderEnabled: () => true,
        availabilityByProviderId: {},
      },
    );

    expect(result.enabled.map((provider) => provider.id)).toEqual(['alpha', 'zulu']);
  });

  it('filters hidden providers before grouping', () => {
    const result = groupProviderEntries(
      [
        entry('visible', 'Visible'),
        entry('hidden', 'Hidden'),
        entry('catalog-hidden', 'Catalog Hidden', false),
      ],
      {
        isProviderEnabled: () => false,
        availabilityByProviderId: {
          visible: { available: true },
          hidden: { available: true },
          'catalog-hidden': { available: true },
        },
        hiddenProviderIds: ['hidden'],
      },
    );

    expect(result.discovered.map((provider) => provider.id)).toEqual(['catalog-hidden', 'visible']);
  });

  it('returns empty arrays for empty groups', () => {
    expect(
      groupProviderEntries([], {
        isProviderEnabled: () => false,
        availabilityByProviderId: {},
      }),
    ).toEqual({ enabled: [], discovered: [], supported: [] });
  });

  it('treats a pending provider as supported when it is not enabled', () => {
    const result = groupProviderEntries([entry('pending', 'Pending')], {
      isProviderEnabled: () => false,
      availabilityByProviderId: {},
    });

    expect(result).toEqual({
      enabled: [],
      discovered: [],
      supported: [entry('pending', 'Pending')],
    });
  });

  it('keeps enabled providers in Enabled while pending or unavailable', () => {
    const result = groupProviderEntries(
      [entry('pending', 'Pending'), entry('unavailable', 'Unavailable')],
      {
        isProviderEnabled: () => true,
        availabilityByProviderId: { unavailable: { available: false } },
      },
    );

    expect(result.enabled.map((provider) => provider.id)).toEqual(['pending', 'unavailable']);
    expect(result.discovered).toEqual([]);
    expect(result.supported).toEqual([]);
  });
});
