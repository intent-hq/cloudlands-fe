import { describe, expect, it } from 'vitest';

import type { AuggieModel } from '$features/auggie/auggie-models.client';
import type { DropdownOption } from '$lib/components/ui/dropdown';

import { isUserProviderSettled } from './model-picker-utils';

const sampleModel: AuggieModel = { value: 'auggie:sonnet4.6', label: 'Sonnet 4.6' };
const sampleDropdownOption: DropdownOption = {
  value: 'auggie:sonnet4.6',
  label: 'Sonnet 4.6',
  description: 'A model',
};

describe('isUserProviderSettled', () => {
  it('returns false in override mode when neither models nor error have arrived', () => {
    const result = isUserProviderSettled({
      isAgentProviderOverride: true,
      agentProviderModels: null,
      agentProviderError: null,
      enabledProviderIds: ['auggie'],
      allProviderModels: { auggie: [sampleDropdownOption] },
      modelProvider: 'auggie',
    });
    expect(result).toBe(false);
  });

  it('returns true in override mode when models have loaded', () => {
    const result = isUserProviderSettled({
      isAgentProviderOverride: true,
      agentProviderModels: [sampleModel],
      agentProviderError: null,
      enabledProviderIds: ['auggie'],
      allProviderModels: {},
      modelProvider: 'auggie',
    });
    expect(result).toBe(true);
  });

  it('returns true in override mode when the agent-provider fetch errored', () => {
    const result = isUserProviderSettled({
      isAgentProviderOverride: true,
      agentProviderModels: null,
      agentProviderError: 'network blew up',
      enabledProviderIds: ['auggie'],
      allProviderModels: {},
      modelProvider: 'auggie',
    });
    expect(result).toBe(true);
  });

  it('returns true in non-override mode when the provider is no longer enabled (genuinely gone)', () => {
    const result = isUserProviderSettled({
      isAgentProviderOverride: false,
      agentProviderModels: null,
      agentProviderError: null,
      enabledProviderIds: ['codex'],
      allProviderModels: { codex: [sampleDropdownOption] },
      modelProvider: 'auggie',
    });
    expect(result).toBe(true);
  });

  it('returns false in non-override mode when the enabled provider has no models yet', () => {
    const emptyResult = isUserProviderSettled({
      isAgentProviderOverride: false,
      agentProviderModels: null,
      agentProviderError: null,
      enabledProviderIds: ['auggie'],
      allProviderModels: { auggie: [] },
      modelProvider: 'auggie',
    });
    expect(emptyResult).toBe(false);

    const missingResult = isUserProviderSettled({
      isAgentProviderOverride: false,
      agentProviderModels: null,
      agentProviderError: null,
      enabledProviderIds: ['auggie'],
      allProviderModels: {},
      modelProvider: 'auggie',
    });
    expect(missingResult).toBe(false);
  });

  it('returns true in non-override mode when the enabled provider has loaded ≥1 model', () => {
    const result = isUserProviderSettled({
      isAgentProviderOverride: false,
      agentProviderModels: null,
      agentProviderError: null,
      enabledProviderIds: ['auggie'],
      allProviderModels: { auggie: [sampleDropdownOption] },
      modelProvider: 'auggie',
    });
    expect(result).toBe(true);
  });

  it('normalizes raw enabled provider ids through getProviderConfig before checking membership', () => {
    // 'acp' is an alias that getProviderConfig resolves to the default provider
    // ('auggie'). Passing the raw alias must still recognize the provider as
    // enabled so the helper evaluates settledness, not treat it as "not enabled".
    const result = isUserProviderSettled({
      isAgentProviderOverride: false,
      agentProviderModels: null,
      agentProviderError: null,
      enabledProviderIds: ['acp'],
      allProviderModels: { auggie: [] },
      modelProvider: 'auggie',
    });
    expect(result).toBe(false);
  });
});
