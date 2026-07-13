import {
  describe,
  expect,
  it,
} from 'vitest';

import { resolveProviderOverlayState } from './provider-overlay';

describe('resolveProviderOverlayState', () => {
  it('does not block a used chat just because the global/default provider changed', () => {
    const state = resolveProviderOverlayState({
      agentProviderId: 'codex',
      hiddenProviderIds: [],
      disabledProviderIds: [],
      unusableProviderIds: [],
      canChangeAgentProvider: false,
    });

    expect(state).toEqual({ reason: null, show: false });
  });

  it('blocks when the persisted provider is hidden', () => {
    const state = resolveProviderOverlayState({
      agentProviderId: 'codex',
      hiddenProviderIds: ['codex'],
      disabledProviderIds: [],
      unusableProviderIds: [],
      canChangeAgentProvider: false,
    });

    expect(state).toEqual({ reason: 'hidden', show: true });
  });

  it('blocks chats when the persisted provider has been disabled by the user', () => {
    const state = resolveProviderOverlayState({
      agentProviderId: 'codex',
      hiddenProviderIds: [],
      disabledProviderIds: ['codex'],
      unusableProviderIds: [],
      canChangeAgentProvider: true,
    });

    expect(state).toEqual({ reason: 'disabled', show: true });
  });

  it('blocks used chats when the persisted provider is unusable', () => {
    const state = resolveProviderOverlayState({
      agentProviderId: 'codex',
      hiddenProviderIds: [],
      disabledProviderIds: [],
      unusableProviderIds: ['codex'],
      canChangeAgentProvider: false,
    });

    expect(state).toEqual({ reason: 'unavailable', show: true });
  });

  it('does not block unused chats when provider can still be changed', () => {
    const state = resolveProviderOverlayState({
      agentProviderId: 'codex',
      hiddenProviderIds: [],
      disabledProviderIds: [],
      unusableProviderIds: ['codex'],
      canChangeAgentProvider: true,
    });

    expect(state).toEqual({ reason: null, show: false });
  });
});
