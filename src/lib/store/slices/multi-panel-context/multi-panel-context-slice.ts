import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";

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
  panels: PanelContextItem[];
  selections: SelectionContextItem[];
  currentAgentPanelId: string | null;
  workspaceId: string | null;
};

const initialState: MultiPanelContextState = {
  panels: [],
  selections: [],
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
    return { panels: [], selections: [], currentAgentPanelId: null, workspaceId };
  })
  .with(setCurrentAgentPanel, (state, { payload: [panelId] }) => ({
    ...state,
    currentAgentPanelId: panelId,
  }))
  .with(updatePanels, (state, { payload: [panels] }) => {
    const checkedIds = new Set(state.panels.filter((p) => p.checked).map((p) => p.id));
    return {
      ...state,
      panels: panels.map((p) => ({
        ...p,
        checked: checkedIds.has(p.id) || p.checked,
      })),
    };
  })
  .with(togglePanel, (state, { payload: [id] }) => {
    const idx = state.panels.findIndex((p) => p.id === id);
    if (idx < 0) return state;
    return {
      ...state,
      panels: state.panels.map((p, i) => i === idx ? { ...p, checked: !p.checked } : p),
    };
  })
  .with(setSelection, (state, { payload: [selection] }) => {
    const id = `sel-${selection.panelId}-${selection.tabId}`;
    const item: SelectionContextItem = {
      ...selection,
      id,
      checked: true,
    };
    const existingIndex = state.selections.findIndex(
      (s) => s.panelId === selection.panelId && s.tabId === selection.tabId,
    );
    if (existingIndex >= 0) {
      return {
        ...state,
        selections: state.selections.map((s, i) => i === existingIndex ? item : s),
      };
    }
    return { ...state, selections: [...state.selections, item] };
  })
  .with(clearSelection, (state, { payload: [panelId, tabId] }) => ({
    ...state,
    selections: state.selections.filter((s) => !(s.panelId === panelId && s.tabId === tabId)),
  }))
  .with(clearPanelSelections, (state, { payload: [panelId] }) => ({
    ...state,
    selections: state.selections.filter((s) => s.panelId !== panelId),
  }))
  .with(toggleSelection, (state, { payload: [id] }) => {
    const idx = state.selections.findIndex((s) => s.id === id);
    if (idx < 0) return state;
    return {
      ...state,
      selections: state.selections.map((s, i) => i === idx ? { ...s, checked: !s.checked } : s),
    };
  })
  .with(removeSelection, (state, { payload: [id] }) => ({
    ...state,
    selections: state.selections.filter((s) => s.id !== id),
  }))
  .with(checkAllPanels, (state) => ({
    ...state,
    panels: state.panels.map((p) => ({ ...p, checked: true })),
  }))
  .with(uncheckAllPanels, (state) => ({
    ...state,
    panels: state.panels.map((p) => ({ ...p, checked: false })),
  }))
  .with(checkAllSelections, (state) => ({
    ...state,
    selections: state.selections.map((s) => ({ ...s, checked: true })),
  }))
  .with(uncheckAllSelections, (state) => ({
    ...state,
    selections: state.selections.map((s) => ({ ...s, checked: false })),
  }))
  .with(clear, (state) => ({
    panels: [],
    selections: [],
    currentAgentPanelId: null,
    workspaceId: state.workspaceId,
  }))
  .with(addSearchedItem, (state, { payload: [item] }) => {
    const existing = state.panels.find((p) => p.id === item.id);
    if (existing) {
      if (existing.checked) return state;
      return {
        ...state,
        panels: state.panels.map((p) => p.id === item.id ? { ...p, checked: true } : p),
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
    return { ...state, panels: [...state.panels, newItem] };
  })
  .with(removePanel, (state, { payload: [id] }) => ({
    ...state,
    panels: state.panels.filter((p) => p.id !== id),
  }));

