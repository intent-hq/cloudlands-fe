import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// FAKE seams: the github-auth + external-editors IPC clients are stubbed so no
// daemon/IPC call happens. The lifecycle IPC middleware is registered in the
// REAL configured store, so dispatching each restored trigger exercises the
// wiring, cache guard, refresh dedup, and store convergence end to end.
vi.mock("$features/github-auth/renderer/github-auth.client", () => ({
  githubAuthClient: { listRepos: vi.fn(() => Promise.resolve([])) },
}));
vi.mock("$features/external-editors/external-editors.client", () => ({
  externalEditorsClient: { detectInstalled: vi.fn(() => Promise.resolve([])) },
}));
// FAKE seam: the raw IPC bridge is stubbed so `loadKnownRepos` exercises the
// invoke → setRepos wiring without a real daemon round-trip.
vi.mock(
  "$lib/electron-bridge",
  async () => await import("$store/renderer/utils/test-helpers/electron-bridge-mock"),
);

import { githubAuthClient } from "$features/github-auth/renderer/github-auth.client";
import { externalEditorsClient } from "$features/external-editors/external-editors.client";
import { invoke } from "$lib/electron-bridge";
import { store as appStore } from "$store/renderer/store";
import {
  loadGithubRepos,
  setGithubRepos,
} from "$store/renderer/slices/github-repos/github-repos-slice";
import {
  fetchEditors,
  fetchEditorsSuccess,
} from "$store/renderer/slices/external-editors/external-editors-slice";
import {
  loadKnownRepos,
  setRepos,
} from "$store/renderer/slices/known-repos/known-repos-slice";
import {
  addContextItem,
  initContextForWorkspace,
} from "$store/renderer/slices/context/context-slice";
import { selectContextItems } from "$store/renderer/slices/context/context-selectors";
import type { ContextItem } from "$features/context/types";
import { getItems } from "@augmentcode/ag-redux-toolkit/utils/collections/collection-utils";

