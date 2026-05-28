import { createSelector } from "../../utils/create-selector";
import { getPaletteMruEntries } from "./palette-normalization";

export const selectIsPaletteOpen = createSelector((state) => {
  return state.palette.isOpen;
});

export const selectPaletteQuery = createSelector((state) => {
  return state.palette.query;
});

export const selectPaletteMruEntries = createSelector((state) => {
  return getPaletteMruEntries(state.palette);
});

export const selectPaletteFileMru = createSelector((state) => {
  return state.palette.fileMru;
});

