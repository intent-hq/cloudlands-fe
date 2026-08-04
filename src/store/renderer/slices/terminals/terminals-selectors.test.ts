import {
  describe,
  expect,
  it,
} from "vitest";
import type { StoreState } from "../../types";
import { createCollection } from "$lib/store-shim/utils/collections/collection-utils";
import type { TerminalOverlayState, TerminalTab } from "./terminals-slice";
import { selectTerminalDisplayName, selectWorkspaceSetupTerminal } from "./terminals-selectors";
import { m } from "$shared/paraglide/messages.js";

const WS = "ws-1";

function terminalState(terminals: TerminalTab[]): TerminalOverlayState {
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
        selectedScriptId: null,
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
});
