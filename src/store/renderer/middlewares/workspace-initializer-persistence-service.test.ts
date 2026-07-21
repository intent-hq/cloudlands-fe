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
import { createWorkspaceInitializerPersistenceMiddleware } from "./workspace-initializer-persistence-service";
import {
  setCompactWorkspaceInitializerFormState,
  setWorkspaceInitializerOnboardingFormState,
  debounceWorkspaceInitializerOnboardingFormState,
  cancelWorkspaceInitializerOnboardingFormStateDebounce,
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

// Sequential (explicit): the first test resolves the shared one-shot hydration gate that
// every later test depends on, so declaration-order execution is a hard requirement.
describe.sequential("workspace-initializer-persistence-service (PROTOCOL §5.12 workspaceInitializer.state)", () => {
  // Deferred hydration gate: hydration blocks on this promise regardless of which early
  // action triggers it, so the first (regression) test owns the in-flight window and
  // resolves it manually with the daemon bag the rest of the suite expects.
  let resolveHydration!: (value: unknown) => void;
  const hydrationGate = new Promise((resolve) => {
    resolveHydration = resolve;
  });

  beforeAll(() => {
    installMemoryLocalStorage();
    installMemorySessionStorage();

    // Set up daemon bag for hydration BEFORE store.init()
    getSpy.mockImplementation(() => hydrationGate);
    updateSpy.mockResolvedValue({ applied: [{ path: "workspaceInitializer.state", value: {} }] });

    // Store.init() triggers hydration on first dispatched action
    appStore.init();
  });

  beforeEach(async () => {
    await flush();
    mem.clear();
    memSession.clear();
    updateSpy.mockClear();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  // MUST run first: hydration is one-shot per store lifetime, and this test resolves the
  // hydration gate that every later test depends on.
  it("defers persists that race boot hydration and flushes the hydrated bag afterwards (regression)", async () => {
    // Persist-triggering dispatch while hydration is in flight — an empty recentRepos
    // during boot (e.g. RepoSelector loadRecentRepos) must not clobber the previously
    // persisted daemon bag with defaults. A second persist-triggering dispatch in the
    // same window proves queued persists coalesce into a single flush.
    appStore.dispatch(setWorkspaceInitializerRecentRepos([]));
    appStore.dispatch(setWorkspaceInitializerLastSelectedRepo({ path: "/boot", type: "local" }));
    await flush();

    // While hydration is in flight, no settings.update may reach the daemon.
    expect(appStore.state.workspaceInitializer.hydrated).toBe(false);
    expect(updateSpy).not.toHaveBeenCalled();

    resolveHydration({
      definition: { path: "workspaceInitializer.state", type: "object" },
      value: {
        lastSelectedRepo: { path: "/daemon/repo", type: "local" },
        compactFormState: { repoPath: "/compact" },
        recentRepos: [{ path: "/daemon/repo", type: "local", name: "repo" }],
      },
    });
    await flush();
    await flush();

    // The deferred persist flushes once after hydration and retains the previously
    // persisted lastSelectedRepo/recentRepos instead of pre-hydration defaults.
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith({
      changes: [
        {
          path: "workspaceInitializer.state",
          value: expect.objectContaining({
            lastSelectedRepo: { path: "/daemon/repo", type: "local" },
            recentRepos: [{ path: "/daemon/repo", type: "local", name: "repo" }],
          }),
        },
      ],
    });
  });

  it("drops queued persists when hydration fails instead of flushing defaults", async () => {
    // Fresh middleware instance (hydration is one-shot per instance) driven manually so
    // the shared appStore's own already-hydrated middleware is not involved.
    getSpy.mockRejectedValueOnce(new Error("daemon unavailable"));
    const invoke = createWorkspaceInitializerPersistenceMiddleware()({
      dispatch: (action: unknown) => action,
      getState: () => appStore.state,
    })((action: unknown) => action);
    updateSpy.mockClear();

    // Persist-triggering action while this instance's hydration is in flight
    invoke(setWorkspaceInitializerRecentRepos([]));
    await flush();
    await flush();

    // Hydration failed → the queued persist is dropped, never written to the daemon.
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("hydrates from daemon on store init and asserts settings.get request shape", async () => {
    // Dispatch an action to trigger hydration (middleware hydrates on first action)
    appStore.dispatch(setCompactWorkspaceInitializerFormState({ repoPath: "/init-test" }));
    await flush();
    await flush(); // Double flush to ensure async hydration completes

    // Assert settings.get was called with correct params (PROTOCOL §5.12)
    expect(getSpy).toHaveBeenCalledWith({ path: "workspaceInitializer.state" });

    // Verify hydration applied daemon values (compactFormState overwritten by the trigger action)
    expect(appStore.state.workspaceInitializer.hydrated).toBe(true);
    expect(appStore.state.workspaceInitializer.lastSelectedRepo).toEqual({
      path: "/daemon/repo",
      type: "local",
    });
  });

  // Note: Migration and daemon-failure-fallback scenarios would require separate store instances
  // to test properly, since the middleware's hasHydrated flag is closure-scoped and hydration runs
  // once per store lifetime. Those code paths exist and are type-safe but are not easily testable
  // in isolation within a single appStore test suite.

  it("persists state to daemon after actions", async () => {
    appStore.dispatch(
      setWorkspaceInitializerLastSelectedRepo({ path: "/test/repo", type: "local" }),
    );
    await flush();

    // Verify persistence worked (PROTOCOL §5.12 wire contract)
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

  it("sanitizes a non-structured-cloneable bag to plain JSON before settings.update (STAB DataCloneError regression)", async () => {
    // A Proxy mimics a Svelte $state proxy: structuredClone (used by IPC) throws
    // DataCloneError on it, but JSON round-tripping yields the plain target values.
    const proxiedRemoteSetup = new Proxy(
      {
        id: "remote-proxy",
        name: "Proxy Remote",
        host: "proxy.example.com",
        port: 22,
        username: "user",
        workspacePath: "/workspace",
      },
      {},
    ) as WorkspaceInitializerRemoteSetup;
    expect(() => structuredClone(proxiedRemoteSetup)).toThrow();

    appStore.dispatch(
      setCompactWorkspaceInitializerFormState({
        repoPath: "/proxy-repo",
        remoteSetup: proxiedRemoteSetup,
      }),
    );
    await flush();

    // Exact wire request per PROTOCOL §5.12: settings.update with the sanitized bag
    expect(updateSpy).toHaveBeenCalledWith({
      changes: [
        {
          path: "workspaceInitializer.state",
          value: expect.objectContaining({
            compactFormState: {
              repoPath: "/proxy-repo",
              remoteSetup: {
                id: "remote-proxy",
                name: "Proxy Remote",
                host: "proxy.example.com",
                port: 22,
                username: "user",
                workspacePath: "/workspace",
              },
            },
          }),
        },
      ],
    });

    // The persisted payload must itself be structured-cloneable (plain JSON, no proxies)
    const persistedBag = updateSpy.mock.calls.at(-1)?.[0].changes[0].value;
    expect(() => structuredClone(persistedBag)).not.toThrow();
  });

  it("skips the persist without throwing when the bag cannot be sanitized either", async () => {
    // Non-cloneable AND non-JSON-serializable: structuredClone throws on the Proxy
    // trap, and JSON.stringify throws on the circular reference inside the target.
    const circular: Record<string, unknown> = {
      id: "remote-circular",
      name: "Circular Remote",
      host: "circular.example.com",
      port: 22,
      username: "user",
      workspacePath: "/workspace",
    };
    circular.self = circular;
    const unsanitizable = new Proxy(circular, {}) as unknown as WorkspaceInitializerRemoteSetup;
    expect(() => structuredClone(unsanitizable)).toThrow();
    expect(() => JSON.stringify(unsanitizable)).toThrow();

    // The dispatch (and the persist it triggers) must not throw synchronously…
    expect(() =>
      appStore.dispatch(
        setCompactWorkspaceInitializerFormState({
          repoPath: "/circular-repo",
          remoteSetup: unsanitizable,
        }),
      ),
    ).not.toThrow();
    await flush();

    // …and no settings.update is sent for the unsanitizable bag.
    expect(updateSpy).not.toHaveBeenCalled();

    // Restore a sanitizable bag so later tests are unaffected.
    appStore.dispatch(setCompactWorkspaceInitializerFormState({ repoPath: "/recovered" }));
    await flush();
    expect(updateSpy).toHaveBeenCalled();
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

  it("debounces onboarding form drafts for 300ms before applying", async () => {
    getSpy.mockResolvedValue({
      definition: { path: "workspaceInitializer.state", type: "object" },
      value: {},
    });

    vi.useFakeTimers();
    updateSpy.mockClear();

    appStore.dispatch(
      debounceWorkspaceInitializerOnboardingFormState({
        projectSelection: { type: "local", repoPath: "/draft1" },
        step: "project",
      }),
    );

    // No immediate persistence
    expect(updateSpy).not.toHaveBeenCalled();

    // Advance 299ms — still not persisted
    await vi.advanceTimersByTimeAsync(299);
    expect(updateSpy).not.toHaveBeenCalled();

    // Advance 1ms more (total 300ms) — now persisted
    await vi.advanceTimersByTimeAsync(1);

    expect(updateSpy).toHaveBeenCalledWith({
      changes: [
        {
          path: "workspaceInitializer.state",
          value: expect.objectContaining({
            onboardingFormState: {
              projectSelection: { type: "local", repoPath: "/draft1" },
              step: "project",
            },
          }),
        },
      ],
    });

    vi.useRealTimers();
  });

  it("cancels debounced onboarding draft on cancelWorkspaceInitializerOnboardingFormStateDebounce", async () => {
    getSpy.mockResolvedValue({
      definition: { path: "workspaceInitializer.state", type: "object" },
      value: {},
    });

    vi.useFakeTimers();
    updateSpy.mockClear();

    appStore.dispatch(
      debounceWorkspaceInitializerOnboardingFormState({
        projectSelection: { type: "local", repoPath: "/draft" },
        step: "project",
      }),
    );

    await vi.advanceTimersByTimeAsync(100);
    appStore.dispatch(cancelWorkspaceInitializerOnboardingFormStateDebounce());
    await vi.advanceTimersByTimeAsync(300);

    // Draft was cancelled — no persistence
    expect(updateSpy).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("cancels debounced onboarding draft on resetOnboarding and persists null", async () => {
    getSpy.mockResolvedValue({
      definition: { path: "workspaceInitializer.state", type: "object" },
      value: {},
    });

    vi.useFakeTimers();
    updateSpy.mockClear();

    appStore.dispatch(
      debounceWorkspaceInitializerOnboardingFormState({
        projectSelection: { type: "local", repoPath: "/draft" },
        step: "project",
      }),
    );

    await vi.advanceTimersByTimeAsync(100);
    appStore.dispatch(resetOnboarding());
    await vi.advanceTimersByTimeAsync(10);

    // Draft cancelled, onboarding form cleared and persisted as null
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

    vi.useRealTimers();
  });
});
