import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import {
  normalizePaletteFileMru,
  getPaletteMruEntries,
  normalizePaletteMruState,
} from './palette-normalization';
import type { PaletteMruEntryType, PaletteState } from './palette-types';

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
export const recordPaletteMruItem =
  createAction<[type: PaletteMruEntryType, id: string, timestamp: number]>('palette/recordMruItem');
export const recordPaletteFileMru =
  createAction<[path: string, timestamp: number]>('palette/recordFileMru');

export const paletteReducer = createReducer<PaletteState>(initialState);
paletteReducer.with(openPalette, (state) => ({
  ...state,
  isOpen: true,
  query: '',
}));
paletteReducer.with(closePalette, (state) => ({
  ...state,
  isOpen: false,
  query: '',
}));
paletteReducer.with(openGoToLine, (state) => ({
  ...state,
  isOpen: true,
  query: ':',
}));
paletteReducer.with(togglePalette, (state) => {
  if (state.isOpen) {
    return { ...state, isOpen: false, query: '' };
  }
  return { ...state, isOpen: true, query: '' };
});
paletteReducer.with(recordPaletteMruItem, (state, { payload: [type, id, timestamp] }) => ({
  ...state,
  ...normalizePaletteMruState([{ type, id, timestamp }, ...getPaletteMruEntries(state)]),
}));
paletteReducer.with(recordPaletteFileMru, (state, { payload: [path, timestamp] }) => ({
  ...state,
  fileMru: normalizePaletteFileMru({ ...state.fileMru, [path]: timestamp }),
}));
