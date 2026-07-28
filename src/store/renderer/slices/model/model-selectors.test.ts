import {
  describe,
  expect,
  it,
} from 'vitest';
import { getDefaultProviderId } from '$shared/config/provider-config';
import { MODEL_DEFAULTS } from '$shared/constants/agent-services';
import { initialState as modelInitialState } from './model-slice';
import { initialState as providerSettingsInitialState } from '../provider-settings/provider-settings-slice';
import { selectSelectedModel } from './model-selectors';
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

describe('selectSelectedModel', () => {
  it('returns the active provider default when set', () => {
    const state = mockState(
      { providerModels: { [defaultProviderId]: 'gpt5.4' } },
      { activeProviderId: defaultProviderId },
    );

    expect(selectSelectedModel.select(state)).toBe('gpt5.4');
  });

  it('returns the explicit provider default when a providerId is passed', () => {
    const state = mockState(
      {
        providerModels: {
          [defaultProviderId]: 'gpt5.4',
          codex: 'codex:gpt-5.3-codex/high',
        },
      },
      { activeProviderId: defaultProviderId },
    );

    expect(selectSelectedModel.select(state, 'codex')).toBe('codex:gpt-5.3-codex/high');
  });

  it('falls back to the UI initial model when no provider default exists', () => {
    const state = mockState({}, { activeProviderId: defaultProviderId });

    expect(selectSelectedModel.select(state)).toBe(MODEL_DEFAULTS.UI_INITIAL_MODEL);
  });
});
