import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Fake the live backend transport so the settings seam routes settings.get/update
// through in-memory stubs (no Electron). `vi.hoisted` keeps spies visible
// to the hoisted vi.mock factory.
const { getSpy, updateSpy } = vi.hoisted(() => ({
  getSpy: vi.fn(),
  updateSpy: vi.fn(),
}));

vi.mock("$lib/client/live/backend-transport", () => ({
  backendRequest: (method: string, params?: unknown) => {
    if (method === "settings.get") return getSpy(params);
    if (method === "settings.update") return updateSpy(params);
    return Promise.resolve(undefined);
  },
  backendSubscribe: () => Promise.resolve({ subscriptionId: "sub-wi-1" }),
  backendUnsubscribe: () => Promise.resolve(),
  onBackendNotification: () => () => {},
  onBackendReconnected: () => () => {},
}));

import { store as appStore } from "$store/renderer/store";
import {
  setCompactWorkspaceInitializerFormState,
  setWorkspaceInitializerOnboardingFormState,
  setWorkspaceInitializerLastSelectedRepo,
  setWorkspaceInitializerRecentRepos,
  upsertWorkspaceInitializerRemoteSetup,
  removeWorkspaceInitializerRemoteSetup,
} from "../slices/workspace-initializer/workspace-initializer-slice";
import { resetOnboarding } from "../slices/onboarding/onboarding-slice";
import type {
  WorkspaceInitializerRecentRepo,
  WorkspaceInitializerRemoteSetup,
} from "../slices/workspace-initializer/workspace-initializer-types";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const mem = new Map<string, string>();
function installMemoryLocalStorage(): void {
  vi.mocked(window.localStorage.getItem).mockImplementation((key: string) => mem.get(key) ?? null);
  vi.mocked(window.localStorage.setItem).mockImplementation((key: string, value: string) => {
    mem.set(key, String(value));
  });
  vi.mocked(window.localStorage.removeItem).mockImplementation((key: string) => {
    mem.delete(key);
  });
}

const memSession = new Map<string, string>();
function installMemorySessionStorage(): void {
  // Create a fresh sessionStorage mock that backs to memSession
  const sessionStorageMock = {
    getItem: vi.fn((key: string) => memSession.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      memSession.set(key, String(value));
    }),
    removeItem: vi.fn((key: string) => {
      memSession.delete(key);
    }),
    clear: vi.fn(() => {
      memSession.clear();
    }),
  };
  Object.defineProperty(window, "sessionStorage", {
    value: sessionStorageMock,
    writable: true,
    configurable: true,
  });
}

