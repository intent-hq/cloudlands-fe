/**
 * Fire-and-forget `workspace.markSeen` trigger (PROTOCOL §5.1).
 *
 * `workspace.markSeen` is the explicit "mark all read" gesture — the daemon
 * marks every top-level agent conversation seen (advancing each session's
 * `lastSeenMessageId`), the derived workspace unread clears, and the emitted
 * `workspace:attention-changed` drives the reactive UI clear on all clients.
 *
 * It is deliberately NOT fired by merely viewing a workspace: unread is
 * daemon-derived from per-agent seen markers and clears as each unread agent
 * conversation is read (`agent.markSeen`, see mark-agent-seen.ts). Callers are
 * explicit affordances only (sidebar "Mark as read" actions). Callers never
 * await the mutation — failures are tolerated silently (the badge stays up
 * and the user can retry the gesture).
 *
 * Dependency-light per src/store/renderer/AGENTS.md: the appClient seam is
 * dynamically imported inside the trigger so this module stays importable
 * without eagerly pulling in the client graph.
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
      // Fire-and-forget: unread stays raised and the gesture can be retried.
    });
}
