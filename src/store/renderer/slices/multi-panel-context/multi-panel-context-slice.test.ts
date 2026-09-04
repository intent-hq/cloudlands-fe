import { describe, it, expect } from 'vitest';
import { createCollection, getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import {
  multiPanelContextReducer,
  setWorkspace,
  updatePanels,
  togglePanel,
  setSelection,
  clearSelection,
  toggleSelection,
  addSearchedItem,
  type MultiPanelContextState,
  type PanelContextItem,
  type SelectionContextItem,
} from './multi-panel-context-slice';

const initialState: MultiPanelContextState = {
  panels: createCollection<PanelContextItem, 'id'>('id'),
  selections: createCollection<SelectionContextItem, 'id'>('id'),
  currentAgentPanelId: null,
  workspaceId: null,
};

function withPanels(...panels: PanelContextItem[]): MultiPanelContextState {
  return {
    ...initialState,
    panels: createCollection<PanelContextItem, 'id'>('id', panels),
  };
}

function withSelections(...selections: SelectionContextItem[]): MultiPanelContextState {
  return {
    ...initialState,
    selections: createCollection<SelectionContextItem, 'id'>('id', selections),
  };
}

const makePanel = (overrides: Partial<PanelContextItem> = {}): PanelContextItem => ({
  id: 'p1',
  panelId: 'panel-1',
  tabId: 'tab-1',
  type: 'file',
  label: 'file.ts',
  checked: false,
  ...overrides,
});

const makeSelection = (overrides: Partial<SelectionContextItem> = {}): SelectionContextItem => ({
  id: 'sel-panel-1-tab-1',
  panelId: 'panel-1',
  tabId: 'tab-1',
  sourceType: 'file',
  sourceLabel: 'file.ts',
  text: 'selected text',
  checked: true,
  timestamp: 1000,
  ...overrides,
});

describe('multiPanelContextReducer', () => {
  it('should return initial state', () => {
    const state = multiPanelContextReducer(undefined, { type: '@@INIT' });
    expect(state).toEqual(initialState);
  });

  describe('setWorkspace', () => {
    it('should reset state when workspace changes', () => {
      const stateWithData: MultiPanelContextState = {
        panels: createCollection<PanelContextItem, 'id'>('id', [makePanel()]),
        selections: createCollection<SelectionContextItem, 'id'>('id', [makeSelection()]),
        currentAgentPanelId: 'agent-panel',
        workspaceId: 'ws-1',
      };
      const state = multiPanelContextReducer(stateWithData, setWorkspace('ws-2'));
      expect(state).toEqual({
        panels: createCollection<PanelContextItem, 'id'>('id'),
        selections: createCollection<SelectionContextItem, 'id'>('id'),
        currentAgentPanelId: null,
        workspaceId: 'ws-2',
      });
    });

    it('should return same state if workspace unchanged', () => {
      const stateWithWs: MultiPanelContextState = { ...initialState, workspaceId: 'ws-1' };
      const state = multiPanelContextReducer(stateWithWs, setWorkspace('ws-1'));
      expect(state).toBe(stateWithWs);
    });
  });

  describe('updatePanels', () => {
    it('should return same state for semantically unchanged panels after preserving checked state', () => {
      const stateWithChecked = withPanels(
        makePanel({ id: 'p1', checked: true, isActive: true, filePath: 'file.ts' }),
      );
      const incomingPanels = [
        makePanel({ id: 'p1', checked: false, isActive: true, filePath: 'file.ts' }),
      ];

      const state = multiPanelContextReducer(stateWithChecked, updatePanels(incomingPanels));

      expect(state).toBe(stateWithChecked);
    });

    it('should preserve checked state for existing panels', () => {
      const stateWithChecked = withPanels(
        makePanel({ id: 'p1', checked: true }),
        makePanel({ id: 'p2', checked: false }),
      );
      const newPanels = [
        makePanel({ id: 'p1', checked: false }),
        makePanel({ id: 'p2', checked: false }),
        makePanel({ id: 'p3', checked: false }),
      ];
      const state = multiPanelContextReducer(stateWithChecked, updatePanels(newPanels));
      const nextPanels = getItems(state.panels);
      expect(nextPanels[0].checked).toBe(true); // preserved
      expect(nextPanels[1].checked).toBe(false);
      expect(nextPanels[2].checked).toBe(false);
    });

    it('should keep incoming checked=true even if not previously checked', () => {
      const newPanels = [makePanel({ id: 'p1', checked: true })];
      const state = multiPanelContextReducer(initialState, updatePanels(newPanels));
      expect(getItems(state.panels)[0].checked).toBe(true);
    });

    it('should update state for real panel additions', () => {
      const stateWithPanel = withPanels(makePanel({ id: 'p1' }));
      const state = multiPanelContextReducer(
        stateWithPanel,
        updatePanels([makePanel({ id: 'p1' }), makePanel({ id: 'p2' })]),
      );

      expect(state).not.toBe(stateWithPanel);
      expect(getItems(state.panels).map((panel) => panel.id)).toEqual(['p1', 'p2']);
    });

    it('should update state for panel removals', () => {
      const stateWithPanels = withPanels(makePanel({ id: 'p1' }), makePanel({ id: 'p2' }));
      const state = multiPanelContextReducer(
        stateWithPanels,
        updatePanels([makePanel({ id: 'p1' })]),
      );

      expect(state).not.toBe(stateWithPanels);
      expect(getItems(state.panels).map((panel) => panel.id)).toEqual(['p1']);
    });

    it('should update state for semantic panel field changes', () => {
      const stateWithPanel = withPanels(makePanel({ id: 'p1', label: 'file.ts' }));
      const state = multiPanelContextReducer(
        stateWithPanel,
        updatePanels([makePanel({ id: 'p1', label: 'renamed.ts' })]),
      );

      expect(state).not.toBe(stateWithPanel);
      expect(getItems(state.panels)[0].label).toBe('renamed.ts');
    });

    it('should update state for semantic panel reordering', () => {
      const stateWithPanels = withPanels(makePanel({ id: 'p1' }), makePanel({ id: 'p2' }));
      const state = multiPanelContextReducer(
        stateWithPanels,
        updatePanels([makePanel({ id: 'p2' }), makePanel({ id: 'p1' })]),
      );

      expect(state).not.toBe(stateWithPanels);
      expect(getItems(state.panels).map((panel) => panel.id)).toEqual(['p2', 'p1']);
    });
  });

  describe('togglePanel', () => {
    it('should toggle panel checked state', () => {
      const stateWithPanel = withPanels(makePanel({ checked: false }));
      const state = multiPanelContextReducer(stateWithPanel, togglePanel('p1'));
      expect(getItems(state.panels)[0].checked).toBe(true);
    });

    it('should return same state if panel not found', () => {
      const state = multiPanelContextReducer(initialState, togglePanel('nonexistent'));
      expect(state).toBe(initialState);
    });
  });

  describe('setSelection', () => {
    it('should add new selection', () => {
      const sel = {
        panelId: 'panel-1',
        tabId: 'tab-1',
        sourceType: 'file' as const,
        sourceLabel: 'f.ts',
        text: 'hello',
        timestamp: 1000,
      };
      const state = multiPanelContextReducer(initialState, setSelection(sel));
      const selections = getItems(state.selections);
      expect(selections).toHaveLength(1);
      expect(selections[0].id).toBe('sel-panel-1-tab-1');
      expect(selections[0].checked).toBe(true);
    });

    it('should update existing selection by panelId+tabId', () => {
      const stateWithSel = withSelections(makeSelection());
      const updated = {
        panelId: 'panel-1',
        tabId: 'tab-1',
        sourceType: 'file' as const,
        sourceLabel: 'f.ts',
        text: 'new text',
        timestamp: 2000,
      };
      const state = multiPanelContextReducer(stateWithSel, setSelection(updated));
      const selections = getItems(state.selections);
      expect(selections).toHaveLength(1);
      expect(selections[0].text).toBe('new text');
    });

    it('should return the same state for unchanged selection text despite timestamp changes', () => {
      const stateWithSel = withSelections(makeSelection({ timestamp: 1000 }));
      const state = multiPanelContextReducer(
        stateWithSel,
        setSelection({
          panelId: 'panel-1',
          tabId: 'tab-1',
          sourceType: 'file',
          sourceLabel: 'file.ts',
          text: 'selected text',
          timestamp: 2000,
        }),
      );

      expect(state).toBe(stateWithSel);
    });
  });

  describe('clearSelection', () => {
    it('should remove selection by panelId and tabId', () => {
      const stateWithSel = withSelections(makeSelection());
      const state = multiPanelContextReducer(stateWithSel, clearSelection('panel-1', 'tab-1'));
      expect(getItems(state.selections)).toHaveLength(0);
    });

    it('should return the same state when the selection is already clear', () => {
      expect(multiPanelContextReducer(initialState, clearSelection('panel-1', 'tab-1'))).toBe(
        initialState,
      );
    });
  });

  describe('toggleSelection', () => {
    it('should toggle selection checked state', () => {
      const stateWithSel = withSelections(makeSelection({ checked: true }));
      const state = multiPanelContextReducer(stateWithSel, toggleSelection('sel-panel-1-tab-1'));
      expect(getItems(state.selections)[0].checked).toBe(false);
    });
  });

  describe('addSearchedItem', () => {
    it('should add new searched item as checked panel', () => {
      const state = multiPanelContextReducer(
        initialState,
        addSearchedItem({ id: 's1', type: 'file', label: 'test.ts' }),
      );
      const panels = getItems(state.panels);
      expect(panels).toHaveLength(1);
      expect(panels[0].checked).toBe(true);
      expect(panels[0].panelId).toBe('search');
    });

    it('should check existing item if already present', () => {
      const stateWithPanel = withPanels(makePanel({ id: 's1', checked: false }));
      const state = multiPanelContextReducer(
        stateWithPanel,
        addSearchedItem({ id: 's1', type: 'file', label: 'test.ts' }),
      );
      const panels = getItems(state.panels);
      expect(panels).toHaveLength(1);
      expect(panels[0].checked).toBe(true);
    });

    it('should return same state if item already checked', () => {
      const stateWithPanel = withPanels(makePanel({ id: 's1', checked: true }));
      const state = multiPanelContextReducer(
        stateWithPanel,
        addSearchedItem({ id: 's1', type: 'file', label: 'test.ts' }),
      );
      expect(state).toBe(stateWithPanel);
    });
  });
});
