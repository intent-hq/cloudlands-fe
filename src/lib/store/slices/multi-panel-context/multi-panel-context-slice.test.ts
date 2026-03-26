import { describe, it, expect } from "vitest";
import { createCollection, getItems } from "../../utils/collection-utils";
import {
  multiPanelContextReducer,
  setWorkspace,
  setCurrentAgentPanel,
  updatePanels,
  togglePanel,
  setSelection,
  clearSelection,
  clearPanelSelections,
  toggleSelection,
  removeSelection,
  checkAllPanels,
  uncheckAllPanels,
  checkAllSelections,
  uncheckAllSelections,
  clear,
  addSearchedItem,
  removePanel,
  type MultiPanelContextState,
  type PanelContextItem,
  type SelectionContextItem,
} from "./multi-panel-context-slice";

const initialState: MultiPanelContextState = {
  panels: createCollection<PanelContextItem, "id">("id"),
  selections: createCollection<SelectionContextItem, "id">("id"),
  currentAgentPanelId: null,
  workspaceId: null,
};

function withPanels(...panels: PanelContextItem[]): MultiPanelContextState {
  return {
    ...initialState,
    panels: createCollection<PanelContextItem, "id">("id", panels),
  };
}

function withSelections(...selections: SelectionContextItem[]): MultiPanelContextState {
  return {
    ...initialState,
    selections: createCollection<SelectionContextItem, "id">("id", selections),
  };
}

const makePanel = (overrides: Partial<PanelContextItem> = {}): PanelContextItem => ({
  id: "p1",
  panelId: "panel-1",
  tabId: "tab-1",
  type: "file",
  label: "file.ts",
  checked: false,
  ...overrides,
});

const makeSelection = (overrides: Partial<SelectionContextItem> = {}): SelectionContextItem => ({
  id: "sel-panel-1-tab-1",
  panelId: "panel-1",
  tabId: "tab-1",
  sourceType: "file",
  sourceLabel: "file.ts",
  text: "selected text",
  checked: true,
  timestamp: 1000,
  ...overrides,
});

