import { createSelector } from "../../utils/create-selector";
import { SYSTEM_DEFAULT_FONT, type FontOption } from "./font-settings-slice";

export const selectAgentFontStyle = createSelector((state) => {
  return state.fontSettings.agentFontStyle;
});

export const selectAgentFontStyleLabel = createSelector((state) => {
  switch (state.fontSettings.agentFontStyle) {
    case 'sans':
      return 'Sans-serif';
    case 'monospace':
      return 'Monospace';
    default:
      return 'Sans-serif';
  }
});

export const selectIsAgentMonospace = createSelector((state) => {
  return state.fontSettings.agentFontStyle === 'monospace';
});

export const selectNoteFontStyle = createSelector((state) => {
  return state.fontSettings.noteFontStyle;
});

export const selectNoteFontStyleLabel = createSelector((state) => {
  switch (state.fontSettings.noteFontStyle) {
    case 'sans':
      return 'Sans-serif';
    case 'monospace':
      return 'Monospace';
    default:
      return 'Sans-serif';
  }
});

export const selectIsNoteMonospace = createSelector((state) => {
  return state.fontSettings.noteFontStyle === 'monospace';
});

export const selectCodeFontFamily = createSelector((state) => {
  return state.fontSettings.codeFontFamily;
});

export const selectSystemFonts = createSelector((state) => {
  return state.fontSettings.systemFonts;
});

export const selectCodeFontFamilyCSS = createSelector((state) => {
  const { codeFontFamily } = state.fontSettings;
  if (codeFontFamily === 'system-default') {
    return SYSTEM_DEFAULT_FONT;
  }
  return `'${codeFontFamily}', monospace`;
});

export const selectCodeFontFamilyLabel = createSelector((state) => {
  const { codeFontFamily } = state.fontSettings;
  if (codeFontFamily === 'system-default') {
    return 'System Default';
  }
  return codeFontFamily;
});

export const selectCodeFontOptions = createSelector((state) => {
  const { systemFonts } = state.fontSettings;
  const options: FontOption[] = [
    { value: 'system-default', label: 'System Default', fontFamily: SYSTEM_DEFAULT_FONT },
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