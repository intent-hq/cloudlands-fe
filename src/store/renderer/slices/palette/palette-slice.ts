import { createAction } from '$lib/store-shim/utils/store/create-action';
import { createReducer } from '$lib/store-shim/utils/store/create-reducer';
import {
  normalizePaletteFileMru,
  getPaletteMruEntries,
  normalizePaletteMruState,
} from './palette-normalization';
import type { PaletteMruEntry, PaletteMruEntryType, PaletteState } from './palette-types';

export const initialState: PaletteState = {
  isOpen: false,
  query: '',
  mruEntryIds: [],
  mruEntriesByKey: {},
  fileMru: {},
};

export const openPalette = createAction('palette/open');
export const closePalette = createAction('palette/close');
export const openGoToLine = createAction('palette/openGoToLine');
export const togglePalette = createAction('palette/toggle');
export const hydratePaletteMruEntries = createAction<[entries: PaletteMruEntry[]]>(
  'palette/hydrateMruEntries',
);
export const recordPaletteMruItem =
  createAction<[type: PaletteMruEntryType, id: string, timestamp: number]>('palette/recordMruItem');
export const hydratePaletteFileMru =
  createAction<[fileMru: Record<string, number>]>('palette/hydrateFileMru');
export const recordPaletteFileMru =
  createAction<[path: string, timestamp: number]>('palette/recordFileMru');

export const paletteReducer = createReducer<PaletteState>(initialState)
  .with(openPalette, (state) => ({
    ...state,
    isOpen: true,
    query: '',
  }))
  .with(closePalette, (state) => ({
    ...state,
    isOpen: false,
    query: '',
  }))
  .with(openGoToLine, (state) => ({
    ...state,
    isOpen: true,
    query: ':',
  }))
  .with(togglePalette, (state) => {
    if (state.isOpen) {
      return { ...state, isOpen: false, query: '' };
    }
    return { ...state, isOpen: true, query: '' };
  })
  .with(hydratePaletteMruEntries, (state, { payload: [entries] }) => ({
    ...state,
    ...normalizePaletteMruState(entries),
  }))
  .with(recordPaletteMruItem, (state, { payload: [type, id, timestamp] }) => ({
    ...state,
    ...normalizePaletteMruState([{ type, id, timestamp }, ...getPaletteMruEntries(state)]),
  }))
  .with(hydratePaletteFileMru, (state, { payload: [fileMru] }) => ({
    ...state,
    fileMru: normalizePaletteFileMru(fileMru),
  }))
  .with(recordPaletteFileMru, (state, { payload: [path, timestamp] }) => ({
    ...state,
    fileMru: normalizePaletteFileMru({ ...state.fileMru, [path]: timestamp }),
  }));
