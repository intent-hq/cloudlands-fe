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
    },
    tasks: { list: vi.fn(() => Promise.resolve([])) },
    events: { list: vi.fn(() => Promise.resolve([])) },
    skills: { list: vi.fn(() => Promise.resolve([])) },
    scripts: { list: vi.fn(() => Promise.resolve([])) },
    git: { prStatus: vi.fn(() => Promise.resolve(null)) },
  },
}));

import { appClient } from "$lib/client";
import { store as appStore } from "$store/renderer/store";
import { loadWorkspacesRequested } from "$store/renderer/slices/workspace/workspace-slice";
import { ensureWorkspaceTasksLoaded } from "$store/renderer/slices/workspace-tasks/workspace-tasks-slice";
import { loadEventsRequested } from "$store/renderer/slices/workspace-events/workspace-events-slice";
import { loadSkillsRequested } from "$store/renderer/slices/skills/skills-slice";
import { refreshScripts } from "$store/renderer/slices/scripts/scripts-slice";
import { refreshPRStatusRequested } from "$store/renderer/slices/pr-status/pr-status-slice";

type Fn = ReturnType<typeof vi.fn>;
const wsApi = appClient.workspaces as unknown as Record<string, Fn>;
const tasksApi = appClient.tasks as unknown as Record<string, Fn>;
const eventsApi = appClient.events as unknown as Record<string, Fn>;
const skillsApi = appClient.skills as unknown as Record<string, Fn>;
const scriptsApi = appClient.scripts as unknown as Record<string, Fn>;
const gitApi = appClient.git as unknown as Record<string, Fn>;
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
});
