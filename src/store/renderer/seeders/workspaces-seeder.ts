/**
 * Workspaces & layout seeder.
 *
 * Pulls the workspace list and recency data from the `AppClient` seam and
 * dispatches existing slice actions to populate the store so the home view,
 * sidebar, and workspace tabs render. The workspaces domain is now backed by the
 * live intentd daemon (the mock workspace fixtures were removed), so this seeder
 * hydrates the store from live data rather than from a mock.
 *
 * Also registers the renderer→main IPC mock handlers for the legacy
 * `workspace:open` / `workspace:list` / `workspace:get-recent-repositories`
 * channels that `workspace.client.ts` and LifecycleIpcReadService still invoke
 * (route loader, RepoSelector, and the known-repos hydration on app load).
 * With no real Electron main process driving this build, those channels would
 * otherwise reject with UnbridgedMockIpcChannelError. Each handler resolves
 * through the live daemon (AppClient seam `workspace.list` / `workspace.get`
 * per PROTOCOL §5.1, and `repo.list` per §5.6) and returns the CommandResponse
 * shape the legacy main-process handlers produced, so `workspace.client.ts`
 * `normalizeResponse` folds it into `{ ok: true, data }`.
 *
 * Workspace creation is NOT bridged here: `WorkspaceClient.create` calls
 * `appClient.workspaces.create` directly (PROTOCOL §5.1), so the legacy
 * `workspace:create` IPC channel has no consumer.
 */
import { registerMockIpcHandler } from "$shared/ipc-mock-router";
import { WORKSPACE_CHANNELS } from "$shared/ipc/channels";
import { appClient } from "$lib/client";
import { backendRequest } from "$lib/client/live/backend-transport";
import type { KnownRepo } from "$shared/types/known-repo";
import { WorkspaceStatus } from "$shared/types";
import { registerMockSeeder } from "../mock-bootstrap";
import {
  loadRecencyData,
  replaceWorkspaceList,
  setActiveWorkspaceId,
  setWorkspaceHasLoaded,
} from "../slices/workspace/workspace-slice";
import { openWorkspaceTab } from "../slices/tab-state/tab-state-slice";

/** Read the `id` (preferred) or `workspaceId` field off the route loader's open payload. */
function readWorkspaceOpenId(arg: unknown): string {
  const raw = (arg as { id?: unknown; workspaceId?: unknown } | undefined) ?? {};
  if (typeof raw.id === "string") return raw.id;
  if (typeof raw.workspaceId === "string") return raw.workspaceId;
  return "";
}

// Registered at import time (not inside the async seeder) so the route loader's
// `workspaceClient.open()` call resolves through the mock router before any
// component mounts, mirroring the same idiom agents-seeder uses for the
// AuggieSetupGate bootstrap probes.
registerMockIpcHandler(WORKSPACE_CHANNELS.OPEN, async (arg) => {
  const id = readWorkspaceOpenId(arg);
  if (!id) {
    return { success: false, error: "Workspace not found" };
  }
  const workspace = await appClient.workspaces.open(id);
  if (!workspace) {
    return { success: false, error: "Workspace not found" };
  }
  return { success: true, data: workspace };
});

