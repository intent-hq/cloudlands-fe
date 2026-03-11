import { createSelector } from "../../utils/create-selector";

export const selectAgentFontStyle = createSelector((state) => {
  return state.agentFontSettings.fontStyle;
});

export const selectAgentFontStyleLabel = createSelector((state) => {
  switch (state.agentFontSettings.fontStyle) {
    case 'sans':
      return 'Sans-serif';
    case 'monospace':
      return 'Monospace';
    default:
      return 'Sans-serif';
  }
});

export const selectIsAgentMonospace = createSelector((state) => {
  return state.agentFontSettings.fontStyle === 'monospace';
});