type Fn = ReturnType<typeof vi.fn>;
const reposApi = githubAuthClient as unknown as { listRepos: Fn };
const editorsApi = externalEditorsClient as unknown as { detectInstalled: Fn };
const invokeMock = vi.mocked(invoke);
const getItemMock = window.localStorage.getItem as unknown as Fn;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const noteItem = (id: string): ContextItem => ({
  id,
  type: "note",
  title: id,
  provider: "internal",
  noteId: id,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const editor = (id: string) => ({
  id,
  name: id,
  shortLabel: id,
  appName: id,
  category: "ide" as const,
  handlerType: "generic" as const,
  priority: 1,
  installed: true,
});

describe("lifecycleIpcReadService (fake seams, real store)", () => {
  beforeAll(() => appStore.init());
  // Reset the editors cache to cold so each test controls the cache-guard state
  // (the real store is shared across tests in this file).
  beforeEach(() => appStore.dispatch(fetchEditorsSuccess([], 0)));
  afterEach(() => vi.clearAllMocks());

  it("loadGithubRepos fetches + maps repos into the collection", async () => {
    reposApi.listRepos.mockResolvedValueOnce([
      { owner: "acme", name: "web", default_branch: "main" },
    ] as never);

    appStore.dispatch(loadGithubRepos());
    await flush();

    expect(reposApi.listRepos).toHaveBeenCalledTimes(1);
    const repos = getItems(appStore.state.githubRepos.repos);
    expect(repos).toEqual([
      { id: "acme/web", owner: "acme", name: "web", defaultBranch: "main" },
    ]);
    expect(appStore.state.githubRepos.loaded).toBe(true);
    expect(appStore.state.githubRepos.error).toBeNull();
  });

  it("loadGithubRepos surfaces an error without clearing prior repos", async () => {
    appStore.dispatch(setGithubRepos([{ id: "a/b", owner: "a", name: "b" }]));
    reposApi.listRepos.mockRejectedValueOnce(new Error("boom") as never);

    appStore.dispatch(loadGithubRepos());
    await flush();

    expect(appStore.state.githubRepos.error).toBe("boom");
    expect(getItems(appStore.state.githubRepos.repos)).toHaveLength(1);
  });

  it("loadGithubRepos coalesces rapid dispatches into a single fetch", async () => {
    appStore.dispatch(loadGithubRepos());
    appStore.dispatch(loadGithubRepos());
    appStore.dispatch(loadGithubRepos());
    await flush();

    expect(reposApi.listRepos).toHaveBeenCalledTimes(1);
  });

  it("fetchEditors detects + stores installed editors", async () => {
    editorsApi.detectInstalled.mockResolvedValueOnce([editor("vscode")] as never);

    appStore.dispatch(fetchEditors());
    await flush();

    expect(editorsApi.detectInstalled).toHaveBeenCalledWith(false);
    expect(getItems(appStore.state.externalEditors.editors)).toHaveLength(1);
    expect(appStore.state.externalEditors.lastFetched).toBeGreaterThan(0);
  });

  it("fetchEditors skips the IPC call while the cache is fresh", async () => {
    editorsApi.detectInstalled.mockResolvedValueOnce([editor("vscode")] as never);
    appStore.dispatch(fetchEditors());
    await flush();
    expect(editorsApi.detectInstalled).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    appStore.dispatch(fetchEditors());
    await flush();
    expect(editorsApi.detectInstalled).not.toHaveBeenCalled();
  });

  it("fetchEditors(forceRefresh) re-detects even with a fresh cache", async () => {
    editorsApi.detectInstalled.mockResolvedValueOnce([editor("vscode")] as never);
    appStore.dispatch(fetchEditors());
    await flush();
    expect(editorsApi.detectInstalled).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    editorsApi.detectInstalled.mockResolvedValueOnce([editor("cursor")] as never);
    appStore.dispatch(fetchEditors(true));
    await flush();

    expect(editorsApi.detectInstalled).toHaveBeenCalledWith(true);
  });

  it("fetchEditors surfaces a detect failure via fetchEditorsFailure", async () => {
    editorsApi.detectInstalled.mockRejectedValueOnce(new Error("detect failed") as never);

    appStore.dispatch(fetchEditors(true));
    await flush();

    expect(appStore.state.externalEditors.error).toBe("detect failed");
    expect(appStore.state.externalEditors.loading).toBe(false);
  });

  it("loadKnownRepos stores the registry repos via setRepos", async () => {
    const repo = {
      path: "/repos/acme",
      name: "acme",
      addedAt: "2026-01-01T00:00:00.000Z",
      lastUsedAt: "2026-01-02T00:00:00.000Z",
    };
    invokeMock.mockResolvedValueOnce({ success: true, data: [repo] } as never);

    appStore.dispatch(loadKnownRepos());
    await flush();

    expect(invokeMock).toHaveBeenCalledWith("workspace:get-recent-repositories", {});
    expect(getItems(appStore.state.knownRepos.repos)).toEqual([repo]);
    expect(appStore.state.knownRepos.loaded).toBe(true);
  });

  it("loadKnownRepos falls back to an empty list when the IPC call fails", async () => {
    appStore.dispatch(setRepos([{ path: "/r", name: "r", addedAt: "x", lastUsedAt: "y" }]));
    invokeMock.mockRejectedValueOnce(new Error("ipc down") as never);

    appStore.dispatch(loadKnownRepos());
    await flush();

    expect(getItems(appStore.state.knownRepos.repos)).toEqual([]);
    expect(appStore.state.knownRepos.loaded).toBe(true);
  });

  it("loadKnownRepos falls back to an empty list on an unsuccessful response", async () => {
    invokeMock.mockResolvedValueOnce({ success: false } as never);

    appStore.dispatch(loadKnownRepos());
    await flush();

    expect(getItems(appStore.state.knownRepos.repos)).toEqual([]);
  });

  it("initContextForWorkspace hydrates items persisted in localStorage", async () => {
    const wsId = "ws-context-hydrate";
    // The global test-setup stubs window.localStorage with vi.fn()s; drive getItem
    // so safeLocalStorage.getJSON returns the persisted array.
    getItemMock.mockReturnValueOnce(JSON.stringify([noteItem("n1"), noteItem("n2")]));

    appStore.dispatch(initContextForWorkspace(wsId));
    await flush();

    expect(getItemMock).toHaveBeenCalledWith(`workspace:context:${wsId}`);
    expect(selectContextItems.select(appStore.state, wsId).map((i) => i.id)).toEqual([
      "n1",
      "n2",
    ]);
  });

  it("initContextForWorkspace is a no-op when no persisted context exists", async () => {
    const wsId = "ws-context-missing";
    getItemMock.mockReturnValueOnce(null);
    appStore.dispatch(addContextItem(wsId, noteItem("inmemory")));

    appStore.dispatch(initContextForWorkspace(wsId));
    await flush();

    expect(selectContextItems.select(appStore.state, wsId).map((i) => i.id)).toEqual([
      "inmemory",
    ]);
  });
});