// `workspace:get` — WorkspaceActionsMenu's "open in editor / reveal" path
// resolves worktreePath/repositoryPath through a one-off workspace read.
// Bridges to the daemon's `workspace.get` (PROTOCOL §5.1) through the
// AppClient seam; a missing workspace and transport failures both fold to
// the legacy `{ success:false, error }` envelope the caller's success-check
// already handles.
registerMockIpcHandler(WORKSPACE_CHANNELS.GET, async (arg) => {
  const id = readWorkspaceOpenId(arg);
  if (!id) {
    return { success: false, error: "Workspace not found" };
  }
  try {
    const workspace = await appClient.workspaces.get(id);
    if (!workspace) {
      return { success: false, error: "Workspace not found" };
    }
    return { success: true, data: workspace };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

// `workspace:list` — the RepoSelector recent-repo scan and every
// `workspaceClient.list()` read. The legacy handler returned the paginated
// `{ workspaces }` wrapper or a bare array; the bare array is returned here and
// `WorkspaceClient.list()` already handles both. The legacy `lite` flag is
// ignored: the daemon's `workspace.list` result is the only shape it serves.
registerMockIpcHandler(WORKSPACE_CHANNELS.LIST, async () => {
  const workspaces = await appClient.workspaces.list({ includeArchived: true });
  return { success: true, data: workspaces };
});

// `workspace:get-recent-repositories` — LifecycleIpcReadService's known-repos
// hydration, fired unconditionally on every app load. Bridges to the daemon's
// `repo.list` (PROTOCOL §5.11): the persistent known-repo registry, MRU-first,
// with the legacy handler's one-time workspace→registry sync performed
// daemon-side. Failures propagate as rejections — the caller keeps the prior
// known-repos list on error (mirrors the legacy safe-handler contract).
registerMockIpcHandler(WORKSPACE_CHANNELS.GET_RECENT_REPOSITORIES, async () => {
  const result = await backendRequest<{ repos: KnownRepo[] }>("repo.list");
  return { success: true, data: result.repos ?? [] };
});

// `workspace:remove-recent-repository` — the repositories list's "Remove"
// affordance for repos with no active spaces (confirmRemoveRepo → the
// workspace-operations middleware). Bridges to the daemon's `repo.remove`
// (PROTOCOL §5.11), which deletes the entry from the same persistent
// known-repo registry `repo.list` serves. Returns the legacy safe-handler
// envelope `{ success:true, data:{ removed } }`, with failures folded to
// `{ success:false, error }` so the caller surfaces them loud.
registerMockIpcHandler(WORKSPACE_CHANNELS.REMOVE_RECENT_REPOSITORY, async (arg) => {
  const repository = (arg as { repository?: unknown } | undefined)?.repository;
  if (typeof repository !== "string" || repository.length === 0) {
    return { success: false, error: "repository is required" };
  }
  try {
    const result = await backendRequest<{ removed: boolean }>("repo.remove", {
      path: repository,
    });
    return { success: true, data: { removed: result.removed === true } };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

// `workspace:update-settings` — workspace settings persistence middleware
// writes auto-commit state via this IPC channel. Bridge to the daemon's
// `workspace.updateSettings` (PROTOCOL §5.1). The middleware fires and forgets
// (no await), so rejections propagate as uncaught promises; return the legacy
// success envelope so it doesn't reject.
registerMockIpcHandler(WORKSPACE_CHANNELS.UPDATE_SETTINGS, async (arg) => {
  const payload = arg as { id?: unknown; settings?: unknown } | undefined;
  const id = typeof payload?.id === "string" ? payload.id : "";
  const settings = payload?.settings;
  if (!id || typeof settings !== "object" || settings === null) {
    return { success: false, error: "id and settings are required" };
  }
  try {
    await backendRequest("workspace.updateSettings", { id, settings });
    return { success: true, data: {} };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

registerMockSeeder("workspaces", async ({ store, client }) => {
  let workspaces;
  let recentViews;

  // Narrow error swallowing to the RPC boundaries only: if the daemon is down,
  // keep the UI functional with an empty list. Let unexpected in-process bugs
  // (reducer errors, bad data shapes) throw so they fail fast in tests/dev.
  try {
    workspaces = await client.workspaces.list({ includeArchived: true });
  } catch (error) {
    console.error("Workspaces seeder: client.workspaces.list() failed:", error);
    store.dispatch(setWorkspaceHasLoaded(true));
    return;
  }

  store.dispatch(replaceWorkspaceList(workspaces));
  store.dispatch(setWorkspaceHasLoaded(true));

  try {
    recentViews = await client.workspaces.recentViews();
  } catch (error) {
    console.error("Workspaces seeder: client.workspaces.recentViews() failed:", error);
    // Continue with empty recency data — the list is already loaded
    recentViews = {};
  }

  store.dispatch(loadRecencyData({ lastViewedAt: recentViews }));

  // Auto-select the first non-archived workspace (skip archived since they're hidden by default).
  // Fall back to workspaces[0] if all are archived (edge case).
  const firstWorkspace =
    workspaces.find((w) => w.status !== WorkspaceStatus.Archived) ?? workspaces[0];
  if (firstWorkspace) {
    // Only auto-select the first workspace if BOTH activeWorkspaceId AND currentTabId
    // are unset (fresh boot). If either is already set (e.g. by route loader on reload),
    // skip auto-selection entirely to avoid clobbering route-driven state.
    const { workspace, tabState } = store.state;
    const hasActiveWorkspace = workspace.activeWorkspaceId !== null;
    const hasCurrentTab = tabState.currentTabId !== null;

    if (!hasActiveWorkspace && !hasCurrentTab) {
      store.dispatch(setActiveWorkspaceId(firstWorkspace.id));
      store.dispatch(openWorkspaceTab(firstWorkspace.id));
    }
  }
});
