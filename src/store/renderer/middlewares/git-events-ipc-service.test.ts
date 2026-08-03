import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

// Use vi.hoisted to ensure mocks are available before module resolution
const {
  mockAppStore,
  mockState,
  mockIsElectron,
  mockNavigateToRoute,
  mockToastSuccess,
  mockToastError,
} = vi.hoisted(() => {
    const mockState: {
      workspace: {
        activeWorkspaceId: string | null;
        workspaces: { map: Record<string, { id: string; title?: string }> };
      };
      globalModals: { gitCredentials: { shownForWorkspaceIds: Record<string, boolean> } };
    } = {
      workspace: { activeWorkspaceId: "ws-1", workspaces: { map: {} } },
      globalModals: { gitCredentials: { shownForWorkspaceIds: {} } },
    };
    return {
      mockState,
      mockAppStore: { state: mockState, dispatch: vi.fn() },
      mockIsElectron: vi.fn(() => true),
      mockNavigateToRoute: vi.fn(() => Promise.resolve()),
      mockToastSuccess: vi.fn(),
      mockToastError: vi.fn(),
    };
  });

vi.mock("$store/renderer/store", () => ({
  store: mockAppStore,
}));

vi.mock("$lib/electron-bridge", () => ({
  isElectron: mockIsElectron,
}));

vi.mock("$lib/utils/navigation.client", () => ({
  navigateToRoute: mockNavigateToRoute,
  isHudWindowRenderer: () => false,
}));

vi.mock("svelte-sonner", () => ({
  toast: {
    success: mockToastSuccess,
    error: mockToastError,
  },
}));

// Import after mocking
import { createGitEventsIpcMiddleware } from "./git-events-ipc-service";
import { setLastGitOperation, setLastGitError } from "../slices/git/git-slice";
import {
  openGitCredentialsModal,
  openGitHubAuthModal,
} from "../slices/global-modals/global-modals-slice";

