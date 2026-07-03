import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// FAKE seam: appClient.* reads are stubbed so no daemon call (and never a
// mutation) happens. The lifecycle middleware is already registered in the REAL
// configured store, so dispatching each restored Cluster C trigger exercises the
// wiring, refresh dedup, and store convergence end to end. READ-ONLY: only the
// list/status reads the boot seeders use are stubbed.
vi.mock("$lib/client", () => ({
  appClient: {
    workspaces: {
      list: vi.fn(() => Promise.resolve([])),
      recentViews: vi.fn(() => Promise.resolve({})),
      getTokenUsage: vi.fn(() => Promise.resolve(null)),
    },
    tasks: { list: vi.fn(() => Promise.resolve([])) },
    events: { list: vi.fn(() => Promise.resolve([])) },
    skills: { list: vi.fn(() => Promise.resolve([])) },
    scripts: { list: vi.fn(() => Promise.resolve([])) },
    git: {
      prStatus: vi.fn(() => Promise.resolve(null)),
      trackedChanges: vi.fn(() => Promise.resolve([])),
      commits: vi.fn(() => Promise.resolve([])),
    },
  },
}));

// FAKE §5.20 metrics seam: `metrics.getAgentStats` reads go through the
// line-changes client; mock it so no backendRequest reaches a daemon.
vi.mock("$features/line-changes/line-changes.client", () => ({
  getAgentLineStats: vi.fn(() => Promise.resolve(null)),
}));

import { appClient } from "$lib/client";
import { getAgentLineStats } from "$features/line-changes/line-changes.client";
import { store as appStore } from "$store/renderer/store";
import { loadWorkspacesRequested } from "$store/renderer/slices/workspace/workspace-slice";
import { ensureWorkspaceTasksLoaded } from "$store/renderer/slices/workspace-tasks/workspace-tasks-slice";
import { loadEventsRequested } from "$store/renderer/slices/workspace-events/workspace-events-slice";
import { fetchWorkspaceTokenUsage } from "$store/renderer/slices/token-usage/token-usage-slice";
import { loadSkillsRequested } from "$store/renderer/slices/skills/skills-slice";
import { refreshScripts } from "$store/renderer/slices/scripts/scripts-slice";
import { refreshPRStatusRequested } from "$store/renderer/slices/pr-status/pr-status-slice";
import {
  refreshRequested,
  requestAgentLineStats,
} from "$store/renderer/slices/changes/changes-slice";