describe("multiPanelContextReducer", () => {
  it("should return initial state", () => {
    const state = multiPanelContextReducer(undefined, { type: "@@INIT" });
    expect(state).toEqual(initialState);
  });

  describe("setWorkspace", () => {
    it("should reset state when workspace changes", () => {
      const stateWithData: MultiPanelContextState = {
        panels: createCollection<PanelContextItem, "id">("id", [makePanel()]),
        selections: createCollection<SelectionContextItem, "id">("id", [makeSelection()]),
        currentAgentPanelId: "agent-panel",
        workspaceId: "ws-1",
      };
      const state = multiPanelContextReducer(stateWithData, setWorkspace("ws-2"));
      expect(state).toEqual({
        panels: createCollection<PanelContextItem, "id">("id"),
        selections: createCollection<SelectionContextItem, "id">("id"),
        currentAgentPanelId: null,
        workspaceId: "ws-2",
      });
    });

    it("should return same state if workspace unchanged", () => {
      const stateWithWs: MultiPanelContextState = { ...initialState, workspaceId: "ws-1" };
      const state = multiPanelContextReducer(stateWithWs, setWorkspace("ws-1"));
      expect(state).toBe(stateWithWs);
    });
  });

  describe("setCurrentAgentPanel", () => {
    it("should set currentAgentPanelId", () => {
      const state = multiPanelContextReducer(initialState, setCurrentAgentPanel("agent-panel"));
      expect(state.currentAgentPanelId).toBe("agent-panel");
    });
  });

  describe("updatePanels", () => {
    it("should preserve checked state for existing panels", () => {
      const stateWithChecked = withPanels(
        makePanel({ id: "p1", checked: true }),
        makePanel({ id: "p2", checked: false })
      );
      const newPanels = [makePanel({ id: "p1", checked: false }), makePanel({ id: "p2", checked: false }), makePanel({ id: "p3", checked: false })];
      const state = multiPanelContextReducer(stateWithChecked, updatePanels(newPanels));
      const nextPanels = getItems(state.panels);
      expect(nextPanels[0].checked).toBe(true); // preserved
      expect(nextPanels[1].checked).toBe(false);
      expect(nextPanels[2].checked).toBe(false);
    });

    it("should keep incoming checked=true even if not previously checked", () => {
      const newPanels = [makePanel({ id: "p1", checked: true })];
      const state = multiPanelContextReducer(initialState, updatePanels(newPanels));
      expect(getItems(state.panels)[0].checked).toBe(true);
    });
  });

  describe("togglePanel", () => {
    it("should toggle panel checked state", () => {
      const stateWithPanel = withPanels(makePanel({ checked: false }));
      const state = multiPanelContextReducer(stateWithPanel, togglePanel("p1"));
      expect(getItems(state.panels)[0].checked).toBe(true);
    });

    it("should return same state if panel not found", () => {
      const state = multiPanelContextReducer(initialState, togglePanel("nonexistent"));
      expect(state).toBe(initialState);
    });
  });

  describe("setSelection", () => {
    it("should add new selection", () => {
      const sel = { panelId: "panel-1", tabId: "tab-1", sourceType: "file" as const, sourceLabel: "f.ts", text: "hello", timestamp: 1000 };
      const state = multiPanelContextReducer(initialState, setSelection(sel));
      const selections = getItems(state.selections);
      expect(selections).toHaveLength(1);
      expect(selections[0].id).toBe("sel-panel-1-tab-1");
      expect(selections[0].checked).toBe(true);
    });

    it("should update existing selection by panelId+tabId", () => {
      const stateWithSel = withSelections(makeSelection());
      const updated = { panelId: "panel-1", tabId: "tab-1", sourceType: "file" as const, sourceLabel: "f.ts", text: "new text", timestamp: 2000 };
      const state = multiPanelContextReducer(stateWithSel, setSelection(updated));
      const selections = getItems(state.selections);
      expect(selections).toHaveLength(1);
      expect(selections[0].text).toBe("new text");
    });
  });

  describe("clearSelection", () => {
    it("should remove selection by panelId and tabId", () => {
      const stateWithSel = withSelections(makeSelection());
      const state = multiPanelContextReducer(stateWithSel, clearSelection("panel-1", "tab-1"));
      expect(getItems(state.selections)).toHaveLength(0);
    });
  });

  describe("clearPanelSelections", () => {
    it("should remove all selections for a panel", () => {
      const stateWithSels = withSelections(
        makeSelection({ id: "s1", panelId: "panel-1" }),
        makeSelection({ id: "s2", panelId: "panel-2", tabId: "tab-2" })
      );
      const state = multiPanelContextReducer(stateWithSels, clearPanelSelections("panel-1"));
      const selections = getItems(state.selections);
      expect(selections).toHaveLength(1);
      expect(selections[0].panelId).toBe("panel-2");
    });
  });

  describe("toggleSelection", () => {
    it("should toggle selection checked state", () => {
      const stateWithSel = withSelections(makeSelection({ checked: true }));
      const state = multiPanelContextReducer(stateWithSel, toggleSelection("sel-panel-1-tab-1"));
      expect(getItems(state.selections)[0].checked).toBe(false);
    });
  });

  describe("removeSelection", () => {
    it("should remove selection by id", () => {
      const stateWithSel = withSelections(makeSelection());
      const state = multiPanelContextReducer(stateWithSel, removeSelection("sel-panel-1-tab-1"));
      expect(getItems(state.selections)).toHaveLength(0);
    });
  });

  describe("checkAllPanels / uncheckAllPanels", () => {
    it("should check all panels", () => {
      const stateWithPanels = withPanels(
        makePanel({ id: "p1", checked: false }),
        makePanel({ id: "p2", checked: false })
      );
      const state = multiPanelContextReducer(stateWithPanels, checkAllPanels());
      expect(getItems(state.panels).every((p) => p.checked)).toBe(true);
    });

    it("should uncheck all panels", () => {
      const stateWithPanels = withPanels(
        makePanel({ id: "p1", checked: true }),
        makePanel({ id: "p2", checked: true })
      );
      const state = multiPanelContextReducer(stateWithPanels, uncheckAllPanels());
      expect(getItems(state.panels).every((p) => !p.checked)).toBe(true);
    });
  });

  describe("checkAllSelections / uncheckAllSelections", () => {
    it("should check all selections", () => {
      const stateWithSels = withSelections(makeSelection({ checked: false }));
      const state = multiPanelContextReducer(stateWithSels, checkAllSelections());
      expect(getItems(state.selections).every((s) => s.checked)).toBe(true);
    });

    it("should uncheck all selections", () => {
      const stateWithSels = withSelections(makeSelection({ checked: true }));
      const state = multiPanelContextReducer(stateWithSels, uncheckAllSelections());
      expect(getItems(state.selections).every((s) => !s.checked)).toBe(true);
    });
  });

  describe("clear", () => {
    it("should clear all state but preserve workspaceId", () => {
      const stateWithData: MultiPanelContextState = {
        panels: createCollection<PanelContextItem, "id">("id", [makePanel()]),
        selections: createCollection<SelectionContextItem, "id">("id", [makeSelection()]),
        currentAgentPanelId: "agent",
        workspaceId: "ws-1",
      };
      const state = multiPanelContextReducer(stateWithData, clear());
      expect(state).toEqual({
        panels: createCollection<PanelContextItem, "id">("id"),
        selections: createCollection<SelectionContextItem, "id">("id"),
        currentAgentPanelId: null,
        workspaceId: "ws-1",
      });
    });
  });

  describe("addSearchedItem", () => {
    it("should add new searched item as checked panel", () => {
      const state = multiPanelContextReducer(initialState, addSearchedItem({ id: "s1", type: "file", label: "test.ts" }));
      const panels = getItems(state.panels);
      expect(panels).toHaveLength(1);
      expect(panels[0].checked).toBe(true);
      expect(panels[0].panelId).toBe("search");
    });

    it("should check existing item if already present", () => {
      const stateWithPanel = withPanels(makePanel({ id: "s1", checked: false }));
      const state = multiPanelContextReducer(stateWithPanel, addSearchedItem({ id: "s1", type: "file", label: "test.ts" }));
      const panels = getItems(state.panels);
      expect(panels).toHaveLength(1);
      expect(panels[0].checked).toBe(true);
    });

    it("should return same state if item already checked", () => {
      const stateWithPanel = withPanels(makePanel({ id: "s1", checked: true }));
      const state = multiPanelContextReducer(stateWithPanel, addSearchedItem({ id: "s1", type: "file", label: "test.ts" }));
      expect(state).toBe(stateWithPanel);
    });
  });

  describe("removePanel", () => {
    it("should remove panel by id", () => {
      const stateWithPanel = withPanels(makePanel());
      const state = multiPanelContextReducer(stateWithPanel, removePanel("p1"));
      expect(getItems(state.panels)).toHaveLength(0);
    });
  });
});
