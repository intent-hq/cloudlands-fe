/**
 * User-preferences persistence service — restores the localStorage read/write
 * that the removed `user-preferences/sagas/persistence-saga` performed for
 * spellcheck, showArchived, groupByRepo, hasCompletedProviderSetup, agent font
 * style, note font style, code font family, and activity-log presets
 * (GAPs 9-15, 17). It also owns the language preference: hydration, persistence,
 * applying it to the Paraglide runtime via the renderer locale service, and
 * syncing it to the Electron main process (`app:set-language-preference`) so
 * native menus/dialogs/notifications follow the same locale.
 *
 * Beta-updates and notification settings are handled by sibling middlewares and
 * are excluded here to avoid overlap.
 *
 * Storage keys match the deleted saga exactly so existing users' stored values
 * are honored. Boot-time hydration reads from localStorage on first action and
 * dispatches hydration actions for all preferences. Write-after-action persistence
 * writes to localStorage after the reducer runs.
 *
 * Dependency-light per src/store AGENTS.md: imports only the safe-storage helper
 * and slice actions/types — no selectors (importing them would evaluate
 * `store.createSelector` mid store-init) and no store module.
 */
import type { StoreMiddleware } from "$lib/store-shim/types";
import { safeLocalStorage } from "$lib/utils/safe-storage";
import { applyLanguagePreference } from "$lib/i18n/locale";
import { isElectron } from "$lib/electron-bridge";
import {
  setSpellcheckEnabled,
  toggleSpellcheck,
  setShowArchived,
  toggleShowArchived,
  setGroupByRepo,
  toggleGroupByRepo,
  setHasCompletedProviderSetup,
  toggleHasCompletedProviderSetup,
  setAgentFontStyle,
  cycleFontStyle,
  setNoteFontStyle,
  cycleNoteFontStyle,
  setCodeFontFamily,
  saveActivityLogPreset,
  deleteActivityLogPreset,
  hydrateActivityLogPresets,
  setLanguagePreference,
  type FontStyle,
  type ActivityLogPresetPreference,
  FONT_STYLES,
} from "../slices/user-preferences/user-preferences-slice";

// Storage keys from the deleted saga — must match exactly for compatibility
const SPELLCHECK_STORAGE_KEY = "note-spellcheck-settings";
const SHOW_ARCHIVED_STORAGE_KEY = "workspace-list:showArchived";
const GROUP_BY_REPO_STORAGE_KEY = "workspace-list:groupByRepo";
const COMPLETED_PROVIDER_SETUP_STORAGE_KEY = "workspace-list:completedProviderSetup";
const AGENT_STORAGE_KEY = "agent-font-settings";
const NOTE_STORAGE_KEY = "note-font-settings";
const CODE_STORAGE_KEY = "code-font-settings";
const ACTIVITY_LOG_PRESETS_STORAGE_KEY = "activityLogPresets";
const LANGUAGE_PREFERENCE_STORAGE_KEY = "language-preference";

/**
 * Middleware giving the restored user-preferences persistence triggers real handlers
 * again. Writes happen after `next` so the reducer runs first and state updates
 * before localStorage. Reads (boot-time hydration) happen once on first action.
 */
