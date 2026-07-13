import { store } from "../../store";
import {
  SYSTEM_DEFAULT_FONT,
  type FontOption,
} from "./user-preferences-slice";

export const selectAgentFontStyle = store.createSelector((state) => {
  return state.userPreferences.agentFontStyle;
});

export const selectAgentFontStyleLabel = store.createSelector((state) => {
  switch (state.userPreferences.agentFontStyle) {
    case "sans":
      return "Sans-serif";
    case "monospace":
      return "Monospace";
    default:
      return "Sans-serif";
  }
});

export const selectIsAgentMonospace = store.createSelector((state) => {
  return state.userPreferences.agentFontStyle === "monospace";
});

export const selectBetaUpdatesEnabled = store.createSelector((state) => {
  return state.userPreferences.betaUpdatesEnabled;
});

export const selectSpellcheckEnabled = store.createSelector((state) => {
  return state.userPreferences.spellcheckEnabled;
});

export const selectZoomFactor = store.createSelector((state) => {
  return state.userPreferences.zoomFactor;
});

export const selectShowArchived = store.createSelector((state) => {
  return state.userPreferences.showArchived;
});

export const selectGroupByRepo = store.createSelector((state) => {
  return state.userPreferences.groupByRepo;
});

export const selectHasCompletedProviderSetup = store.createSelector((state) => {
  return state.userPreferences.hasCompletedProviderSetup;
});

export const selectCounterScale = store.createSelector((state) => {
  return 1 / state.userPreferences.zoomFactor;
});

export const selectNoteFontStyle = store.createSelector((state) => {
  return state.userPreferences.noteFontStyle;
});

export const selectNoteFontStyleLabel = store.createSelector((state) => {
  switch (state.userPreferences.noteFontStyle) {
    case "sans":
      return "Sans-serif";
    case "monospace":
      return "Monospace";
    default:
      return "Sans-serif";
  }
});

export const selectIsNoteMonospace = store.createSelector((state) => {
  return state.userPreferences.noteFontStyle === "monospace";
});

export const selectCodeFontFamily = store.createSelector((state) => {
  return state.userPreferences.codeFontFamily;
});

export const selectCodeFontFamilyCSS = store.createSelector((state) => {
  const { codeFontFamily } = state.userPreferences;
  if (codeFontFamily === "system-default") {
    return SYSTEM_DEFAULT_FONT;
  }
  return `'${codeFontFamily}', monospace`;
});

export const selectCodeFontFamilyLabel = store.createSelector((state) => {
  const { codeFontFamily } = state.userPreferences;
  if (codeFontFamily === "system-default") {
    return "System Default";
  }
  return codeFontFamily;
});

export const selectCodeFontOptions = store.createSelector((state) => {
  const { systemFonts } = state.userPreferences;
  const options: FontOption[] = [
    { value: "system-default", label: "System Default", fontFamily: SYSTEM_DEFAULT_FONT },
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

export const selectNotificationEnabled = store.createSelector((state) => {
  return state.userPreferences.enabled;
});

export const selectSoundEnabled = store.createSelector((state) => {
  return state.userPreferences.soundEnabled;
});

export const selectSoundOnlyWhenUnfocused = store.createSelector((state) => {
  return state.userPreferences.soundOnlyWhenUnfocused;
});

export const selectNotificationVolume = store.createSelector((state) => {
  return state.userPreferences.volume;
});

export const selectActivityLogPresets = store.createSelector((state) => {
  return state.userPreferences.activityLogPresets;
});

export const selectPromoBannerInteractions = store.createSelector((state) => {
  return state.userPreferences.promoBannerInteractions;
});

export const selectPromoBannerInteractionRecord = store.createSelector((state, bannerId: string) => {
  return state.userPreferences.promoBannerInteractions[bannerId] ?? null;
});
