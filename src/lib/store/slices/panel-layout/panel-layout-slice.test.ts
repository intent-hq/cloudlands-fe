import { describe, expect, it } from "vitest";
import {
  panelLayoutReducer,
  emptyWorkspaceState,
  initializeLayout,
  openTab,
  closeTab,
  setActiveTab,
  selectNextTab,
  selectPreviousTab,
  reorderTabs,
  focusPanel,
  closeOtherTabs,
  closeAllTabs,
  closeTabsByType,
  reopenClosedTab,
  setDeferSpecTab,
  updateTabTitle,
  clearPanelLayout,
} from "./panel-layout-slice";
import { workspaceUnmounted } from "../workspace-lifecycle/workspace-lifecycle-slice";
import type { PanelLayoutSliceState } from "./panel-layout-types";

const WS = "test-ws";

function emptyState(): PanelLayoutSliceState {
  return { byWorkspaceId: {} };
}

/** Create state with a single panel containing some tabs */
function stateWithPanel(panelId = "p1", tabs: Array<{ id: string; type: string; title: string }> = []) {
  const state = emptyState();
  state.byWorkspaceId[WS] = {
    ...emptyWorkspaceState,
    root: { type: "panel", panelId },
    panels: {
      [panelId]: {
        id: panelId,
        tabs: tabs.map((t) => ({ ...t, closable: true }) as any),
        activeTabId: tabs.length > 0 ? tabs[0].id : null,
      },
    },
    focusedPanelId: panelId,
  };
  return state;
}

