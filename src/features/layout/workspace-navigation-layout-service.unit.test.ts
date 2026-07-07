/**
 * Unit-level wire-contract test for the workspace-navigation-layout middleware.
 *
 * Regression coverage for two related shapes of the workspace-creation intent:
 * `CompactWorkspaceInitializer` / `OnboardingPage` dispatch
 * `hydrateWorkspaceNavigation({ mainPanel: empty, drawer: agent/{id} })` so
 * the workspace page mounts with the initial-agent conversation as its only
 * tab (full-width, no split). The middleware still supports the legacy
 * spec+agent split shape (`mainPanel: notes/spec, drawer: agent/{id}` →
 * spec tab in the main panel + adjacent agent tab) for any hydration source
 * that opts in. Without the middleware, the workspace page mounts with an
 * empty panel-layout — the underlying regression this file guards against.
 *
 * Same shape as the sibling `workspace-navigation-tab-service.unit.test.ts`:
 * stubs `$store/renderer/store` via `vi.mock` so the middleware doesn't drag
 * in the full store bootstrap (importing selectors mid store-init would trip
 * the same setup issue documented in that sibling test's header).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const dispatchedActions: Array<{ type: string; payload: unknown }> = [];

vi.mock("$store/renderer/store", () => ({
  store: {
    dispatch: (action: { type: string; payload: unknown }) => {
      dispatchedActions.push(action);
    },
  },
}));

import {
  applyHydratedLayout,
  createWorkspaceNavigationLayoutMiddleware,
} from "./workspace-navigation-layout-service";
import {
  hydrateWorkspaceNavigation,
  type WorkspaceNavigationWorkspaceState,
} from "$store/renderer/slices/workspace-navigation/workspace-navigation-slice";

type Dispatch = (action: { type: string; payload?: unknown }) => unknown;

function makeMiddlewareRunner(): {
  dispatch: Dispatch;
  next: ReturnType<typeof vi.fn>;
} {
  const next = vi.fn((action) => action);
  const middleware = createWorkspaceNavigationLayoutMiddleware();
  const api = { dispatch: vi.fn(), getState: vi.fn() } as unknown as Parameters<
    ReturnType<typeof createWorkspaceNavigationLayoutMiddleware>
  >[0];
  const dispatch = middleware(api)(next) as Dispatch;
  return { dispatch, next };
}

function findAction(type: string): { type: string; payload: unknown } | undefined {
  return dispatchedActions.find((a) => a.type === type);
}

function buildInitialCreationState(agentId: string): WorkspaceNavigationWorkspaceState {
  // Matches the exact shape CompactWorkspaceInitializer / OnboardingPage dispatch
  // after workspace creation: agent-only landing, no spec tab in the main panel.
  return {
    version: 2,
    workspace: { id: "ws-1", status: "loading" },
    mainPanel: { type: "empty" },
    drawer: { open: true, type: "agent", itemId: agentId },
    navigation: { history: [], currentIndex: -1 },
    ui: { hasInitialized: false },
  };
}

function buildSpecPlusAgentState(agentId: string): WorkspaceNavigationWorkspaceState {
  // Legacy spec + agent split intent — still supported by the middleware for
  // any hydration source that opts in, though no first-party caller does today.
  return {
    version: 2,
    workspace: { id: "ws-1", status: "loading" },
    mainPanel: { type: "notes", selectedNoteId: "spec" },
    drawer: { open: true, type: "agent", itemId: agentId },
    navigation: { history: [], currentIndex: -1 },
    ui: { hasInitialized: false },
  };
}

describe("workspaceNavigationLayoutMiddleware (unit)", () => {
  beforeEach(() => {
    dispatchedActions.length = 0;
  });

  it("opens only the initial agent tab full-width from the initializer's agent-only hydration payload", () => {
    const { dispatch, next } = makeMiddlewareRunner();
    const WS = "ws-1";
    const AGENT = "agent-e8a6f466";

    dispatch(hydrateWorkspaceNavigation(WS, buildInitialCreationState(AGENT)));

    // Middleware passes the action to the reducer chain (post-reducer handler).
    expect(next).toHaveBeenCalledTimes(1);

    // No spec (or other) note tab is opened — the workspace lands on the agent.
    expect(findAction("panelLayout/openTab")).toBeUndefined();

    const openAgentAction = findAction("appLayout/openAgentTabRequested");
    expect(openAgentAction).toBeDefined();
    expect(openAgentAction!.payload).toEqual([
      WS,
      { agentId: AGENT, openInAdjacentPanel: false },
    ]);
  });

  it("opens the spec note tab AND the adjacent agent tab from a legacy spec+agent hydration payload", () => {
    const { dispatch } = makeMiddlewareRunner();
    const WS = "ws-legacy";
    const AGENT = "agent-legacy";

    dispatch(hydrateWorkspaceNavigation(WS, buildSpecPlusAgentState(AGENT)));

    const openTabAction = findAction("panelLayout/openTab");
    expect(openTabAction).toBeDefined();
    const openTabPayload = openTabAction!.payload as {
      wsId: string;
      tab: Record<string, unknown>;
    };
    expect(openTabPayload.wsId).toBe(WS);
    expect(openTabPayload.tab).toMatchObject({
      type: "note",
      noteId: "spec",
      title: "Spec",
      workspaceId: WS,
      closable: true,
    });

    const openAgentAction = findAction("appLayout/openAgentTabRequested");
    expect(openAgentAction).toBeDefined();
    expect(openAgentAction!.payload).toEqual([
      WS,
      { agentId: AGENT, openInAdjacentPanel: true },
    ]);
  });

  it("only opens the note tab when the drawer is closed", () => {
    const { dispatch } = makeMiddlewareRunner();
    const WS = "ws-2";
    dispatch(
      hydrateWorkspaceNavigation(WS, {
        ...buildSpecPlusAgentState("agent-x"),
        drawer: { open: false, type: null, itemId: null },
      }),
    );

    expect(findAction("panelLayout/openTab")).toBeDefined();
    expect(findAction("appLayout/openAgentTabRequested")).toBeUndefined();
  });

  it("skips both openings when there is no note id AND no drawer agent", () => {
    const { dispatch } = makeMiddlewareRunner();
    dispatch(
      hydrateWorkspaceNavigation("ws-4", {
        ...buildSpecPlusAgentState("agent-z"),
        mainPanel: { type: "notes" },
        drawer: { open: false, type: null, itemId: null },
      }),
    );

    expect(findAction("panelLayout/openTab")).toBeUndefined();
    expect(findAction("appLayout/openAgentTabRequested")).toBeUndefined();
  });

  it("passes through unrelated actions without effect", () => {
    const { dispatch, next } = makeMiddlewareRunner();
    dispatch({ type: "other/something", payload: 42 });
    expect(next).toHaveBeenCalledWith({ type: "other/something", payload: 42 });
    expect(dispatchedActions).toHaveLength(0);
  });

  it("exposes applyHydratedLayout for direct callers (agent-only intent)", () => {
    applyHydratedLayout("ws-5", buildInitialCreationState("agent-direct"));
    expect(findAction("panelLayout/openTab")).toBeUndefined();
    const openAgentAction = findAction("appLayout/openAgentTabRequested");
    expect(openAgentAction).toBeDefined();
    expect(openAgentAction!.payload).toEqual([
      "ws-5",
      { agentId: "agent-direct", openInAdjacentPanel: false },
    ]);
  });
});