export function createUserPreferencesPersistenceMiddleware(): StoreMiddleware {
  let hasHydrated = false;

  return (api) => (next) => (action) => {
    // Boot-time hydration on first action
    if (!hasHydrated) {
      hasHydrated = true;

      // Hydrate spellcheck
      const storedSpellcheck = safeLocalStorage.getJSON<{ enabled: boolean }>(SPELLCHECK_STORAGE_KEY);
      if (storedSpellcheck && typeof storedSpellcheck.enabled === "boolean") {
        api.dispatch(setSpellcheckEnabled(storedSpellcheck.enabled));
      }

      // Hydrate showArchived
      const storedShowArchived = safeLocalStorage.getJSON<boolean>(SHOW_ARCHIVED_STORAGE_KEY);
      if (typeof storedShowArchived === "boolean") {
        api.dispatch(setShowArchived(storedShowArchived));
      }

      // Hydrate groupByRepo
      const storedGroupByRepo = safeLocalStorage.getJSON<boolean>(GROUP_BY_REPO_STORAGE_KEY);
      if (typeof storedGroupByRepo === "boolean") {
        api.dispatch(setGroupByRepo(storedGroupByRepo));
      }

      // Hydrate hasCompletedProviderSetup
      const storedProviderSetup = safeLocalStorage.getJSON<boolean>(COMPLETED_PROVIDER_SETUP_STORAGE_KEY);
      if (typeof storedProviderSetup === "boolean") {
        api.dispatch(setHasCompletedProviderSetup(storedProviderSetup));
      }

      // Hydrate agent font style
      const storedAgentFont = safeLocalStorage.getJSON<{ fontStyle: FontStyle }>(AGENT_STORAGE_KEY);
      if (
        storedAgentFont &&
        typeof storedAgentFont.fontStyle === "string" &&
        FONT_STYLES.includes(storedAgentFont.fontStyle as FontStyle)
      ) {
        api.dispatch(setAgentFontStyle(storedAgentFont.fontStyle));
      }

      // Hydrate note font style
      const storedNoteFont = safeLocalStorage.getJSON<{ fontStyle: FontStyle }>(NOTE_STORAGE_KEY);
      if (
        storedNoteFont &&
        typeof storedNoteFont.fontStyle === "string" &&
        FONT_STYLES.includes(storedNoteFont.fontStyle as FontStyle)
      ) {
        api.dispatch(setNoteFontStyle(storedNoteFont.fontStyle));
      }

      // Hydrate code font family
      const storedCodeFont = safeLocalStorage.getJSON<{ fontFamily: string }>(CODE_STORAGE_KEY);
      if (storedCodeFont && typeof storedCodeFont.fontFamily === "string" && storedCodeFont.fontFamily.trim()) {
        api.dispatch(setCodeFontFamily(storedCodeFont.fontFamily));
      }

      // Hydrate activity-log presets
      const storedPresets = safeLocalStorage.getJSON<ActivityLogPresetPreference[]>(
        ACTIVITY_LOG_PRESETS_STORAGE_KEY
      );
      if (
        Array.isArray(storedPresets) &&
        storedPresets.every(
          (p) =>
            p &&
            typeof p === "object" &&
            typeof p.name === "string" &&
            typeof p.filters === "object"
        )
      ) {
        api.dispatch(hydrateActivityLogPresets(storedPresets));
      }

      // Hydrate language preference
      const storedLanguage = safeLocalStorage.getJSON<string>(LANGUAGE_PREFERENCE_STORAGE_KEY);
      if (typeof storedLanguage === "string" && storedLanguage.trim() !== "") {
        api.dispatch(setLanguagePreference(storedLanguage));
      }
    }

    // Apply the language preference to the Paraglide runtime before the
    // reducer runs, so components re-rendering from this dispatch already
    // read messages in the new locale.
    if (action && action.type === setLanguagePreference.type) {
      const [preference] = (action as ReturnType<typeof setLanguagePreference>).payload;
      applyLanguagePreference(preference);
    }

    const result = next(action);

    if (action) {
      switch (action.type) {
        // Spellcheck persistence
        case setSpellcheckEnabled.type:
        case toggleSpellcheck.type: {
          const state = api.getState().userPreferences;
          safeLocalStorage.setJSON(SPELLCHECK_STORAGE_KEY, { enabled: state.spellcheckEnabled });
          break;
        }

        // ShowArchived persistence
        case setShowArchived.type:
        case toggleShowArchived.type: {
          const state = api.getState().userPreferences;
          safeLocalStorage.setJSON(SHOW_ARCHIVED_STORAGE_KEY, state.showArchived);
          break;
        }

        // GroupByRepo persistence
        case setGroupByRepo.type:
        case toggleGroupByRepo.type: {
          const state = api.getState().userPreferences;
          safeLocalStorage.setJSON(GROUP_BY_REPO_STORAGE_KEY, state.groupByRepo);
          break;
        }

        // HasCompletedProviderSetup persistence
        case setHasCompletedProviderSetup.type:
        case toggleHasCompletedProviderSetup.type: {
          const state = api.getState().userPreferences;
          safeLocalStorage.setJSON(COMPLETED_PROVIDER_SETUP_STORAGE_KEY, state.hasCompletedProviderSetup);
          break;
        }

        // Agent font style persistence
        case setAgentFontStyle.type:
        case cycleFontStyle.type: {
          const state = api.getState().userPreferences;
          safeLocalStorage.setJSON(AGENT_STORAGE_KEY, { fontStyle: state.agentFontStyle });
          break;
        }

        // Note font style persistence
        case setNoteFontStyle.type:
        case cycleNoteFontStyle.type: {
          const state = api.getState().userPreferences;
          safeLocalStorage.setJSON(NOTE_STORAGE_KEY, { fontStyle: state.noteFontStyle });
          break;
        }

        // Code font family persistence
        case setCodeFontFamily.type: {
          const state = api.getState().userPreferences;
          safeLocalStorage.setJSON(CODE_STORAGE_KEY, { fontFamily: state.codeFontFamily });
          break;
        }

        // Activity log presets persistence
        case saveActivityLogPreset.type:
        case deleteActivityLogPreset.type: {
          const state = api.getState().userPreferences;
          safeLocalStorage.setJSON(ACTIVITY_LOG_PRESETS_STORAGE_KEY, state.activityLogPresets);
          break;
        }

        // Language preference persistence + main-process sync (fire-and-forget)
        case setLanguagePreference.type: {
          const state = api.getState().userPreferences;
          safeLocalStorage.setJSON(LANGUAGE_PREFERENCE_STORAGE_KEY, state.languagePreference);
          if (isElectron() && typeof window !== "undefined" && window.electronAPI?.invoke) {
            void window.electronAPI
              .invoke("app:set-language-preference", { preference: state.languagePreference })
              .catch(() => {
                // Non-fatal: main keeps its current locale until the next sync.
              });
          }
          break;
        }
      }
    }

    return result;
  };
}
