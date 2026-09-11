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
import { registerMockIpcHandler } from '$shared/ipc-mock-router';
import { WORKSPACE_CHANNELS } from '$shared/ipc/channels';
import { appClient } from '$lib/client';
import { workspaceClient } from '../slices/workspace/utils/workspace.client';
import { backendRequest } from '$lib/client/live/backend-transport';
import { readSetting, updateSettings } from '$lib/client/live/live-settings-client';
import type { KnownRepo } from '$shared/types/known-repo';
import { isDaemonManagedCheckoutPath } from '$shared/utils/daemon-managed-checkout';
import type { Workspace } from '$shared/types';
import { WorkspaceStatus } from '$shared/types';
import { registerMockSeeder } from '../mock-bootstrap';
import {
  loadRecencyData,
  replaceWorkspaceList,
  setWorkspaceHasLoaded,
} from '../slices/workspace/workspace-slice';
import { getActiveBackendId } from '../utils/backend-storage-namespace';
import { openWorkspaceTab } from '../slices/tab-state/tab-state-slice';

/** Read the `id` (preferred) or `workspaceId` field off the route loader's open payload. */
function readWorkspaceOpenId(arg: unknown): string {
  const raw = (arg as { id?: unknown; workspaceId?: unknown } | undefined) ?? {};
  if (typeof raw.id === 'string') return raw.id;
  if (typeof raw.workspaceId === 'string') return raw.workspaceId;
  return '';
}

