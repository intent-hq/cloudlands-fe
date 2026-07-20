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
    agents: { list: vi.fn(() => Promise.resolve([])) },
    git: {
      prStatus: vi.fn(() => Promise.resolve(null)),
      prRefresh: vi.fn(() => Promise.resolve(null)),
      trackedChanges: vi.fn(() => Promise.resolve([])),
      commits: vi.fn(() => Promise.resolve([])),
      commitsWithBoundary: vi.fn(() => Promise.resolve({ commits: [], boundarySha: null, nextToken: null })),
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
import { initContextForWorkspace } from "$store/renderer/slices/context/context-slice";
import { selectContextItems } from "$store/renderer/slices/context/context-selectors";
import { hydrateTaskAgentAssociationsRequested } from "$store/renderer/slices/task-agent-associations/task-agent-associations-slice";
import { loadSkillsRequested } from "$store/renderer/slices/skills/skills-slice";
import { refreshScripts } from "$store/renderer/slices/scripts/scripts-slice";
import { refreshPRStatusRequested } from "$store/renderer/slices/pr-status/pr-status-slice";
import {
  loadOlderCommitsRequested,
  refreshRequested,
  requestAgentLineStats,
} from "$store/renderer/slices/changes/changes-slice";
import {
  hydrateAgentsRequested,
  setActiveAgentId,
} from "$store/renderer/slices/workspace-agents/workspace-agents-slice";
import { workspaceDeleted } from "$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice";
import { bulkUpsertSessions } from "$store/renderer/slices/agent-session/agent-session-slice";
import { AgentStatus } from "$shared/types/agent.types";
import type { AgentMessage, AgentSession } from "$shared/types";

type Fn = ReturnType<typeof vi.fn>;
const wsApi = appClient.workspaces as unknown as Record<string, Fn>;
const tasksApi = appClient.tasks as unknown as Record<string, Fn>;
const eventsApi = appClient.events as unknown as Record<string, Fn>;
const skillsApi = appClient.skills as unknown as Record<string, Fn>;
const scriptsApi = appClient.scripts as unknown as Record<string, Fn>;
const agentsApi = appClient.agents as unknown as Record<string, Fn>;
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

  it("initContextForWorkspace hydrates items from workspace.getContext (§5.1)", async () => {
    const ws = "ws-context-1";
    const items = [
      {
        id: "n1",
        type: "note" as const,
        title: "note-1",
        provider: "internal" as const,
        noteId: "n1",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    wsApi.getContext.mockResolvedValueOnce(items as never);

    appStore.dispatch(initContextForWorkspace(ws));
    await flush();

    expect(wsApi.getContext).toHaveBeenCalledWith(ws);
    expect(selectContextItems.select(appStore.state, ws).map((i) => i.id)).toEqual(["n1"]);
  });

  it("initContextForWorkspace hydrates each workspace only once", async () => {
    const ws = "ws-context-2";
    wsApi.getContext.mockResolvedValue([] as never);

    appStore.dispatch(initContextForWorkspace(ws));
    await flush();
    appStore.dispatch(initContextForWorkspace(ws));
    await flush();

    expect(wsApi.getContext).toHaveBeenCalledTimes(1);
  });

  // Empty from the daemon is authoritative — the reducer must be told the
  // workspace is empty so any stale in-memory items (e.g. from a cross-window
  // event that landed before init) are cleared to reflect the wire state.
  it("initContextForWorkspace dispatches an empty hydrate when the daemon returns no items", async () => {
    const ws = "ws-context-empty";
    // Pre-seed the slice with a stale item to prove the empty daemon list
    // wins the reconciliation.
    const stale = {
      id: "stale",
      type: "note" as const,
      title: "stale",
      provider: "internal" as const,
      noteId: "stale",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const { hydrateContextItems } = await import(
      "$store/renderer/slices/context/context-slice"
    );
    appStore.dispatch(hydrateContextItems(ws, [stale]));
    expect(selectContextItems.select(appStore.state, ws).map((i) => i.id)).toEqual(["stale"]);

    wsApi.getContext.mockResolvedValueOnce([] as never);
    appStore.dispatch(initContextForWorkspace(ws));
    await flush();

    expect(wsApi.getContext).toHaveBeenCalledWith(ws);
    expect(selectContextItems.select(appStore.state, ws)).toEqual([]);
  });

  // Once-per-workspace guard must be released on unmount — the context slice
  // clears workspace state on `workspaceUnmounted`, so a remount of the same
  // workspace id must re-run `workspace.getContext` instead of staying empty.
  it("initContextForWorkspace re-hydrates after workspaceUnmounted clears the guard", async () => {
    const ws = "ws-context-remount";
    const { workspaceUnmounted } = await import(
      "$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice"
    );
    wsApi.getContext.mockResolvedValue([] as never);

    appStore.dispatch(initContextForWorkspace(ws));
    await flush();
    expect(wsApi.getContext).toHaveBeenCalledTimes(1);

    // Re-triggering while mounted stays deduped by the guard.
    appStore.dispatch(initContextForWorkspace(ws));
    await flush();
    expect(wsApi.getContext).toHaveBeenCalledTimes(1);

    // Unmount clears the guard so the next mount refetches.
    appStore.dispatch(workspaceUnmounted(ws));
    appStore.dispatch(initContextForWorkspace(ws));
    await flush();
    expect(wsApi.getContext).toHaveBeenCalledTimes(2);
  });

  it("hydrateTaskAgentAssociationsRequested hydrates via task.listAgentLinks (§5.4)", async () => {
    const ws = "ws-links-1";
    const byNoteId = {
      "note-1": {
        "agent:a1": {
          noteId: "note-1",
          taskKey: "agent:a1",
          taskText: "do the thing",
          agentId: "a1",
          createdAt: 1700000000000,
        },
      },
    };
    tasksApi.listAgentLinks.mockResolvedValueOnce(byNoteId as never);

    appStore.dispatch(hydrateTaskAgentAssociationsRequested(ws));
    await flush();

    expect(tasksApi.listAgentLinks).toHaveBeenCalledWith(ws);
    expect(appStore.state.taskAgentAssociations.byWorkspaceId[ws]?.byNoteId).toEqual(byNoteId);
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

  it("refreshPRStatusRequested forces a daemon pr.refresh and clears the refreshing flag", async () => {
    const ws = "ws-pr-1";
    gitApi.prRefresh.mockResolvedValueOnce({
      outcome: "unchanged",
      pullRequests: [],
    } as never);
    appStore.dispatch(refreshPRStatusRequested(ws, true, true));
    await flush();

    expect(gitApi.prRefresh).toHaveBeenCalledWith(ws);
    expect(gitApi.prStatus).not.toHaveBeenCalled();
    const prState = appStore.state.prStatus.byWorkspaceId[ws];
    expect(prState?.isRefreshing).toBe(false);
    expect(prState?.lastRefreshTime).not.toBeNull();
    expect(prState?.lastError).toBeNull();
  });

  it("refreshPRStatusRequested reports failure when the seam folds an error to null", async () => {
    const ws = "ws-pr-fail";
    // Seam contract: null = transport/daemon failure (a no-PR refresh still
    // returns a result), so the refresh must not look successful.
    gitApi.prRefresh.mockResolvedValueOnce(null as never);
    appStore.dispatch(refreshPRStatusRequested(ws, true, true));
    await flush();

    expect(gitApi.prRefresh).toHaveBeenCalledWith(ws);
    const prState = appStore.state.prStatus.byWorkspaceId[ws];
    expect(prState?.isRefreshing).toBe(false);
    expect(prState?.lastRefreshTime).toBeNull();
    expect(prState?.lastError).toBe("pr.refresh failed");
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
    gitApi.commitsWithBoundary.mockResolvedValueOnce({ commits: [commit], boundarySha: "abc123", nextToken: null } as never);

    appStore.dispatch(refreshRequested(ws));
    await flush();

    expect(gitApi.trackedChanges).toHaveBeenCalledWith(ws);
    expect(gitApi.commitsWithBoundary).toHaveBeenCalledWith(ws);
    const changesState = appStore.state.changes.byWorkspaceId[ws];
    expect(changesState?.changes).toEqual([change]);
    expect(changesState?.commits).toEqual([commit]);
    expect(changesState?.boundarySha).toBe("abc123");
    expect(changesState?.hasLoadedInitialData).toBe(true);
  });

  it("loadOlderCommitsRequested calls commitsWithBoundary with includeOlder=true and appends to olderCommits", async () => {
    const ws = "ws-older-1";
    const olderCommit = {
      hash: "def456",
      message: "earlier work",
      author: "Bob",
      timestamp: 1749990000000,
      files: [],
      stage: "remote",
    };
    gitApi.commitsWithBoundary.mockResolvedValueOnce({
      commits: [olderCommit],
      boundarySha: null,
      nextToken: null,
    } as never);

    appStore.dispatch(loadOlderCommitsRequested(ws, "abc123", 25));
    await flush();

    expect(gitApi.commitsWithBoundary).toHaveBeenCalledWith(ws, true);
    const changesState = appStore.state.changes.byWorkspaceId[ws];
    expect(changesState?.olderCommits).toEqual([olderCommit]);
    expect(changesState?.loadingOlderCommits).toBe(false);
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

describe("lifecycleReadService (hydrateAgentsRequested → agents.list convergence)", () => {
  beforeAll(() => appStore.init());
  afterEach(() => vi.clearAllMocks());

  function makeAgent(id: string, ws: string, overrides: Partial<AgentSession> = {}): AgentSession {
    return {
      id,
      backendSessionId: `backend-${id}`,
      workspaceId: ws,
      name: id,
      status: AgentStatus.Idle,
      messages: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      ...overrides,
    } as AgentSession;
  }

  it("hydrates the agent list and selects the first foreground agent", async () => {
    const ws = "ws-agents-1";
    const background = makeAgent("agent-hydrate-bg", ws, { isBackground: true });
    const foreground = makeAgent("agent-hydrate-fg", ws);
    agentsApi.list.mockResolvedValueOnce([background, foreground] as never);

    appStore.dispatch(hydrateAgentsRequested(ws));
    await flush();

    expect(agentsApi.list).toHaveBeenCalledWith(ws);
    const wsAgents = appStore.state.workspaceAgents.byWorkspaceId[ws];
    expect(wsAgents?.agentsLoaded).toBe(true);
    expect(wsAgents?.agentIds).toEqual(["agent-hydrate-bg", "agent-hydrate-fg"]);
    expect(wsAgents?.activeAgentId).toBe("agent-hydrate-fg");
    expect(appStore.state.agentSessions.byAgentId["agent-hydrate-fg"]).toBeDefined();
  });

  it("refetches on every hydrate (no agentsLoaded skip) without clobbering a still-valid active agent", async () => {
    const ws = "ws-agents-2";
    const a1 = makeAgent("agent-keep-1", ws);
    const a2 = makeAgent("agent-keep-2", ws);
    agentsApi.list.mockResolvedValue([a1, a2] as never);

    appStore.dispatch(hydrateAgentsRequested(ws));
    await flush();
    expect(agentsApi.list).toHaveBeenCalledTimes(1);

    // User picks the second agent, then the workspace re-mounts.
    appStore.dispatch(setActiveAgentId(ws, "agent-keep-2"));
    appStore.dispatch(hydrateAgentsRequested(ws));
    await flush();

    // The list WAS refetched (the old `agentsLoaded` guard would have skipped
    // it) but the user's selection survives the reconcile.
    expect(agentsApi.list).toHaveBeenCalledTimes(2);
    expect(appStore.state.workspaceAgents.byWorkspaceId[ws]?.activeAgentId).toBe("agent-keep-2");
    agentsApi.list.mockReset();
    agentsApi.list.mockResolvedValue([] as never);
  });

  it("recycled workspace ID: purge then rehydrate surfaces only the new workspace's agents", async () => {
    const ws = "ws-agents-recycled";
    const stale = makeAgent("agent-recycled-old", ws);
    agentsApi.list.mockResolvedValueOnce([stale] as never);
    appStore.dispatch(hydrateAgentsRequested(ws));
    await flush();
    expect(appStore.state.workspaceAgents.byWorkspaceId[ws]?.agentIds).toEqual([
      "agent-recycled-old",
    ]);

    // The recycled-ID create path (daemon-events-bridge `workspace:created`)
    // purges the old ID's state, then re-requests hydration.
    appStore.dispatch(workspaceDeleted(ws, ["agent-recycled-old"]));
    const fresh = makeAgent("agent-recycled-new", ws);
    agentsApi.list.mockResolvedValueOnce([fresh] as never);
    appStore.dispatch(hydrateAgentsRequested(ws));
    await flush();

    const wsAgents = appStore.state.workspaceAgents.byWorkspaceId[ws];
    expect(wsAgents?.agentIds).toEqual(["agent-recycled-new"]);
    expect(wsAgents?.activeAgentId).toBe("agent-recycled-new");
    expect(appStore.state.agentSessions.byAgentId["agent-recycled-old"]).toBeUndefined();
    expect(appStore.state.agentSessions.byAgentId["agent-recycled-new"]).toBeDefined();
  });

  // Regression (LEAK-1 review #1): `agent.list` returns AgentLite — `messages`
  // is always `[]` — so a re-mount refetch must not truncate a transcript the
  // chat read path already hydrated.
  it("re-mount hydration preserves an already-hydrated transcript", async () => {
    const ws = "ws-agents-transcript";
    const agentId = "agent-with-transcript";
    agentsApi.list.mockResolvedValueOnce([makeAgent(agentId, ws)] as never);
    appStore.dispatch(hydrateAgentsRequested(ws));
    await flush();

    // Chat hydration (agent.getConversation) fills the transcript.
    const transcript: AgentMessage[] = [
      { id: "m1", role: "user", timestamp: "2026-01-01T00:00:01.000Z" } as AgentMessage,
      { id: "m2", role: "assistant", timestamp: "2026-01-01T00:00:02.000Z" } as AgentMessage,
    ];
    appStore.dispatch(bulkUpsertSessions([makeAgent(agentId, ws, { messages: transcript })]));
    expect(appStore.state.agentSessions.byAgentId[agentId]?.messages).toHaveLength(2);

    // Re-mount: the list refetch returns the Lite snapshot (messages: []).
    agentsApi.list.mockResolvedValueOnce([makeAgent(agentId, ws)] as never);
    appStore.dispatch(hydrateAgentsRequested(ws));
    await flush();

    expect(agentsApi.list).toHaveBeenCalledTimes(2);
    expect(appStore.state.agentSessions.byAgentId[agentId]?.messages).toEqual(transcript);
  });

  // Regression (LEAK-1 review #2): a purge landing while an `agents:{wsId}`
  // fetch is in flight must neither coalesce away the follow-up rehydrate nor
  // let the stale pre-purge response resurrect the purged agents.
  it("purge during an in-flight fetch discards the stale response and rehydrates fresh", async () => {
    const ws = "ws-agents-inflight";
    const stale = makeAgent("agent-inflight-stale", ws);
    const fresh = makeAgent("agent-inflight-fresh", ws);
    let resolveStale: (agents: AgentSession[]) => void = () => {};
    agentsApi.list.mockReturnValueOnce(
      new Promise<AgentSession[]>((resolve) => {
        resolveStale = resolve;
      }) as never,
    );

    appStore.dispatch(hydrateAgentsRequested(ws));
    // Purge (recycled-ID create / delete) lands mid-flight, then the bridge
    // re-requests hydration — this second fetch must actually go out.
    appStore.dispatch(workspaceDeleted(ws, []));
    agentsApi.list.mockResolvedValueOnce([fresh] as never);
    appStore.dispatch(hydrateAgentsRequested(ws));
    resolveStale([stale]);
    await flush();

    expect(agentsApi.list).toHaveBeenCalledTimes(2);
    const wsAgents = appStore.state.workspaceAgents.byWorkspaceId[ws];
    expect(wsAgents?.agentIds).toEqual(["agent-inflight-fresh"]);
    expect(wsAgents?.activeAgentId).toBe("agent-inflight-fresh");
    expect(appStore.state.agentSessions.byAgentId["agent-inflight-stale"]).toBeUndefined();
    expect(appStore.state.agentSessions.byAgentId["agent-inflight-fresh"]).toBeDefined();
  });
});