describe("panelLayoutReducer", () => {
  it("returns the initial state", () => {
    const result = panelLayoutReducer(undefined, { type: "@@INIT" });
    expect(result).toEqual({ byWorkspaceId: {} });
  });

  describe("initializeLayout", () => {
    it("sets root, panels, and focusedPanelId", () => {
      const layout = {
        root: { type: "panel" as const, panelId: "p1" },
        panels: { p1: { id: "p1", tabs: [], activeTabId: null } },
        focusedPanelId: "p1",
      };
      const result = panelLayoutReducer(emptyState(), initializeLayout(WS, layout));
      expect(result.byWorkspaceId[WS].root).toEqual(layout.root);
      expect(result.byWorkspaceId[WS].panels.p1).toBeDefined();
      expect(result.byWorkspaceId[WS].focusedPanelId).toBe("p1");
    });
  });

  describe("openTab", () => {
    it("adds a tab to the focused panel", () => {
      const state = stateWithPanel("p1");
      const result = panelLayoutReducer(
        state,
        openTab(WS, { type: "note", title: "Test Note", noteId: "n1", closable: true }, undefined, "tab1"),
      );
      const panel = result.byWorkspaceId[WS].panels.p1;
      expect(panel.tabs).toHaveLength(1);
      expect(panel.tabs[0].noteId).toBe("n1");
      expect(panel.activeTabId).toBe("tab1");
    });

    it("blocks spec note when deferSpecTab is true", () => {
      const state = stateWithPanel("p1");
      state.byWorkspaceId[WS].deferSpecTab = true;
      const result = panelLayoutReducer(
        state,
        openTab(WS, { type: "note", title: "Spec", noteId: "spec", closable: true }),
      );
      expect(result.byWorkspaceId[WS].panels.p1.tabs).toHaveLength(0);
    });

    it("reuses existing singleton tab (agent-overview)", () => {
      const state = stateWithPanel("p1", [
        { id: "t1", type: "agent-overview", title: "Agents" },
      ]);
      const result = panelLayoutReducer(
        state,
        openTab(WS, { type: "agent-overview", title: "Agents v2", closable: true }),
      );
      // Should not add a second tab — reuse existing
      expect(result.byWorkspaceId[WS].panels.p1.tabs).toHaveLength(1);
      expect(result.byWorkspaceId[WS].panels.p1.activeTabId).toBe("t1");
    });
  });

  describe("closeTab", () => {
    it("removes the tab and adds to recentlyClosed", () => {
      const state = stateWithPanel("p1", [
        { id: "t1", type: "note", title: "Note 1" },
        { id: "t2", type: "file", title: "File 1" },
      ]);
      const result = panelLayoutReducer(state, closeTab(WS, "t1", "p1", 1000));
      const panel = result.byWorkspaceId[WS].panels.p1;
      expect(panel.tabs).toHaveLength(1);
      expect(panel.tabs[0].id).toBe("t2");
      expect(result.byWorkspaceId[WS].recentlyClosed).toHaveLength(1);
    });

    it("sets next tab as active when closing active tab", () => {
      const state = stateWithPanel("p1", [
        { id: "t1", type: "note", title: "A" },
        { id: "t2", type: "file", title: "B" },
      ]);
      const result = panelLayoutReducer(state, closeTab(WS, "t1", "p1", 1000));
      expect(result.byWorkspaceId[WS].panels.p1.activeTabId).toBe("t2");
    });
  });

  describe("setActiveTab", () => {
    it("changes the active tab", () => {
      const state = stateWithPanel("p1", [
        { id: "t1", type: "note", title: "A" },
        { id: "t2", type: "file", title: "B" },
      ]);
      const result = panelLayoutReducer(state, setActiveTab(WS, "t2", "p1"));
      expect(result.byWorkspaceId[WS].panels.p1.activeTabId).toBe("t2");
    });
  });

  describe("selectNextTab / selectPreviousTab", () => {
    it("cycles through tabs forward", () => {
      const state = stateWithPanel("p1", [
        { id: "t1", type: "note", title: "A" },
        { id: "t2", type: "file", title: "B" },
      ]);
      const result = panelLayoutReducer(state, selectNextTab(WS, "p1"));
      expect(result.byWorkspaceId[WS].panels.p1.activeTabId).toBe("t2");
    });

    it("wraps around to first tab when at end", () => {
      const state = stateWithPanel("p1", [
        { id: "t1", type: "note", title: "A" },
        { id: "t2", type: "file", title: "B" },
      ]);
      state.byWorkspaceId[WS].panels.p1.activeTabId = "t2";
      const result = panelLayoutReducer(state, selectNextTab(WS, "p1"));
      expect(result.byWorkspaceId[WS].panels.p1.activeTabId).toBe("t1");
    });

    it("cycles through tabs backward", () => {
      const state = stateWithPanel("p1", [
        { id: "t1", type: "note", title: "A" },
        { id: "t2", type: "file", title: "B" },
      ]);
      const result = panelLayoutReducer(state, selectPreviousTab(WS, "p1"));
      expect(result.byWorkspaceId[WS].panels.p1.activeTabId).toBe("t2");
    });
  });

  describe("reorderTabs", () => {
    it("moves a tab from one index to another", () => {
      const state = stateWithPanel("p1", [
        { id: "t1", type: "note", title: "A" },
        { id: "t2", type: "file", title: "B" },
        { id: "t3", type: "file", title: "C" },
      ]);
      const result = panelLayoutReducer(state, reorderTabs(WS, "p1", 0, 2));
      const tabs = result.byWorkspaceId[WS].panels.p1.tabs;
      expect(tabs[0].id).toBe("t2");
      expect(tabs[1].id).toBe("t3");
      expect(tabs[2].id).toBe("t1");
    });
  });

  describe("focusPanel", () => {
    it("changes focused panel ID", () => {
      const state = stateWithPanel("p1");
      state.byWorkspaceId[WS].panels.p2 = { id: "p2", tabs: [], activeTabId: null };
      const result = panelLayoutReducer(state, focusPanel(WS, "p2"));
      expect(result.byWorkspaceId[WS].focusedPanelId).toBe("p2");
    });
  });

  describe("closeOtherTabs", () => {
    it("keeps only the specified tab", () => {
      const state = stateWithPanel("p1", [
        { id: "t1", type: "note", title: "A" },
        { id: "t2", type: "file", title: "B" },
        { id: "t3", type: "file", title: "C" },
      ]);
      const result = panelLayoutReducer(state, closeOtherTabs(WS, "t2", "p1"));
      const panel = result.byWorkspaceId[WS].panels.p1;
      expect(panel.tabs).toHaveLength(1);
      expect(panel.tabs[0].id).toBe("t2");
      expect(panel.activeTabId).toBe("t2");
    });
  });

  describe("closeAllTabs", () => {
    it("removes all tabs from a panel", () => {
      const state = stateWithPanel("p1", [
        { id: "t1", type: "note", title: "A" },
        { id: "t2", type: "file", title: "B" },
      ]);
      const result = panelLayoutReducer(state, closeAllTabs(WS, "p1"));
      const panel = result.byWorkspaceId[WS].panels.p1;
      expect(panel.tabs).toHaveLength(0);
      expect(panel.activeTabId).toBeNull();
    });
  });

  describe("closeTabsByType", () => {
    it("removes all tabs of a given type", () => {
      const state = stateWithPanel("p1", [
        { id: "t1", type: "note", title: "A" },
        { id: "t2", type: "file", title: "B" },
        { id: "t3", type: "note", title: "C" },
      ]);
      const result = panelLayoutReducer(state, closeTabsByType(WS, "note"));
      const panel = result.byWorkspaceId[WS].panels.p1;
      expect(panel.tabs).toHaveLength(1);
      expect(panel.tabs[0].id).toBe("t2");
    });
  });

  describe("setDeferSpecTab", () => {
    it("sets deferSpecTab flag", () => {
      const state = stateWithPanel("p1");
      const result = panelLayoutReducer(state, setDeferSpecTab(WS, true));
      expect(result.byWorkspaceId[WS].deferSpecTab).toBe(true);
    });
  });

  describe("updateTabTitle", () => {
    it("updates the title of a tab across panels", () => {
      const state = stateWithPanel("p1", [
        { id: "t1", type: "note", title: "Old Title" },
      ]);
      const result = panelLayoutReducer(state, updateTabTitle(WS, "t1", "New Title"));
      expect(result.byWorkspaceId[WS].panels.p1.tabs[0].title).toBe("New Title");
    });
  });

  describe("clearPanelLayout", () => {
    it("resets workspace to empty state", () => {
      const state = stateWithPanel("p1", [
        { id: "t1", type: "note", title: "A" },
      ]);
      const result = panelLayoutReducer(state, clearPanelLayout(WS));
      expect(result.byWorkspaceId[WS]).toBeUndefined();
    });
  });

  describe("workspaceUnmounted", () => {
    it("does NOT clear panel layout state (state persists for workspace switch)", () => {
      const state = stateWithPanel("p1", [
        { id: "t1", type: "note", title: "A" },
      ]);
      const result = panelLayoutReducer(state, workspaceUnmounted(WS));
      // State should be preserved — not cleared
      expect(result.byWorkspaceId[WS]).toBeDefined();
      expect(result.byWorkspaceId[WS].panels.p1.tabs).toHaveLength(1);
    });
  });

  describe("reopenClosedTab", () => {
    it("restores the most recently closed tab", () => {
      const state = stateWithPanel("p1", [
        { id: "t1", type: "note", title: "A" },
        { id: "t2", type: "file", title: "B" },
      ]);
      // Close tab t1
      const afterClose = panelLayoutReducer(state, closeTab(WS, "t1", "p1", 1000));
      expect(afterClose.byWorkspaceId[WS].recentlyClosed).toHaveLength(1);
      // Reopen
      const afterReopen = panelLayoutReducer(afterClose, reopenClosedTab(WS));
      const panel = afterReopen.byWorkspaceId[WS].panels.p1;
      expect(panel.tabs).toHaveLength(2);
      expect(afterReopen.byWorkspaceId[WS].recentlyClosed).toHaveLength(0);
    });
  });
});

