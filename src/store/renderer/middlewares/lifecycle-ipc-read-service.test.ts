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
// FAKE seam: AcceptChangesClient.getStatus is stubbed so `refreshAcceptChangesStatus`
// exercises the getStatus → setPostMergeState wiring without a daemon round-trip.
vi.mock("$features/accept-changes/accept-changes.client", () => ({
  AcceptChangesClient: { getStatus: vi.fn() },
}));
// FAKE seam: the AppClient-backed reads the `workspaceMounted` fan-out re-triggers
// (tasks/events/scripts/skills/PR status/agents/terminals/file-explorer) are stubbed
// so the fan-out test stays hermetic.
vi.mock("$lib/client", () => ({
  appClient: {
    workspaces: {
      list: vi.fn(() => Promise.resolve([])),
      recentViews: vi.fn(() => Promise.resolve({})),
      getContext: vi.fn(() => Promise.resolve([])),
      updateContext: vi.fn(() => Promise.resolve([])),
    },
    tasks: {
      list: vi.fn(() => Promise.resolve([])),
      listAgentLinks: vi.fn(() => Promise.resolve({})),
      linkAgent: vi.fn(() => Promise.resolve(null)),
      unlinkAgent: vi.fn(() => Promise.resolve(false)),
    },
    events: { list: vi.fn(() => Promise.resolve([])) },
    skills: { list: vi.fn(() => Promise.resolve([])) },
    scripts: { list: vi.fn(() => Promise.resolve([])) },
    git: {
      prStatus: vi.fn(() => Promise.resolve(null)),
      // Default to a benign no-PR refresh result; null means transport failure.
      prRefresh: vi.fn(() => Promise.resolve({ outcome: "unchanged", pullRequests: [] })),
    },
    agents: { list: vi.fn(() => Promise.resolve([])) },
    terminals: { list: vi.fn(() => Promise.resolve({ terminals: [], daemonBootId: "boot-test" })) },
    files: {
      explorerTree: vi.fn(() => Promise.resolve(null)),
      gitStatusMap: vi.fn(() => Promise.resolve({})),
    },
  },
}));

import { githubAuthClient } from "$features/github-auth/renderer/github-auth.client";
import { externalEditorsClient } from "$features/external-editors/external-editors.client";
import { AcceptChangesClient } from "$features/accept-changes/accept-changes.client";
import { appClient } from "$lib/client";
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
import { refreshAcceptChangesStatus } from "$store/renderer/slices/changes/changes-slice";
import { setPostMergeState } from "$store/renderer/slices/git/git-slice";
import { workspaceMounted } from "$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice";
import type { WorkspaceGitStatus } from "$features/accept-changes/types";
import { getItems } from "$lib/store-shim/utils/collections/collection-utils";

type Fn = ReturnType<typeof vi.fn>;
const reposApi = githubAuthClient as unknown as { listRepos: Fn };
const editorsApi = externalEditorsClient as unknown as { detectInstalled: Fn };
const acceptApi = AcceptChangesClient as unknown as { getStatus: Fn };
const invokeMock = vi.mocked(invoke);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

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

