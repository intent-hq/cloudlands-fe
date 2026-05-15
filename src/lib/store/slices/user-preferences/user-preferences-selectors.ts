import { createSelector } from "../../utils/create-selector";
import {
  SYSTEM_DEFAULT_FONT,
  type FontOption,
} from "./user-preferences-slice";

export const selectAgentFontStyle = createSelector((state) => {
  return state.userPreferences.agentFontStyle;
});

export const selectAgentFontStyleLabel = createSelector((state) => {
  switch (state.userPreferences.agentFontStyle) {
    case "sans":
      return "Sans-serif";
    case "monospace":
      return "Monospace";
    default:
      return "Sans-serif";
  }
});

export const selectIsAgentMonospace = createSelector((state) => {
  return state.userPreferences.agentFontStyle === "monospace";
});

export const selectBetaUpdatesEnabled = createSelector((state) => {
  return state.userPreferences.betaUpdatesEnabled;
});

export const selectSpellcheckEnabled = createSelector((state) => {
  return state.userPreferences.spellcheckEnabled;
});

export const selectZoomFactor = createSelector((state) => {
  return state.userPreferences.zoomFactor;
});

export const selectShowArchived = createSelector((state) => {
  return state.userPreferences.showArchived;
});

export const selectGroupByRepo = createSelector((state) => {
  return state.userPreferences.groupByRepo;
});

export const selectHasCompletedProviderSetup = createSelector((state) => {
  return state.userPreferences.hasCompletedProviderSetup;
});

export const selectCounterScale = createSelector((state) => {
  return 1 / state.userPreferences.zoomFactor;
});

export const selectNoteFontStyle = createSelector((state) => {
  return state.userPreferences.noteFontStyle;
});

export const selectNoteFontStyleLabel = createSelector((state) => {
  switch (state.userPreferences.noteFontStyle) {
    case "sans":
      return "Sans-serif";
    case "monospace":
      return "Monospace";
    default:
      return "Sans-serif";
  }
});

export const selectIsNoteMonospace = createSelector((state) => {
  return state.userPreferences.noteFontStyle === "monospace";
});

export const selectCodeFontFamily = createSelector((state) => {
  return state.userPreferences.codeFontFamily;
});

export const selectSystemFonts = createSelector((state) => {
  return state.userPreferences.systemFonts;
});

export const selectCodeFontFamilyCSS = createSelector((state) => {
  const { codeFontFamily } = state.userPreferences;
  if (codeFontFamily === "system-default") {
    return SYSTEM_DEFAULT_FONT;
  }
  return `'${codeFontFamily}', monospace`;
});

export const selectCodeFontFamilyLabel = createSelector((state) => {
  const { codeFontFamily } = state.userPreferences;
  if (codeFontFamily === "system-default") {
    return "System Default";
  }
  return codeFontFamily;
});

export const selectCodeFontOptions = createSelector((state) => {
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

export const selectNotificationEnabled = createSelector((state) => {
  return state.userPreferences.enabled;
});

export const selectSoundEnabled = createSelector((state) => {
  return state.userPreferences.soundEnabled;
});

export const selectSoundOnlyWhenUnfocused = createSelector((state) => {
  return state.userPreferences.soundOnlyWhenUnfocused;
});

export const selectNotificationVolume = createSelector((state) => {
  return state.userPreferences.volume;
});

export const selectActivityLogPresets = createSelector((state) => {
  return state.userPreferences.activityLogPresets;
});

export const selectPromoBannerInteractions = createSelector((state) => {
  return state.userPreferences.promoBannerInteractions;
});

export const selectPromoBannerInteractionRecord = createSelector((state, bannerId: string) => {
  return state.userPreferences.promoBannerInteractions[bannerId] ?? null;
});
