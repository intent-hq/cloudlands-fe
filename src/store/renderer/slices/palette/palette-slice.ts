import { createAction, createAsyncAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import {
  createCollection,
  getItem,
  removeItem,
  upsertItem,
} from '@themislib/themis/utils/collections/collection-utils';
import {
  normalizePaletteFileMru,
  getPaletteMruEntries,
  getPalettePicks,
  mergePaletteMemory,
  toPalettePickState,
  normalizePaletteMruState,
} from './palette-normalization';
import { addPalettePick, normalizePalettePickQuery } from './palette-pick-memory';
import type {
  PaletteMemorySnapshot,
  PaletteMruEntryType,
  PaletteNoteSearchUpdate,
  PaletteState,
} from './palette-types';

export const initialState: PaletteState = {
  isOpen: false,
  query: '',
  mruEntryIds: [],
  mruEntriesByKey: {},
  fileMru: {},
  pickQueries: [],
  picksByQuery: {},
  noteSearches: createCollection('consumerId'),
};

export const openPalette = createAction<[query?: string]>('palette/open');
export const closePalette = createAction('palette/close');
export const openGoToLine = createAction('palette/openGoToLine');
export const togglePalette = createAction('palette/toggle');
export const recordPaletteMruItem =
  createAction<[type: PaletteMruEntryType, id: string, timestamp: number]>('palette/recordMruItem');
export const recordPaletteFileMru =
  createAction<[path: string, timestamp: number]>('palette/recordFileMru');
/** Remember that the row with `itemKey` (the ranker's `paletteItemKey(row)`) was opened for `query`. */
export const recordPalettePick =
  createAction<[query: string, itemKey: string, timestamp: number]>('palette/recordPick');
/** Stored memory loaded: `merge` at startup, `replace` when the window switches daemon. */
export const paletteMemoryLoaded =
  createAction<[memory: PaletteMemorySnapshot, mode: 'merge' | 'replace']>('palette/memoryLoaded');
export const paletteNoteSearchRequested = createAsyncAction<
  [consumerId: string, requestId: string, query: string, preferWorkspaceId?: string],
  PaletteNoteSearchUpdate
>('palette/noteSearchRequested', 'palette/noteSearchSettled');
export const paletteNoteSearchAuthorityCaptured = createAction<
  [consumerId: string, requestId: string, authority: string | null]
>('palette/noteSearchAuthorityCaptured');
export const paletteNoteSearchFinished = createAction<
  [consumerId: string, requestId: string, authority: string | null, update: PaletteNoteSearchUpdate]
>('palette/noteSearchFinished');
export const paletteNoteSearchReleased = createAction<[consumerId: string]>(
  'palette/noteSearchReleased',
);

export const paletteReducer = createReducer<PaletteState>(initialState);
paletteReducer.with(openPalette, (state, { payload: [query] }) => ({
  ...state,
  isOpen: true,
  query: query ?? '',
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
paletteReducer.with(recordPalettePick, (state, { payload: [query, itemKey, timestamp] }) => {
  const normalized = normalizePalettePickQuery(query);
  if (!normalized || !itemKey) return state;
  return {
    ...state,
    ...toPalettePickState(
      addPalettePick(getPalettePicks(state), {
        query: normalized,
        itemKey,
        timestamp,
      }),
    ),
  };
});
paletteReducer.with(paletteMemoryLoaded, (state, { payload: [memory, mode] }) => ({
  ...state,
  ...(mode === 'merge' ? mergePaletteMemory(state, memory) : memory),
}));
paletteReducer.with(
  paletteNoteSearchRequested,
  (state, { payload: [consumerId, requestId, query, preferWorkspaceId] }) => ({
    ...state,
    noteSearches: upsertItem(state.noteSearches, {
      consumerId,
      requestId,
      query,
      ...(preferWorkspaceId ? { preferWorkspaceId } : {}),
      authority: null,
      items: [],
      loading: query.trim().length > 0,
      capability: 'unknown',
      fallback: true,
    }),
  }),
);
paletteReducer.with(
  paletteNoteSearchAuthorityCaptured,
  (state, { payload: [consumerId, requestId, authority] }) => {
    const current = getItem(state.noteSearches, consumerId);
    if (!current || current.requestId !== requestId) return state;
    return {
      ...state,
      noteSearches: upsertItem(state.noteSearches, { ...current, authority }),
    };
  },
);
paletteReducer.with(
  paletteNoteSearchFinished,
  (state, { payload: [consumerId, requestId, authority, update] }) => {
    const current = getItem(state.noteSearches, consumerId);
    if (!current || current.requestId !== requestId || current.authority !== authority)
      return state;
    return {
      ...state,
      noteSearches: upsertItem(state.noteSearches, { ...current, ...update }),
    };
  },
);
paletteReducer.with(paletteNoteSearchReleased, (state, { payload: [consumerId] }) => {
  if (!getItem(state.noteSearches, consumerId)) return state;
  return { ...state, noteSearches: removeItem(state.noteSearches, consumerId) };
});
