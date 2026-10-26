import { store } from '../../store';
import { getItems, type Collection } from '@themislib/themis/utils/collections/collection-utils';
import type { PanelContextItem, SelectionContextItem } from './multi-panel-context-slice';
import { contextNoteIds } from './context-note-ids';

const selectPanelsCollection = store.createSelector((state): Collection<PanelContextItem, 'id'> => {
  return state.multiPanelContext.panels;
});

export const selectPanels = store.createSelector((state) => {
  return getItems(selectPanelsCollection.select(state));
});

export const selectCheckedPanels = store.createSelector((state) => {
  return selectPanels.select(state).filter((p) => p.checked);
});

/** The turn's `noteIds`: checked note/spec panels only (see `contextNoteIds`). */
export const selectCheckedNoteIds = store.createSelector((state) => {
  return contextNoteIds(selectCheckedPanels.select(state));
});

const selectSelectionsCollection = store.createSelector(
  (state): Collection<SelectionContextItem, 'id'> => {
    return state.multiPanelContext.selections;
  },
);

export const selectSelections = store.createSelector((state) => {
  return getItems(selectSelectionsCollection.select(state));
});

export const selectCheckedSelections = store.createSelector((state) => {
  return selectSelections.select(state).filter((s) => s.checked);
});
