import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import { store } from '../../store';
import { getPaletteMruEntries, getPalettePicks } from './palette-normalization';
import type { PaletteNoteSearchUpdate } from './palette-types';

const emptyNoteSearch: PaletteNoteSearchUpdate = {
  items: [],
  loading: false,
  capability: 'unknown',
  fallback: true,
};

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

export const selectPalettePicks = store.createSelector((state) => {
  return getPalettePicks(state.palette);
});

/** Everything persisted per daemon: recent items, recent files and picks. */
export const selectPaletteMemorySnapshot = store.createSelector((state) => {
  return state.palette;
});

export const selectPaletteNoteSearch = store.createSelector((state, consumerId: string) => {
  return getItem(state.palette.noteSearches, consumerId) ?? emptyNoteSearch;
});
