/**
 * Fire-and-forget `workspace.markSeen` triggers (PROTOCOL §5.1).
 *
 * Clearing unread is a daemon round-trip so all clients converge: the daemon
 * clears the workspace's unread `attention` flag and emits
 * `workspace:attention-changed`, which drives the reactive UI clear. Callers
 * therefore never await the mutation — failures are tolerated silently and
 * the next view/focus trigger retries naturally.
 *
 * Dependency-light per src/store/renderer/AGENTS.md: the appClient seam is
 * dynamically imported inside the trigger so this module can be imported from
 * event-bridge code without eagerly pulling in the client graph.
 */

/** Route placeholders that are not real daemon workspace ids. */
function isRealWorkspaceId(workspaceId: string): boolean {
  return (
    workspaceId.length > 0 &&
    workspaceId !== 'new' &&
    workspaceId !== 'undefined' &&
    workspaceId !== 'null' &&
    !workspaceId.startsWith('optimistic-')
  );
}

/** True when the given workspace's route is the one currently on screen. */
export function isViewingWorkspace(workspaceId: string): boolean {
  if (typeof window === 'undefined') return false;
  const prefix = `/workspace/${workspaceId}`;
  const path = window.location.pathname;
  return path === prefix || path.startsWith(prefix + '/');
}

/**
 * Fire-and-forget `workspace.markSeen`. No-op for route placeholder ids
 * (`new`, `optimistic-*`, stringified `undefined`/`null` from transient route
 * params); errors are swallowed (the mutation seam already
 * folds failures into `{ success: false }`, this guards the transport too).
 */
export function markWorkspaceSeen(workspaceId: string): void {
  if (!isRealWorkspaceId(workspaceId)) return;
  void import('$lib/client')
    .then(({ appClient }) => appClient.workspaces.markSeen(workspaceId))
    .catch(() => {
      // Fire-and-forget: unread stays raised and the next trigger retries.
    });
}

/**
 * Mark the workspace seen only when it is the one currently being viewed —
 * used when an `unread` raise arrives for the on-screen workspace so the user
 * never sees a self-blue-dot for the workspace they are looking at.
 */
export function markWorkspaceSeenIfViewing(workspaceId: string): void {
  if (isViewingWorkspace(workspaceId)) markWorkspaceSeen(workspaceId);
}
