import {
  describe,
  it,
  expect,
} from "vitest";
import {
  terminalsReducer,
  openTerminalOverlay,
  closeTerminalOverlay,
  toggleTerminalOverlay,
  selectTerminal,
  addTerminal,
  removeTerminal,
  setTerminalOverlayHeight,
  renameTerminal,
  saveTerminalMetadata,
  loadWorkspaceTerminals,
  hydrateHeight,
  setTerminalsLoaded,
  setIsLoadingTerminals,
  markTerminalRecentlyCreated,
  setTerminalsList,
  type TerminalOverlayState,
  type TerminalTab,
} from "./terminals-slice";
import {
  createCollection,
  getItems,
  getItem,
} from "$lib/store-shim/utils/collections/collection-utils";

const WS = "ws-1";

/** Shorthand to create a Collection<TerminalTab, "id"> from an array */
function col(items: TerminalTab[]) {
  return createCollection<TerminalTab, "id">("id", items);
}

/** Shorthand to get items array from workspace terminals collection */
function terms(state: TerminalOverlayState, wsId: string = WS) {
  return getItems(getWs(state, wsId).terminals);
}

const initialState: TerminalOverlayState = {
  height: 50,
  workspaces: {},
};

/** Helper to get workspace state from the top-level state */
function getWs(state: TerminalOverlayState, wsId: string = WS) {
  return state.workspaces[wsId] || { isOpen: false, activeTerminalId: null, terminals: createCollection<TerminalTab, "id">("id"), terminalsLoaded: false, isLoadingTerminals: false, recentlyCreatedTerminals: [] };
}

