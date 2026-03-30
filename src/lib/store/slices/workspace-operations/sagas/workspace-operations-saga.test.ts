import { beforeEach, describe, expect, it, vi } from "vitest";
import { testSaga } from "redux-saga-test-plan";
import * as sagaEffects from "redux-saga/effects";

vi.mock("typed-redux-saga", () => ({
  call: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.call(fn, ...args);
  },
  put: function* (action: any) {
    return yield sagaEffects.put(action);
  },
  select: function* (selector: any, ...args: any[]) {
    return yield sagaEffects.select(selector, ...args);
  },
  takeLatest: function* (pattern: any, saga: any) {
    return yield sagaEffects.takeLatest(pattern, saga);
  },
  delay: function* (ms: number) {
    return yield sagaEffects.delay(ms);
  },
}));

const { mockHasRunningAgents, mockGetRunningAgentNames, mockNavigateAfterWorkspaceRemoval, mockDeleteWithUndo, mockArchive, mockToast } = vi.hoisted(() => ({
  mockHasRunningAgents: vi.fn(() => false),
  mockGetRunningAgentNames: vi.fn(() => []),
  mockNavigateAfterWorkspaceRemoval: vi.fn(),
  mockDeleteWithUndo: vi.fn(),
  mockArchive: vi.fn(() => ({ ok: true })),
  mockToast: { warning: vi.fn(), error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

vi.mock("$lib/utils/delete-warning-utils", () => ({
  hasRunningAgents: mockHasRunningAgents,
  getRunningAgentNames: mockGetRunningAgentNames,
}));

vi.mock("$lib/utils/workspace-navigation", () => ({
  navigateAfterWorkspaceRemoval: mockNavigateAfterWorkspaceRemoval,
}));

vi.mock("$features/workspace/workspace.store.svelte", () => ({
  workspaceStore: {
    deleteWithUndo: mockDeleteWithUndo,
    archive: mockArchive,
    items: [],
  },
}));

vi.mock("svelte-sonner", () => ({
  toast: mockToast,
}));

vi.mock("$lib/electron-bridge", () => ({
  invoke: vi.fn(),
}));

vi.mock("$app/navigation", () => ({
  goto: vi.fn(),
}));

import type { Workspace } from "$shared/types";
import type { WorkspaceId } from "$shared/types/branded-ids";
import { navigateAfterWorkspaceRemoval } from "$lib/utils/workspace-navigation";
import {
  requestDeleteWorkspaceSaga,
  confirmDeleteWorkspaceSaga,
  requestArchiveWorkspaceSaga,
} from "./workspace-operations-saga";
import {
  requestDeleteWorkspace,
  requestArchiveWorkspace,
  openDeleteWarning,
  closeDeleteWarning,
} from "../workspace-operations-slice";
import { selectPendingDeleteWorkspace } from "../workspace-operations-selectors";

function makeWorkspace(id: string): Workspace {
  return {
    id: id as WorkspaceId,
    title: "Test Workspace",
    branch: "main",
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: "Active",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  } as Workspace;
}

describe("workspace-operations-saga navigate-away behavior", () => {
  const workspace = makeWorkspace("ws-123");

  beforeEach(() => {
    vi.clearAllMocks();
    mockHasRunningAgents.mockReturnValue(false);
    Object.defineProperty(window, "location", {
      value: { pathname: "/" },
      writable: true,
      configurable: true,
    });
  });

  describe("requestDeleteWorkspaceSaga", () => {
    it("calls navigateAfterWorkspaceRemoval when viewing the workspace", () => {
      Object.defineProperty(window, "location", {
        value: { pathname: `/workspace/${workspace.id}` },
        writable: true,
        configurable: true,
      });

      const action = requestDeleteWorkspace(workspace);
      const gen = requestDeleteWorkspaceSaga(action);

      // First yield: call(navigateAfterWorkspaceRemoval, workspace.id)
      const navEffect = gen.next().value as any;
      expect(navEffect.type).toBe("CALL");
      expect(navEffect.payload.fn).toBe(navigateAfterWorkspaceRemoval);
      expect(navEffect.payload.args).toEqual([workspace.id]);

      // Second yield: call(deleteWorkspaceWithUndo, workspace)
      const deleteEffect = gen.next().value as any;
      expect(deleteEffect.type).toBe("CALL");
      expect(deleteEffect.payload.args).toEqual([workspace]);

      // Done
      expect(gen.next().done).toBe(true);
    });

    it("does NOT call navigateAfterWorkspaceRemoval when not viewing the workspace", () => {
      Object.defineProperty(window, "location", {
        value: { pathname: "/workspace/other-id" },
        writable: true,
        configurable: true,
      });

      const action = requestDeleteWorkspace(workspace);
      const gen = requestDeleteWorkspaceSaga(action);

      // First yield: call(deleteWorkspaceWithUndo, workspace) — no navigation
      const deleteEffect = gen.next().value as any;
      expect(deleteEffect.type).toBe("CALL");
      expect(deleteEffect.payload.args).toEqual([workspace]);
      // Should NOT be navigateAfterWorkspaceRemoval
      expect(deleteEffect.payload.fn).not.toBe(navigateAfterWorkspaceRemoval);

      // Done
      expect(gen.next().done).toBe(true);
    });

    it("calls navigateAfterWorkspaceRemoval when viewing a sub-route of the workspace", () => {
      Object.defineProperty(window, "location", {
        value: { pathname: `/workspace/${workspace.id}/files` },
        writable: true,
        configurable: true,
      });

      const action = requestDeleteWorkspace(workspace);
      const gen = requestDeleteWorkspaceSaga(action);

      // First yield: call(navigateAfterWorkspaceRemoval, workspace.id)
      const navEffect = gen.next().value as any;
      expect(navEffect.type).toBe("CALL");
      expect(navEffect.payload.fn).toBe(navigateAfterWorkspaceRemoval);
      expect(navEffect.payload.args).toEqual([workspace.id]);

      // Second yield: call(deleteWorkspaceWithUndo, workspace)
      const deleteEffect = gen.next().value as any;
      expect(deleteEffect.type).toBe("CALL");
      expect(deleteEffect.payload.args).toEqual([workspace]);

      // Done
      expect(gen.next().done).toBe(true);
    });

    it("does NOT call navigateAfterWorkspaceRemoval for a workspace whose ID is a prefix of the current path", () => {
      Object.defineProperty(window, "location", {
        value: { pathname: `/workspace/${workspace.id}-other` },
        writable: true,
        configurable: true,
      });

      const action = requestDeleteWorkspace(workspace);
      const gen = requestDeleteWorkspaceSaga(action);

      // First yield: call(deleteWorkspaceWithUndo, workspace) — no navigation
      const deleteEffect = gen.next().value as any;
      expect(deleteEffect.type).toBe("CALL");
      expect(deleteEffect.payload.args).toEqual([workspace]);
      // Should NOT be navigateAfterWorkspaceRemoval
      expect(deleteEffect.payload.fn).not.toBe(navigateAfterWorkspaceRemoval);

      // Done
      expect(gen.next().done).toBe(true);
    });

    it("opens delete warning when workspace has running agents (no navigation)", () => {
      mockHasRunningAgents.mockReturnValue(true);
      mockGetRunningAgentNames.mockReturnValue(["Agent 1"]);
      Object.defineProperty(window, "location", {
        value: { pathname: `/workspace/${workspace.id}` },
        writable: true,
        configurable: true,
      });

      const action = requestDeleteWorkspace(workspace);

      testSaga(requestDeleteWorkspaceSaga, action)
        .next()
        .put(openDeleteWarning({ workspace, agentNames: ["Agent 1"] }))
        .next()
        .isDone();
    });
  });

  describe("confirmDeleteWorkspaceSaga", () => {
    it("calls navigateAfterWorkspaceRemoval when viewing the workspace", () => {
      Object.defineProperty(window, "location", {
        value: { pathname: `/workspace/${workspace.id}` },
        writable: true,
        configurable: true,
      });

      const gen = confirmDeleteWorkspaceSaga();

      // First yield: selectPendingDeleteWorkspace.effect()
      const selectEffect = gen.next().value as any;
      expect(selectEffect.type).toBe("SELECT");

      // Second yield: put(closeDeleteWarning()) — provide workspace from select
      const putEffect = gen.next(workspace).value as any;
      expect(putEffect.type).toBe("PUT");
      expect(putEffect.payload.action.type).toBe(closeDeleteWarning.type);

      // Third yield: call(navigateAfterWorkspaceRemoval, workspace.id)
      const navEffect = gen.next().value as any;
      expect(navEffect.type).toBe("CALL");
      expect(navEffect.payload.fn).toBe(navigateAfterWorkspaceRemoval);
      expect(navEffect.payload.args).toEqual([workspace.id]);

      // Fourth yield: call(deleteWorkspaceWithUndo, workspace)
      const deleteEffect = gen.next().value as any;
      expect(deleteEffect.type).toBe("CALL");
      expect(deleteEffect.payload.args).toEqual([workspace]);

      // Done
      expect(gen.next().done).toBe(true);
    });
  });

  describe("requestArchiveWorkspaceSaga", () => {
    it("calls navigateAfterWorkspaceRemoval when viewing the workspace", () => {
      Object.defineProperty(window, "location", {
        value: { pathname: `/workspace/${workspace.id}` },
        writable: true,
        configurable: true,
      });

      const action = requestArchiveWorkspace(workspace);
      const gen = requestArchiveWorkspaceSaga(action);

      // First yield: call(getToast)
      const toastEffect = gen.next().value as any;
      expect(toastEffect.type).toBe("CALL");

      // Second yield: call(navigateAfterWorkspaceRemoval, workspace.id)
      const navEffect = gen.next(mockToast).value as any;
      expect(navEffect.type).toBe("CALL");
      expect(navEffect.payload.fn).toBe(navigateAfterWorkspaceRemoval);
      expect(navEffect.payload.args).toEqual([workspace.id]);

      // Third yield: call([workspaceStore, workspaceStore.archive], workspace.id)
      const archiveEffect = gen.next().value as any;
      expect(archiveEffect.type).toBe("CALL");
    });

    it("does NOT call navigateAfterWorkspaceRemoval when not viewing the workspace", () => {
      Object.defineProperty(window, "location", {
        value: { pathname: "/workspace/other-id" },
        writable: true,
        configurable: true,
      });

      const action = requestArchiveWorkspace(workspace);
      const gen = requestArchiveWorkspaceSaga(action);

      // First yield: call(getToast)
      const toastEffect = gen.next().value as any;
      expect(toastEffect.type).toBe("CALL");

      // Second yield: call([workspaceStore, workspaceStore.archive], ...) — no navigation
      const archiveEffect = gen.next(mockToast).value as any;
      expect(archiveEffect.type).toBe("CALL");
      // Should NOT be navigateAfterWorkspaceRemoval
      expect(archiveEffect.payload.fn).not.toBe(navigateAfterWorkspaceRemoval);
    });
  });
});

