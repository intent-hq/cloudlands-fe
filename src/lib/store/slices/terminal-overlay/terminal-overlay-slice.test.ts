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

const initialState: TerminalOverlayState = {
  isOpen: false,
  height: 50,
  workspaceId: null,
  activeTerminalId: null,
  terminals: [],
};

describe("terminalOverlayReducer", () => {
  it("should return initial state", () => {
    const state = terminalOverlayReducer(undefined, { type: "@@INIT" });
    expect(state).toEqual(initialState);
  });

  describe("openTerminalOverlay", () => {
    it("should open overlay", () => {
      const state = terminalOverlayReducer(initialState, openTerminalOverlay());
      expect(state.isOpen).toBe(true);
    });

    it("should open with workspace and create default terminal", () => {
      const state = terminalOverlayReducer(initialState, openTerminalOverlay("ws-1"));
      expect(state.isOpen).toBe(true);
      expect(state.workspaceId).toBe("ws-1");
      expect(state.terminals).toHaveLength(1);
      expect(state.terminals[0].id).toBe("terminal-ws-1-default");
      expect(state.activeTerminalId).toBe("terminal-ws-1-default");
    });

    it("should open with specific terminal", () => {
      const state = terminalOverlayReducer(initialState, openTerminalOverlay("ws-1", "term-123"));
      expect(state.isOpen).toBe(true);
      expect(state.activeTerminalId).toBe("term-123");
      expect(state.terminals).toHaveLength(1);
      expect(state.terminals[0].id).toBe("term-123");
    });

    it("should not create duplicate terminal", () => {
      const stateWithTerminal: TerminalOverlayState = {
        ...initialState,
        workspaceId: "ws-1",
        terminals: [{ id: "term-123", name: "Terminal" }],
        activeTerminalId: "term-123",
      };
      const state = terminalOverlayReducer(stateWithTerminal, openTerminalOverlay("ws-1", "term-123"));
      expect(state.terminals).toHaveLength(1);
    });
  });

  describe("closeTerminalOverlay", () => {
    it("should close overlay", () => {
      const openState = { ...initialState, isOpen: true };
      const state = terminalOverlayReducer(openState, closeTerminalOverlay());
      expect(state.isOpen).toBe(false);
    });

    it("should return same state if already closed", () => {
      const state = terminalOverlayReducer(initialState, closeTerminalOverlay());
      expect(state).toBe(initialState);
    });
  });

  describe("toggleTerminalOverlay", () => {
    it("should open when closed", () => {
      const state = terminalOverlayReducer(initialState, toggleTerminalOverlay("ws-1"));
      expect(state.isOpen).toBe(true);
    });

    it("should close when open and no termId", () => {
      const openState = { ...initialState, isOpen: true };
      const state = terminalOverlayReducer(openState, toggleTerminalOverlay());
      expect(state.isOpen).toBe(false);
    });

    it("should stay open when open with termId", () => {
      const openState = { ...initialState, isOpen: true, workspaceId: "ws-1" };
      const state = terminalOverlayReducer(openState, toggleTerminalOverlay("ws-1", "term-1"));
      expect(state.isOpen).toBe(true);
      expect(state.activeTerminalId).toBe("term-1");
    });
  });

  describe("removeTerminal", () => {
    it("should remove terminal and select adjacent", () => {
      const stateWith3: TerminalOverlayState = {
        ...initialState,
        terminals: [
          { id: "t1", name: "T1" },
          { id: "t2", name: "T2" },
          { id: "t3", name: "T3" },
        ],
        activeTerminalId: "t2",
      };
      const state = terminalOverlayReducer(stateWith3, removeTerminal("t2"));
      expect(state.terminals).toHaveLength(2);
      expect(state.activeTerminalId).toBe("t3");
    });

    it("should select previous when removing last", () => {
      const stateWith2: TerminalOverlayState = {
        ...initialState,
        terminals: [
          { id: "t1", name: "T1" },
          { id: "t2", name: "T2" },
        ],
        activeTerminalId: "t2",
      };
      const state = terminalOverlayReducer(stateWith2, removeTerminal("t2"));
      expect(state.activeTerminalId).toBe("t1");
    });

    it("should set null when removing only terminal", () => {
      const stateWith1: TerminalOverlayState = {
        ...initialState,
        terminals: [{ id: "t1", name: "T1" }],
        activeTerminalId: "t1",
      };
      const state = terminalOverlayReducer(stateWith1, removeTerminal("t1"));
      expect(state.terminals).toHaveLength(0);
      expect(state.activeTerminalId).toBeNull();
    });

    it("should return same state if terminal not found", () => {
      const state = terminalOverlayReducer(initialState, removeTerminal("nonexistent"));
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
    it("should update workspace ID", () => {
      const state = terminalOverlayReducer(initialState, setTerminalOverlayWorkspace("ws-2"));
      expect(state.workspaceId).toBe("ws-2");
    });

    it("should return same state if workspace unchanged", () => {
      const stateWithWs = { ...initialState, workspaceId: "ws-1" };
      const state = terminalOverlayReducer(stateWithWs, setTerminalOverlayWorkspace("ws-1"));
      expect(state).toBe(stateWithWs);
    });
  });

  describe("renameTerminal", () => {
    it("should set custom name", () => {
      const stateWith: TerminalOverlayState = {
        ...initialState,
        terminals: [{ id: "t1", name: "Terminal" }],
      };
      const state = terminalOverlayReducer(stateWith, renameTerminal("t1", "My Terminal"));
      expect(state.terminals[0].customName).toBe("My Terminal");
    });

    it("should clear custom name on empty string", () => {
      const stateWith: TerminalOverlayState = {
        ...initialState,
        terminals: [{ id: "t1", name: "Terminal", customName: "Old" }],
      };
      const state = terminalOverlayReducer(stateWith, renameTerminal("t1", "  "));
      expect(state.terminals[0].customName).toBeUndefined();
    });
  });

  describe("updateTerminalName", () => {
    it("should update terminal name", () => {
      const stateWith: TerminalOverlayState = {
        ...initialState,
        terminals: [{ id: "t1", name: "Terminal" }],
      };
      const state = terminalOverlayReducer(stateWith, updateTerminalName("t1", "npm run build"));
      expect(state.terminals[0].name).toBe("npm run build");
    });
  });

  describe("syncTerminals", () => {
    it("should sync terminals from list", () => {
      const state = terminalOverlayReducer(
        initialState,
        syncTerminals([
          { id: "t1", name: "Term 1" },
          { id: "t2", title: "Term 2" },
        ])
      );
      expect(state.terminals).toHaveLength(2);
      expect(state.terminals[0].name).toBe("Term 1");
      expect(state.terminals[1].name).toBe("Term 2");
    });

    it("should reset active terminal if no longer valid", () => {
      const stateWith: TerminalOverlayState = {
        ...initialState,
        activeTerminalId: "old-term",
        terminals: [{ id: "old-term", name: "Old" }],
      };
      const state = terminalOverlayReducer(stateWith, syncTerminals([{ id: "t1", name: "New" }]));
      expect(state.activeTerminalId).toBe("t1");
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
        loadWorkspaceTerminals("ws-1", terminals, { isOpen: true, activeTerminalId: "t2" })
      );
      expect(state.workspaceId).toBe("ws-1");
      expect(state.terminals).toEqual(terminals);
      expect(state.isOpen).toBe(true);
      expect(state.activeTerminalId).toBe("t2");
    });

    it("should fallback to first terminal if saved active not found", () => {
      const terminals = [{ id: "t1", name: "T1" }];
      const state = terminalOverlayReducer(
        initialState,
        loadWorkspaceTerminals("ws-1", terminals, { isOpen: true, activeTerminalId: "gone" })
      );
      expect(state.activeTerminalId).toBe("t1");
    });

    it("should handle empty terminals with saved state", () => {
      const state = terminalOverlayReducer(
        initialState,
        loadWorkspaceTerminals("ws-1", [], { isOpen: true, activeTerminalId: null })
      );
      expect(state.terminals).toEqual([]);
      expect(state.activeTerminalId).toBeNull();
      expect(state.isOpen).toBe(true);
    });

    it("should close when no terminals and no saved state", () => {
      const state = terminalOverlayReducer(
        initialState,
        loadWorkspaceTerminals("ws-1", [], null)
      );
      expect(state.isOpen).toBe(false);
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
        terminals: [{ id: "t1", name: "T1" }, { id: "t2", name: "T2" }],
        activeTerminalId: "t1",
      };
      const state = terminalOverlayReducer(stateWith, selectTerminal("t2"));
      expect(state.activeTerminalId).toBe("t2");
    });

    it("should ignore nonexistent terminal", () => {
      const state = terminalOverlayReducer(initialState, selectTerminal("nonexistent"));
      expect(state).toBe(initialState);
    });
  });

  describe("addTerminal", () => {
    it("should add terminal and make it active", () => {
      const state = terminalOverlayReducer(initialState, addTerminal("t1", "My Term"));
      expect(state.terminals).toHaveLength(1);
      expect(state.terminals[0]).toEqual({ id: "t1", name: "My Term" });
      expect(state.activeTerminalId).toBe("t1");
    });

    it("should not duplicate existing terminal", () => {
      const stateWith: TerminalOverlayState = {
        ...initialState,
        terminals: [{ id: "t1", name: "T1" }],
      };
      const state = terminalOverlayReducer(stateWith, addTerminal("t1", "T1"));
      expect(state.terminals).toHaveLength(1);
      expect(state.activeTerminalId).toBe("t1");
    });
  });
});