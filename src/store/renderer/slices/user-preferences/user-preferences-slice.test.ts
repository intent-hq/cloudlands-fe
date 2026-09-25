import { describe, expect, it } from 'vitest';
import {
  agentRulesContentChanged,
  agentRulesEditorOpened,
  agentRulesEditorClosed,
  agentRulesLoaded,
  agentRulesSaveStarted,
  agentRulesSaved,
  agentRulesFailed,
  agentRulesErrorCleared,
  agentRulesSaveStatusCleared,
  undoAgentRulesChanges,
  cycleNoteFontStyle,
  deleteActivityLogPreset,
  hydrateActivityLogPresets,
  hydrateShortcutOverrides,
  initialState,
  resetNotificationSettings,
  resetAllShortcutOverrides,
  resetShortcutOverride,
  saveActivityLogPreset,
  setChatAuroraEnabled,
  setCodeFontFamily,
  setGroupByRepo,
  setGithubLinkDefaultAction,
  setHasCompletedProviderSetup,
  setLabsMultiplayerEnabled,
  setLabsSettingsVisible,
  setNotificationEnabled,
  setNoteFontStyle,
  setLanguagePreference,
  setShowArchived,
  setSpellcheckEnabled,
  setReduceMotionOnBattery,
  setShowReasoningBlocks,
  setShellTransparencyEnabled,
  setShortcutOverride,
  setSoundEnabled,
  setSoundOnlyWhenUnfocused,
  setSystemFonts,
  setVolume,
  setZoomFactor,
  type AgentFontStyle,
  toggleGroupByRepo,
  toggleHasCompletedProviderSetup,
  toggleChatAurora,
  toggleLabsMultiplayer,
  toggleLabsSettingsVisibility,
  toggleReduceMotionOnBattery,
  toggleShowArchived,
  toggleShowReasoningBlocks,
  toggleShellTransparency,
  setUpdateChannel,
  toggleSpellcheck,
  userPreferencesReducer,
} from './user-preferences-slice';
import {
  selectAgentFontStyle,
  selectAgentFontStyleLabel,
  selectActivityLogPresets,
  selectChatAuroraEnabled,
  selectCodeFontFamily,
  selectCodeFontFamilyCSS,
  selectCodeFontFamilyLabel,
  selectCodeFontOptions,
  selectGroupByRepo,
  selectGithubLinkDefaultAction,
  selectHasCompletedProviderSetup,
  selectIsAgentMonospace,
  selectIsNoteMonospace,
  selectLabsMultiplayerEnabled,
  selectLabsSettingsVisible,
  selectLanguagePreference,
  selectNoteFontStyle,
  selectNoteFontStyleLabel,
  selectNotificationEnabled,
  selectNotificationVolume,
  selectShowArchived,
  selectReduceMotionOnBattery,
  selectShowReasoningBlocks,
  selectShellTransparencyEnabled,
  selectSoundEnabled,
  selectSoundOnlyWhenUnfocused,
} from './user-preferences-selectors';

