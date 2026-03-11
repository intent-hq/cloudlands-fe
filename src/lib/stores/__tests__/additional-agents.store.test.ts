import { describe, expect, it } from 'vitest';

import {
  canDisableProvider,
  getEffectivelyEnabledProviderIds,
} from '../additional-agents.store.svelte';

describe('additional agent enablement helpers', () => {
  it('treats the active default provider as enabled', () => {
    expect(getEffectivelyEnabledProviderIds({ opencode: true }, 'codex')).toEqual([
      'auggie',
      'codex',
      'opencode',
    ]);
  });

  it('does not allow disabling the current default provider', () => {
    expect(canDisableProvider('codex', 'codex')).toBe(false);
    expect(canDisableProvider('codex', 'auggie')).toBe(true);
  });
});