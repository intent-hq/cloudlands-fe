/**
 * Shared "empty window destination" decision for the "no next workspace tab"
 * navigation paths (tab close, workspace removal, reopen fallbacks).
 *
 * When available workspaces (excluding chief and archived/deleted ones) still
 * exist, an empty window lands on the minimal home empty state at '/';
 * onboarding/creation at '/workspace/new' is reserved for the zero-workspace
 * case. Boot routing is intentionally separate — fresh windows still boot at
 * '/workspace/new' via decideBootRoute (see $lib/utils/boot-route-gate).
 *
 * Dependency-light on purpose: no stores, no `$app/*` imports, so it is safe
 * to use from `navigate-away-if-viewing.ts` (main-process typecheck graph).
 */
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';

/** Minimal workspace shape needed for the destination decision. */
export interface EmptyWindowDestinationWorkspace {
  id: string;
  status?: string;
}

/**
 * True when at least one available workspace exists: non-chief, not
 * archived/deleted, and not the one currently being removed.
 *
 * @param workspaces - Known workspaces (e.g. `selectWorkspaceItems.select(...)`)
 * @param excludedWorkspaceId - A workspace being removed right now, whose
 *   status may not yet reflect the removal in store state
 */
function hasAvailableWorkspace(
  workspaces: readonly EmptyWindowDestinationWorkspace[],
  excludedWorkspaceId?: string,
): boolean {
  return workspaces.some(
    (workspace) =>
      workspace.id !== CHIEF_WORKSPACE_ID &&
      workspace.id !== excludedWorkspaceId &&
      workspace.status !== 'Archived' &&
      workspace.status !== 'Deleted',
  );
}

/**
 * Decide where navigation should land when no workspace tab remains.
 *
 * @param workspaces - Known workspaces (e.g. `selectWorkspaceItems.select(...)`)
 * @param excludedWorkspaceId - A workspace being removed right now, whose
 *   status may not yet reflect the removal in store state
 */
export function resolveEmptyWindowDestination(
  workspaces: readonly EmptyWindowDestinationWorkspace[],
  excludedWorkspaceId?: string,
): '/' | '/workspace/new' {
  return hasAvailableWorkspace(workspaces, excludedWorkspaceId) ? '/' : '/workspace/new';
}