describe('userPreferencesReducer', () => {
  describe('rules editor state', () => {
    it('keeps the opening baseline and draft while recording acknowledged persistence', () => {
      let state = userPreferencesReducer(initialState, agentRulesEditorOpened());
      expect(state.agentRulesEditor).toMatchObject({ generation: 1, active: true, loading: true });
      state = userPreferencesReducer(state, agentRulesLoaded(1, 'original'));
      state = userPreferencesReducer(state, agentRulesContentChanged('\ndraft\n'));
      state = userPreferencesReducer(state, agentRulesSaveStarted(1));
      expect(state.agentRulesEditor.saveStatus).toBe('saving');
      state = userPreferencesReducer(state, agentRulesSaved(1, 'draft'));
      expect(state.agentRulesEditor).toMatchObject({
        originalContent: 'original',
        content: '\ndraft\n',
        persistedContent: 'draft',
        saveStatus: 'saved',
      });
      state = userPreferencesReducer(state, agentRulesSaveStatusCleared(1));
      expect(state.agentRulesEditor.saveStatus).toBe('idle');
      state = userPreferencesReducer(state, undoAgentRulesChanges());
      expect(state.agentRulesEditor).toMatchObject({
        content: 'original',
        persistedContent: 'draft',
      });
      expect(userPreferencesReducer(state, undoAgentRulesChanges())).toBe(state);
      expect(userPreferencesReducer(state, agentRulesContentChanged('original'))).toBe(state);
    });

    it('does not mark newer content saved when an older write completes', () => {
      let state = userPreferencesReducer(initialState, agentRulesEditorOpened());
      state = userPreferencesReducer(state, agentRulesLoaded(1, 'original'));
      state = userPreferencesReducer(state, agentRulesContentChanged('latest'));
      state = userPreferencesReducer(state, agentRulesSaved(1, 'older'));
      expect(state.agentRulesEditor).toMatchObject({
        content: 'latest',
        persistedContent: 'older',
        saveStatus: 'saving',
      });
      state = userPreferencesReducer(state, agentRulesFailed(1, 'rejected'));
      expect(state.agentRulesEditor).toMatchObject({
        content: 'latest',
        errorMessage: 'rejected',
        saveStatus: 'idle',
        loading: false,
      });
      state = userPreferencesReducer(state, agentRulesErrorCleared(1));
      expect(state.agentRulesEditor.errorMessage).toBeNull();
      expect(userPreferencesReducer(state, agentRulesErrorCleared(1))).toBe(state);
      expect(userPreferencesReducer(state, agentRulesSaveStatusCleared(1))).toBe(state);
    });

    it('ignores stale completions and repeated cleanup across close/reopen generations', () => {
      let state = userPreferencesReducer(initialState, agentRulesEditorOpened());
      state = userPreferencesReducer(state, agentRulesEditorClosed());
      expect(state.agentRulesEditor).toMatchObject({
        active: false,
        loading: false,
        saveStatus: 'idle',
      });
      expect(userPreferencesReducer(state, agentRulesEditorClosed())).toBe(state);
      expect(userPreferencesReducer(state, agentRulesLoaded(1, 'stale'))).toBe(state);
      expect(userPreferencesReducer(state, agentRulesContentChanged('closed'))).toBe(state);
      state = userPreferencesReducer(state, agentRulesEditorOpened());
      expect(state.agentRulesEditor.generation).toBe(2);
      for (const action of [
        agentRulesLoaded(1, 'stale'),
        agentRulesSaved(1, 'stale'),
        agentRulesFailed(1, 'stale'),
        agentRulesSaveStarted(1),
        agentRulesErrorCleared(1),
        agentRulesSaveStatusCleared(1),
      ])
        expect(userPreferencesReducer(state, action)).toBe(state);
      expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    });
  });

  it('should return initial state', () => {
    const state = userPreferencesReducer(undefined, { type: '@@INIT' });
    expect(state).toEqual(initialState);
  });

  describe('shortcut overrides', () => {
    it('saves normalized values and resets one or all overrides', () => {
      const saved = userPreferencesReducer(
        initialState,
        setShortcutOverride('global.settings', ' Command + Shift + , '),
      );
      expect(saved.shortcutOverrides).toEqual({ 'global.settings': 'mod+shift+,' });

      const second = userPreferencesReducer(saved, setShortcutOverride('global.search', 'alt+f'));
      expect(
        userPreferencesReducer(second, resetShortcutOverride('global.settings')).shortcutOverrides,
      ).toEqual({ 'global.search': 'alt+f' });
      expect(userPreferencesReducer(second, resetAllShortcutOverrides()).shortcutOverrides).toEqual(
        {},
      );
    });

    it('does not let malformed input replace a working binding', () => {
      const state = {
        ...initialState,
        shortcutOverrides: { 'global.search': 'alt+f' } as const,
      };
      expect(userPreferencesReducer(state, setShortcutOverride('global.search', 'mod+'))).toBe(
        state,
      );
    });

    it('sanitizes loaded data and omits values equal to defaults', () => {
      const state = userPreferencesReducer(
        initialState,
        hydrateShortcutOverrides({
          'global.search': 'Option+F',
          'global.settings': 'mod+,',
          invalid: 'mod+x',
        }),
      );
      expect(state.shortcutOverrides).toEqual({ 'global.search': 'alt+f' });
    });
  });

  describe('update channel actions', () => {
    it('defaults to the stable channel', () => {
      expect(initialState.updateChannel).toBe('stable');
    });

    it('should set the update channel to beta', () => {
      const state = userPreferencesReducer(initialState, setUpdateChannel('beta'));
      expect(state.updateChannel).toBe('beta');
    });

    it('should set the update channel to alpha', () => {
      const state = userPreferencesReducer(initialState, setUpdateChannel('alpha'));
      expect(state.updateChannel).toBe('alpha');
    });

    it('should set the update channel back to stable', () => {
      const state = userPreferencesReducer(
        { ...initialState, updateChannel: 'beta' },
        setUpdateChannel('stable'),
      );
      expect(state.updateChannel).toBe('stable');
    });
  });

  describe('spellcheck actions', () => {
    it('should set spellcheck enabled to true', () => {
      const state = userPreferencesReducer(initialState, setSpellcheckEnabled(true));
      expect(state.spellcheckEnabled).toBe(true);
    });

    it('should set spellcheck enabled to false', () => {
      const state = userPreferencesReducer(
        { ...initialState, spellcheckEnabled: true },
        setSpellcheckEnabled(false),
      );
      expect(state.spellcheckEnabled).toBe(false);
    });

    it('should toggle spellcheck from false to true', () => {
      const state = userPreferencesReducer(initialState, toggleSpellcheck());
      expect(state.spellcheckEnabled).toBe(true);
    });

    it('should toggle spellcheck from true to false', () => {
      const state = userPreferencesReducer(
        { ...initialState, spellcheckEnabled: true },
        toggleSpellcheck(),
      );
      expect(state.spellcheckEnabled).toBe(false);
    });
  });

  describe('setZoomFactor', () => {
    const state = { ...initialState, zoomFactor: 1.0 };

    it('should set zoom factor', () => {
      expect(userPreferencesReducer(state, setZoomFactor(1.5)).zoomFactor).toBe(1.5);
    });

    it('should return same state if zoom factor unchanged', () => {
      expect(userPreferencesReducer(state, setZoomFactor(1.0))).toBe(state);
    });

    it('should reject invalid zoom factors', () => {
      expect(userPreferencesReducer(state, setZoomFactor(0))).toBe(state);
      expect(userPreferencesReducer(state, setZoomFactor(-1))).toBe(state);
      expect(userPreferencesReducer(state, setZoomFactor(NaN))).toBe(state);
      expect(userPreferencesReducer(state, setZoomFactor(Infinity))).toBe(state);
    });

    it('should accept valid zoom factors', () => {
      expect(userPreferencesReducer(state, setZoomFactor(0.5)).zoomFactor).toBe(0.5);
      expect(userPreferencesReducer(state, setZoomFactor(3.0)).zoomFactor).toBe(3.0);
    });
  });

  describe('home page preference actions', () => {
    it('should set showArchived', () => {
      const state = userPreferencesReducer(initialState, setShowArchived(true));
      expect(state.showArchived).toBe(true);
    });

    it('should toggle showArchived', () => {
      const state = userPreferencesReducer(initialState, toggleShowArchived());
      expect(state.showArchived).toBe(true);
    });

    it('should set groupByRepo', () => {
      const state = userPreferencesReducer(initialState, setGroupByRepo(false));
      expect(state.groupByRepo).toBe(false);
    });

    it('should toggle groupByRepo', () => {
      const state = userPreferencesReducer(initialState, toggleGroupByRepo());
      expect(state.groupByRepo).toBe(false);
    });

    it('should set hasCompletedProviderSetup', () => {
      const state = userPreferencesReducer(initialState, setHasCompletedProviderSetup(true));
      expect(state.hasCompletedProviderSetup).toBe(true);
    });

    it('should toggle hasCompletedProviderSetup', () => {
      const state = userPreferencesReducer(initialState, toggleHasCompletedProviderSetup());
      expect(state.hasCompletedProviderSetup).toBe(true);
    });
  });

  describe('font settings actions', () => {
    it('updates and cycles note font style', () => {
      expect(
        userPreferencesReducer(initialState, setNoteFontStyle('monospace')).noteFontStyle,
      ).toBe('monospace');
      expect(userPreferencesReducer(initialState, cycleNoteFontStyle()).noteFontStyle).toBe(
        'serif',
      );
      expect(
        userPreferencesReducer({ ...initialState, noteFontStyle: 'serif' }, cycleNoteFontStyle())
          .noteFontStyle,
      ).toBe('monospace');
      expect(
        userPreferencesReducer(
          { ...initialState, noteFontStyle: 'monospace' },
          cycleNoteFontStyle(),
        ).noteFontStyle,
      ).toBe('sans');
    });

    it('updates code font family and system fonts', () => {
      const withCodeFont = userPreferencesReducer(initialState, setCodeFontFamily('Fira Code'));
      const withSystemFonts = userPreferencesReducer(
        withCodeFont,
        setSystemFonts(['JetBrains Mono', 'Cascadia Code']),
      );

      expect(withSystemFonts.codeFontFamily).toBe('Fira Code');
      expect(withSystemFonts.systemFonts).toEqual(['JetBrains Mono', 'Cascadia Code']);
    });
  });

  describe('notification settings actions', () => {
    it('keeps action type prefixes under notificationSettings', () => {
      expect(setNotificationEnabled.type).toBe('notificationSettings/setNotificationEnabled');
      expect(setSoundEnabled.type).toBe('notificationSettings/setSoundEnabled');
      expect(setSoundOnlyWhenUnfocused.type).toBe('notificationSettings/setSoundOnlyWhenUnfocused');
      expect(setVolume.type).toBe('notificationSettings/setVolume');
      expect(resetNotificationSettings.type).toBe('notificationSettings/resetNotificationSettings');
    });

    it('updates notification booleans', () => {
      let state = userPreferencesReducer(initialState, setNotificationEnabled(false));
      expect(state.enabled).toBe(false);

      state = userPreferencesReducer(state, setSoundEnabled(false));
      expect(state.soundEnabled).toBe(false);

      state = userPreferencesReducer(state, setSoundOnlyWhenUnfocused(false));
      expect(state.soundOnlyWhenUnfocused).toBe(false);
    });

    it('clamps notification volume', () => {
      expect(userPreferencesReducer(initialState, setVolume(-0.5)).volume).toBe(0);
      expect(userPreferencesReducer(initialState, setVolume(1.5)).volume).toBe(1);
      expect(userPreferencesReducer(initialState, setVolume(0.8)).volume).toBe(0.8);
    });

    it('resets notification settings without affecting other preferences', () => {
      const modified = userPreferencesReducer(
        {
          ...initialState,
          enabled: false,
          soundEnabled: false,
          soundOnlyWhenUnfocused: false,
          volume: 0.2,
          noteFontStyle: 'monospace',
        },
        resetNotificationSettings(),
      );

      expect(modified.enabled).toBe(true);
      expect(modified.soundEnabled).toBe(true);
      expect(modified.soundOnlyWhenUnfocused).toBe(true);
      expect(modified.volume).toBe(0.5);
      expect(modified.noteFontStyle).toBe('monospace');
    });
  });

  describe('small renderer preference persistence actions', () => {
    const preset = {
      name: 'Errors',
      filters: {
        showFileChanges: false,
        showAgentActivity: true,
        showSystemEvents: false,
        showErrors: true,
        searchQuery: 'error',
        dateRange: 'today',
        actorFilter: 'agent',
      },
    };

    it('hydrates, saves, and deletes activity log presets', () => {
      const hydrated = userPreferencesReducer(initialState, hydrateActivityLogPresets([preset]));
      const saved = userPreferencesReducer(
        hydrated,
        saveActivityLogPreset({ ...preset, name: 'All' }),
      );
      const deleted = userPreferencesReducer(saved, deleteActivityLogPreset(0));

      expect(hydrated.activityLogPresets).toEqual([preset]);
      expect(saved.activityLogPresets.map((item) => item.name)).toEqual(['Errors', 'All']);
      expect(deleted.activityLogPresets.map((item) => item.name)).toEqual(['All']);
    });
  });

  describe('showReasoningBlocks actions', () => {
    it('defaults to false (reasoning hidden)', () => {
      expect(initialState.showReasoningBlocks).toBe(false);
    });

    it('sets showReasoningBlocks', () => {
      const state = userPreferencesReducer(initialState, setShowReasoningBlocks(true));
      expect(state.showReasoningBlocks).toBe(true);
    });

    it('toggles showReasoningBlocks', () => {
      const on = userPreferencesReducer(initialState, toggleShowReasoningBlocks());
      const off = userPreferencesReducer(on, toggleShowReasoningBlocks());
      expect(on.showReasoningBlocks).toBe(true);
      expect(off.showReasoningBlocks).toBe(false);
    });
  });

  describe('appearance preference actions', () => {
    it('defaults aurora and shell transparency to enabled and reduceMotionOnBattery to disabled', () => {
      expect(initialState.chatAuroraEnabled).toBe(true);
      expect(initialState.shellTransparencyEnabled).toBe(true);
      expect(initialState.reduceMotionOnBattery).toBe(false);
    });

    it('sets and toggles reduceMotionOnBattery', () => {
      const enabled = userPreferencesReducer(initialState, setReduceMotionOnBattery(true));
      const disabled = userPreferencesReducer(enabled, toggleReduceMotionOnBattery());
      expect(enabled.reduceMotionOnBattery).toBe(true);
      expect(disabled.reduceMotionOnBattery).toBe(false);
    });

    it('sets and toggles chatAuroraEnabled', () => {
      const disabled = userPreferencesReducer(initialState, setChatAuroraEnabled(false));
      const enabled = userPreferencesReducer(disabled, toggleChatAurora());
      expect(disabled.chatAuroraEnabled).toBe(false);
      expect(enabled.chatAuroraEnabled).toBe(true);
    });

    it('sets and toggles shellTransparencyEnabled', () => {
      const disabled = userPreferencesReducer(initialState, setShellTransparencyEnabled(false));
      const enabled = userPreferencesReducer(disabled, toggleShellTransparency());
      expect(disabled.shellTransparencyEnabled).toBe(false);
      expect(enabled.shellTransparencyEnabled).toBe(true);
    });
  });

  describe('Labs Settings visibility', () => {
    it('starts hidden and supports setting and toggling both directions', () => {
      const fresh = userPreferencesReducer(undefined, { type: '@@INIT' });
      expect(selectLabsSettingsVisible.select({ userPreferences: fresh } as any)).toBe(false);

      const shown = userPreferencesReducer(fresh, setLabsSettingsVisible(true));
      expect(selectLabsSettingsVisible.select({ userPreferences: shown } as any)).toBe(true);
      const hidden = userPreferencesReducer(shown, setLabsSettingsVisible(false));
      expect(hidden.labsSettingsVisible).toBe(false);
      const toggled = userPreferencesReducer(hidden, toggleLabsSettingsVisibility());
      expect(toggled.labsSettingsVisible).toBe(true);
      expect(
        userPreferencesReducer(toggled, toggleLabsSettingsVisibility()).labsSettingsVisible,
      ).toBe(false);
    });

    it('preserves experiment values while showing and hiding Settings', () => {
      const enabled = userPreferencesReducer(initialState, setLabsMultiplayerEnabled(true));
      const shown = userPreferencesReducer(enabled, setLabsSettingsVisible(true));
      const hidden = userPreferencesReducer(shown, toggleLabsSettingsVisibility());
      expect(shown.labsMultiplayerEnabled).toBe(true);
      expect(hidden.labsMultiplayerEnabled).toBe(true);
      expect(hidden).toEqual(enabled);
    });
  });

  describe('labs preference actions', () => {
    it('defaults the Multiplayer lab to disabled', () => {
      expect(initialState.labsMultiplayerEnabled).toBe(false);
    });

    it('sets and toggles labsMultiplayerEnabled', () => {
      const enabled = userPreferencesReducer(initialState, setLabsMultiplayerEnabled(true));
      const disabled = userPreferencesReducer(enabled, toggleLabsMultiplayer());
      expect(enabled.labsMultiplayerEnabled).toBe(true);
      expect(disabled.labsMultiplayerEnabled).toBe(false);
    });
  });

  describe('language preference actions', () => {
    it('defaults to the system preference', () => {
      expect(initialState.languagePreference).toBe('system');
    });

    it('sets an explicit language preference', () => {
      const state = userPreferencesReducer(initialState, setLanguagePreference('zh-CN'));
      expect(state.languagePreference).toBe('zh-CN');
    });

    it('sets the preference back to system', () => {
      const state = userPreferencesReducer(
        { ...initialState, languagePreference: 'zh-CN' },
        setLanguagePreference('system'),
      );
      expect(state.languagePreference).toBe('system');
    });
  });

  describe('GitHub link default action', () => {
    it('defaults to showing choices', () => {
      expect(initialState.githubLinkDefaultAction).toBe('show-choices');
    });

    it('sets the default action', () => {
      const state = userPreferencesReducer(initialState, setGithubLinkDefaultAction('copy-link'));
      expect(state.githubLinkDefaultAction).toBe('copy-link');
    });
  });

  describe('selectors', () => {
    const state = {
      userPreferences: {
        ...initialState,
        agentFontStyle: 'monospace' as AgentFontStyle,
        noteFontStyle: 'monospace',
        codeFontFamily: 'JetBrains Mono',
        systemFonts: ['JetBrains Mono'],
        enabled: false,
        soundEnabled: false,
        soundOnlyWhenUnfocused: false,
        volume: 0.25,
        showArchived: true,
        groupByRepo: false,
        hasCompletedProviderSetup: true,
      },
    } as any;

    it('selects home page preference values', () => {
      expect(selectShowArchived.select(state)).toBe(true);
      expect(selectGroupByRepo.select(state)).toBe(false);
      expect(selectHasCompletedProviderSetup.select(state)).toBe(true);
    });

    it('selects showReasoningBlocks (default false, missing slice safe)', () => {
      expect(selectShowReasoningBlocks.select(state)).toBe(false);
      expect(
        selectShowReasoningBlocks.select({
          userPreferences: { ...initialState, showReasoningBlocks: true },
        } as any),
      ).toBe(true);
      expect(selectShowReasoningBlocks.select({} as any)).toBe(false);
    });

    it('selects appearance preferences with their default fallbacks', () => {
      expect(
        selectChatAuroraEnabled.select({
          userPreferences: { ...initialState, chatAuroraEnabled: false },
        } as any),
      ).toBe(false);
      expect(
        selectShellTransparencyEnabled.select({
          userPreferences: { ...initialState, shellTransparencyEnabled: false },
        } as any),
      ).toBe(false);
      expect(
        selectReduceMotionOnBattery.select({
          userPreferences: { ...initialState, reduceMotionOnBattery: true },
        } as any),
      ).toBe(true);
      expect(selectChatAuroraEnabled.select({} as any)).toBe(true);
      expect(selectShellTransparencyEnabled.select({} as any)).toBe(true);
      expect(selectReduceMotionOnBattery.select({} as any)).toBe(false);
    });

    it('selects labsMultiplayerEnabled (default false, missing slice safe)', () => {
      expect(selectLabsMultiplayerEnabled.select(state)).toBe(false);
      expect(
        selectLabsMultiplayerEnabled.select({
          userPreferences: { ...initialState, labsMultiplayerEnabled: true },
        } as any),
      ).toBe(true);
      expect(selectLabsMultiplayerEnabled.select({} as any)).toBe(false);
    });

    it('selects font settings from userPreferences', () => {
      expect(selectAgentFontStyle.select(state)).toBe('monospace');
      expect(selectAgentFontStyleLabel.select(state)).toBe('Monospace');
      expect(selectIsAgentMonospace.select(state)).toBe(true);
      expect(selectNoteFontStyle.select(state)).toBe('monospace');
      expect(selectNoteFontStyleLabel.select(state)).toBe('Monospace');
      expect(selectIsNoteMonospace.select(state)).toBe(true);
      expect(selectCodeFontFamily.select(state)).toBe('JetBrains Mono');
      expect(selectCodeFontFamilyCSS.select(state)).toBe("'JetBrains Mono', monospace");
      expect(selectCodeFontFamilyLabel.select(state)).toBe('JetBrains Mono');
      expect(selectCodeFontOptions.select(state)).toEqual([
        {
          value: 'system-default',
          label: 'System Default',
          fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Monaco, Consolas, monospace",
        },
        {
          value: 'JetBrains Mono',
          label: 'JetBrains Mono',
          fontFamily: "'JetBrains Mono', monospace",
        },
      ]);
    });

    it('includes every loaded system font after System Default', () => {
      const fontState = {
        userPreferences: {
          ...initialState,
          systemFonts: ['Helvetica Neue', 'JetBrains Mono', 'Cascadia Code'],
        },
      } as any;

      expect(selectCodeFontOptions.select(fontState).map((option) => option.value)).toEqual([
        'system-default',
        'Helvetica Neue',
        'JetBrains Mono',
        'Cascadia Code',
      ]);
    });

    it('selects notification settings from userPreferences', () => {
      expect(selectNotificationEnabled.select(state)).toBe(false);
      expect(selectSoundEnabled.select(state)).toBe(false);
      expect(selectSoundOnlyWhenUnfocused.select(state)).toBe(false);
      expect(selectNotificationVolume.select(state)).toBe(0.25);
    });

    it('selects migrated small renderer preferences', () => {
      const preferenceState = {
        userPreferences: {
          ...initialState,
          activityLogPresets: [{ name: 'Errors', filters: {} }],
        },
      } as any;

      expect(selectActivityLogPresets.select(preferenceState)).toEqual([
        { name: 'Errors', filters: {} },
      ]);
    });

    it('selects the language preference', () => {
      const preferenceState = {
        userPreferences: { ...initialState, languagePreference: 'zh-CN' },
      } as any;

      expect(selectLanguagePreference.select(preferenceState)).toBe('zh-CN');
    });
    it('selects the GitHub link default action with a safe fallback', () => {
      expect(
        selectGithubLinkDefaultAction.select({
          userPreferences: { ...initialState, githubLinkDefaultAction: 'start-workspace' },
        } as any),
      ).toBe('start-workspace');
      expect(selectGithubLinkDefaultAction.select({} as any)).toBe('show-choices');
    });
  });
});
