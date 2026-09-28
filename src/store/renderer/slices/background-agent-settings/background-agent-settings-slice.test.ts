import { describe, it, expect } from 'vitest';
import {
  backgroundAgentSettingsReducer,
  setDefaultModel,
  setDefaultReasoningEffort,
  setTypeReasoningEffortOverride,
  resetTypeOverride,
  setTypeOverride,
  clearTypeOverride,
  resetSettings,
  hydrateSettings,
  hydrateProviderSettings,
  saveProviderSnapshot,
  restoreProviderSettings,
  initialState,
  DEFAULT_BACKGROUND_MODEL,
  type BackgroundAgentSettingsState,
} from './background-agent-settings-slice';

describe('backgroundAgentSettingsReducer', () => {
  it('should return initial state', () => {
    const state = backgroundAgentSettingsReducer(undefined, { type: '@@INIT' });
    expect(state).toEqual(initialState);
  });

  it('defaults to no explicit model (empty string = provider default)', () => {
    expect(DEFAULT_BACKGROUND_MODEL).toBe('');
    expect(initialState.defaultModel).toBe('');
  });

  describe('setDefaultModel', () => {
    it('should update defaultModel', () => {
      const state = backgroundAgentSettingsReducer(initialState, setDefaultModel('sonnet4.5'));
      expect(state.defaultModel).toBe('sonnet4.5');
    });

    it('should not mutate previous state', () => {
      const state = backgroundAgentSettingsReducer(initialState, setDefaultModel('sonnet4.5'));
      expect(initialState.defaultModel).toBe(DEFAULT_BACKGROUND_MODEL);
      expect(state.defaultModel).toBe('sonnet4.5');
    });
  });

  describe('setTypeOverride', () => {
    it('should set a type override', () => {
      const state = backgroundAgentSettingsReducer(
        initialState,
        setTypeOverride({ type: 'commit', model: 'haiku4.5' }),
      );
      expect(state.typeOverrides.commit).toBe('haiku4.5');
      // Other overrides unchanged
      expect(state.typeOverrides.pr).toBe('');
      expect(state.typeOverrides.review).toBe('');
      expect(state.typeOverrides.fast).toBe('');
    });
  });

  describe('clearTypeOverride', () => {
    it('should clear a type override', () => {
      const prev: BackgroundAgentSettingsState = {
        ...initialState,
        typeOverrides: { ...initialState.typeOverrides, commit: 'haiku4.5' },
      };
      const state = backgroundAgentSettingsReducer(prev, clearTypeOverride('commit'));
      expect(state.typeOverrides.commit).toBe('');
    });
  });

  describe('resetSettings', () => {
    it('should reset to initial state', () => {
      const prev: BackgroundAgentSettingsState = {
        ...initialState,
        defaultModel: 'sonnet4.5',
        typeOverrides: {
          commit: 'haiku4.5',
          pr: 'opus4.5',
          review: '',
          fast: '',
        },
        providerSettings: {
          auggie: {
            defaultModel: 'sonnet4.5',
            typeOverrides: { commit: '', pr: '', review: '', fast: '' },
          },
        },
      };
      const state = backgroundAgentSettingsReducer(prev, resetSettings());
      expect(state.defaultModel).toBe(DEFAULT_BACKGROUND_MODEL);
      expect(state.typeOverrides).toEqual({
        commit: '',
        pr: '',
        review: '',
        fast: '',
      });
      expect(state.providerSettings).toEqual({});
    });
  });

  describe('hydrateSettings', () => {
    it('should hydrate from localStorage data', () => {
      const state = backgroundAgentSettingsReducer(
        initialState,
        hydrateSettings({
          defaultModel: 'sonnet4.5',
          typeOverrides: {
            commit: 'haiku4.5',
            pr: '',
            review: '',
            fast: '',
          },
        }),
      );
      expect(state.defaultModel).toBe('sonnet4.5');
      expect(state.typeOverrides.commit).toBe('haiku4.5');
    });

    it('should keep an empty defaultModel (provider default) and default missing overrides', () => {
      const state = backgroundAgentSettingsReducer(
        initialState,
        hydrateSettings({
          defaultModel: '',
          typeOverrides: {} as any,
        }),
      );
      expect(state.defaultModel).toBe('');
      expect(state.typeOverrides.commit).toBe('');
    });
  });

  describe('hydrateProviderSettings', () => {
    it('should set provider settings', () => {
      const providerSettings = {
        auggie: {
          defaultModel: 'sonnet4.5',
          typeOverrides: { commit: '', pr: '', review: '', fast: '' },
        },
      };
      const state = backgroundAgentSettingsReducer(
        initialState,
        hydrateProviderSettings(providerSettings),
      );
      expect(state.providerSettings).toEqual(providerSettings);
    });
  });

  describe('saveProviderSnapshot', () => {
    it('should save settings for a provider', () => {
      const settings = {
        defaultModel: 'sonnet4.5',
        typeOverrides: { commit: 'haiku4.5', pr: '', review: '', fast: '' },
      };
      const state = backgroundAgentSettingsReducer(
        initialState,
        saveProviderSnapshot({ providerId: 'auggie', settings }),
      );
      expect(state.providerSettings.auggie).toEqual(settings);
    });
  });

  describe('restoreProviderSettings', () => {
    it('should restore settings from a provider snapshot', () => {
      const state = backgroundAgentSettingsReducer(
        initialState,
        restoreProviderSettings({
          defaultModel: 'opus4.5',
          typeOverrides: { commit: 'haiku4.5', pr: '', review: '', fast: '' },
        }),
      );
      expect(state.defaultModel).toBe('opus4.5');
      expect(state.typeOverrides.commit).toBe('haiku4.5');
    });
  });
});

