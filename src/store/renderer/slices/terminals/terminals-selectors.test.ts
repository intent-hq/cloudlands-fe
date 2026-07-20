import {
  describe,
  expect,
  it,
} from "vitest";
import type { StoreState } from "../../types";
import { createCollection } from "$lib/store-shim/utils/collections/collection-utils";
import type { TerminalOverlayState, TerminalTab } from "./terminals-slice";
import { selectWorkspaceSetupTerminal } from "./terminals-selectors";

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
});
