import {
  describe,
  expect,
  it,
} from 'vitest';
import { getDefaultProviderId } from '$shared/config/provider-config';
import { MODEL_DEFAULTS } from '$shared/constants/agent-services';
import { initialState as modelInitialState } from './model-slice';
import { initialState as providerSettingsInitialState } from '../provider-settings/provider-settings-slice';
import {
  selectHasResolvableModel,
  selectSelectedModel,
  selectWorkspaceDefaultModel,
} from './model-selectors';
import type { ProviderStatus } from '../agent-availability/agent-availability-types';
import type { ModelState } from './model-types';
import type { ProviderSettingsState } from '../provider-settings/provider-settings-slice';
import type { StoreState } from '../../types';

const defaultProviderId = getDefaultProviderId();

function mockState(
  model: Partial<ModelState> = {},
  providerSettings: Partial<ProviderSettingsState> = {},
  providerStatusMap: Record<string, ProviderStatus> = {},
): StoreState {
  return {
    model: { ...modelInitialState, ...model },
    providerSettings: { ...providerSettingsInitialState, ...providerSettings },
    agentAvailability: {
      providerStatusMap,
      providerLoadingMap: {},
      providerUserInfoLoadingMap: {},
      hasCheckedOnce: false,
      watchedTerminalIds: [],
      npxStatus: null,
    },
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

describe('selectSelectedModel', () => {
  it('returns the persisted model for an available active provider', () => {
    const state = mockState(
      { providerModels: { [defaultProviderId]: 'gpt5.4' } },
      { activeProviderId: defaultProviderId, enabledProviders: {} },
      { [defaultProviderId]: { available: true } },
    );

    expect(selectSelectedModel.select(state)).toBe('gpt5.4');
  });

  it('falls back to UI_INITIAL_MODEL when no model is persisted and the active provider is available', () => {
    const state = mockState(
      {},
      { activeProviderId: defaultProviderId, enabledProviders: {} },
      { [defaultProviderId]: { available: true } },
    );

    expect(selectSelectedModel.select(state)).toBe(MODEL_DEFAULTS.UI_INITIAL_MODEL);
  });

  it('does not fall back to UI_INITIAL_MODEL when the active provider is unavailable', () => {
    const state = mockState(
      {},
      { activeProviderId: defaultProviderId, enabledProviders: {} },
      { [defaultProviderId]: { available: false } },
    );

    expect(selectSelectedModel.select(state)).toBe('');
  });

  it('does not fall back to UI_INITIAL_MODEL when the active provider has not been checked', () => {
    const state = mockState({}, { activeProviderId: defaultProviderId, enabledProviders: {} });

    expect(selectSelectedModel.select(state)).toBe('');
  });
});

describe('selectHasResolvableModel', () => {
  it('is true when the active provider is available', () => {
    const state = mockState(
      {},
      { activeProviderId: defaultProviderId, enabledProviders: {} },
      { [defaultProviderId]: { available: true } },
    );

    expect(selectHasResolvableModel.select(state)).toBe(true);
  });

  it('is false when the active provider is unavailable and nothing is persisted', () => {
    const state = mockState(
      {},
      { activeProviderId: defaultProviderId, enabledProviders: {} },
      { [defaultProviderId]: { available: false } },
    );

    expect(selectHasResolvableModel.select(state)).toBe(false);
  });
});
