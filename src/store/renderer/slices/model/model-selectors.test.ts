import {
  describe,
  expect,
  it,
} from 'vitest';
import { getDefaultProviderId } from '$shared/config/provider-config';
import { initialState as modelInitialState } from './model-slice';
import { initialState as providerSettingsInitialState } from '../provider-settings/provider-settings-slice';
import { selectWorkspaceDefaultModel } from './model-selectors';
import type { ModelState } from './model-types';
import type { ProviderSettingsState } from '../provider-settings/provider-settings-slice';
import type { StoreState } from '../../types';

const defaultProviderId = getDefaultProviderId();

function mockState(
  model: Partial<ModelState> = {},
  providerSettings: Partial<ProviderSettingsState> = {},
): StoreState {
  return {
    model: { ...modelInitialState, ...model },
    providerSettings: { ...providerSettingsInitialState, ...providerSettings },
  } as unknown as StoreState;
}

describe('selectWorkspaceDefaultModel', () => {
  it('falls back to the global selected model when the override provider is disabled (#584)', () => {
    const state = mockState(
      {
        workspaceModels: { ws1: 'codex:gpt-5.3-codex/high' },
        providerModels: { [defaultProviderId]: 'gpt5.4' },
      },
      { activeProviderId: defaultProviderId, enabledProviders: {} },
    );

    expect(selectWorkspaceDefaultModel.select(state, 'ws1')).toBe('gpt5.4');
  });

  it('returns the workspace override when its provider is enabled', () => {
    const state = mockState(
      {
        workspaceModels: { ws1: 'codex:gpt-5.3-codex/high' },
        providerModels: { [defaultProviderId]: 'gpt5.4' },
      },
      { activeProviderId: defaultProviderId, enabledProviders: { codex: true } },
    );

    expect(selectWorkspaceDefaultModel.select(state, 'ws1')).toBe('codex:gpt-5.3-codex/high');
  });

  it('returns the workspace override when its provider is the active provider', () => {
    const state = mockState(
      { workspaceModels: { ws1: 'codex:gpt-5.3-codex/high' } },
      { activeProviderId: 'codex', enabledProviders: {} },
    );

    expect(selectWorkspaceDefaultModel.select(state, 'ws1')).toBe('codex:gpt-5.3-codex/high');
  });

  it('returns a bare (non-compound) workspace override unchanged', () => {
    const state = mockState(
      {
        workspaceModels: { ws1: 'gpt5.4-mini' },
        providerModels: { [defaultProviderId]: 'gpt5.4' },
      },
      { activeProviderId: defaultProviderId, enabledProviders: {} },
    );

    expect(selectWorkspaceDefaultModel.select(state, 'ws1')).toBe('gpt5.4-mini');
  });

  it('falls back to the global selected model when no override exists', () => {
    const state = mockState(
      { providerModels: { [defaultProviderId]: 'gpt5.4' } },
      { activeProviderId: defaultProviderId, enabledProviders: {} },
    );

    expect(selectWorkspaceDefaultModel.select(state, 'ws1')).toBe('gpt5.4');
  });
});
