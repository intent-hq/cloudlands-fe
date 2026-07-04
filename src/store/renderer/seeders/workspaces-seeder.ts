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
 * `workspace:open` / `workspace:list` / `workspace:create` /
 * `workspace:get-recent-repositories` channels that `workspace.client.ts` and
 * LifecycleIpcReadService still invoke (route loader, RepoSelector, the
 * workspace-creation flow in CompactWorkspaceInitializer / OnboardingPage /
 * AcceptChangesPanel, and the known-repos hydration on app load). With no real
 * Electron main process driving this build, those channels would otherwise
 * reject with UnbridgedMockIpcChannelError. Each handler resolves through the
 * live daemon (AppClient seam `workspace.list` / `workspace.create` /
 * `workspace.get` per PROTOCOL §5.1, and `repo.list` per §5.6) and returns the
 * CommandResponse shape the legacy main-process handlers produced, so
 * `workspace.client.ts` `normalizeResponse` folds it into `{ ok: true, data }`.
 */
import { registerMockIpcHandler } from "$shared/ipc-mock-router";
import { WORKSPACE_CHANNELS } from "$shared/ipc/channels";
import { appClient } from "$lib/client";
import { backendRequest } from "$lib/client/live/backend-transport";
import type { CreateWorkspaceRequest } from "$shared/types";
import type { KnownRepo } from "$shared/types/known-repo";
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
  const workspaces = await appClient.workspaces.list();
  return { success: true, data: workspaces };
});

// `workspace:create` — the workspace-creation flow (CompactWorkspaceInitializer,
// OnboardingPage, AcceptChangesPanel). Callers need the created Workspace back
// (`result.data.id` drives navigation), so the seam surfaces the daemon's
// `{ workspace }` result. A success without a workspace is a wire divergence
// from PROTOCOL §5.1 and fails loud rather than handing callers `undefined`.
registerMockIpcHandler(WORKSPACE_CHANNELS.CREATE, async (arg) => {
  const result = await appClient.workspaces.create(arg as CreateWorkspaceRequest);
  if (!result.success) {
    return { success: false, error: result.error || "Failed to create workspace" };
  }
  if (!result.workspace) {
    return {
      success: false,
      error: "workspace.create returned no workspace (PROTOCOL §5.1 divergence)",
    };
  }
  return { success: true, data: result.workspace };
});

// `workspace:get-recent-repositories` — LifecycleIpcReadService's known-repos
// hydration, fired unconditionally on every app load. Bridges to the daemon's
// `repo.list` (PROTOCOL §5.6): the persistent known-repo registry, MRU-first,
// with the legacy handler's one-time workspace→registry sync performed
// daemon-side. Failures propagate as rejections — the caller keeps the prior
// known-repos list on error (mirrors the legacy safe-handler contract).
registerMockIpcHandler(WORKSPACE_CHANNELS.GET_RECENT_REPOSITORIES, async () => {
  const result = await backendRequest<{ repos: KnownRepo[] }>("repo.list");
  return { success: true, data: result.repos ?? [] };
});

registerMockSeeder("workspaces", async ({ store, client }) => {
  const workspaces = await client.workspaces.list();

  store.dispatch(replaceWorkspaceList(workspaces));
  store.dispatch(setWorkspaceHasLoaded(true));

  const recentViews = await client.workspaces.recentViews();
  store.dispatch(loadRecencyData({ lastViewedAt: recentViews }));

  const firstWorkspace = workspaces[0];
  if (firstWorkspace) {
    store.dispatch(setActiveWorkspaceId(firstWorkspace.id));
    store.dispatch(openWorkspaceTab(firstWorkspace.id));
  }
});
