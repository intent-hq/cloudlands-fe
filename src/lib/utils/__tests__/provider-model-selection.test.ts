import { describe, expect, it } from 'vitest';

import {
  buildProviderDropdownOptions,
  getSelectableProviderIds,
  pickCompatibleModelForProvider,
  shouldShowChatProviderControl,
} from '../provider-model-selection';

describe('pickCompatibleModelForProvider', () => {
  it('keeps the current model when it already matches the provider', () => {
    const result = pickCompatibleModelForProvider({
      providerId: 'opencode',
      availableModelValues: ['opencode:gpt-5', 'opencode:claude-sonnet-4.5'],
      currentModel: 'opencode:gpt-5',
      fallbackModel: 'opencode:claude-sonnet-4.5',
    });

    expect(result).toBe('opencode:gpt-5');
  });

  it('falls back to the provider-compatible default when the current model is invalid', () => {
    const result = pickCompatibleModelForProvider({
      providerId: 'opencode',
      availableModelValues: ['opencode:gpt-5', 'opencode:claude-sonnet-4.5'],
      currentModel: 'gpt-5',
      fallbackModel: 'opencode:claude-sonnet-4.5',
    });

    expect(result).toBe('opencode:claude-sonnet-4.5');
  });

  it('returns null when the provider has no compatible models', () => {
    const result = pickCompatibleModelForProvider({
      providerId: 'opencode',
      availableModelValues: ['gpt-5', 'claude-sonnet-4.5'],
      currentModel: 'gpt-5',
    });

    expect(result).toBeNull();
  });

  it('falls back to the first compatible option when current and fallback models belong to other providers', () => {
    const result = pickCompatibleModelForProvider({
      providerId: 'opencode',
      availableModelValues: ['opencode:gpt-5', 'opencode:claude-sonnet-4.5'],
      currentModel: 'gpt5.4',
      fallbackModel: 'codex:gpt-5-codex',
    });

    expect(result).toBe('opencode:gpt-5');
  });
});

describe('buildProviderDropdownOptions', () => {
  it('uses configured provider display names', () => {
    expect(buildProviderDropdownOptions(['auggie', 'opencode'])).toEqual([
      { value: 'auggie', label: 'Augment Auggie' },
      { value: 'opencode', label: 'OpenCode' },
    ]);
  });
});

describe('getSelectableProviderIds', () => {
  it('returns only enabled providers that are currently usable', () => {
    expect(
      getSelectableProviderIds({
        enabledProviderIds: ['auggie', 'codex', 'opencode'],
        usableProviderIds: ['auggie', 'opencode'],
      }),
    ).toEqual(['auggie', 'opencode']);
  });

  it('keeps the selected provider visible even when it is not currently usable', () => {
    expect(
      getSelectableProviderIds({
        enabledProviderIds: ['auggie', 'codex', 'opencode'],
        usableProviderIds: ['auggie', 'opencode'],
        selectedProviderId: 'codex',
      }),
    ).toEqual(['codex', 'auggie', 'opencode']);
  });
});

describe('shouldShowChatProviderControl', () => {
  it('hides the control when the default provider is the only selectable option', () => {
    expect(
      shouldShowChatProviderControl({
        defaultProviderId: 'auggie',
        selectableProviderIds: ['auggie'],
        selectedProviderId: 'auggie',
      }),
    ).toBe(false);
  });

  it('shows the control when multiple selectable providers exist', () => {
    expect(
      shouldShowChatProviderControl({
        defaultProviderId: 'auggie',
        selectableProviderIds: ['auggie', 'codex'],
        selectedProviderId: 'auggie',
      }),
    ).toBe(true);
  });

  it('shows the control when the current provider is non-default even without alternatives', () => {
    expect(
      shouldShowChatProviderControl({
        defaultProviderId: 'auggie',
        selectableProviderIds: ['codex'],
        selectedProviderId: 'codex',
      }),
    ).toBe(true);
  });
});