describe("terminalsReducer", () => {
  it("should return initial state", () => {
    const state = terminalsReducer(undefined, { type: "@@INIT" });
    expect(state).toEqual(initialState);
  });

  describe("openTerminalOverlay", () => {
    it("should open with workspace and create default terminal", () => {
      const state = terminalsReducer(initialState, openTerminalOverlay(WS));
      const ws = getWs(state);
      expect(ws.isOpen).toBe(true);
      expect(terms(state)).toHaveLength(1);
      expect(terms(state)[0].id).toBe("terminal-ws-1-default");
      expect(ws.activeTerminalId).toBe("terminal-ws-1-default");
    });

    it("should open with specific terminal", () => {
      const state = terminalsReducer(initialState, openTerminalOverlay(WS, "term-123"));
      const ws = getWs(state);
      expect(ws.isOpen).toBe(true);
      expect(ws.activeTerminalId).toBe("term-123");
      expect(terms(state)).toHaveLength(1);
      expect(terms(state)[0].id).toBe("term-123");
    });

    it("should not create duplicate terminal", () => {
      const stateWithTerminal: TerminalOverlayState = {
        ...initialState,
        workspaces: { [WS]: { isOpen: false, activeTerminalId: "term-123", terminals: col([{ id: "term-123", name: "Terminal" }]), terminalsLoaded: false, isLoadingTerminals: false, recentlyCreatedTerminals: [] } },
      };
      const state = terminalsReducer(stateWithTerminal, openTerminalOverlay(WS, "term-123"));
      expect(terms(state)).toHaveLength(1);
    });
  });

  describe("closeTerminalOverlay", () => {
    it("should close overlay", () => {
      const openState: TerminalOverlayState = {
        ...initialState,
        workspaces: { [WS]: { isOpen: true, activeTerminalId: null, terminals: col([]), terminalsLoaded: false, isLoadingTerminals: false, recentlyCreatedTerminals: [] } },
      };
      const state = terminalsReducer(openState, closeTerminalOverlay(WS));
      expect(getWs(state).isOpen).toBe(false);
    });

    it("should return same state if already closed", () => {
      const state = terminalsReducer(initialState, closeTerminalOverlay(WS));
      expect(state).toBe(initialState);
    });
  });

  describe("toggleTerminalOverlay", () => {
    it("should open when closed", () => {
      const state = terminalsReducer(initialState, toggleTerminalOverlay(WS));
      expect(getWs(state).isOpen).toBe(true);
    });

    it("should close when open and no termId", () => {
      const openState: TerminalOverlayState = {
        ...initialState,
        workspaces: { [WS]: { isOpen: true, activeTerminalId: null, terminals: col([]), terminalsLoaded: false, isLoadingTerminals: false, recentlyCreatedTerminals: [] } },
      };
      const state = terminalsReducer(openState, toggleTerminalOverlay(WS));
      expect(getWs(state).isOpen).toBe(false);
    });

    it("should stay open when open with termId", () => {
      const openState: TerminalOverlayState = {
        ...initialState,
        workspaces: { [WS]: { isOpen: true, activeTerminalId: null, terminals: col([]), terminalsLoaded: false, isLoadingTerminals: false, recentlyCreatedTerminals: [] } },
      };
      const state = terminalsReducer(openState, toggleTerminalOverlay(WS, "term-1"));
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
          terminals: col([
            { id: "t1", name: "T1" },
            { id: "t2", name: "T2" },
            { id: "t3", name: "T3" },
          ]),
          activeTerminalId: "t2",
          terminalsLoaded: false,
          isLoadingTerminals: false,
          recentlyCreatedTerminals: [],
        }},
      };
      const state = terminalsReducer(stateWith3, removeTerminal(WS, "t2"));
      const ws = getWs(state);
      expect(terms(state)).toHaveLength(2);
      expect(ws.activeTerminalId).toBe("t3");
    });

    it("should select previous when removing last", () => {
      const stateWith2: TerminalOverlayState = {
        ...initialState,
        workspaces: { [WS]: {
          isOpen: false,
          terminals: col([
            { id: "t1", name: "T1" },
            { id: "t2", name: "T2" },
          ]),
          activeTerminalId: "t2",
          terminalsLoaded: false,
          isLoadingTerminals: false,
          recentlyCreatedTerminals: [],
        }},
      };
      const state = terminalsReducer(stateWith2, removeTerminal(WS, "t2"));
      expect(getWs(state).activeTerminalId).toBe("t1");
    });

    it("should set null when removing only terminal", () => {
      const stateWith1: TerminalOverlayState = {
        ...initialState,
        workspaces: { [WS]: {
          isOpen: false,
          terminals: col([{ id: "t1", name: "T1" }]),
          activeTerminalId: "t1",
          terminalsLoaded: false,
          isLoadingTerminals: false,
          recentlyCreatedTerminals: [],
        }},
      };
      const state = terminalsReducer(stateWith1, removeTerminal(WS, "t1"));
      const ws = getWs(state);
      expect(terms(state)).toHaveLength(0);
      expect(ws.activeTerminalId).toBeNull();
    });

    it("should close panel when removing last terminal while open", () => {
      // Removing the last terminal while the panel is open must also set
      // isOpen=false to prevent the stuck state (isOpen:true + activeTerminalId:null).
      const stateWith1Open: TerminalOverlayState = {
        ...initialState,
        workspaces: { [WS]: {
          isOpen: true,
          terminals: col([{ id: "t1", name: "T1" }]),
          activeTerminalId: "t1",
          terminalsLoaded: false,
          isLoadingTerminals: false,
          recentlyCreatedTerminals: [],
        }},
      };
      const state = terminalsReducer(stateWith1Open, removeTerminal(WS, "t1"));
      const ws = getWs(state);
      expect(terms(state)).toHaveLength(0);
      expect(ws.activeTerminalId).toBeNull();
      expect(ws.isOpen).toBe(false);
    });

    it("should keep panel open when removing non-last terminal", () => {
      const stateWith2: TerminalOverlayState = {
        ...initialState,
        workspaces: { [WS]: {
          isOpen: true,
          terminals: col([{ id: "t1", name: "T1" }, { id: "t2", name: "T2" }]),
          activeTerminalId: "t1",
          terminalsLoaded: false,
          isLoadingTerminals: false,
          recentlyCreatedTerminals: [],
        }},
      };
      const state = terminalsReducer(stateWith2, removeTerminal(WS, "t1"));
      const ws = getWs(state);
      expect(terms(state)).toHaveLength(1);
      expect(ws.isOpen).toBe(true);
    });

    it("should return same state if terminal not found", () => {
      const state = terminalsReducer(initialState, removeTerminal(WS, "nonexistent"));
      expect(state).toBe(initialState);
    });
  });

  describe("setTerminalOverlayHeight", () => {
    it("should clamp height to min/max", () => {
      const state = terminalsReducer(initialState, setTerminalOverlayHeight(10));
      expect(state.height).toBe(20);

      const state2 = terminalsReducer(initialState, setTerminalOverlayHeight(100));
      expect(state2.height).toBe(90);
    });

    it("should return same state if height unchanged", () => {
      const state = terminalsReducer(initialState, setTerminalOverlayHeight(50));
      expect(state).toBe(initialState);
    });
  });

  describe("renameTerminal", () => {
    it("should set custom name", () => {
      const stateWith: TerminalOverlayState = {
        ...initialState,
        workspaces: { [WS]: { isOpen: false, activeTerminalId: null, terminals: col([{ id: "t1", name: "Terminal" }]), terminalsLoaded: false, isLoadingTerminals: false, recentlyCreatedTerminals: [] } },
      };
      const state = terminalsReducer(stateWith, renameTerminal(WS, "t1", "My Terminal"));
      expect(getItem(getWs(state).terminals, "t1")?.customName).toBe("My Terminal");
    });

    it("should clear custom name on empty string", () => {
      const stateWith: TerminalOverlayState = {
        ...initialState,
        workspaces: { [WS]: { isOpen: false, activeTerminalId: null, terminals: col([{ id: "t1", name: "Terminal", customName: "Old" }]), terminalsLoaded: false, isLoadingTerminals: false, recentlyCreatedTerminals: [] } },
      };
      const state = terminalsReducer(stateWith, renameTerminal(WS, "t1", "  "));
      expect(getItem(getWs(state).terminals, "t1")?.customName).toBeUndefined();
    });
  });

  describe("saveTerminalMetadata", () => {
    it("should add metadata-backed terminal if missing", () => {
      const state = terminalsReducer(
        initialState,
        saveTerminalMetadata(WS, "term-1", "Setup", "2026-04-29T00:00:00.000Z")
      );

      expect(getItem(getWs(state).terminals, "term-1")).toEqual({
        id: "term-1",
        name: "Setup",
        type: "terminal",
        workspaceId: WS,
        createdAt: "2026-04-29T00:00:00.000Z",
      });
    });

    it("should update existing terminal metadata while preserving custom name", () => {
      const stateWith: TerminalOverlayState = {
        ...initialState,
        workspaces: {
          [WS]: {
            isOpen: false,
            activeTerminalId: null,
            terminals: col([{ id: "term-1", name: "Terminal", customName: "Mine", createdAt: "old" }]),
            terminalsLoaded: false,
            isLoadingTerminals: false,
            recentlyCreatedTerminals: [],
          },
        },
      };

      const state = terminalsReducer(
        stateWith,
        saveTerminalMetadata(WS, "term-1", "Setup", "2026-04-29T00:00:00.000Z")
      );

      expect(getItem(getWs(state).terminals, "term-1")).toEqual({
        id: "term-1",
        name: "Setup",
        customName: "Mine",
        type: "terminal",
        workspaceId: WS,
        createdAt: "old",
      });
    });

    it("should preserve a daemon-provided name when no title is given (no 'Terminal' clobber)", () => {
      // Regression: opening/attaching a hydrated terminal dispatches
      // saveTerminalMetadata without an explicit title; the daemon name
      // (e.g. "Setup Script" from terminal.list) must survive.
      const stateWith: TerminalOverlayState = {
        ...initialState,
        workspaces: {
          [WS]: {
            isOpen: false,
            activeTerminalId: null,
            terminals: col([{ id: "pty-0", name: "Setup Script" }]),
            terminalsLoaded: false,
            isLoadingTerminals: false,
            recentlyCreatedTerminals: [],
          },
        },
      };

      const state = terminalsReducer(
        stateWith,
        saveTerminalMetadata(WS, "pty-0", undefined, "2026-07-21T00:00:00.000Z")
      );

      expect(getItem(getWs(state).terminals, "pty-0")?.name).toBe("Setup Script");
    });

    it("should fall back to 'Terminal' when neither title nor existing name is present", () => {
      const state = terminalsReducer(
        initialState,
        saveTerminalMetadata(WS, "pty-3", undefined, "2026-07-21T00:00:00.000Z")
      );

      expect(getItem(getWs(state).terminals, "pty-3")?.name).toBe("Terminal");
    });
  });

  describe("loadWorkspaceTerminals", () => {
    it("should carry the daemon name into TerminalTab.name on hydration (before local metadata exists)", () => {
      // Regression: terminals listed by the daemon before any local metadata
      // exists must display the daemon `name` (e.g. "Setup Script"), never a
      // pty-X-derived label.
      const terminals = [
        { id: "pty-0", name: "Setup Script", isConnected: true, isExecuting: false },
        { id: "pty-1", name: "Terminal", isConnected: true, isExecuting: true },
      ];
      const state = terminalsReducer(
        initialState,
        loadWorkspaceTerminals(WS, terminals, null)
      );

      const setup = getItem(getWs(state).terminals, "pty-0");
      expect(setup?.name).toBe("Setup Script");
      // Display resolution is customName || name || 'Terminal'.
      expect(setup?.customName || setup?.name || "Terminal").toBe("Setup Script");
      expect(getItem(getWs(state).terminals, "pty-1")?.name).toBe("Terminal");
    });

    it("should load terminals with saved state", () => {
      const terminals = [
        { id: "t1", name: "T1" },
        { id: "t2", name: "T2" },
      ];
      const state = terminalsReducer(
        initialState,
        loadWorkspaceTerminals(WS, terminals, { isOpen: true, activeTerminalId: "t2" })
      );
      const ws = getWs(state);
      expect(terms(state)).toEqual(terminals);
      expect(ws.isOpen).toBe(true);
      expect(ws.activeTerminalId).toBe("t2");
    });

    it("should fallback to first terminal if saved active not found", () => {
      const terminals = [{ id: "t1", name: "T1" }];
      const state = terminalsReducer(
        initialState,
        loadWorkspaceTerminals(WS, terminals, { isOpen: true, activeTerminalId: "gone" })
      );
      expect(getWs(state).activeTerminalId).toBe("t1");
    });

    it("should force isOpen=false when terminals are empty even if saved state says open", () => {
      // When there are no terminals, isOpen must be false regardless of saved state.
      // The panel requires activeTerminalId to render, so isOpen:true with no
      // terminals creates a stuck state where the toggle appears broken.
      const state = terminalsReducer(
        initialState,
        loadWorkspaceTerminals(WS, [], { isOpen: true, activeTerminalId: null })
      );
      const ws = getWs(state);
      expect(terms(state)).toEqual([]);
      expect(ws.activeTerminalId).toBeNull();
      expect(ws.isOpen).toBe(false);
    });

    it("should close when no terminals and no saved state", () => {
      const state = terminalsReducer(
        initialState,
        loadWorkspaceTerminals(WS, [], null)
      );
      expect(getWs(state).isOpen).toBe(false);
    });
  });

  describe("hydrateHeight", () => {
    it("should set height from localStorage", () => {
      const state = terminalsReducer(initialState, hydrateHeight(75));
      expect(state.height).toBe(75);
    });

    it("should ignore invalid height", () => {
      const state = terminalsReducer(initialState, hydrateHeight(10));
      expect(state).toBe(initialState);
    });
  });

  describe("selectTerminal", () => {
    it("should select a terminal that exists", () => {
      const stateWith: TerminalOverlayState = {
        ...initialState,
        workspaces: { [WS]: {
          isOpen: false,
          terminals: col([{ id: "t1", name: "T1" }, { id: "t2", name: "T2" }]),
          activeTerminalId: "t1",
          terminalsLoaded: false,
          isLoadingTerminals: false,
          recentlyCreatedTerminals: [],
        }},
      };
      const state = terminalsReducer(stateWith, selectTerminal(WS, "t2"));
      expect(getWs(state).activeTerminalId).toBe("t2");
    });

    it("should ignore nonexistent terminal", () => {
      const state = terminalsReducer(initialState, selectTerminal(WS, "nonexistent"));
      expect(state).toBe(initialState);
    });
  });

  describe("addTerminal", () => {
    it("should add terminal and make it active", () => {
      const state = terminalsReducer(initialState, addTerminal(WS, "t1", "My Term"));
      const ws = getWs(state);
      expect(terms(state)).toHaveLength(1);
      expect(getItem(ws.terminals, "t1")).toEqual({ id: "t1", name: "My Term" });
      expect(ws.activeTerminalId).toBe("t1");
    });

    it("should not duplicate existing terminal", () => {
      const stateWith: TerminalOverlayState = {
        ...initialState,
        workspaces: { [WS]: { isOpen: false, activeTerminalId: null, terminals: col([{ id: "t1", name: "T1" }]), terminalsLoaded: false, isLoadingTerminals: false, recentlyCreatedTerminals: [] } },
      };
      const state = terminalsReducer(stateWith, addTerminal(WS, "t1", "T1"));
      const ws = getWs(state);
      expect(terms(state)).toHaveLength(1);
      expect(ws.activeTerminalId).toBe("t1");
    });
  });

  describe("per-workspace isolation", () => {
    it("should keep workspaces independent", () => {
      let state = terminalsReducer(initialState, addTerminal("ws-1", "t1", "Term 1"));
      state = terminalsReducer(state, addTerminal("ws-2", "t2", "Term 2"));

      expect(terms(state, "ws-1")).toHaveLength(1);
      expect(terms(state, "ws-1")[0].id).toBe("t1");
      expect(terms(state, "ws-2")).toHaveLength(1);
      expect(terms(state, "ws-2")[0].id).toBe("t2");
    });

    it("should not affect other workspaces when closing", () => {
      let state = terminalsReducer(initialState, openTerminalOverlay("ws-1"));
      state = terminalsReducer(state, openTerminalOverlay("ws-2"));
      state = terminalsReducer(state, closeTerminalOverlay("ws-1"));

      expect(state.workspaces["ws-1"].isOpen).toBe(false);
      expect(state.workspaces["ws-2"].isOpen).toBe(true);
    });
  });

  describe("setTerminalsLoaded", () => {
    it("should set terminalsLoaded flag", () => {
      const state = terminalsReducer(initialState, setTerminalsLoaded(WS, true));
      expect(getWs(state).terminalsLoaded).toBe(true);
    });

    it("should return same state if unchanged", () => {
      const state = terminalsReducer(initialState, setTerminalsLoaded(WS, false));
      expect(state).toBe(initialState);
    });
  });

  describe("setIsLoadingTerminals", () => {
    it("should set isLoadingTerminals flag", () => {
      const state = terminalsReducer(initialState, setIsLoadingTerminals(WS, true));
      expect(getWs(state).isLoadingTerminals).toBe(true);
    });
  });

  describe("markTerminalRecentlyCreated", () => {
    it("should add terminal to recently created list", () => {
      const state = terminalsReducer(initialState, markTerminalRecentlyCreated(WS, "t1"));
      expect(getWs(state).recentlyCreatedTerminals).toEqual(["t1"]);
    });

    it("should not duplicate", () => {
      let state = terminalsReducer(initialState, markTerminalRecentlyCreated(WS, "t1"));
      state = terminalsReducer(state, markTerminalRecentlyCreated(WS, "t1"));
      expect(getWs(state).recentlyCreatedTerminals).toEqual(["t1"]);
    });
  });

  describe("fresh-create stale customName regression (PanelLayout.handleCreateTerminal)", () => {
    // A previously-renamed terminal can leave a stale entry in the slice
    // (e.g. tab closed without removing the terminal, or daemon restart that
    // resets the id counter and reuses a prior id). `saveTerminalMetadata`
    // intentionally preserves customName for the remount/reattach case, so the
    // fresh-create path in `PanelLayout.handleCreateTerminal` must dispatch
    // `removeTerminal` for the freshly daemon-assigned id before calling
    // `saveTerminalMetadata`, otherwise the new terminal inherits the stale
    // customName from the previous renamed terminal.
    it("dispatching removeTerminal + saveTerminalMetadata clears stale customName for a reused id", () => {
      const stateWithStale: TerminalOverlayState = {
        ...initialState,
        workspaces: {
          [WS]: {
            isOpen: false,
            activeTerminalId: null,
            terminals: col([{ id: "pty-0", name: "Terminal", customName: "Build", type: "terminal", workspaceId: WS, createdAt: "2026-01-01T00:00:00.000Z" }]),
            terminalsLoaded: false,
            isLoadingTerminals: false,
            recentlyCreatedTerminals: [],
          },
        },
      };

      let state = terminalsReducer(stateWithStale, removeTerminal(WS, "pty-0"));
      state = terminalsReducer(
        state,
        saveTerminalMetadata(WS, "pty-0", "Terminal", "2026-06-30T00:00:00.000Z"),
      );

      const term = getItem(getWs(state).terminals, "pty-0");
      expect(term).toEqual({
        id: "pty-0",
        name: "Terminal",
        type: "terminal",
        workspaceId: WS,
        createdAt: "2026-06-30T00:00:00.000Z",
      });
      expect(term?.customName).toBeUndefined();
    });

    // Sanity check: without the removeTerminal step (the pre-fix buggy flow),
    // the stale customName carries over to the fresh terminal — this asserts
    // the bug exists at the reducer level and motivates the fix above.
    it("saveTerminalMetadata alone preserves stale customName (documents the bug)", () => {
      const stateWithStale: TerminalOverlayState = {
        ...initialState,
        workspaces: {
          [WS]: {
            isOpen: false,
            activeTerminalId: null,
            terminals: col([{ id: "pty-0", name: "Terminal", customName: "Build" }]),
            terminalsLoaded: false,
            isLoadingTerminals: false,
            recentlyCreatedTerminals: [],
          },
        },
      };

      const state = terminalsReducer(
        stateWithStale,
        saveTerminalMetadata(WS, "pty-0", "Terminal", "2026-06-30T00:00:00.000Z"),
      );

      expect(getItem(getWs(state).terminals, "pty-0")?.customName).toBe("Build");
    });
  });

  // Regression (intent-hq/monorepo#1330): switching workspaces re-dispatches
  // loadWorkspaceTerminals from mount hydration. When the daemon returns a
  // transient empty terminal.list (restart race, PTY not yet spawned), the
  // reducer REPLACES the workspace state wholesale — live tabs vanish and
  // isOpen is forced to false. An empty hydration result over existing live
  // tabs must preserve them.
  describe("transient empty hydration over live tabs (monorepo#1330)", () => {
    it("must not clobber existing live tabs when an empty list lands", () => {
      const stateWith: TerminalOverlayState = {
        ...initialState,
        workspaces: { [WS]: {
          isOpen: true,
          activeTerminalId: "pty-42",
          terminals: col([{ id: "pty-42", name: "Terminal" }]),
          terminalsLoaded: true,
          isLoadingTerminals: false,
          recentlyCreatedTerminals: [],
        }},
      };

      const state = terminalsReducer(stateWith, loadWorkspaceTerminals(WS, [], null));

      expect(terms(state).map((t) => t.id)).toEqual(["pty-42"]);
      expect(getWs(state).activeTerminalId).toBe("pty-42");
      expect(getWs(state).isOpen).toBe(true);
    });
  });

  describe("setTerminalsList", () => {
    it("should replace terminal list preserving custom names", () => {
      const stateWith: TerminalOverlayState = {
        ...initialState,
        workspaces: { [WS]: {
          isOpen: false,
          activeTerminalId: null,
          terminals: col([{ id: "t1", name: "T1", customName: "My Term" }]),
          terminalsLoaded: false,
          isLoadingTerminals: false,
          recentlyCreatedTerminals: [],
        }},
      };
      const state = terminalsReducer(stateWith, setTerminalsList(WS, [
        { id: "t1", name: "New T1" },
        { id: "t2", name: "T2" },
      ]));
      const ws = getWs(state);
      expect(terms(state)).toHaveLength(2);
      expect(getItem(ws.terminals, "t1")?.customName).toBe("My Term");
      expect(getItem(ws.terminals, "t1")?.name).toBe("New T1");
    });
  });
});