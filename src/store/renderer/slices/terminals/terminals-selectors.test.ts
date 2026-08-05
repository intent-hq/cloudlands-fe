import {
  describe,
  expect,
  it,
} from "vitest";
import type { StoreState } from "../../types";
import { createCollection } from "$lib/store-shim/utils/collections/collection-utils";
import type { TerminalOverlayState, TerminalTab } from "./terminals-slice";
import {
  selectSelectedScriptId,
  selectTerminalDisplayName,
  selectWorkspaceSetupTerminal,
} from "./terminals-selectors";
import { m } from "$shared/paraglide/messages.js";

const WS = "ws-1";

function terminalState(terminals: TerminalTab[], selectedScriptId: string | null = null): TerminalOverlayState {
  return {
    height: 50,
    workspaces: {
      [WS]: {
        isOpen: false,
        activeTerminalId: null,
        terminals: createCollection<TerminalTab, "id">("id", terminals),
        terminalsLoaded: true,
        isLoadingTerminals: false,
        daemonBootId: null,
        selectedScriptId,
      },
    },
  };
}

function stateWith(terminals: TerminalTab[]): StoreState {
  return {
    terminals: terminalState(terminals),
    workspace: { activeWorkspaceId: WS },
  } as unknown as StoreState;
}

/** State for selectSelectedScriptId: selection + scripts-slice shape. */
function scriptSelectionState(options: {
  selectedScriptId: string | null;
  activeWorkspaceId?: string | null;
  scriptsWs?: { initialized: boolean; scripts: Record<string, unknown> } | undefined;
}): StoreState {
  return {
    terminals: terminalState([], options.selectedScriptId),
    workspace: {
      activeWorkspaceId:
        options.activeWorkspaceId === undefined ? WS : options.activeWorkspaceId,
    },
    scripts: {
      byWorkspaceId: options.scriptsWs === undefined ? {} : { [WS]: options.scriptsWs },
    },
  } as unknown as StoreState;
}

describe("terminals selectors", () => {
  describe("selectWorkspaceSetupTerminal", () => {
    it("returns the setup terminal when one exists by name", () => {
      const state = stateWith([{ id: "term-1", name: "Setup" }]);

      expect(selectWorkspaceSetupTerminal.select(state, WS)).toEqual({ id: "term-1", name: "Setup" });
    });

    it("returns the setup terminal when one exists by custom name", () => {
      const setupTerminal = { id: "term-setup", name: "Terminal", customName: "Setup" };
      const state = stateWith([
        { id: "term-1", name: "Terminal" },
        setupTerminal,
      ]);

      expect(selectWorkspaceSetupTerminal.select(state, WS)).toBe(setupTerminal);
    });

    it("returns undefined when the workspace has no setup terminal", () => {
      const state = stateWith([{ id: "term-1", name: "Terminal" }]);

      expect(selectWorkspaceSetupTerminal.select(state, WS)).toBeUndefined();
    });
  });

  describe("selectTerminalDisplayName", () => {
    it("localizes the daemon-provided 'Setup Script' spawn-time name", () => {
      const state = stateWith([{ id: "term-1", name: "Setup Script" }]);

      expect(selectTerminalDisplayName.select(state, "term-1")).toBe(
        m.terminal_daemonName_setupScript_label(),
      );
      // The wire value itself must stay raw/untouched in state — localization
      // happens only at the selector's return value, not in the store.
      expect(state.terminals.workspaces[WS].terminals.map["term-1"].name).toBe("Setup Script");
    });

    it("prefers a user-set customName over the localized daemon name", () => {
      const state = stateWith([
        { id: "term-1", name: "Setup Script", customName: "My Terminal" },
      ]);

      expect(selectTerminalDisplayName.select(state, "term-1")).toBe("My Terminal");
    });

    it("falls back to the raw name for an unrecognized daemon name", () => {
      const state = stateWith([{ id: "term-1", name: "some-unmapped-name" }]);

      expect(selectTerminalDisplayName.select(state, "term-1")).toBe("some-unmapped-name");
    });

    it("returns the generic fallback label when the terminal is missing", () => {
      const state = stateWith([]);

      expect(selectTerminalDisplayName.select(state, "missing")).toBe(
        m.terminal_quakeOverlay_terminal_fallback(),
      );
    });
  });

  // Validation contract the terminals reducer's hydration paths rely on: the
  // selected script id is filtered against the scripts slice at read time.
  describe("selectSelectedScriptId", () => {
    it("returns null when no workspace is active", () => {
      const state = scriptSelectionState({
        selectedScriptId: "script-1",
        activeWorkspaceId: null,
      });

      expect(selectSelectedScriptId.select(state)).toBeNull();
    });

    it("returns null when no script is selected", () => {
      const state = scriptSelectionState({
        selectedScriptId: null,
        scriptsWs: { initialized: true, scripts: { "script-1": {} } },
      });

      expect(selectSelectedScriptId.select(state)).toBeNull();
    });

    it("passes the raw id through while scripts are still hydrating (no scripts state)", () => {
      const state = scriptSelectionState({
        selectedScriptId: "script-1",
        scriptsWs: undefined,
      });

      expect(selectSelectedScriptId.select(state)).toBe("script-1");
    });

    it("passes the raw id through while scripts are loading (initialized: false)", () => {
      const state = scriptSelectionState({
        selectedScriptId: "script-1",
        scriptsWs: { initialized: false, scripts: {} },
      });

      expect(selectSelectedScriptId.select(state)).toBe("script-1");
    });

    it("returns null once scripts initialize without the selected id (stale/deleted)", () => {
      const state = scriptSelectionState({
        selectedScriptId: "script-1",
        scriptsWs: { initialized: true, scripts: { "other-script": {} } },
      });

      expect(selectSelectedScriptId.select(state)).toBeNull();
    });

    it("returns the id when scripts are initialized and the script exists", () => {
      const state = scriptSelectionState({
        selectedScriptId: "script-1",
        scriptsWs: { initialized: true, scripts: { "script-1": {} } },
      });

      expect(selectSelectedScriptId.select(state)).toBe("script-1");
    });
  });
});
