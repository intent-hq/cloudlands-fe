import { describe, expect, it } from 'vitest';

import { compareProvidersByDisplayName, orderProviderEntries } from '../provider-list-order';

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
