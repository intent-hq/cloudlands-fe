import { describe, it, expect } from "vitest";
import {
  terminalOverlayReducer,
  openTerminalOverlay,
  closeTerminalOverlay,
  toggleTerminalOverlay,
  selectTerminal,
  addTerminal,
  removeTerminal,
  setTerminalOverlayHeight,
  setTerminalOverlayWorkspace,
  renameTerminal,
  updateTerminalName,
  syncTerminals,
  loadWorkspaceTerminals,
  hydrateHeight,
  type TerminalOverlayState,
} from "./terminal-overlay-slice";

const WS = "ws-1";

const initialState: TerminalOverlayState = {
  height: 50,
  activeWorkspaceId: null,
  workspaces: {},
};

/** Helper to get workspace state from the top-level state */
function getWs(state: TerminalOverlayState, wsId: string = WS) {
  return state.workspaces[wsId] || { isOpen: false, activeTerminalId: null, terminals: [] };
}

describe("terminalOverlayReducer", () => {
  it("should return initial state", () => {
    const state = terminalOverlayReducer(undefined, { type: "@@INIT" });
    expect(state).toEqual(initialState);
  });

  describe("openTerminalOverlay", () => {
    it("should open with workspace and create default terminal", () => {
      const state = terminalOverlayReducer(initialState, openTerminalOverlay(WS));
      const ws = getWs(state);
      expect(ws.isOpen).toBe(true);
      expect(state.activeWorkspaceId).toBe(WS);
      expect(ws.terminals).toHaveLength(1);
      expect(ws.terminals[0].id).toBe("terminal-ws-1-default");
      expect(ws.activeTerminalId).toBe("terminal-ws-1-default");
    });

    it("should open with specific terminal", () => {
      const state = terminalOverlayReducer(initialState, openTerminalOverlay(WS, "term-123"));
      const ws = getWs(state);
      expect(ws.isOpen).toBe(true);
      expect(ws.activeTerminalId).toBe("term-123");
      expect(ws.terminals).toHaveLength(1);
      expect(ws.terminals[0].id).toBe("term-123");
    });

    it("should not create duplicate terminal", () => {
      const stateWithTerminal: TerminalOverlayState = {
        ...initialState,
        activeWorkspaceId: WS,
        workspaces: { [WS]: { isOpen: false, activeTerminalId: "term-123", terminals: [{ id: "term-123", name: "Terminal" }] } },
      };
      const state = terminalOverlayReducer(stateWithTerminal, openTerminalOverlay(WS, "term-123"));
      expect(getWs(state).terminals).toHaveLength(1);
    });
  });

  describe("closeTerminalOverlay", () => {
    it("should close overlay", () => {
      const openState: TerminalOverlayState = {
        ...initialState,
        workspaces: { [WS]: { isOpen: true, activeTerminalId: null, terminals: [] } },
      };
      const state = terminalOverlayReducer(openState, closeTerminalOverlay(WS));
      expect(getWs(state).isOpen).toBe(false);
    });

    it("should return same state if already closed", () => {
      const state = terminalOverlayReducer(initialState, closeTerminalOverlay(WS));
      expect(state).toBe(initialState);
    });
  });

  describe("toggleTerminalOverlay", () => {
    it("should open when closed", () => {
      const state = terminalOverlayReducer(initialState, toggleTerminalOverlay(WS));
      expect(getWs(state).isOpen).toBe(true);
    });

    it("should close when open and no termId", () => {
      const openState: TerminalOverlayState = {
        ...initialState,
        workspaces: { [WS]: { isOpen: true, activeTerminalId: null, terminals: [] } },
      };
      const state = terminalOverlayReducer(openState, toggleTerminalOverlay(WS));
      expect(getWs(state).isOpen).toBe(false);
    });

    it("should stay open when open with termId", () => {
      const openState: TerminalOverlayState = {
        ...initialState,
        activeWorkspaceId: WS,
        workspaces: { [WS]: { isOpen: true, activeTerminalId: null, terminals: [] } },
      };
      const state = terminalOverlayReducer(openState, toggleTerminalOverlay(WS, "term-1"));
      const ws = getWs(state);
      expect(ws.isOpen).toBe(true);
      expect(ws.activeTerminalId).toBe("term-1");
    });
  });

  describe("removeTerminal", () => {
    it("should remove terminal and select adjacent", () => {
      const stateWith3: TerminalOverlayState = {
        ...initialState,
        workspaces: { [WS]: {
          isOpen: false,
          terminals: [
            { id: "t1", name: "T1" },
            { id: "t2", name: "T2" },
            { id: "t3", name: "T3" },
          ],
          activeTerminalId: "t2",
        }},
      };
      const state = terminalOverlayReducer(stateWith3, removeTerminal(WS, "t2"));
      const ws = getWs(state);
      expect(ws.terminals).toHaveLength(2);
      expect(ws.activeTerminalId).toBe("t3");
    });

    it("should select previous when removing last", () => {
      const stateWith2: TerminalOverlayState = {
        ...initialState,
        workspaces: { [WS]: {
          isOpen: false,
          terminals: [
            { id: "t1", name: "T1" },
            { id: "t2", name: "T2" },
          ],
          activeTerminalId: "t2",
        }},
      };
      const state = terminalOverlayReducer(stateWith2, removeTerminal(WS, "t2"));
      expect(getWs(state).activeTerminalId).toBe("t1");
    });

    it("should set null when removing only terminal", () => {
      const stateWith1: TerminalOverlayState = {
        ...initialState,
        workspaces: { [WS]: {
          isOpen: false,
          terminals: [{ id: "t1", name: "T1" }],
          activeTerminalId: "t1",
        }},
      };
      const state = terminalOverlayReducer(stateWith1, removeTerminal(WS, "t1"));
      const ws = getWs(state);
      expect(ws.terminals).toHaveLength(0);
      expect(ws.activeTerminalId).toBeNull();
    });

    it("should return same state if terminal not found", () => {
      const state = terminalOverlayReducer(initialState, removeTerminal(WS, "nonexistent"));
      expect(state).toBe(initialState);
    });
  });

  describe("setTerminalOverlayHeight", () => {
    it("should clamp height to min/max", () => {
      const state = terminalOverlayReducer(initialState, setTerminalOverlayHeight(10));
      expect(state.height).toBe(20);

      const state2 = terminalOverlayReducer(initialState, setTerminalOverlayHeight(100));
      expect(state2.height).toBe(90);
    });

    it("should return same state if height unchanged", () => {
      const state = terminalOverlayReducer(initialState, setTerminalOverlayHeight(50));
      expect(state).toBe(initialState);
    });
  });

  describe("setTerminalOverlayWorkspace", () => {
    it("should update active workspace ID", () => {
      const state = terminalOverlayReducer(initialState, setTerminalOverlayWorkspace("ws-2"));
      expect(state.activeWorkspaceId).toBe("ws-2");
    });

    it("should return same state if workspace unchanged", () => {
      const stateWithWs = { ...initialState, activeWorkspaceId: WS };
      const state = terminalOverlayReducer(stateWithWs, setTerminalOverlayWorkspace(WS));
      expect(state).toBe(stateWithWs);
    });
  });

  describe("renameTerminal", () => {
    it("should set custom name", () => {
      const stateWith: TerminalOverlayState = {
        ...initialState,
        workspaces: { [WS]: { isOpen: false, activeTerminalId: null, terminals: [{ id: "t1", name: "Terminal" }] } },
      };
      const state = terminalOverlayReducer(stateWith, renameTerminal(WS, "t1", "My Terminal"));
      expect(getWs(state).terminals[0].customName).toBe("My Terminal");
    });

    it("should clear custom name on empty string", () => {
      const stateWith: TerminalOverlayState = {
        ...initialState,
        workspaces: { [WS]: { isOpen: false, activeTerminalId: null, terminals: [{ id: "t1", name: "Terminal", customName: "Old" }] } },
      };
      const state = terminalOverlayReducer(stateWith, renameTerminal(WS, "t1", "  "));
      expect(getWs(state).terminals[0].customName).toBeUndefined();
    });
  });

  describe("updateTerminalName", () => {
    it("should update terminal name", () => {
      const stateWith: TerminalOverlayState = {
        ...initialState,
        workspaces: { [WS]: { isOpen: false, activeTerminalId: null, terminals: [{ id: "t1", name: "Terminal" }] } },
      };
      const state = terminalOverlayReducer(stateWith, updateTerminalName(WS, "t1", "npm run build"));
      expect(getWs(state).terminals[0].name).toBe("npm run build");
    });
  });

  describe("syncTerminals", () => {
    it("should sync terminals from list", () => {
      const state = terminalOverlayReducer(
        initialState,
        syncTerminals(WS, [
          { id: "t1", name: "Term 1" },
          { id: "t2", title: "Term 2" },
        ])
      );
      const ws = getWs(state);
      expect(ws.terminals).toHaveLength(2);
      expect(ws.terminals[0].name).toBe("Term 1");
      expect(ws.terminals[1].name).toBe("Term 2");
    });

    it("should reset active terminal if no longer valid", () => {
      const stateWith: TerminalOverlayState = {
        ...initialState,
        workspaces: { [WS]: {
          isOpen: false,
          activeTerminalId: "old-term",
          terminals: [{ id: "old-term", name: "Old" }],
        }},
      };
      const state = terminalOverlayReducer(stateWith, syncTerminals(WS, [{ id: "t1", name: "New" }]));
      expect(getWs(state).activeTerminalId).toBe("t1");
    });
  });

  describe("loadWorkspaceTerminals", () => {
    it("should load terminals with saved state", () => {
      const terminals = [
        { id: "t1", name: "T1" },
        { id: "t2", name: "T2" },
      ];
      const state = terminalOverlayReducer(
        initialState,
        loadWorkspaceTerminals(WS, terminals, { isOpen: true, activeTerminalId: "t2" })
      );
      const ws = getWs(state);
      expect(state.activeWorkspaceId).toBe(WS);
      expect(ws.terminals).toEqual(terminals);
      expect(ws.isOpen).toBe(true);
      expect(ws.activeTerminalId).toBe("t2");
    });

    it("should fallback to first terminal if saved active not found", () => {
      const terminals = [{ id: "t1", name: "T1" }];
      const state = terminalOverlayReducer(
        initialState,
        loadWorkspaceTerminals(WS, terminals, { isOpen: true, activeTerminalId: "gone" })
      );
      expect(getWs(state).activeTerminalId).toBe("t1");
    });

    it("should handle empty terminals with saved state", () => {
      const state = terminalOverlayReducer(
        initialState,
        loadWorkspaceTerminals(WS, [], { isOpen: true, activeTerminalId: null })
      );
      const ws = getWs(state);
      expect(ws.terminals).toEqual([]);
      expect(ws.activeTerminalId).toBeNull();
      expect(ws.isOpen).toBe(true);
    });

    it("should close when no terminals and no saved state", () => {
      const state = terminalOverlayReducer(
        initialState,
        loadWorkspaceTerminals(WS, [], null)
      );
      expect(getWs(state).isOpen).toBe(false);
    });
  });

  describe("hydrateHeight", () => {
    it("should set height from localStorage", () => {
      const state = terminalOverlayReducer(initialState, hydrateHeight(75));
      expect(state.height).toBe(75);
    });

    it("should ignore invalid height", () => {
      const state = terminalOverlayReducer(initialState, hydrateHeight(10));
      expect(state).toBe(initialState);
    });
  });

  describe("selectTerminal", () => {
    it("should select a terminal that exists", () => {
      const stateWith: TerminalOverlayState = {
        ...initialState,
        workspaces: { [WS]: {
          isOpen: false,
          terminals: [{ id: "t1", name: "T1" }, { id: "t2", name: "T2" }],
          activeTerminalId: "t1",
        }},
      };
      const state = terminalOverlayReducer(stateWith, selectTerminal(WS, "t2"));
      expect(getWs(state).activeTerminalId).toBe("t2");
    });

    it("should ignore nonexistent terminal", () => {
      const state = terminalOverlayReducer(initialState, selectTerminal(WS, "nonexistent"));
      expect(state).toBe(initialState);
    });
  });

  describe("addTerminal", () => {
    it("should add terminal and make it active", () => {
      const state = terminalOverlayReducer(initialState, addTerminal(WS, "t1", "My Term"));
      const ws = getWs(state);
      expect(ws.terminals).toHaveLength(1);
      expect(ws.terminals[0]).toEqual({ id: "t1", name: "My Term" });
      expect(ws.activeTerminalId).toBe("t1");
    });

    it("should not duplicate existing terminal", () => {
      const stateWith: TerminalOverlayState = {
        ...initialState,
        workspaces: { [WS]: { isOpen: false, activeTerminalId: null, terminals: [{ id: "t1", name: "T1" }] } },
      };
      const state = terminalOverlayReducer(stateWith, addTerminal(WS, "t1", "T1"));
      const ws = getWs(state);
      expect(ws.terminals).toHaveLength(1);
      expect(ws.activeTerminalId).toBe("t1");
    });
  });

  describe("per-workspace isolation", () => {
    it("should keep workspaces independent", () => {
      let state = terminalOverlayReducer(initialState, addTerminal("ws-1", "t1", "Term 1"));
      state = terminalOverlayReducer(state, addTerminal("ws-2", "t2", "Term 2"));

      expect(state.workspaces["ws-1"].terminals).toHaveLength(1);
      expect(state.workspaces["ws-1"].terminals[0].id).toBe("t1");
      expect(state.workspaces["ws-2"].terminals).toHaveLength(1);
      expect(state.workspaces["ws-2"].terminals[0].id).toBe("t2");
    });

    it("should not affect other workspaces when closing", () => {
      let state = terminalOverlayReducer(initialState, openTerminalOverlay("ws-1"));
      state = terminalOverlayReducer(state, openTerminalOverlay("ws-2"));
      state = terminalOverlayReducer(state, closeTerminalOverlay("ws-1"));

      expect(state.workspaces["ws-1"].isOpen).toBe(false);
      expect(state.workspaces["ws-2"].isOpen).toBe(true);
    });
  });
});