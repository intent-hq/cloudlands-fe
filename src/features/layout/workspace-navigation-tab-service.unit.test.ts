/**
 * Unit-level wire-contract test for the workspace-navigation-tab middleware.
 *
 * The real-store integration test in this folder (mirroring
 * app-layout-navigation-service.test.ts) trips a pre-existing renderer test
 * setup issue where importing the configured store eagerly loads Toast.svelte
 * (which calls store.createSelector before the store finishes initializing).
 * This unit test exercises the middleware directly with a stubbed store via
 * `vi.mock`, asserting that dispatching `openWorkspaceCommitChangeset` causes
 * an `openTab` action to be dispatched with the correct PROTOCOL-style payload
 * (type="changes", workspaceId, data: { commitHash, commitMessage }).
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
  createWorkspaceNavigationTabMiddleware,
  openCommitChangesetTab,
} from "./workspace-navigation-tab-service";
import { openWorkspaceCommitChangeset } from "$store/renderer/slices/workspace-navigation/workspace-navigation-slice";

type Dispatch = (action: { type: string; payload?: unknown }) => unknown;

function makeMiddlewareRunner(): {
  dispatch: Dispatch;
  next: ReturnType<typeof vi.fn>;
} {
  const next = vi.fn((action) => action);
  const middleware = createWorkspaceNavigationTabMiddleware();
  const api = { dispatch: vi.fn(), getState: vi.fn() } as unknown as Parameters<
    ReturnType<typeof createWorkspaceNavigationTabMiddleware>
  >[0];
  const dispatch = middleware(api)(next) as Dispatch;
  return { dispatch, next };
}

function findOpenTab(): { type: string; payload: unknown } | undefined {
  return dispatchedActions.find((a) => a.type === "panelLayout/openTab");
}

function findOpenTabAdjacent(): { type: string; payload: unknown } | undefined {
  return dispatchedActions.find((a) => a.type === "panelLayout/openTabInAdjacentOrSplit");
}

describe("workspaceNavigationTabMiddleware (unit)", () => {
  beforeEach(() => {
    dispatchedActions.length = 0;
  });

  it("opens a 'changes' tab keyed by commitHash on openWorkspaceCommitChangeset", () => {
    const { dispatch, next } = makeMiddlewareRunner();
    const WS = "ws-1";
    const HASH = "abc1234deadbeef";
    const MSG = "feat: add login";

    dispatch(openWorkspaceCommitChangeset(WS, HASH, MSG));

    // Middleware passes the action to the reducer chain.
    expect(next).toHaveBeenCalledTimes(1);

    const openTabAction = findOpenTab();
    expect(openTabAction).toBeDefined();
    const payload = openTabAction!.payload as {
      wsId: string;
      tab: Record<string, unknown>;
      force: boolean;
    };
    expect(payload.wsId).toBe(WS);
    expect(payload.force).toBe(true);
    expect(payload.tab).toMatchObject({
      type: "changes",
      workspaceId: WS,
      closable: true,
      data: { commitHash: HASH, commitMessage: MSG },
    });
    expect(payload.tab.title as string).toContain(HASH.substring(0, 7));
    expect(payload.tab.title as string).toContain("feat: add login");
  });

  it("routes adjacent-panel requests through openTabInAdjacentOrSplit", () => {
    const { dispatch } = makeMiddlewareRunner();
    const WS = "ws-2";
    const HASH = "feedfacecafebabe";

    dispatch(
      openWorkspaceCommitChangeset(WS, HASH, "split", { openInAdjacentPanel: true, sourcePanelId: "panel-A" }),
    );

    expect(findOpenTab()).toBeUndefined();
    const adjacent = findOpenTabAdjacent();
    expect(adjacent).toBeDefined();
    const payload = adjacent!.payload as {
      wsId: string;
      tab: Record<string, unknown>;
      sourcePanelId?: string;
      force: boolean;
    };
    expect(payload.wsId).toBe(WS);
    expect(payload.sourcePanelId).toBe("panel-A");
    expect(payload.force).toBe(true);
    expect(payload.tab).toMatchObject({ type: "changes", data: { commitHash: HASH } });
  });

  it("falls back to a generic title when no commit message is provided", () => {
    const { dispatch } = makeMiddlewareRunner();
    const HASH = "deadbeefdeadbeef";

    dispatch(openWorkspaceCommitChangeset("ws-3", HASH));

    const payload = findOpenTab()!.payload as { tab: { title: string; data: unknown } };
    expect(payload.tab.title).toBe(`Commit ${HASH.substring(0, 7)}`);
    expect(payload.tab.data).toEqual({ commitHash: HASH });
  });

  it("ignores the trigger when the commitHash is missing", () => {
    const { dispatch } = makeMiddlewareRunner();

    dispatch(openWorkspaceCommitChangeset("ws-4"));

    expect(findOpenTab()).toBeUndefined();
    expect(findOpenTabAdjacent()).toBeUndefined();
  });

  it("passes through unrelated actions without effect", () => {
    const { dispatch, next } = makeMiddlewareRunner();

    dispatch({ type: "other/something", payload: 42 });

    expect(next).toHaveBeenCalledWith({ type: "other/something", payload: 42 });
    expect(dispatchedActions).toHaveLength(0);
  });

  it("exposes openCommitChangesetTab for direct callers", () => {
    openCommitChangesetTab("ws-5", "0123456789abcdef", "direct call");

    const openTabAction = findOpenTab();
    expect(openTabAction).toBeDefined();
    const payload = openTabAction!.payload as { tab: { data: unknown } };
    expect(payload.tab.data).toMatchObject({
      commitHash: "0123456789abcdef",
      commitMessage: "direct call",
    });
  });
});
