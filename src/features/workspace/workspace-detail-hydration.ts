/**
 * On-demand `workspace.get` hydration for slim `workspace.list` rows.
 *
 * `workspace.list` rows carry only the fields list-context UI renders
 * (PROTOCOL §5.1): `setupScript`, `contextLinks`, `diskUsage`,
 * `diffSummary.files`, `tokenUsage` and per-PR `headSha`/`author` are
 * detail-only, and the `pullRequests` pool is capped (with
 * `pullRequestsTotal` announcing the full size when truncated). Readers that
 * need one of those fields call the helpers here instead of trusting the
 * stored row: the read is single-flighted per workspace (one in-flight
 * `workspace.get` shared by every caller, including the panel-layout saga)
 * and applied through `setWorkspaceEntity(..., { detailRead: true })`, which
 * takes the detail fields and the full PR pool as served (`workspace.get` is
 * authoritative — an omitted field means none) and marks the row
 * detail-hydrated so later callers skip the fetch. The store carries
 * detail-only fields forward across slim list refreshes, so the mark stays
 * valid until the row leaves the store.
 *
 * Failures fail open: callers get the stored row as-is.
 */

import type { Workspace } from '$shared/types';
import {
  isWorkspacePullRequestPoolTruncated,
  selectWorkspaceById,
  selectWorkspaceDetailHydrated,
} from '$store/renderer/slices/workspace/workspace-selectors';
import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
import { store as appStore } from '$store/renderer/store';

const inFlightByWorkspace = new Map<string, Promise<Workspace | null>>();

/**
 * Read `workspace.get` for one workspace, single-flighted: concurrent callers
 * share the same request. Resolves `null` when the workspace is unknown or
 * the read fails. Does not touch the store — use {@link ensureWorkspaceDetail}
 * unless you own the dispatch (sagas).
 */
export function fetchWorkspaceDetail(workspaceId: string): Promise<Workspace | null> {
  const pending = inFlightByWorkspace.get(workspaceId);
  if (pending) return pending;
  const request = import('$lib/client')
    .then(({ appClient }) => appClient.workspaces.get(workspaceId))
    .catch(() => null)
    .finally(() => {
      if (inFlightByWorkspace.get(workspaceId) === request) {
        inFlightByWorkspace.delete(workspaceId);
      }
    });
  inFlightByWorkspace.set(workspaceId, request);
  return request;
}

function storedWorkspace(workspaceId: string): Workspace | undefined {
  return selectWorkspaceById.select(appStore.state, workspaceId);
}

async function hydrateIntoStore(workspaceId: string): Promise<Workspace | undefined> {
  const workspace = await fetchWorkspaceDetail(workspaceId);
  if (workspace) {
    appStore.dispatch(setWorkspaceEntity(workspace, { detailRead: true }));
  }
  return storedWorkspace(workspaceId);
}

/**
 * Ensure the stored row carries the `workspace.get` detail fields. Skips the
 * read when the row is already detail-hydrated; otherwise fetches once and
 * merges. Resolves to the (possibly refreshed) stored row.
 */
export function ensureWorkspaceDetail(workspaceId: string): Promise<Workspace | undefined> {
  if (selectWorkspaceDetailHydrated.select(appStore.state, workspaceId)) {
    return Promise.resolve(storedWorkspace(workspaceId));
  }
  return hydrateIntoStore(workspaceId);
}

/**
 * Ensure the stored `pullRequests` pool is complete: fetches `workspace.get`
 * only while the row carries the capped list projection
 * (`pullRequestsTotal` above the stored count). Unlike
 * {@link ensureWorkspaceDetail} this ignores the detail-hydrated mark — the
 * authoritative `workspace.list` refresh re-caps the pool, so truncation is
 * the only reliable signal.
 */
export function ensureWorkspacePullRequestPool(
  workspaceId: string,
): Promise<Workspace | undefined> {
  const workspace = storedWorkspace(workspaceId);
  if (!isWorkspacePullRequestPoolTruncated(workspace)) {
    return Promise.resolve(workspace);
  }
  return hydrateIntoStore(workspaceId);
}

/** Test-only: forget in-flight reads so isolated tests start clean. */
export function __resetWorkspaceDetailHydrationForTesting(): void {
  inFlightByWorkspace.clear();
}
