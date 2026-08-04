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
  selectScript,
  clearScriptSelection,
  addTerminal,
  removeTerminal,
  setTerminalOverlayHeight,
  renameTerminal,
  saveTerminalMetadata,
  loadWorkspaceTerminals,
  hydrateHeight,
  setTerminalsLoaded,
  setIsLoadingTerminals,
  setTerminalsList,
  type TerminalOverlayState,
  type TerminalTab,
} from "./terminals-slice";
import {
  createCollection,
  getItems,
  getItem,
} from "$lib/store-shim/utils/collections/collection-utils";
import { setScriptsData } from "../scripts/scripts-slice";
import type { ScriptWithState } from "$features/scripts/types";

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
  return state.workspaces[wsId] || { isOpen: false, activeTerminalId: null, terminals: createCollection<TerminalTab, "id">("id"), terminalsLoaded: false, isLoadingTerminals: false, daemonBootId: null, selectedScriptId: null };
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
        workspaces: { [WS]: { isOpen: false, activeTerminalId: "term-123", terminals: col([{ id: "term-123", name: "Terminal" }]), terminalsLoaded: false, isLoadingTerminals: false, daemonBootId: null, selectedScriptId: null } },
      };
      const state = terminalsReducer(stateWithTerminal, openTerminalOverlay(WS, "term-123"));
      expect(terms(state)).toHaveLength(1);
    });
  });

  describe("closeTerminalOverlay", () => {
    it("should close overlay", () => {
      const openState: TerminalOverlayState = {
        ...initialState,
        workspaces: { [WS]: { isOpen: true, activeTerminalId: null, terminals: col([]), terminalsLoaded: false, isLoadingTerminals: false, daemonBootId: null, selectedScriptId: null } },
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
        workspaces: { [WS]: { isOpen: true, activeTerminalId: null, terminals: col([]), terminalsLoaded: false, isLoadingTerminals: false, daemonBootId: null, selectedScriptId: null } },
      };
      const state = terminalsReducer(openState, toggleTerminalOverlay(WS));
      expect(getWs(state).isOpen).toBe(false);
    });

    it("should stay open when open with termId", () => {
      const openState: TerminalOverlayState = {
        ...initialState,
        workspaces: { [WS]: { isOpen: true, activeTerminalId: null, terminals: col([]), terminalsLoaded: false, isLoadingTerminals: false, daemonBootId: null, selectedScriptId: null } },
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
          daemonBootId: null,
          selectedScriptId: null,
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
          daemonBootId: null,
          selectedScriptId: null,
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
          daemonBootId: null,
          selectedScriptId: null,
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
          daemonBootId: null,
          selectedScriptId: null,
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
          daemonBootId: null,
          selectedScriptId: null,
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
        workspaces: { [WS]: { isOpen: false, activeTerminalId: null, terminals: col([{ id: "t1", name: "Terminal" }]), terminalsLoaded: false, isLoadingTerminals: false, daemonBootId: null, selectedScriptId: null } },
      };
      const state = terminalsReducer(stateWith, renameTerminal(WS, "t1", "My Terminal"));
      expect(getItem(getWs(state).terminals, "t1")?.customName).toBe("My Terminal");
    });

    it("should clear custom name on empty string", () => {
      const stateWith: TerminalOverlayState = {
        ...initialState,
        workspaces: { [WS]: { isOpen: false, activeTerminalId: null, terminals: col([{ id: "t1", name: "Terminal", customName: "Old" }]), terminalsLoaded: false, isLoadingTerminals: false, daemonBootId: null, selectedScriptId: null } },
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
            daemonBootId: null,
            selectedScriptId: null,
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
            daemonBootId: null,
            selectedScriptId: null,
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
          daemonBootId: null,
          selectedScriptId: null,
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
        workspaces: { [WS]: { isOpen: false, activeTerminalId: null, terminals: col([{ id: "t1", name: "T1" }]), terminalsLoaded: false, isLoadingTerminals: false, daemonBootId: null, selectedScriptId: null } },
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
            daemonBootId: null,
            selectedScriptId: null,
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
            daemonBootId: null,
            selectedScriptId: null,
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
          daemonBootId: null,
          selectedScriptId: null,
        }},
      };

      const state = terminalsReducer(stateWith, loadWorkspaceTerminals(WS, [], null));

      expect(terms(state).map((t) => t.id)).toEqual(["pty-42"]);
      expect(getWs(state).activeTerminalId).toBe("pty-42");
      expect(getWs(state).isOpen).toBe(true);
    });
  });

  // Boot-id-aware empty handling (intent-hq/monorepo#1334): the terminal.list
  // envelope carries daemonBootId. A same-boot empty is authoritative (every
  // PTY genuinely gone — converge to zero tabs); a different/unknown boot id
  // means restart (preserve tabs; auto-reconnect respawns) or a legacy
  // bare-array response (no metadata — preserve).
  describe("boot-id-aware empty hydration (monorepo#1334)", () => {
    function liveState(overrides?: Partial<ReturnType<typeof getWs>>): TerminalOverlayState {
      return {
        ...initialState,
        workspaces: { [WS]: {
          isOpen: true,
          activeTerminalId: "pty-42",
          terminals: col([{ id: "pty-42", name: "Terminal" }]),
          terminalsLoaded: true,
          isLoadingTerminals: false,
          daemonBootId: "boot-1",
          selectedScriptId: null,
          ...overrides,
        }},
      };
    }

    it("adopts the daemonBootId from a non-empty hydration", () => {
      const state = terminalsReducer(
        initialState,
        loadWorkspaceTerminals(WS, [{ id: "t1", name: "T1" }], null, "boot-1")
      );
      expect(getWs(state).daemonBootId).toBe("boot-1");
    });

    it("converges to zero tabs on a same-boot authoritative empty", () => {
      const state = terminalsReducer(
        liveState(),
        loadWorkspaceTerminals(WS, [], null, "boot-1")
      );
      const ws = getWs(state);
      expect(terms(state)).toEqual([]);
      expect(ws.activeTerminalId).toBeNull();
      expect(ws.isOpen).toBe(false);
      expect(ws.daemonBootId).toBe("boot-1");
    });

    it("preserves tabs and adopts the new boot id on a post-restart empty (different boot)", () => {
      const state = terminalsReducer(
        liveState(),
        loadWorkspaceTerminals(WS, [], null, "boot-2")
      );
      const ws = getWs(state);
      expect(terms(state).map((t) => t.id)).toEqual(["pty-42"]);
      expect(ws.activeTerminalId).toBe("pty-42");
      expect(ws.isOpen).toBe(true);
      expect(ws.daemonBootId).toBe("boot-2");
    });

    it("preserves tabs on an empty without boot metadata (legacy bare-array response)", () => {
      const state = terminalsReducer(liveState(), loadWorkspaceTerminals(WS, [], null));
      const ws = getWs(state);
      expect(terms(state).map((t) => t.id)).toEqual(["pty-42"]);
      expect(ws.daemonBootId).toBe("boot-1");
    });

    it("preserves tabs when a boot-tagged empty lands before any boot id is known", () => {
      const stateWith = liveState({ daemonBootId: null });
      const state = terminalsReducer(stateWith, loadWorkspaceTerminals(WS, [], null, "boot-1"));
      const ws = getWs(state);
      expect(terms(state).map((t) => t.id)).toEqual(["pty-42"]);
      expect(ws.daemonBootId).toBe("boot-1");
    });

    it("keeps isOpen on a same-boot authoritative empty when a script tab holds the panel", () => {
      const state = terminalsReducer(
        liveState({ selectedScriptId: "script-1" }),
        loadWorkspaceTerminals(WS, [], null, "boot-1")
      );
      const ws = getWs(state);
      expect(terms(state)).toEqual([]);
      expect(ws.activeTerminalId).toBeNull();
      expect(ws.isOpen).toBe(true);
      expect(ws.selectedScriptId).toBe("script-1");
      expect(ws.daemonBootId).toBe("boot-1");
    });
  });

  // Scripts are not in `terminal.list`, so a script-only panel gets an empty
  // terminals hydration on every workspace remount. The reducer used to force
  // isOpen:false unconditionally on the empty-over-empty pass, closing a
  // panel legitimately held open by a script tab (monorepo#1411 — 1-frame
  // flash then disappear on workspace switch-back).
  describe("script-held panel survives empty hydration (monorepo#1411)", () => {
    function scriptOnlyState(overrides?: Partial<ReturnType<typeof getWs>>): TerminalOverlayState {
      return {
        ...initialState,
        workspaces: { [WS]: {
          isOpen: true,
          activeTerminalId: null,
          terminals: col([]),
          terminalsLoaded: true,
          isLoadingTerminals: false,
          daemonBootId: "boot-1",
          selectedScriptId: "script-1",
          ...overrides,
        }},
      };
    }

    it("keeps isOpen through a switch-away-and-back cycle (repeated empty hydrations)", () => {
      // Each remount fires hydrateTerminalsRequested → empty terminal.list —
      // the panel must stay open on the script tab across the whole cycle.
      let state: TerminalOverlayState = scriptOnlyState();
      state = terminalsReducer(state, loadWorkspaceTerminals(WS, [], undefined, "boot-1"));
      state = terminalsReducer(state, loadWorkspaceTerminals(WS, [], undefined, "boot-1"));
      const ws = getWs(state);
      expect(ws.isOpen).toBe(true);
      expect(ws.selectedScriptId).toBe("script-1");
      expect(terms(state)).toEqual([]);
    });

    it("restores a persisted script-held open panel (savedState, zero terminals)", () => {
      const state = terminalsReducer(
        initialState,
        loadWorkspaceTerminals(WS, [], {
          isOpen: true,
          activeTerminalId: null,
          selectedScriptId: "script-1",
        }, "boot-1")
      );
      const ws = getWs(state);
      expect(ws.isOpen).toBe(true);
      expect(ws.selectedScriptId).toBe("script-1");
      expect(ws.daemonBootId).toBe("boot-1");
    });

    it("keeps a script-held panel closed when it was closed (no spurious opens)", () => {
      const state = terminalsReducer(
        scriptOnlyState({ isOpen: false }),
        loadWorkspaceTerminals(WS, [], undefined, "boot-1")
      );
      expect(getWs(state).isOpen).toBe(false);
    });

    it("still converges isOpen to false on a truly-empty workspace (stuck-state guard)", () => {
      const state = terminalsReducer(
        scriptOnlyState({ selectedScriptId: null }),
        loadWorkspaceTerminals(WS, [], undefined, "boot-1")
      );
      expect(getWs(state).isOpen).toBe(false);
    });

    it("ignores a persisted isOpen:true with no script and no terminals (stuck-state guard)", () => {
      const state = terminalsReducer(
        initialState,
        loadWorkspaceTerminals(WS, [], {
          isOpen: true,
          activeTerminalId: null,
          selectedScriptId: null,
        }, "boot-1")
      );
      expect(getWs(state).isOpen).toBe(false);
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
          daemonBootId: null,
          selectedScriptId: null,
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

  // Selected script tab lives in per-workspace Redux state (monorepo#1411) so
  // it survives workspace switches/remounts instead of being component $state.
  describe("selectScript / clearScriptSelection", () => {
    function scriptState(overrides?: Partial<ReturnType<typeof getWs>>): TerminalOverlayState {
      return {
        ...initialState,
        workspaces: { [WS]: {
          isOpen: true,
          activeTerminalId: "t1",
          terminals: col([{ id: "t1", name: "T1" }, { id: "t2", name: "T2" }]),
          terminalsLoaded: false,
          isLoadingTerminals: false,
          daemonBootId: null,
          selectedScriptId: null,
          ...overrides,
        }},
      };
    }

    it("selectScript sets selectedScriptId and keeps activeTerminalId", () => {
      const state = terminalsReducer(scriptState(), selectScript(WS, "script-1"));
      const ws = getWs(state);
      expect(ws.selectedScriptId).toBe("script-1");
      expect(ws.activeTerminalId).toBe("t1");
    });

    it("selectScript is a no-op when the script is already selected", () => {
      const stateWith = scriptState({ selectedScriptId: "script-1" });
      const state = terminalsReducer(stateWith, selectScript(WS, "script-1"));
      expect(state).toBe(stateWith);
    });

    it("selectScript works on an untouched workspace (no terminals yet)", () => {
      const state = terminalsReducer(initialState, selectScript(WS, "script-1"));
      expect(getWs(state).selectedScriptId).toBe("script-1");
    });

    it("clearScriptSelection resets selectedScriptId", () => {
      const stateWith = scriptState({ selectedScriptId: "script-1" });
      const state = terminalsReducer(stateWith, clearScriptSelection(WS));
      expect(getWs(state).selectedScriptId).toBeNull();
    });

    it("clearScriptSelection is a no-op when nothing is selected", () => {
      const stateWith = scriptState();
      const state = terminalsReducer(stateWith, clearScriptSelection(WS));
      expect(state).toBe(stateWith);
    });

    it("selectTerminal clears the script selection", () => {
      const stateWith = scriptState({ selectedScriptId: "script-1" });
      const state = terminalsReducer(stateWith, selectTerminal(WS, "t2"));
      const ws = getWs(state);
      expect(ws.activeTerminalId).toBe("t2");
      expect(ws.selectedScriptId).toBeNull();
    });

    it("selectTerminal on the already-active terminal still clears the script selection", () => {
      // Mirrors the former component logic: clicking the active terminal tab
      // while a script tab was showing switches back to the terminal.
      const stateWith = scriptState({ selectedScriptId: "script-1" });
      const state = terminalsReducer(stateWith, selectTerminal(WS, "t1"));
      const ws = getWs(state);
      expect(ws.activeTerminalId).toBe("t1");
      expect(ws.selectedScriptId).toBeNull();
    });

    it("addTerminal clears the script selection (createNewTerminal semantics)", () => {
      const stateWith = scriptState({ selectedScriptId: "script-1" });
      const state = terminalsReducer(stateWith, addTerminal(WS, "t3", "T3"));
      const ws = getWs(state);
      expect(ws.activeTerminalId).toBe("t3");
      expect(ws.selectedScriptId).toBeNull();
    });

    it("openTerminalOverlay with explicit termId clears the script selection", () => {
      const stateWith = scriptState({ selectedScriptId: "script-1", isOpen: false });
      const state = terminalsReducer(stateWith, openTerminalOverlay(WS, "t2"));
      const ws = getWs(state);
      expect(ws.isOpen).toBe(true);
      expect(ws.activeTerminalId).toBe("t2");
      expect(ws.selectedScriptId).toBeNull();
    });

    it("openTerminalOverlay without termId preserves the script selection", () => {
      const stateWith = scriptState({ selectedScriptId: "script-1", isOpen: false });
      const state = terminalsReducer(stateWith, openTerminalOverlay(WS));
      const ws = getWs(state);
      expect(ws.isOpen).toBe(true);
      expect(ws.selectedScriptId).toBe("script-1");
    });

    it("removeTerminal preserves the script selection", () => {
      const stateWith = scriptState({ selectedScriptId: "script-1" });
      const state = terminalsReducer(stateWith, removeTerminal(WS, "t2"));
      expect(getWs(state).selectedScriptId).toBe("script-1");
    });

    it("loadWorkspaceTerminals preserves the in-memory script selection (remount hydration)", () => {
      const stateWith = scriptState({ selectedScriptId: "script-1" });
      const state = terminalsReducer(
        stateWith,
        loadWorkspaceTerminals(WS, [{ id: "t1", name: "T1" }], { isOpen: true, activeTerminalId: "t1" })
      );
      // savedState without selectedScriptId (legacy persisted entry) must not
      // drop the in-memory selection.
      expect(getWs(state).selectedScriptId).toBe("script-1");
    });

    it("loadWorkspaceTerminals restores a persisted script selection", () => {
      const state = terminalsReducer(
        initialState,
        loadWorkspaceTerminals(WS, [{ id: "t1", name: "T1" }], {
          isOpen: true,
          activeTerminalId: "t1",
          selectedScriptId: "script-1",
        })
      );
      expect(getWs(state).selectedScriptId).toBe("script-1");
    });

    it("loadWorkspaceTerminals honors an explicit persisted null selection", () => {
      const stateWith = scriptState({ selectedScriptId: "script-1" });
      const state = terminalsReducer(
        stateWith,
        loadWorkspaceTerminals(WS, [{ id: "t1", name: "T1" }], {
          isOpen: true,
          activeTerminalId: "t1",
          selectedScriptId: null,
        })
      );
      expect(getWs(state).selectedScriptId).toBeNull();
    });

    it("empty-list hydration over an empty workspace preserves the script selection", () => {
      // Scripts are not in terminal.list, so a script-only panel gets an empty
      // terminals hydration on every remount — the selection must survive it.
      const stateWith = scriptState({
        terminals: col([]),
        activeTerminalId: null,
        selectedScriptId: "script-1",
      });
      const state = terminalsReducer(stateWith, loadWorkspaceTerminals(WS, [], null));
      expect(getWs(state).selectedScriptId).toBe("script-1");
    });

    it("keeps script selections independent per workspace", () => {
      let state = terminalsReducer(initialState, selectScript("ws-1", "script-a"));
      state = terminalsReducer(state, selectScript("ws-2", "script-b"));
      state = terminalsReducer(state, clearScriptSelection("ws-1"));
      expect(getWs(state, "ws-1").selectedScriptId).toBeNull();
      expect(getWs(state, "ws-2").selectedScriptId).toBe("script-b");
    });
  });

  // Write-time validation of the selected script tab: when `setScriptsData`
  // (the authoritative `script.list` response) lands without the selected
  // script, the reducer clears the selection instead of relying solely on
  // `selectSelectedScriptId`'s read-time filtering — a stale persisted id
  // must not keep isOpen:true alive with nothing renderable (stuck state).
  describe("stale selectedScriptId cleared on setScriptsData", () => {
    function makeScript(id: string): ScriptWithState {
      return {
        id,
        workspaceId: WS,
        name: `script-${id}`,
        command: "pnpm dev",
        mode: "service",
        source: "user",
        createdAt: "2026-01-01T00:00:00.000Z",
        runtime: { status: "idle", restartCount: 0 },
      };
    }

    function scriptHeldState(overrides?: Partial<ReturnType<typeof getWs>>): TerminalOverlayState {
      return {
        ...initialState,
        workspaces: { [WS]: {
          isOpen: true,
          activeTerminalId: null,
          terminals: col([]),
          terminalsLoaded: false,
          isLoadingTerminals: false,
          daemonBootId: "boot-1",
          selectedScriptId: "script-1",
          ...overrides,
        }},
      };
    }

    it("clears a selection missing from the script list and closes a script-only panel", () => {
      const state = terminalsReducer(
        scriptHeldState(),
        setScriptsData(WS, [makeScript("other-script")]),
      );
      const ws = getWs(state);
      expect(ws.selectedScriptId).toBeNull();
      expect(ws.isOpen).toBe(false);
    });

    it("clears a stale selection but keeps the panel open on an active terminal", () => {
      const state = terminalsReducer(
        scriptHeldState({
          terminals: col([{ id: "t1", name: "T1" }]),
          activeTerminalId: "t1",
        }),
        setScriptsData(WS, []),
      );
      const ws = getWs(state);
      expect(ws.selectedScriptId).toBeNull();
      expect(ws.isOpen).toBe(true);
      expect(ws.activeTerminalId).toBe("t1");
    });

    it("keeps a selection present in the script list", () => {
      const stateWith = scriptHeldState();
      const state = terminalsReducer(stateWith, setScriptsData(WS, [makeScript("script-1")]));
      expect(state).toBe(stateWith);
    });

    it("is a no-op when no script is selected", () => {
      const stateWith = scriptHeldState({ selectedScriptId: null, isOpen: false });
      const state = terminalsReducer(stateWith, setScriptsData(WS, []));
      expect(state).toBe(stateWith);
    });

    it("does not touch other workspaces", () => {
      const stateWith = scriptHeldState();
      const state = terminalsReducer(stateWith, setScriptsData("ws-other", []));
      expect(getWs(state).selectedScriptId).toBe("script-1");
      expect(getWs(state).isOpen).toBe(true);
    });
  });

  // Nit fix from the PR #705 review: customName is renderer-only state keyed
  // by daemon PTY id. Across a KNOWN daemon boot change a recycled id is a
  // different terminal, so hydration must not resurrect the old custom name.
  describe("customName preservation across daemonBootId changes", () => {
    function namedState(bootId: string | null): TerminalOverlayState {
      return {
        ...initialState,
        workspaces: { [WS]: {
          isOpen: true,
          activeTerminalId: "pty-0",
          terminals: col([{ id: "pty-0", name: "Terminal", customName: "Build" }]),
          terminalsLoaded: false,
          isLoadingTerminals: false,
          daemonBootId: bootId,
          selectedScriptId: null,
        }},
      };
    }

    it("preserves customName on a same-boot hydration", () => {
      const state = terminalsReducer(
        namedState("boot-1"),
        loadWorkspaceTerminals(WS, [{ id: "pty-0", name: "Terminal" }], undefined, "boot-1"),
      );
      expect(getItem(getWs(state).terminals, "pty-0")?.customName).toBe("Build");
    });

    it("drops customName for a recycled id on a new boot", () => {
      const state = terminalsReducer(
        namedState("boot-1"),
        loadWorkspaceTerminals(WS, [{ id: "pty-0", name: "Terminal" }], undefined, "boot-2"),
      );
      expect(getItem(getWs(state).terminals, "pty-0")?.customName).toBeUndefined();
    });

    it("preserves customName when the incoming boot id is unknown (legacy bare-array response)", () => {
      const state = terminalsReducer(
        namedState("boot-1"),
        loadWorkspaceTerminals(WS, [{ id: "pty-0", name: "Terminal" }], undefined),
      );
      expect(getItem(getWs(state).terminals, "pty-0")?.customName).toBe("Build");
    });

    it("preserves customName when no prior boot id was known", () => {
      const state = terminalsReducer(
        namedState(null),
        loadWorkspaceTerminals(WS, [{ id: "pty-0", name: "Terminal" }], undefined, "boot-1"),
      );
      expect(getItem(getWs(state).terminals, "pty-0")?.customName).toBe("Build");
    });
  });
});