describe("workspace-initializer-persistence-service (PROTOCOL §5.12 workspaceInitializer.state)", () => {
  beforeAll(() => {
    installMemoryLocalStorage();
    installMemorySessionStorage();
    appStore.init();
  });

  beforeEach(async () => {
    await flush();
    mem.clear();
    memSession.clear();
    getSpy.mockReset();
    updateSpy.mockReset();
    updateSpy.mockResolvedValue({ applied: [{ path: "workspaceInitializer.state", value: {} }] });
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  // Note: Hydration runs on first action after store init. The getSpy setup happens
  // too late to mock the boot hydration, so we focus on testing the persistence writes.

  it("persists state to daemon after actions", async () => {
    // Trigger hydration by dispatching any action
    appStore.dispatch(
      setWorkspaceInitializerLastSelectedRepo({ path: "/test/repo", type: "local" }),
    );
    await flush();

    // After the action, hydration completes and state is hydrated
    expect(appStore.state.workspaceInitializer.hydrated).toBe(true);

    // Verify persistence worked
    expect(updateSpy).toHaveBeenCalledWith({
      changes: [
        {
          path: "workspaceInitializer.state",
          value: expect.objectContaining({
            lastSelectedRepo: { path: "/test/repo", type: "local" },
          }),
        },
      ],
    });
  });

  it("persists state bag on setCompactWorkspaceInitializerFormState", async () => {
    appStore.dispatch(setCompactWorkspaceInitializerFormState({ repoPath: "/test" }));
    await flush();

    expect(updateSpy).toHaveBeenCalledWith({
      changes: [
        {
          path: "workspaceInitializer.state",
          value: expect.objectContaining({
            compactFormState: { repoPath: "/test" },
          }),
        },
      ],
    });
  });

  it("persists state bag on setWorkspaceInitializerLastSelectedRepo", async () => {
    appStore.dispatch(
      setWorkspaceInitializerLastSelectedRepo({ path: "/repo", type: "local" }),
    );
    await flush();

    expect(updateSpy).toHaveBeenCalledWith({
      changes: [
        {
          path: "workspaceInitializer.state",
          value: expect.objectContaining({
            lastSelectedRepo: { path: "/repo", type: "local" },
          }),
        },
      ],
    });
  });

  it("persists state bag on setWorkspaceInitializerRecentRepos", async () => {
    const repos: WorkspaceInitializerRecentRepo[] = [
      { path: "/repo1", type: "local", name: "repo1" },
      { path: "/repo2", type: "github", name: "repo2", owner: "test" },
    ];
    appStore.dispatch(setWorkspaceInitializerRecentRepos(repos));
    await flush();

    expect(updateSpy).toHaveBeenCalledWith({
      changes: [
        {
          path: "workspaceInitializer.state",
          value: expect.objectContaining({
            recentRepos: repos,
          }),
        },
      ],
    });
  });

  it("persists state bag on upsert/remove remote setup", async () => {
    const setup: WorkspaceInitializerRemoteSetup = {
      id: "remote-1",
      name: "Test Remote",
      host: "example.com",
      port: 22,
      username: "user",
      workspacePath: "/workspace",
    };

    appStore.dispatch(upsertWorkspaceInitializerRemoteSetup(setup));
    await flush();

    expect(updateSpy).toHaveBeenCalledWith({
      changes: [
        {
          path: "workspaceInitializer.state",
          value: expect.objectContaining({
            remoteSetups: [setup],
          }),
        },
      ],
    });

    updateSpy.mockClear();
    appStore.dispatch(removeWorkspaceInitializerRemoteSetup("remote-1"));
    await flush();

    expect(updateSpy).toHaveBeenCalledWith({
      changes: [
        {
          path: "workspaceInitializer.state",
          value: expect.objectContaining({
            remoteSetups: [],
          }),
        },
      ],
    });
  });

  it("persists onboarding form state directly via setWorkspaceInitializerOnboardingFormState", async () => {
    appStore.dispatch(
      setWorkspaceInitializerOnboardingFormState({
        projectSelection: { type: "local", repoPath: "/test" },
        step: "project",
      }),
    );
    await flush();

    expect(updateSpy).toHaveBeenCalledWith({
      changes: [
        {
          path: "workspaceInitializer.state",
          value: expect.objectContaining({
            onboardingFormState: {
              projectSelection: { type: "local", repoPath: "/test" },
              step: "project",
            },
          }),
        },
      ],
    });
  });

  it("clears onboarding form state and sessionStorage on resetOnboarding", async () => {
    memSession.set("onboarding-prompt", "test prompt");
    appStore.dispatch(
      setWorkspaceInitializerOnboardingFormState({
        projectSelection: { type: "local", repoPath: "/test" },
        step: "project",
      }),
    );
    await flush();
    updateSpy.mockClear();

    // Reset clears form and removes session key
    appStore.dispatch(resetOnboarding());
    await flush();

    expect(memSession.has("onboarding-prompt")).toBe(false);
    expect(appStore.state.workspaceInitializer.onboardingFormState).toBe(null);
    expect(updateSpy).toHaveBeenCalledWith({
      changes: [
        {
          path: "workspaceInitializer.state",
          value: expect.objectContaining({
            onboardingFormState: null,
          }),
        },
      ],
    });
  });
});
