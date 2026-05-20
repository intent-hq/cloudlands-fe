import { store } from "../../store";
import { getPaletteMruEntries } from "./palette-normalization";

export const selectIsPaletteOpen = store.createSelector((state) => {
  return state.palette.isOpen;
});

export const selectPaletteQuery = store.createSelector((state) => {
  return state.palette.query;
});

export const selectPaletteMruEntries = store.createSelector((state) => {
  return getPaletteMruEntries(state.palette);
});

export const selectPaletteFileMru = store.createSelector((state) => {
  return state.palette.fileMru;
});

