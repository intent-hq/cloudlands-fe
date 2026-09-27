import { store } from '../../store';
import type { AppSelector } from '../../types';
import {
  SYSTEM_DEFAULT_FONT,
  type FontOption,
  type UserPreferencesState,
} from './user-preferences-slice';
import { resolvePreferenceToLocale } from '$lib/i18n/locale';
import { m } from '$shared/paraglide/messages.js';

export const selectAgentFontStyle: AppSelector<UserPreferencesState['agentFontStyle']> =
  store.createSelector((state) => {
    return state.userPreferences.agentFontStyle;
  });

export const selectAgentFontStyleLabel: AppSelector<'Sans-serif' | 'Monospace'> =
  store.createSelector((state) => {
    switch (state.userPreferences.agentFontStyle) {
      case 'sans':
        return 'Sans-serif';
      case 'monospace':
        return 'Monospace';
      default:
        return 'Sans-serif';
    }
  });

export const selectIsAgentMonospace: AppSelector<boolean> = store.createSelector((state) => {
  return state.userPreferences.agentFontStyle === 'monospace';
});

export const selectUpdateChannel: AppSelector<UserPreferencesState['updateChannel']> =
  store.createSelector((state) => {
    return state.userPreferences.updateChannel;
  });

export const selectSpellcheckEnabled: AppSelector<boolean> = store.createSelector((state) => {
  return state.userPreferences.spellcheckEnabled;
});

export const selectZoomFactor: AppSelector<number> = store.createSelector((state) => {
  return state.userPreferences.zoomFactor;
});

export const selectShowArchived: AppSelector<boolean> = store.createSelector((state) => {
  return state.userPreferences.showArchived;
});

export const selectGroupByRepo: AppSelector<boolean> = store.createSelector((state) => {
  return state.userPreferences.groupByRepo;
});

export const selectHasCompletedProviderSetup: AppSelector<boolean> = store.createSelector(
  (state) => {
    return state.userPreferences.hasCompletedProviderSetup;
  },
);

export const selectShowReasoningBlocks: AppSelector<boolean> = store.createSelector((state) => {
  return state.userPreferences?.showReasoningBlocks ?? false;
});

export const selectChatAuroraEnabled: AppSelector<boolean> = store.createSelector((state) => {
  return state.userPreferences?.chatAuroraEnabled ?? true;
});

export const selectShellTransparencyEnabled: AppSelector<boolean> = store.createSelector(
  (state) => {
    return state.userPreferences?.shellTransparencyEnabled ?? true;
  },
);

export const selectReduceMotionOnBattery: AppSelector<boolean> = store.createSelector((state) => {
  return state.userPreferences?.reduceMotionOnBattery ?? false;
});

export const selectLabsSettingsVisible: AppSelector<boolean> = store.createSelector((state) => {
  return state.userPreferences?.labsSettingsVisible ?? false;
});

export const selectLabsMultiplayerEnabled: AppSelector<boolean> = store.createSelector((state) => {
  return state.userPreferences?.labsMultiplayerEnabled ?? false;
});

export const selectLabsGitLabEnabled: AppSelector<boolean> = store.createSelector((state) => {
  return state.userPreferences?.labsGitLabEnabled === true;
});

export const selectCounterScale: AppSelector<number> = store.createSelector((state) => {
  return 1 / state.userPreferences.zoomFactor;
});

export const selectNoteFontStyle: AppSelector<UserPreferencesState['noteFontStyle']> =
  store.createSelector((state) => {
    return state.userPreferences.noteFontStyle;
  });

export const selectNoteFontStyleLabel: AppSelector<'Sans-serif' | 'Monospace' | 'Serif'> =
  store.createSelector((state) => {
    switch (state.userPreferences.noteFontStyle) {
      case 'sans':
        return 'Sans-serif';
      case 'serif':
        return 'Serif';
      case 'monospace':
        return 'Monospace';
      default:
        return 'Sans-serif';
    }
  });

export const selectIsNoteMonospace: AppSelector<boolean> = store.createSelector((state) => {
  return state.userPreferences.noteFontStyle === 'monospace';
});

export const selectCodeFontFamily: AppSelector<string> = store.createSelector((state) => {
  return state.userPreferences.codeFontFamily;
});

export const selectCodeFontFamilyCSS: AppSelector<string> = store.createSelector((state) => {
  const { codeFontFamily } = state.userPreferences;
  if (codeFontFamily === 'system-default') {
    return SYSTEM_DEFAULT_FONT;
  }
  return `'${codeFontFamily}', monospace`;
});

export const selectCodeFontFamilyLabel: AppSelector<string> = store.createSelector((state) => {
  const { codeFontFamily } = state.userPreferences;
  if (codeFontFamily === 'system-default') {
    return m.settings_fonts_systemDefault_label();
  }
  return codeFontFamily;
});

export const selectCodeFontOptions: AppSelector<FontOption[]> = store.createSelector((state) => {
  const { systemFonts } = state.userPreferences;
  const options: FontOption[] = [
    {
      value: 'system-default',
      get label() {
        return m.settings_fonts_systemDefault_label();
      },
      fontFamily: SYSTEM_DEFAULT_FONT,
    },
  ];

  for (const font of systemFonts) {
    options.push({
      value: font,
      label: font,
      fontFamily: `'${font}', monospace`,
    });
  }

  return options;
});

export const selectNotificationEnabled: AppSelector<boolean> = store.createSelector((state) => {
  return state.userPreferences.enabled;
});

export const selectSoundEnabled: AppSelector<boolean> = store.createSelector((state) => {
  return state.userPreferences.soundEnabled;
});

export const selectSoundOnlyWhenUnfocused: AppSelector<boolean> = store.createSelector((state) => {
  return state.userPreferences.soundOnlyWhenUnfocused;
});

export const selectNotificationVolume: AppSelector<number> = store.createSelector((state) => {
  return state.userPreferences.volume;
});

export const selectNotificationVolumeWrite: AppSelector<{
  editId: number | null;
  hydrationEpoch: number;
}> = store.createSelector((state) => {
  return {
    editId: state.userPreferences.pendingNotificationVolumeEditId,
    hydrationEpoch: state.userPreferences.notificationVolumeHydrationEpoch,
  };
});

export const selectActivityLogPresets: AppSelector<UserPreferencesState['activityLogPresets']> =
  store.createSelector((state) => {
    return state.userPreferences.activityLogPresets;
  });

export const selectLanguagePreference: AppSelector<string> = store.createSelector((state) => {
  return state.userPreferences.languagePreference;
});

export const selectGithubLinkDefaultAction: AppSelector<
  UserPreferencesState['githubLinkDefaultAction']
> = store.createSelector((state) => {
  return state.userPreferences?.githubLinkDefaultAction ?? 'show-choices';
});

export const selectShortcutOverrides: AppSelector<UserPreferencesState['shortcutOverrides']> =
  store.createSelector((state) => {
    return state.userPreferences.shortcutOverrides;
  });

/** The concrete catalog locale the preference resolves to (explicit → system → en). */
export const selectResolvedLocale: AppSelector<
  'en' | 'zh-CN' | 'zh-TW' | 'ja' | 'ko' | 'de' | 'fr' | 'es'
> = store.createSelector((state) => {
  return resolvePreferenceToLocale(state.userPreferences.languagePreference);
});