type Fn = ReturnType<typeof vi.fn>;
const wsApi = appClient.workspaces as unknown as Record<string, Fn>;
const tasksApi = appClient.tasks as unknown as Record<string, Fn>;
const eventsApi = appClient.events as unknown as Record<string, Fn>;
const skillsApi = appClient.skills as unknown as Record<string, Fn>;
const scriptsApi = appClient.scripts as unknown as Record<string, Fn>;
const gitApi = appClient.git as unknown as Record<string, Fn>;
const mockedGetAgentLineStats = vi.mocked(getAgentLineStats);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("lifecycleReadService (fake seam, real store)", () => {
  beforeAll(() => appStore.init());
  afterEach(() => vi.clearAllMocks());

  it("loadWorkspacesRequested refetches the list + recency via the seam", async () => {
    appStore.dispatch(loadWorkspacesRequested());
    await flush();

    expect(wsApi.list).toHaveBeenCalledTimes(1);
    expect(wsApi.recentViews).toHaveBeenCalledTimes(1);
    expect(appStore.state.workspace.hasLoaded).toBe(true);
  });

  it("ensureWorkspaceTasksLoaded fetches tasks and marks the workspace initialized", async () => {
    const ws = "ws-tasks-1";
    appStore.dispatch(ensureWorkspaceTasksLoaded(ws));
    await flush();

    expect(tasksApi.list).toHaveBeenCalledWith(ws);
    expect(appStore.state.workspaceTasks.byWorkspaceId[ws]?.initialized).toBe(true);
  });

  it("ensureWorkspaceTasksLoaded is a no-op once the workspace is initialized", async () => {
    const ws = "ws-tasks-2";
    appStore.dispatch(ensureWorkspaceTasksLoaded(ws));
    await flush();
    expect(tasksApi.list).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    appStore.dispatch(ensureWorkspaceTasksLoaded(ws));
    await flush();
    expect(tasksApi.list).not.toHaveBeenCalled();
  });

  it("loadEventsRequested refetches the workspace event stream via the seam", async () => {
    const ws = "ws-events-1";
    appStore.dispatch(loadEventsRequested(ws));
    await flush();

    expect(eventsApi.list).toHaveBeenCalledWith(ws);
  });

  it("fetchWorkspaceTokenUsage stores the daemon rollup (workspace.getTokenUsage, §5.23)", async () => {
    const ws = "ws-token-1";
    // PROTOCOL §5.23 TokenUsage shape.
    const tokenUsage = {
      byAgentId: {
        "agent-123": { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheCreationTokens: 4 },
      },
      totals: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheCreationTokens: 4 },
      byModel: {
        "opus-4.8": { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheCreationTokens: 4 },
      },
      lastScanAt: "2026-06-17T12:00:00Z",
    };
    wsApi.getTokenUsage.mockResolvedValueOnce(tokenUsage as never);

    appStore.dispatch(fetchWorkspaceTokenUsage(ws));
    await flush();

    expect(wsApi.getTokenUsage).toHaveBeenCalledWith(ws);
    expect(appStore.state.tokenUsage.byWorkspaceId[ws]).toEqual({
      ...tokenUsage,
      isStale: false,
    });
  });

  it("fetchWorkspaceTokenUsage marks cached numbers stale when the read fails", async () => {
    const ws = "ws-token-2";
    const tokenUsage = {
      byAgentId: {},
      totals: { inputTokens: 5, outputTokens: 6, cacheReadTokens: 7, cacheCreationTokens: 8 },
      byModel: {},
      lastScanAt: "2026-06-17T12:00:00Z",
    };
    wsApi.getTokenUsage.mockResolvedValueOnce(tokenUsage as never);
    appStore.dispatch(fetchWorkspaceTokenUsage(ws));
    await flush();

    wsApi.getTokenUsage.mockRejectedValueOnce(new Error("boom") as never);
    appStore.dispatch(fetchWorkspaceTokenUsage(ws));
    await flush();

    expect(appStore.state.tokenUsage.byWorkspaceId[ws]).toEqual({
      ...tokenUsage,
      isStale: true,
    });
  });

  it("loadSkillsRequested refetches the workspace skills via the seam", async () => {
    const ws = "ws-skills-1";
    appStore.dispatch(loadSkillsRequested(ws));
    await flush();

    expect(skillsApi.list).toHaveBeenCalledWith(ws);
  });

  it("refreshScripts refetches scripts and marks the workspace initialized", async () => {
    const ws = "ws-scripts-1";
    appStore.dispatch(refreshScripts(ws));
    await flush();

    expect(scriptsApi.list).toHaveBeenCalledWith(ws);
    expect(appStore.state.scripts.byWorkspaceId[ws]?.initialized).toBe(true);
  });

  it("refreshPRStatusRequested re-runs the PR status read and clears the refreshing flag", async () => {
    const ws = "ws-pr-1";
    appStore.dispatch(refreshPRStatusRequested(ws, true, true));
    await flush();

    expect(gitApi.prStatus).toHaveBeenCalledWith(ws);
    const prState = appStore.state.prStatus.byWorkspaceId[ws];
    expect(prState?.isRefreshing).toBe(false);
    expect(prState?.lastRefreshTime).not.toBeNull();
  });

  it("coalesces rapid refreshes for the same workspace into a single fetch", async () => {
    const ws = "ws-scripts-coalesce";
    appStore.dispatch(refreshScripts(ws));
    appStore.dispatch(refreshScripts(ws));
    appStore.dispatch(refreshScripts(ws));
    await flush();

    expect(scriptsApi.list).toHaveBeenCalledTimes(1);
  });

  it("leaves prior state intact when a read fails", async () => {
    const ws = "ws-events-fail";
    eventsApi.list.mockRejectedValueOnce(new Error("boom") as never);

    appStore.dispatch(loadEventsRequested(ws));
    await flush();

    expect(eventsApi.list).toHaveBeenCalledWith(ws);
  });

  // Restored changes-panel refresh: reads the daemon file-tracking surface
  // (§5.19 file-tracking.getChanges / loadCommits) through the git seam.
  it("refreshRequested re-fetches tracked changes + commits and converges the changes slice", async () => {
    const ws = "ws-changes-1";
    const change = {
      id: "git-1-src/x.ts",
      file: "/ws/src/x.ts",
      relativePath: "src/x.ts",
      stage: "committed",
      status: "modified",
      stats: { additions: 10, deletions: 2 },
      attribution: { manual: true, timestamp: 1750000000000 },
    };
    const commit = {
      hash: "abc123",
      message: "init",
      author: "Ada",
      timestamp: 1750000000000,
      files: [],
      stage: "local",
    };
    gitApi.trackedChanges.mockResolvedValueOnce([change] as never);
    gitApi.commits.mockResolvedValueOnce([commit] as never);

    appStore.dispatch(refreshRequested(ws));
    await flush();

    expect(gitApi.trackedChanges).toHaveBeenCalledWith(ws);
    expect(gitApi.commits).toHaveBeenCalledWith(ws);
    const changesState = appStore.state.changes.byWorkspaceId[ws];
    expect(changesState?.changes).toEqual([change]);
    expect(changesState?.commits).toEqual([commit]);
    expect(changesState?.boundarySha).toBe("abc123");
    expect(changesState?.hasLoadedInitialData).toBe(true);
  });

  // §5.20 agent line stats: requestAgentLineStats → metrics.getAgentStats via
  // the line-changes client, folded into agentStats + request state.
  it("requestAgentLineStats fetches metrics.getAgentStats and stores agent stats", async () => {
    const agentId = "agent-stats-1";
    mockedGetAgentLineStats.mockResolvedValueOnce({
      additions: 140,
      deletions: 12,
      filesChanged: 3,
    });

    appStore.dispatch(requestAgentLineStats(agentId));
    await flush();

    expect(mockedGetAgentLineStats).toHaveBeenCalledWith(agentId);
    expect(appStore.state.changes.agentStats[agentId]).toMatchObject({
      additions: 140,
      deletions: 12,
    });
    const request = appStore.state.changes.agentLineStatsRequests[agentId];
    expect(request?.isLoading).toBe(false);
    expect(request?.error).toBeNull();
    expect(request?.lastFinishedAt).not.toBeNull();
  });

  it("requestAgentLineStats skips a refetch when stats exist, unless forceRefresh", async () => {
    const agentId = "agent-stats-2";
    mockedGetAgentLineStats.mockResolvedValue({ additions: 1, deletions: 1, filesChanged: 1 });

    appStore.dispatch(requestAgentLineStats(agentId));
    await flush();
    expect(mockedGetAgentLineStats).toHaveBeenCalledTimes(1);

    appStore.dispatch(requestAgentLineStats(agentId));
    await flush();
    expect(mockedGetAgentLineStats).toHaveBeenCalledTimes(1);

    appStore.dispatch(requestAgentLineStats(agentId, true));
    await flush();
    expect(mockedGetAgentLineStats).toHaveBeenCalledTimes(2);
    mockedGetAgentLineStats.mockReset();
    mockedGetAgentLineStats.mockResolvedValue(null);
  });

  it("requestAgentLineStats folds a failed read into the request error state", async () => {
    const agentId = "agent-stats-fail";
    mockedGetAgentLineStats.mockRejectedValueOnce(new Error("metrics boom"));

    appStore.dispatch(requestAgentLineStats(agentId));
    await flush();

    const request = appStore.state.changes.agentLineStatsRequests[agentId];
    expect(request?.isLoading).toBe(false);
    expect(request?.error).toBe("metrics boom");
    expect(appStore.state.changes.agentStats[agentId]).toBeUndefined();
  });
});
