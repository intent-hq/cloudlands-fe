import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import {
  addItem,
  createCollection,
  filterCollection,
  getItem,
  getItems,
  type Collection,
  updateItem,
  upsertItem,
} from '@augmentcode/themis/utils/collections/collection-utils';
import { deepEqual } from 'fast-equals';

// ============================================================================
// Types
// ============================================================================

export interface PanelContextItem {
  id: string;
  panelId: string;
  tabId: string;
  type: 'file' | 'note' | 'spec' | 'diff' | 'browser' | 'agent';
  label: string;
  filePath?: string;
  noteId?: string;
  browserUrl?: string;
  agentId?: string;
  checked: boolean;
  /** Whether this tab is the active tab in its panel */
  isActive?: boolean;
}

export interface SelectionContextItem {
  id: string;
  panelId: string;
  tabId: string;
  sourceType: 'file' | 'note';
  sourceLabel: string;
  filePath?: string;
  noteId?: string;
  text: string;
  language?: string;
  checked: boolean;
  /** Timestamp for ordering */
  timestamp: number;
}

// ============================================================================
// State
// ============================================================================

export type MultiPanelContextState = {
  panels: Collection<PanelContextItem, 'id'>;
  selections: Collection<SelectionContextItem, 'id'>;
  currentAgentPanelId: string | null;
  workspaceId: string | null;
};

const initialState: MultiPanelContextState = {
  panels: createCollection<PanelContextItem, 'id'>('id'),
  selections: createCollection<SelectionContextItem, 'id'>('id'),
  currentAgentPanelId: null,
  workspaceId: null,
};

// ============================================================================
// Actions
// ============================================================================

export const setWorkspace = createAction<[workspaceId: string | null]>(
  'multiPanelContext/setWorkspace',
);
export const updatePanels = createAction<[panels: PanelContextItem[]]>(
  'multiPanelContext/updatePanels',
);
export const togglePanel = createAction<[id: string]>('multiPanelContext/togglePanel');
export const setSelection = createAction<
  [selection: Omit<SelectionContextItem, 'id' | 'checked'> & { timestamp: number }]
>('multiPanelContext/setSelection');
export const clearSelection = createAction<[panelId: string, tabId: string]>(
  'multiPanelContext/clearSelection',
);
export const toggleSelection = createAction<[id: string]>('multiPanelContext/toggleSelection');
export const addSearchedItem = createAction<
  [
    item: {
      id: string;
      type: PanelContextItem['type'];
      label: string;
      filePath?: string;
      noteId?: string;
    },
  ]
>('multiPanelContext/addSearchedItem');

// ============================================================================
// Reducer
// ============================================================================

export const multiPanelContextReducer = createReducer<MultiPanelContextState>(initialState);

multiPanelContextReducer.with(setWorkspace, (state, { payload: [workspaceId] }) => {
  if (state.workspaceId === workspaceId) return state;
  return {
    panels: createCollection<PanelContextItem, 'id'>('id'),
    selections: createCollection<SelectionContextItem, 'id'>('id'),
    currentAgentPanelId: null,
    workspaceId,
  };
});
multiPanelContextReducer.with(updatePanels, (state, { payload: [panels] }) => {
  const checkedIds = new Set(
    getItems(state.panels)
      .filter((p) => p.checked)
      .map((p) => p.id),
  );
  const nextPanels = panels.map((p) => ({
    ...p,
    checked: checkedIds.has(p.id) || p.checked,
  }));

  if (deepEqual(getItems(state.panels), nextPanels)) {
    return state;
  }

  return {
    ...state,
    panels: createCollection<PanelContextItem, 'id'>('id', nextPanels),
  };
});
multiPanelContextReducer.with(togglePanel, (state, { payload: [id] }) => {
  const panel = getItem(state.panels, id);
  if (!panel) return state;

  const panels = updateItem(state.panels, { ...panel, checked: !panel.checked });
  if (panels === state.panels) {
    return state;
  }

  return {
    ...state,
    panels,
  };
});
multiPanelContextReducer.with(setSelection, (state, { payload: [selection] }) => {
  const id = `sel-${selection.panelId}-${selection.tabId}`;
  const existing = getItem(state.selections, id);
  if (
    existing &&
    existing.panelId === selection.panelId &&
    existing.tabId === selection.tabId &&
    existing.sourceType === selection.sourceType &&
    existing.sourceLabel === selection.sourceLabel &&
    existing.filePath === selection.filePath &&
    existing.noteId === selection.noteId &&
    existing.text === selection.text &&
    existing.language === selection.language &&
    existing.checked === true
  ) {
    return state;
  }
  const item: SelectionContextItem = {
    ...selection,
    id,
    checked: true,
  };
  const selections = upsertItem(state.selections, item);
  if (selections === state.selections) {
    return state;
  }

  return { ...state, selections };
});
multiPanelContextReducer.with(clearSelection, (state, { payload: [panelId, tabId] }) => {
  const id = `sel-${panelId}-${tabId}`;
  if (!getItem(state.selections, id)) return state;
  return {
    ...state,
    selections: filterCollection(
      state.selections,
      (selection): selection is SelectionContextItem => {
        return !(selection.panelId === panelId && selection.tabId === tabId);
      },
    ),
  };
});
multiPanelContextReducer.with(toggleSelection, (state, { payload: [id] }) => {
  const selection = getItem(state.selections, id);
  if (!selection) return state;

  const selections = updateItem(state.selections, {
    ...selection,
    checked: !selection.checked,
  });
  if (selections === state.selections) {
    return state;
  }

  return {
    ...state,
    selections,
  };
});
multiPanelContextReducer.with(addSearchedItem, (state, { payload: [item] }) => {
  const existing = getItem(state.panels, item.id);
  if (existing) {
    if (existing.checked) return state;

    const panels = updateItem(state.panels, { ...existing, checked: true });
    if (panels === state.panels) {
      return state;
    }

    return {
      ...state,
      panels,
    };
  }

  const newItem: PanelContextItem = {
    id: item.id,
    panelId: 'search',
    tabId: item.id,
    type: item.type,
    label: item.label,
    filePath: item.filePath,
    noteId: item.noteId,
    checked: true,
  };

  return { ...state, panels: addItem(state.panels, newItem) };
});
