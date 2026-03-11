import { createSelector } from "../../utils/create-selector";

/** Select the current zoom factor */
export const selectZoomFactor = createSelector((state) => {
  return state.zoom.zoomFactor;
});

/** Select the counter-scale value (1 / zoomFactor) */
export const selectCounterScale = createSelector((state) => {
  return 1 / state.zoom.zoomFactor;
});