describe('independent effort settings', () => {
  it('keeps effort when the model is changed or cleared, and clears both on action reset', () => {
    let state = backgroundAgentSettingsReducer(initialState, setDefaultReasoningEffort('medium'));
    state = backgroundAgentSettingsReducer(
      state,
      setTypeReasoningEffortOverride({ type: 'commit', effort: 'high' }),
    );
    expect(state.typeOverrides.commit).toBe('');
    state = backgroundAgentSettingsReducer(
      state,
      setTypeOverride({ type: 'commit', model: 'other' }),
    );
    state = backgroundAgentSettingsReducer(state, clearTypeOverride('commit'));
    expect(state.typeReasoningEffortOverrides.commit).toBe('high');
    state = backgroundAgentSettingsReducer(state, resetTypeOverride('commit'));
    expect(state.typeReasoningEffortOverrides.commit).toBeUndefined();
    expect(state.defaultReasoningEffort).toBe('medium');
  });
  it('restores older provider snapshots without leaking the outgoing effort', () => {
    const state = backgroundAgentSettingsReducer(initialState, setDefaultReasoningEffort('high'));
    const restored = backgroundAgentSettingsReducer(
      state,
      restoreProviderSettings({
        defaultModel: '',
        typeOverrides: { commit: '', pr: '', review: '', fast: '' },
      }),
    );
    expect(restored.defaultReasoningEffort).toBe('');
    expect(restored.typeReasoningEffortOverrides).toEqual({});
  });
});

it('hydrates blank effort as inheritance without dropping future saved candidates', () => {
  const state = backgroundAgentSettingsReducer(
    initialState,
    hydrateSettings({
      defaultModel: '',
      typeOverrides: { commit: '', pr: '', review: '', fast: '' },
      defaultReasoningEffort: '  ',
      typeReasoningEffortOverrides: { commit: ' ', fast: 'future-level' },
    }),
  );
  expect(state.defaultReasoningEffort).toBe('');
  expect(state.typeReasoningEffortOverrides).toEqual({ fast: 'future-level' });
});
