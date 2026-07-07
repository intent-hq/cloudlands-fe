/**
 * Unit-level wire-contract test for the workspace-navigation-layout middleware.
 *
 * Regression coverage for "Workspace page opens the initial agent conversation
 * after creation": `CompactWorkspaceInitializer` / `OnboardingPage` dispatch
 * `hydrateWorkspaceNavigation` with `mainPanel: notes/spec` + `drawer: agent/{id}`
 * as the pre-navigation intent, and the middleware must translate that intent
 * into the equivalent `panelLayout/openTab` (for the spec note) and
 * `appLayout/openAgentTabRequested` (for the drawer agent). Without the
 * middleware, the workspace page mounts with an empty panel-layout — the exact
 * regression this task is fixing.
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
  // after workspace creation (see CompactWorkspaceInitializer.svelte:~1874-1882).
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

  it("opens the spec note tab AND the adjacent agent tab from the initializer's hydration payload", () => {
    const { dispatch, next } = makeMiddlewareRunner();
    const WS = "ws-1";
    const AGENT = "agent-e8a6f466";

    dispatch(hydrateWorkspaceNavigation(WS, buildInitialCreationState(AGENT)));

    // Middleware passes the action to the reducer chain (post-reducer handler).
    expect(next).toHaveBeenCalledTimes(1);

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
        ...buildInitialCreationState("agent-x"),
        drawer: { open: false, type: null, itemId: null },
      }),
    );

    expect(findAction("panelLayout/openTab")).toBeDefined();
    expect(findAction("appLayout/openAgentTabRequested")).toBeUndefined();
  });

  it("only opens the agent tab when the main panel is not a notes panel", () => {
    const { dispatch } = makeMiddlewareRunner();
    dispatch(
      hydrateWorkspaceNavigation("ws-3", {
        ...buildInitialCreationState("agent-y"),
        mainPanel: { type: "empty" },
      }),
    );

    expect(findAction("panelLayout/openTab")).toBeUndefined();
    expect(findAction("appLayout/openAgentTabRequested")).toBeDefined();
  });

  it("skips both openings when there is no note id AND no drawer agent", () => {
    const { dispatch } = makeMiddlewareRunner();
    dispatch(
      hydrateWorkspaceNavigation("ws-4", {
        ...buildInitialCreationState("agent-z"),
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

  it("exposes applyHydratedLayout for direct callers", () => {
    applyHydratedLayout("ws-5", buildInitialCreationState("agent-direct"));
    expect(findAction("panelLayout/openTab")).toBeDefined();
    expect(findAction("appLayout/openAgentTabRequested")).toBeDefined();
  });
});
