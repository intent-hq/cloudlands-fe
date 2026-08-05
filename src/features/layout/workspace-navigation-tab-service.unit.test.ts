/**
 * Unit-level wire-contract test for the workspace-navigation-tab middleware.
 *
 * The real-store integration test in this folder (mirroring
 * app-layout-navigation-service.test.ts) trips a pre-existing renderer test
 * setup issue where importing the configured store eagerly loads Toast.svelte
 * (which calls store.createSelector before the store finishes initializing).
 * This unit test exercises the middleware directly with a stubbed store via
 * `vi.mock`, asserting that dispatching each restored `openWorkspace*` action
 * causes an `openTab` action to be dispatched with the correct PROTOCOL-style
 * payload the removed sagas used to build.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const dispatchedActions: Array<{ type: string; payload: unknown }> = [];
let mockState: Record<string, unknown> = {};

vi.mock("$store/renderer/store", () => ({
  store: {
    dispatch: (action: { type: string; payload: unknown }) => {
      dispatchedActions.push(action);
    },
    get state() {
      return mockState;
    },
  },
}));

import {
  createWorkspaceNavigationTabMiddleware,
  openChatChangesTab,
  openCommitChangesetTab,
  openDiffTab,
  openFileTab,
  openLocalChangesTab,
  openNoteTab,
} from "./workspace-navigation-tab-service";
import {
  openWorkspaceChatChanges,
  openWorkspaceCommitChangeset,
  openWorkspaceDiff,
  openWorkspaceFile,
  openWorkspaceLocalChanges,
  openWorkspaceNote,
  type JsonValue,
} from "$store/renderer/slices/workspace-navigation/workspace-navigation-slice";
import { ChangeStage, type TrackedChange } from "$features/file-tracking/types";
import { m } from "$shared/paraglide/messages.js";

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

function makeTrackedChange(overrides: Partial<TrackedChange> = {}): TrackedChange {
  return {
    id: "change-1",
    file: "src/foo/bar.ts",
    relativePath: "src/foo/bar.ts",
    stage: ChangeStage.Unstaged,
    stats: { additions: 3, deletions: 1 },
    status: "modified",
    attribution: { manual: true, timestamp: 0 },
    ...overrides,
  } as TrackedChange;
}

describe("workspaceNavigationTabMiddleware (unit)", () => {
  beforeEach(() => {
    dispatchedActions.length = 0;
    mockState = {};
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

  describe("openWorkspaceFile", () => {
    it("opens a 'file' tab shaped like the removed watchOpenFileSaga", () => {
      const { dispatch } = makeMiddlewareRunner();

      dispatch(openWorkspaceFile("ws-f", "src/lib/deep/nested/file.ts"));

      const payload = findOpenTab()!.payload as {
        wsId: string;
        tab: Record<string, unknown>;
        force: boolean;
      };
      expect(payload.wsId).toBe("ws-f");
      expect(payload.force).toBe(true);
      expect(payload.tab).toMatchObject({
        type: "file",
        title: "file.ts",
        filePath: "src/lib/deep/nested/file.ts",
        workspaceId: "ws-f",
        closable: true,
      });
      // No line option → no jump data on the tab.
      expect(payload.tab.data).toBeUndefined();
    });

    it("carries the line and jumpTimestamp when `line` is provided", () => {
      const { dispatch } = makeMiddlewareRunner();

      dispatch(openWorkspaceFile("ws-f", "src/lib/f.ts", { line: 42 }));

      const payload = findOpenTab()!.payload as { tab: { data?: Record<string, unknown> } };
      expect(payload.tab.data?.line).toBe(42);
      expect(typeof payload.tab.data?.jumpTimestamp).toBe("number");
    });

    it("routes adjacent-panel file opens through openTabInAdjacentOrSplit", () => {
      const { dispatch } = makeMiddlewareRunner();

      dispatch(
        openWorkspaceFile("ws-f", "src/lib/f.ts", {
          openInAdjacentPanel: true,
          sourcePanelId: "panel-X",
        }),
      );

      expect(findOpenTab()).toBeUndefined();
      const adjacent = findOpenTabAdjacent();
      expect(adjacent).toBeDefined();
      const payload = adjacent!.payload as {
        wsId: string;
        sourcePanelId?: string;
        force: boolean;
        tab: Record<string, unknown>;
      };
      expect(payload.sourcePanelId).toBe("panel-X");
      expect(payload.force).toBe(true);
      expect(payload.tab).toMatchObject({ type: "file", filePath: "src/lib/f.ts" });
    });

    it("is a no-op when filePath is missing", () => {
      const { dispatch } = makeMiddlewareRunner();

      dispatch(openWorkspaceFile("ws-f", ""));

      expect(findOpenTab()).toBeUndefined();
      expect(findOpenTabAdjacent()).toBeUndefined();
    });
  });

  describe("openWorkspaceNote", () => {
    it("opens a 'note' tab and pulls the title from the workspace-notes store", () => {
      mockState = {
        workspaceNotes: {
          byWorkspaceId: {
            "ws-n": { notes: { map: { "note-42": { id: "note-42", title: "My Note" } } } },
          },
        },
      };
      const { dispatch } = makeMiddlewareRunner();

      dispatch(openWorkspaceNote("ws-n", "note-42"));

      const payload = findOpenTab()!.payload as { tab: Record<string, unknown> };
      expect(payload.tab).toMatchObject({
        type: "note",
        title: "My Note",
        noteId: "note-42",
        workspaceId: "ws-n",
        closable: true,
      });
    });

    it("falls back to the noteId when the note title is unknown", () => {
      const { dispatch } = makeMiddlewareRunner();

      dispatch(openWorkspaceNote("ws-n", "orphan-note"));

      const payload = findOpenTab()!.payload as { tab: { title: string; noteId: string } };
      expect(payload.tab.title).toBe("orphan-note");
      expect(payload.tab.noteId).toBe("orphan-note");
    });

    it("overrides to adjacent-panel opening when the source panel shows an agent tab", () => {
      mockState = {
        panelLayout: {
          byWorkspaceId: {
            "ws-n": {
              panels: {
                "panel-agent": {
                  activeTabId: "tab-1",
                  tabs: [{ id: "tab-1", type: "agent" }],
                },
              },
            },
          },
        },
      };
      const { dispatch } = makeMiddlewareRunner();

      dispatch(openWorkspaceNote("ws-n", "n1", { sourcePanelId: "panel-agent" }));

      expect(findOpenTab()).toBeUndefined();
      const adjacent = findOpenTabAdjacent();
      expect(adjacent).toBeDefined();
      const payload = adjacent!.payload as {
        sourcePanelId?: string;
        tab: Record<string, unknown>;
      };
      expect(payload.sourcePanelId).toBe("panel-agent");
      expect(payload.tab).toMatchObject({ type: "note", noteId: "n1" });
    });

    it("keeps the same-panel path when the source panel shows a non-agent tab", () => {
      mockState = {
        panelLayout: {
          byWorkspaceId: {
            "ws-n": {
              panels: {
                "panel-note": {
                  activeTabId: "tab-1",
                  tabs: [{ id: "tab-1", type: "note" }],
                },
              },
            },
          },
        },
      };
      const { dispatch } = makeMiddlewareRunner();

      dispatch(openWorkspaceNote("ws-n", "n1", { sourcePanelId: "panel-note" }));

      const payload = findOpenTab()!.payload as { panelId?: string; tab: { type: string } };
      expect(payload.panelId).toBe("panel-note");
      expect(payload.tab.type).toBe("note");
      expect(findOpenTabAdjacent()).toBeUndefined();
    });

    it("is a no-op when the noteId is missing", () => {
      const { dispatch } = makeMiddlewareRunner();

      dispatch(openWorkspaceNote("ws-n", ""));

      expect(findOpenTab()).toBeUndefined();
      expect(findOpenTabAdjacent()).toBeUndefined();
    });
  });

  describe("openWorkspaceDiff", () => {
    it("opens a 'diff' tab keyed by diffPath and carries the tracked change on data", () => {
      const { dispatch } = makeMiddlewareRunner();
      const change = makeTrackedChange({ file: "src/a/b/c.ts", relativePath: "src/a/b/c.ts" });

      dispatch(openWorkspaceDiff("ws-d", change));

      const payload = findOpenTab()!.payload as { tab: Record<string, unknown> };
      expect(payload.tab).toMatchObject({
        type: "diff",
        title: "c.ts",
        diffPath: "src/a/b/c.ts",
        workspaceId: "ws-d",
        closable: true,
      });
      const data = payload.tab.data as Record<string, unknown>;
      expect(data.change).toBe(change);
      expect(data.branchBaseRef).toBeUndefined();
      expect(data.branchBaseCommitSha).toBeUndefined();
    });

    it("prefers `options.filePath` over the change's own file/relativePath", () => {
      const { dispatch } = makeMiddlewareRunner();
      const change = makeTrackedChange({ file: "old.ts", relativePath: "old.ts" });

      dispatch(openWorkspaceDiff("ws-d", change, { filePath: "renamed.ts" }));

      const payload = findOpenTab()!.payload as { tab: { diffPath: string; title: string } };
      expect(payload.tab.diffPath).toBe("renamed.ts");
      expect(payload.tab.title).toBe("renamed.ts");
    });

    it("routes adjacent-panel diff opens through openTabInAdjacentOrSplit", () => {
      const { dispatch } = makeMiddlewareRunner();
      const change = makeTrackedChange();

      dispatch(
        openWorkspaceDiff("ws-d", change, {
          openInAdjacentPanel: true,
          sourcePanelId: "panel-Y",
        }),
      );

      expect(findOpenTab()).toBeUndefined();
      const adjacent = findOpenTabAdjacent();
      expect(adjacent).toBeDefined();
      const payload = adjacent!.payload as {
        sourcePanelId?: string;
        force: boolean;
        tab: Record<string, unknown>;
      };
      expect(payload.sourcePanelId).toBe("panel-Y");
      expect(payload.force).toBe(true);
      expect(payload.tab).toMatchObject({ type: "diff", diffPath: change.file });
    });

    it("propagates PR-diff base overrides on tab.data", () => {
      const { dispatch } = makeMiddlewareRunner();
      const change = makeTrackedChange();

      dispatch(
        openWorkspaceDiff("ws-d", change, {
          branchBaseRef: "main",
          branchBaseCommitSha: "abc123",
        }),
      );

      const payload = findOpenTab()!.payload as { tab: { data: Record<string, unknown> } };
      expect(payload.tab.data.branchBaseRef).toBe("main");
      expect(payload.tab.data.branchBaseCommitSha).toBe("abc123");
    });

    it("is a no-op when both change and options.filePath are missing", () => {
      const { dispatch } = makeMiddlewareRunner();

      dispatch(openWorkspaceDiff("ws-d", undefined as unknown as TrackedChange));

      expect(findOpenTab()).toBeUndefined();
      expect(findOpenTabAdjacent()).toBeUndefined();
    });
  });

  describe("openWorkspaceChatChanges", () => {
    const CHANGES: JsonValue[] = [
      { file: "src/a.ts", additions: 2, deletions: 1 },
      { file: "src/b.ts", additions: 5, deletions: 0 },
    ];

    it("opens a 'chat-changes' tab shaped like the removed watchOpenChatChangesSaga", () => {
      const { dispatch } = makeMiddlewareRunner();

      dispatch(
        openWorkspaceChatChanges("ws-c", CHANGES, "3 files changed", {
          messageId: "msg-1",
          isAggregate: true,
          agentId: "agent-1",
          turnNumber: 4,
        }),
      );

      const payload = findOpenTab()!.payload as {
        wsId: string;
        tab: Record<string, unknown>;
        force: boolean;
      };
      expect(payload.wsId).toBe("ws-c");
      expect(payload.force).toBe(true);
      expect(payload.tab).toMatchObject({
        type: "chat-changes",
        title: "3 files changed",
        workspaceId: "ws-c",
        closable: true,
        data: {
          changes: CHANGES,
          title: "3 files changed",
          messageId: "msg-1",
          isAggregate: true,
          agentId: "agent-1",
          turnNumber: 4,
        },
      });
    });

    it("opens without options, keeping the changes and title on tab.data", () => {
      const { dispatch } = makeMiddlewareRunner();

      dispatch(openWorkspaceChatChanges("ws-c", CHANGES, "1 file changed"));

      const payload = findOpenTab()!.payload as { tab: { data: Record<string, unknown> } };
      expect(payload.tab.data.changes).toBe(CHANGES);
      expect(payload.tab.data.title).toBe("1 file changed");
      expect(payload.tab.data.messageId).toBeUndefined();
    });

    it("is a no-op when changes is missing", () => {
      const { dispatch } = makeMiddlewareRunner();

      dispatch(openWorkspaceChatChanges("ws-c", undefined as unknown as JsonValue[], "title"));

      expect(findOpenTab()).toBeUndefined();
      expect(findOpenTabAdjacent()).toBeUndefined();
    });

    it("is a no-op when wsId is missing", () => {
      const { dispatch } = makeMiddlewareRunner();

      dispatch(openWorkspaceChatChanges("", CHANGES, "title"));

      expect(findOpenTab()).toBeUndefined();
      expect(findOpenTabAdjacent()).toBeUndefined();
    });
  });

  describe("openWorkspaceLocalChanges", () => {
    it("opens the singleton 'local-changes' tab shaped like the removed watchOpenLocalChangesSaga", () => {
      const { dispatch } = makeMiddlewareRunner();

      dispatch(openWorkspaceLocalChanges("ws-l"));

      const payload = findOpenTab()!.payload as {
        wsId: string;
        tab: Record<string, unknown>;
        force: boolean;
      };
      expect(payload.wsId).toBe("ws-l");
      expect(payload.force).toBe(true);
      expect(payload.tab).toMatchObject({
        type: "local-changes",
        title: m.layout_presetExecutor_allChanges_title(),
        workspaceId: "ws-l",
        closable: true,
      });
      expect(payload.tab.data).toBeUndefined();
    });

    it("is a no-op when wsId is missing", () => {
      const { dispatch } = makeMiddlewareRunner();

      dispatch(openWorkspaceLocalChanges(""));

      expect(findOpenTab()).toBeUndefined();
      expect(findOpenTabAdjacent()).toBeUndefined();
    });
  });

  describe("direct helpers", () => {
    it("openFileTab dispatches openTab with the same shape as the middleware path", () => {
      openFileTab("ws-h", "src/direct.ts", { line: 7 });
      const payload = findOpenTab()!.payload as { tab: Record<string, unknown> };
      expect(payload.tab).toMatchObject({
        type: "file",
        filePath: "src/direct.ts",
        title: "direct.ts",
      });
      expect((payload.tab.data as { line: number }).line).toBe(7);
    });

    it("openNoteTab dispatches openTab with the same shape as the middleware path", () => {
      openNoteTab("ws-h", "spec");
      const payload = findOpenTab()!.payload as { tab: Record<string, unknown> };
      expect(payload.tab).toMatchObject({ type: "note", noteId: "spec", title: "spec" });
    });

    it("openDiffTab dispatches openTab with the same shape as the middleware path", () => {
      const change = makeTrackedChange({ file: "d.ts", relativePath: "d.ts" });
      openDiffTab("ws-h", change);
      const payload = findOpenTab()!.payload as { tab: Record<string, unknown> };
      expect(payload.tab).toMatchObject({ type: "diff", diffPath: "d.ts", title: "d.ts" });
    });

    it("openChatChangesTab dispatches openTab with the same shape as the middleware path", () => {
      const changes: JsonValue[] = [{ file: "x.ts" }];
      openChatChangesTab("ws-h", changes, "2 files changed", { messageId: "m-1" });
      const payload = findOpenTab()!.payload as { tab: Record<string, unknown> };
      expect(payload.tab).toMatchObject({
        type: "chat-changes",
        title: "2 files changed",
        data: { changes, title: "2 files changed", messageId: "m-1" },
      });
    });

    it("openLocalChangesTab dispatches openTab with the same shape as the middleware path", () => {
      openLocalChangesTab("ws-h");
      const payload = findOpenTab()!.payload as { tab: Record<string, unknown> };
      expect(payload.tab).toMatchObject({
        type: "local-changes",
        title: m.layout_presetExecutor_allChanges_title(),
      });
    });
  });
});
