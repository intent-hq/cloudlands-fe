import { createSelector } from "../../utils/create-selector";

export const selectIsPaletteOpen = createSelector((state) => {
  return state.palette.isOpen;
});

export const selectPaletteQuery = createSelector((state) => {
  return state.palette.query;
});