const gitStatus = (overrides: Partial<WorkspaceGitStatus> = {}): WorkspaceGitStatus => ({
  branch: "feature",
  trunkBranch: "main",
  aheadOfTrunk: 3,
  behindTrunk: 1,
  hasRemote: true,
  isPushed: false,
  uncommittedCount: 0,
  stagedCount: 0,
  localCommits: [],
  canMergeDirectly: true,
  hasConflicts: false,
  hasDivergedFromRemote: false,
  isContentMergedToTrunk: true,
  ...overrides,
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

  it("loadKnownRepos keeps the prior repos intact when the IPC call fails", async () => {
    const prior = { path: "/r", name: "r", addedAt: "x", lastUsedAt: "y" };
    appStore.dispatch(setRepos([prior]));
    invokeMock.mockRejectedValueOnce(new Error("ipc down") as never);

    appStore.dispatch(loadKnownRepos());
    await flush();

    expect(getItems(appStore.state.knownRepos.repos)).toEqual([prior]);
    expect(appStore.state.knownRepos.loaded).toBe(true);
  });

  it("loadKnownRepos keeps the prior repos intact on an unsuccessful response", async () => {
    const prior = { path: "/r", name: "r", addedAt: "x", lastUsedAt: "y" };
    appStore.dispatch(setRepos([prior]));
    invokeMock.mockResolvedValueOnce({ success: false } as never);

    appStore.dispatch(loadKnownRepos());
    await flush();

    expect(getItems(appStore.state.knownRepos.repos)).toEqual([prior]);
  });

  it("refreshAcceptChangesStatus fetches getStatus and merges trunk fields into postMergeState", async () => {
    const wsId = "ws-accept-merge";
    acceptApi.getStatus.mockResolvedValueOnce(
      gitStatus({ aheadOfTrunk: 5, behindTrunk: 2, hasConflicts: true, hasRemote: false }) as never,
    );

    appStore.dispatch(refreshAcceptChangesStatus(wsId));
    await flush();

    expect(acceptApi.getStatus).toHaveBeenCalledWith(wsId);
    expect(appStore.state.git.byWorkspaceId[wsId].postMergeState).toEqual({
      aheadOfTrunk: 5,
      behindTrunk: 2,
      hasConflicts: true,
      isContentMergedToTrunk: true,
      hasRemote: false,
      isMergedToTrunk: false,
      mergeHeadSha: null,
      hasResetToTrunk: false,
    });
  });

  it("refreshAcceptChangesStatus resets trunk fields on failure but preserves session fields", async () => {
    const wsId = "ws-accept-fail";
    appStore.dispatch(
      setPostMergeState(wsId, {
        aheadOfTrunk: 9,
        behindTrunk: 4,
        hasConflicts: true,
        isContentMergedToTrunk: true,
        hasRemote: true,
        isMergedToTrunk: true,
        mergeHeadSha: "abc123",
        hasResetToTrunk: true,
      }),
    );
    acceptApi.getStatus.mockRejectedValueOnce(new Error("status boom") as never);

    appStore.dispatch(refreshAcceptChangesStatus(wsId));
    await flush();

    expect(appStore.state.git.byWorkspaceId[wsId].postMergeState).toEqual({
      aheadOfTrunk: null,
      behindTrunk: 0,
      hasConflicts: false,
      isContentMergedToTrunk: false,
      hasRemote: true,
      isMergedToTrunk: true,
      mergeHeadSha: "abc123",
      hasResetToTrunk: true,
    });
  });

  it("refreshAcceptChangesStatus coalesces rapid dispatches into a single fetch", async () => {
    const wsId = "ws-accept-coalesce";
    acceptApi.getStatus.mockResolvedValue(gitStatus() as never);

    appStore.dispatch(refreshAcceptChangesStatus(wsId));
    appStore.dispatch(refreshAcceptChangesStatus(wsId));
    appStore.dispatch(refreshAcceptChangesStatus(wsId));
    await flush();

    expect(acceptApi.getStatus).toHaveBeenCalledTimes(1);
  });

  it("workspaceMounted fans out to every per-workspace hydration trigger", async () => {
    const wsId = "ws-mounted-fanout";
    acceptApi.getStatus.mockResolvedValue(gitStatus() as never);
    const tasksApi = appClient.tasks as unknown as { list: Fn; listAgentLinks: Fn };
    const workspacesApi = appClient.workspaces as unknown as { getContext: Fn };
    const eventsApi = appClient.events as unknown as { list: Fn };
    const skillsApi = appClient.skills as unknown as { list: Fn };
    const scriptsApi = appClient.scripts as unknown as { list: Fn };
    const gitApi = appClient.git as unknown as { prStatus: Fn; prRefresh: Fn };
    const agentsApi = appClient.agents as unknown as { list: Fn };
    const terminalsApi = appClient.terminals as unknown as { list: Fn };
    const filesApi = appClient.files as unknown as {
      explorerTree: Fn;
      gitStatusMap: Fn;
    };

    appStore.dispatch(workspaceMounted(wsId));
    await flush();

    // Fresh mount fans out to every restored per-workspace handler across the
    // lifecycle read services, the file-explorer read service, and (via the
    // new hydrate*Requested triggers) the agents / terminals reads — proven by
    // each downstream seam being invoked for this workspace. `loadWorkspaceData
    // Requested` has no live handler yet (backend-gated); asserting its
    // downstream fetch would be premature, so the fan-out test does not gate
    // on it.
    expect(tasksApi.list).toHaveBeenCalledWith(wsId);
    expect(eventsApi.list).toHaveBeenCalledWith(wsId);
    expect(acceptApi.getStatus).toHaveBeenCalledWith(wsId);
    expect(scriptsApi.list).toHaveBeenCalledWith(wsId);
    expect(skillsApi.list).toHaveBeenCalledWith(wsId);
    expect(gitApi.prRefresh).toHaveBeenCalledWith(wsId);
    expect(agentsApi.list).toHaveBeenCalledWith(wsId);
    expect(terminalsApi.list).toHaveBeenCalledWith(wsId);
    expect(filesApi.explorerTree).toHaveBeenCalledWith(wsId);
    // Daemon-backed context + task↔agent linkage hydration (§5.1 / §5.4).
    expect(workspacesApi.getContext).toHaveBeenCalledWith(wsId);
    expect(tasksApi.listAgentLinks).toHaveBeenCalledWith(wsId);
  });
});
