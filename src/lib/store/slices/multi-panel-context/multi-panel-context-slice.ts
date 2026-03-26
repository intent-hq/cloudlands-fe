import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";
import {
  addItem,
  createCollection,
  filterCollection,
  getItem,
  getItems,
  removeItem,
  type Collection,
  updateItem,
  upsertItem,
} from "../../utils/collection-utils";

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
  panels: Collection<PanelContextItem, "id">;
  selections: Collection<SelectionContextItem, "id">;
  currentAgentPanelId: string | null;
  workspaceId: string | null;
};

function mapCollectionItems<ITEM extends object, K extends keyof ITEM & string>(
  collection: Collection<ITEM, K>,
  mapItem: (item: ITEM) => ITEM
): Collection<ITEM, K> {
  let changed = false;
  const items = getItems(collection).map((item) => {
    const nextItem = mapItem(item);
    if (nextItem !== item) {
      changed = true;
    }
    return nextItem;
  });

  return changed ? createCollection<ITEM, K>(collection.idField, items) : collection;
}

function setCheckedState<ITEM extends { checked: boolean }, K extends keyof ITEM & string>(
  collection: Collection<ITEM, K>,
  checked: boolean
): Collection<ITEM, K> {
  return mapCollectionItems(collection, (item) => {
    if (item.checked === checked) {
      return item;
    }

    return { ...item, checked };
  });
}

const initialState: MultiPanelContextState = {
  panels: createCollection<PanelContextItem, "id">("id"),
  selections: createCollection<SelectionContextItem, "id">("id"),
  currentAgentPanelId: null,
  workspaceId: null,
};

// ============================================================================
// Actions
// ============================================================================

export const setWorkspace = createAction<[workspaceId: string | null]>("multiPanelContext/setWorkspace");
export const setCurrentAgentPanel = createAction<[panelId: string | null]>("multiPanelContext/setCurrentAgentPanel");
export const updatePanels = createAction<[panels: PanelContextItem[]]>("multiPanelContext/updatePanels");
export const togglePanel = createAction<[id: string]>("multiPanelContext/togglePanel");
export const setSelection = createAction<[selection: Omit<SelectionContextItem, 'id' | 'checked'> & { timestamp: number }]>("multiPanelContext/setSelection");
export const clearSelection = createAction<[panelId: string, tabId: string]>("multiPanelContext/clearSelection");
export const clearPanelSelections = createAction<[panelId: string]>("multiPanelContext/clearPanelSelections");
export const toggleSelection = createAction<[id: string]>("multiPanelContext/toggleSelection");
export const removeSelection = createAction<[id: string]>("multiPanelContext/removeSelection");
export const checkAllPanels = createAction("multiPanelContext/checkAllPanels");
export const uncheckAllPanels = createAction("multiPanelContext/uncheckAllPanels");
export const checkAllSelections = createAction("multiPanelContext/checkAllSelections");
export const uncheckAllSelections = createAction("multiPanelContext/uncheckAllSelections");
export const clear = createAction("multiPanelContext/clear");
export const addSearchedItem = createAction<[item: { id: string; type: PanelContextItem['type']; label: string; filePath?: string; noteId?: string }]>("multiPanelContext/addSearchedItem");
export const removePanel = createAction<[id: string]>("multiPanelContext/removePanel");

// ============================================================================
// Reducer
// ============================================================================

export const multiPanelContextReducer = createReducer<MultiPanelContextState>(initialState)
  .with(setWorkspace, (state, { payload: [workspaceId] }) => {
    if (state.workspaceId === workspaceId) return state;
    return {
      panels: createCollection<PanelContextItem, "id">("id"),
      selections: createCollection<SelectionContextItem, "id">("id"),
      currentAgentPanelId: null,
      workspaceId,
    };
  })
  .with(setCurrentAgentPanel, (state, { payload: [panelId] }) => ({
    ...state,
    currentAgentPanelId: panelId,
  }))
  .with(updatePanels, (state, { payload: [panels] }) => {
    const checkedIds = new Set(getItems(state.panels).filter((p) => p.checked).map((p) => p.id));
    return {
      ...state,
      panels: createCollection<PanelContextItem, "id">(
        "id",
        panels.map((p) => ({
          ...p,
          checked: checkedIds.has(p.id) || p.checked,
        }))
      ),
    };
  })
  .with(togglePanel, (state, { payload: [id] }) => {
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
  })
  .with(setSelection, (state, { payload: [selection] }) => {
    const id = `sel-${selection.panelId}-${selection.tabId}`;
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
  })
  .with(clearSelection, (state, { payload: [panelId, tabId] }) => ({
    ...state,
    selections: filterCollection(
      state.selections,
      (selection): selection is SelectionContextItem => {
        return !(selection.panelId === panelId && selection.tabId === tabId);
      }
    ),
  }))
  .with(clearPanelSelections, (state, { payload: [panelId] }) => ({
    ...state,
    selections: filterCollection(state.selections, (selection): selection is SelectionContextItem => {
      return selection.panelId !== panelId;
    }),
  }))
  .with(toggleSelection, (state, { payload: [id] }) => {
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
  })
  .with(removeSelection, (state, { payload: [id] }) => ({
    ...state,
    selections: removeItem(state.selections, id),
  }))
  .with(checkAllPanels, (state) => ({
    ...state,
    panels: setCheckedState(state.panels, true),
  }))
  .with(uncheckAllPanels, (state) => ({
    ...state,
    panels: setCheckedState(state.panels, false),
  }))
  .with(checkAllSelections, (state) => ({
    ...state,
    selections: setCheckedState(state.selections, true),
  }))
  .with(uncheckAllSelections, (state) => ({
    ...state,
    selections: setCheckedState(state.selections, false),
  }))
  .with(clear, (state) => ({
    panels: createCollection<PanelContextItem, "id">("id"),
    selections: createCollection<SelectionContextItem, "id">("id"),
    currentAgentPanelId: null,
    workspaceId: state.workspaceId,
  }))
  .with(addSearchedItem, (state, { payload: [item] }) => {
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
  })
  .with(removePanel, (state, { payload: [id] }) => ({
    ...state,
    panels: removeItem(state.panels, id),
  }));

