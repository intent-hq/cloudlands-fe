import { createSelector } from "../../utils/create-selector";
import { SYSTEM_DEFAULT_FONT, type FontOption } from "./code-font-settings-slice";

export const selectCodeFontFamily = createSelector((state) => {
  return state.codeFontSettings.fontFamily;
});

export const selectSystemFonts = createSelector((state) => {
  return state.codeFontSettings.systemFonts;
});

export const selectCodeFontFamilyCSS = createSelector((state) => {
  const { fontFamily } = state.codeFontSettings;
  if (fontFamily === 'system-default') {
    return SYSTEM_DEFAULT_FONT;
  }
  return `'${fontFamily}', monospace`;
});

export const selectCodeFontFamilyLabel = createSelector((state) => {
  const { fontFamily } = state.codeFontSettings;
  if (fontFamily === 'system-default') {
    return 'System Default';
  }
  return fontFamily;
});

export const selectCodeFontOptions = createSelector((state) => {
  const { systemFonts } = state.codeFontSettings;
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