// Registered at import time (not inside the async seeder) so the route loader's
// `workspaceClient.open()` call resolves through the mock router before any
// component mounts, mirroring the same idiom agents-seeder uses for the
// AuggieSetupGate bootstrap probes.
registerMockIpcHandler(WORKSPACE_CHANNELS.OPEN, async (arg) => {
  const id = readWorkspaceOpenId(arg);
  if (!id) {
    return { success: false, error: 'Workspace not found' };
  }
  const workspace = await appClient.workspaces.open(id);
  if (!workspace) {
    return { success: false, error: 'Workspace not found' };
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
    return { success: false, error: 'Workspace not found' };
  }
  try {
    const workspace = await appClient.workspaces.get(id);
    if (!workspace) {
      return { success: false, error: 'Workspace not found' };
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

// Path-less GitHub picks (githubUrl, no local checkout) are persisted in the
// daemon-owned `repos.known` setting (PROTOCOL §5.12) — the daemon's
// `repo.list` registry is keyed on local paths, so these entries live beside
// it and are merged into the recents read below. Mirrors the legacy
// main-process repo-registry, which persists through the same setting.
const REPOS_KNOWN_SETTING = 'repos.known';

async function readReposKnownSetting(): Promise<KnownRepo[]> {
  try {
    const setting = await readSetting(REPOS_KNOWN_SETTING);
    return Array.isArray(setting?.value) ? (setting.value as KnownRepo[]) : [];
  } catch {
    // Non-fatal: recents still serve the daemon repo.list registry.
    return [];
  }
}

// `workspace:get-recent-repositories` — LifecycleIpcReadService's known-repos
// hydration, fired unconditionally on every app load. Bridges to the daemon's
// `repo.list` (PROTOCOL §5.11): the persistent known-repo registry, MRU-first,
// with the legacy handler's one-time workspace→registry sync performed
// daemon-side, merged with path-less GitHub picks from `repos.known`.
// Daemon-managed cache/clone checkouts are internal paths, never
// user-pickable repos — they are excluded from the list. Failures of the
// `repo.list` read propagate as rejections — the caller keeps the prior
// known-repos list on error (mirrors the legacy safe-handler contract).
registerMockIpcHandler(WORKSPACE_CHANNELS.GET_RECENT_REPOSITORIES, async () => {
  const result = await backendRequest<{ repos: KnownRepo[] }>('repo.list');
  const repos = (result.repos ?? []).filter((repo) => !isDaemonManagedCheckoutPath(repo.path));
  const githubPicks = (await readReposKnownSetting()).filter((repo) => !!repo.githubUrl);
  const merged = [
    ...githubPicks,
    ...repos.filter((repo) => !githubPicks.some((pick) => pick.path === repo.path)),
  ].sort((a, b) => (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? ''));
  return { success: true, data: merged };
});

// `workspace:add-recent-repository` — registers a repo as recently used.
// Path-less GitHub picks (the Pick-a-repo flow) carry a `githubUrl` and use
// the owner/repo shorthand as their key; entries upsert into the `repos.known`
// setting. Failures fold to `{ success:false, error }` (callers fire and
// forget with a logged warning).
registerMockIpcHandler(WORKSPACE_CHANNELS.ADD_RECENT_REPOSITORY, async (arg) => {
  const payload = arg as
    { repository?: unknown; name?: unknown; owner?: unknown; githubUrl?: unknown } | undefined;
  const repository = typeof payload?.repository === 'string' ? payload.repository : '';
  if (!repository) {
    return { success: false, error: 'repository is required' };
  }
  try {
    const existing = await readReposKnownSetting();
    const now = new Date().toISOString();
    const name =
      typeof payload?.name === 'string' && payload.name
        ? payload.name
        : repository.split('/').pop() || 'Unknown';
    const owner = typeof payload?.owner === 'string' ? payload.owner : undefined;
    const githubUrl = typeof payload?.githubUrl === 'string' ? payload.githubUrl : undefined;
    const index = existing.findIndex((repo) => repo.path === repository);
    if (index >= 0) {
      existing[index] = {
        ...existing[index],
        name,
        owner: owner ?? existing[index].owner,
        githubUrl: githubUrl ?? existing[index].githubUrl,
        lastUsedAt: now,
      };
    } else {
      existing.push({ path: repository, name, owner, githubUrl, addedAt: now, lastUsedAt: now });
    }
    await updateSettings([{ path: REPOS_KNOWN_SETTING, value: existing }]);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
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
  if (typeof repository !== 'string' || repository.length === 0) {
    return { success: false, error: 'repository is required' };
  }
  try {
    // `repo.remove` runs first so a daemon hiccup there fails the whole call
    // before any state changed; only then is a matching path-less GitHub pick
    // dropped from the `repos.known` setting (those entries live beside the
    // daemon's repo.list registry, not in it).
    const result = await backendRequest<{ removed: boolean }>('repo.remove', {
      path: repository,
    });
    const githubPicks = await readReposKnownSetting();
    const remaining = githubPicks.filter((repo) => repo.path !== repository);
    const removedFromSetting = remaining.length !== githubPicks.length;
    if (removedFromSetting) {
      await updateSettings([{ path: REPOS_KNOWN_SETTING, value: remaining }]);
    }
    return {
      success: true,
      data: { removed: result.removed === true || removedFromSetting },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

// `workspace:update-settings` — workspace settings persistence saga writes
// per-workspace auto-commit state via this IPC channel. Bridge to the daemon's
// `workspace.setAutoCommit` (PROTOCOL §5.1) — the per-workspace override only;
// the global `git.autoCommit` setting is never written from here. Resolve the
// legacy CommandResponse envelope (matching the Electron main handler) instead
// of rejecting; the saga worker inspects `success` and logs failures.
registerMockIpcHandler(WORKSPACE_CHANNELS.UPDATE_SETTINGS, async (arg) => {
  const payload = arg as { id?: unknown; settings?: { autoCommitEnabled?: unknown } } | undefined;
  const id = typeof payload?.id === 'string' ? payload.id : '';
  const enabled = payload?.settings?.autoCommitEnabled;
  if (!id || typeof enabled !== 'boolean') {
    return { success: false, error: 'id and settings.autoCommitEnabled are required' };
  }
  try {
    await backendRequest('workspace.setAutoCommit', { workspaceId: id, enabled });
    return { success: true, data: {} };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

registerMockSeeder('workspaces', async ({ store, client, workspaceId, getWorkspaceId }) => {
  let workspaces: Workspace[] = [];
  let recentViews: Record<string, number> = {};

  // Narrow error swallowing to the RPC boundaries only: if the daemon is down,
  // keep the UI functional with an empty list. Let unexpected in-process bugs
  // (reducer errors, bad data shapes) throw so they fail fast in tests/dev.
  try {
    const result = await workspaceClient.list({ lite: true });
    if (!result.ok) throw new Error(result.error);
    workspaces = result.data;
  } catch (error) {
    console.error('Workspaces seeder: client.workspaces.list() failed:', error);
    // Clear any stale workspaces from a previous seeding attempt (dev/HMR/tests)
    store.dispatch(replaceWorkspaceList([]));
    store.dispatch(setWorkspaceHasLoaded(true, getActiveBackendId(store.state)));
    return;
  }

  store.dispatch(replaceWorkspaceList(workspaces));
  store.dispatch(setWorkspaceHasLoaded(true, getActiveBackendId(store.state)));

  try {
    recentViews = await client.workspaces.recentViews();
  } catch (error) {
    console.error('Workspaces seeder: client.workspaces.recentViews() failed:', error);
    // Continue with empty recency data — the list is already loaded
    recentViews = {};
  }

  store.dispatch(loadRecencyData({ lastViewedAt: recentViews }));

  // Auto-select the first non-archived workspace (skip archived since they're hidden by default).
  // Fall back to workspaces[0] if all are archived (edge case).
  const firstWorkspace =
    workspaces.find((w) => w.status !== WorkspaceStatus.Archived) ?? workspaces[0];
  if (firstWorkspace) {
    // Only auto-select the first workspace if both the explicit route context and
    // current tab are unset (fresh boot). Re-read route context after deferred RPCs
    // because the initial context may be a startup snapshot.
    const { tabState } = store.state;
    const hasActiveWorkspace = (getWorkspaceId?.() ?? workspaceId) !== null;
    const hasCurrentTab = tabState.currentTabId !== null;

    if (!hasActiveWorkspace && !hasCurrentTab) {
      store.dispatch(openWorkspaceTab(firstWorkspace.id));
    }
  }
});