describe("createGitEventsIpcMiddleware", () => {
  let mockOn: ReturnType<typeof vi.fn>;
  let next: ReturnType<typeof vi.fn>;

  const initMiddleware = () => {
    const middleware = createGitEventsIpcMiddleware();
    return middleware({} as any)(next);
  };

  const getHandler = (channel: string) => {
    const call = mockOn.mock.calls.find(([ch]) => ch === channel);
    expect(call, `expected a listener for ${channel}`).toBeDefined();
    return call![1] as (data?: unknown) => Promise<void> | void;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsElectron.mockReturnValue(true);
    mockState.workspace.activeWorkspaceId = "ws-1";
    mockState.workspace.workspaces.map = {
      "ws-1": { id: "ws-1", title: "Alpha" },
      "ws-2": { id: "ws-2", title: "Beta" },
    };
    mockState.globalModals.gitCredentials.shownForWorkspaceIds = {};
    next = vi.fn((action) => action);
    mockOn = vi.fn(() => "listener-id-123");
    (window as any).electronAPI = { on: mockOn };
  });

  afterEach(() => {
    delete (window as any).electronAPI;
  });

  it("registers listeners for all git event channels on creation", () => {
    initMiddleware();

    expect(mockOn).toHaveBeenCalledWith("git:op-completed", expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith("git:op-failed", expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith("git:auth-required", expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith("github:auth-required", expect.any(Function));
  });

  it("does not register listeners outside Electron", () => {
    mockIsElectron.mockReturnValue(false);
    initMiddleware();

    expect(mockOn).not.toHaveBeenCalled();
  });

  it("passes through all actions", () => {
    const middlewareChain = initMiddleware();

    const action = { type: "test/action" };
    const result = middlewareChain(action);

    expect(result).toBe(action);
    expect(next).toHaveBeenCalledWith(action);
  });

  describe("git:op-completed", () => {
    it("dispatches setLastGitOperation and shows a success toast", async () => {
      initMiddleware();

      const event = { workspaceId: "ws-1", operationType: "commit", result: { commitHash: "abc" } };
      await getHandler("git:op-completed")(event);

      expect(mockAppStore.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: setLastGitOperation.type }),
      );
      expect(mockToastSuccess).toHaveBeenCalledWith('✅ Changes committed in "Alpha"', {
        duration: 5000,
      });
    });

    it("adds an Open action for cross-workspace events and navigates on click", async () => {
      initMiddleware();

      await getHandler("git:op-completed")({ workspaceId: "ws-2", operationType: "push" });

      expect(mockToastSuccess).toHaveBeenCalledWith('✅ Changes pushed in "Beta"', {
        duration: 5000,
        action: { label: "Open", onClick: expect.any(Function) },
      });
      await mockToastSuccess.mock.calls[0][1].action.onClick();
      expect(mockNavigateToRoute).toHaveBeenCalledWith("/workspace/ws-2");
    });

    it("includes the PR number and title for create-pr", async () => {
      initMiddleware();

      await getHandler("git:op-completed")({
        workspaceId: "ws-1",
        operationType: "create-pr",
        result: { prNumber: 42 },
        metadata: { prTitle: "My PR" },
      });

      expect(mockToastSuccess).toHaveBeenCalledWith('✅ PR #42 created in "Alpha"', {
        duration: 5000,
        description: "My PR",
      });
    });

    it("suppresses the toast for no-change commits and auto-commits", async () => {
      initMiddleware();

      await getHandler("git:op-completed")({
        workspaceId: "ws-1",
        operationType: "commit",
        result: { noChanges: true },
      });
      await getHandler("git:op-completed")({
        workspaceId: "ws-1",
        operationType: "auto-commit",
        result: { noChanges: true },
      });

      expect(mockToastSuccess).not.toHaveBeenCalled();
      expect(mockAppStore.dispatch).toHaveBeenCalledTimes(2);
    });

    it('falls back to "Space" when the workspace is unknown', async () => {
      initMiddleware();

      await getHandler("git:op-completed")({ workspaceId: "ws-x", operationType: "commit" });

      expect(mockToastSuccess).toHaveBeenCalledWith('✅ Changes committed in "Space"', {
        duration: 5000,
        action: { label: "Open", onClick: expect.any(Function) },
      });
    });

    it("ignores events without data", async () => {
      initMiddleware();

      await getHandler("git:op-completed")(undefined);

      expect(mockAppStore.dispatch).not.toHaveBeenCalled();
      expect(mockToastSuccess).not.toHaveBeenCalled();
    });

    it("swallows toast failures", async () => {
      mockToastSuccess.mockImplementation(() => {
        throw new Error("toast unavailable");
      });
      initMiddleware();

      await expect(
        getHandler("git:op-completed")({ workspaceId: "ws-1", operationType: "commit" }),
      ).resolves.toBeUndefined();
      expect(mockAppStore.dispatch).toHaveBeenCalledTimes(1);
    });
  });

  describe("git:op-failed", () => {
    it("dispatches setLastGitError but suppresses the toast when viewing the failing workspace", async () => {
      initMiddleware();

      await getHandler("git:op-failed")({
        workspaceId: "ws-1",
        operationType: "push",
        error: "remote rejected",
      });

      expect(mockAppStore.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: setLastGitError.type }),
      );
      expect(mockToastError).not.toHaveBeenCalled();
    });

    it("shows an error toast with an Open action for cross-workspace failures", async () => {
      initMiddleware();

      await getHandler("git:op-failed")({
        workspaceId: "ws-2",
        operationType: "commit",
        error: "boom",
      });

      expect(mockToastError).toHaveBeenCalledWith('❌ Commit failed in "Beta"', {
        description: "boom",
        duration: 10000,
        action: { label: "Open", onClick: expect.any(Function) },
      });
      await mockToastError.mock.calls[0][1].action.onClick();
      expect(mockNavigateToRoute).toHaveBeenCalledWith("/workspace/ws-2");
    });

    it("shows auto-commit failures even in the failing workspace", async () => {
      initMiddleware();

      await getHandler("git:op-failed")({
        workspaceId: "ws-1",
        operationType: "auto-commit",
        error: "conflict",
      });

      expect(mockToastError).toHaveBeenCalledWith('❌ Auto-commit failed in "Alpha"', {
        description: "conflict",
        duration: 10000,
      });
    });

    it("suppresses hook-related auto-commit failures", async () => {
      initMiddleware();

      await getHandler("git:op-failed")({
        workspaceId: "ws-2",
        operationType: "auto-commit",
        error: "pre-commit hook failed",
      });

      expect(mockToastError).not.toHaveBeenCalled();
      expect(mockAppStore.dispatch).toHaveBeenCalledTimes(1);
    });

    it("truncates long error descriptions to 200 characters", async () => {
      initMiddleware();

      const longError = "e".repeat(250);
      await getHandler("git:op-failed")({
        workspaceId: "ws-2",
        operationType: "push",
        error: longError,
      });

      const { description } = mockToastError.mock.calls[0][1];
      expect(description).toBe("e".repeat(200) + "…");
    });

    it("ignores events without data", async () => {
      initMiddleware();

      await getHandler("git:op-failed")(undefined);

      expect(mockAppStore.dispatch).not.toHaveBeenCalled();
    });
  });

  describe("git:auth-required", () => {
    it("opens the git credentials modal", () => {
      initMiddleware();

      getHandler("git:auth-required")({
        workspaceId: "ws-1",
        message: "auth needed",
        operation: "push",
        command: "git push",
        cwd: "/repo",
        rawError: "fatal: auth",
      });

      expect(mockAppStore.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: openGitCredentialsModal.type,
          payload: [
            {
              workspaceId: "ws-1",
              message: "auth needed",
              operation: "push",
              command: "git push",
              cwd: "/repo",
              rawError: "fatal: auth",
            },
          ],
        }),
      );
    });

    it("dedupes per workspace when the modal was already shown", () => {
      mockState.globalModals.gitCredentials.shownForWorkspaceIds = { "ws-1": true };
      initMiddleware();

      getHandler("git:auth-required")({
        workspaceId: "ws-1",
        message: "auth needed",
        operation: "push",
      });

      expect(mockAppStore.dispatch).not.toHaveBeenCalled();
    });

    it("does not dedupe events without a workspaceId", () => {
      mockState.globalModals.gitCredentials.shownForWorkspaceIds = { "ws-1": true };
      initMiddleware();

      getHandler("git:auth-required")({ message: "auth needed", operation: "fetch" });

      expect(mockAppStore.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: openGitCredentialsModal.type }),
      );
    });

    it("ignores events without data", () => {
      initMiddleware();

      getHandler("git:auth-required")(undefined);

      expect(mockAppStore.dispatch).not.toHaveBeenCalled();
    });
  });

  describe("github:auth-required", () => {
    it("opens the GitHub auth modal with the event payload", () => {
      initMiddleware();

      const event = { workspaceId: "ws-1", operation: "create-pr", message: "GitHub auth needed" };
      getHandler("github:auth-required")(event);

      expect(mockAppStore.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: openGitHubAuthModal.type,
          payload: [event],
        }),
      );
    });

    it("ignores events without data", () => {
      initMiddleware();

      getHandler("github:auth-required")(undefined);

      expect(mockAppStore.dispatch).not.toHaveBeenCalled();
    });
  });
});
