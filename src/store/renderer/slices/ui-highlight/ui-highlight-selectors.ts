import { store } from "../../store";

export const selectUiHighlightToken = store.createSelector((state, highlightId: string): number => {
  return state.uiHighlight.activeById[highlightId.trim()] ?? 0;
});

export const selectIsUiHighlightActive = store.createSelector((state, highlightId: string): boolean => {
  return selectUiHighlightToken.select(state, highlightId) > 0;
});

export const selectUiHighlightDurationMs = store.createSelector(
  (state, highlightId: string): number | undefined => {
    return state.uiHighlight.durationMsById[highlightId.trim()];
  },
);
