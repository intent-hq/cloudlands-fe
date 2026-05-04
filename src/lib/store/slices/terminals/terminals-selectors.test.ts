import { describe, expect, it } from "vitest";
import type { StoreState } from "../../types";
import { createCollection } from "../../utils/collection-utils";
import type { TerminalOverlayState, TerminalTab } from "./terminals-slice";
import { selectWorkspaceHasSetupTerminal } from "./terminals-selectors";

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
        recentlyCreatedTerminals: [],
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
  describe("selectWorkspaceHasSetupTerminal", () => {
    it("returns true when the workspace has a setup terminal by name", () => {
      const state = stateWith([{ id: "term-1", name: "Setup" }]);

      expect(selectWorkspaceHasSetupTerminal.select(state, WS)).toBe(true);
    });

    it("returns true when the workspace has a setup terminal by custom name", () => {
      const state = stateWith([{ id: "term-1", name: "Terminal", customName: "Setup" }]);

      expect(selectWorkspaceHasSetupTerminal.select(state, WS)).toBe(true);
    });

    it("returns false when the workspace has no setup terminal", () => {
      const state = stateWith([{ id: "term-1", name: "Terminal" }]);

      expect(selectWorkspaceHasSetupTerminal.select(state, WS)).toBe(false);
    });
  });
});