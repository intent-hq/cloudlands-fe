/**
 * Workspace-menu *Leave* for a guest window: the same confirmed
 * `leaveGuestWorkspaceRequested` flow as the per-workspace *Leave* in
 * Settings → Collaboration (`workspace.members.leave` on the host). The
 * host's membership-removal delta then tears the workspace out of this window.
 */
import { m } from '$shared/paraglide/messages.js';
import { formatGuestSessionLabel } from '$lib/utils/connection-label';
import { store as appStore } from '$store/renderer/store';
import { selectPrincipalActionContext } from '$store/renderer/slices/principal/principal-selectors';
import {
  selectCanLeaveWorkspace,
  selectWindowGuestSession,
} from '$store/renderer/slices/guest-sessions/guest-sessions-selectors';
import {
  guestLeaveConfirmed,
  leaveGuestWorkspaceRequested,
} from '$store/renderer/slices/guest-sessions/guest-sessions-slice';
import {
  GuestSessionOperationError,
  guestSessionLifetime,
} from '$store/renderer/slices/guest-sessions/guest-sessions-types';

/** What the confirm dialog shows and what the confirmation acts on. */
export interface LeaveWorkspaceTarget {
  sessionId: string;
  sessionLabel: string;
  lifetime: string | null;
  workspaceId: string;
  workspaceTitle: string;
  context: string | null;
}

/** Snapshot the window's guest session and identity when *Leave…* is chosen. */
export function captureLeaveWorkspaceTarget(
  workspace: { id: string; title?: string | null } | null | undefined,
): LeaveWorkspaceTarget | null {
  const state = appStore.state;
  const session = selectWindowGuestSession.select(state);
  if (!workspace?.id || !session || !selectCanLeaveWorkspace.select(state, workspace.id))
    return null;
  return {
    sessionId: session.id,
    sessionLabel: formatGuestSessionLabel(session),
    lifetime: guestSessionLifetime(session),
    workspaceId: workspace.id,
    workspaceTitle: workspace.title?.trim() || m.workspace_links_untitled_label(),
    context: selectPrincipalActionContext.select(state),
  };
}

/**
 * Run a confirmed leave. Sends nothing when the session or identity changed
 * while the dialog was open; reports a failed or refused leave in a toast.
 */
export async function confirmLeaveWorkspace(target: LeaveWorkspaceTarget | null): Promise<void> {
  if (!target?.context || !target.lifetime) return;
  const state = appStore.state;
  const session = selectWindowGuestSession.select(state);
  if (
    session?.id !== target.sessionId ||
    guestSessionLifetime(session) !== target.lifetime ||
    selectPrincipalActionContext.select(state) !== target.context ||
    !selectCanLeaveWorkspace.select(state, target.workspaceId)
  )
    return;
  appStore.dispatch(
    guestLeaveConfirmed({
      id: target.sessionId,
      workspaceId: target.workspaceId,
      context: target.context,
      lifetime: target.lifetime,
    }),
  );
  const { notify } = await import('$lib/components/patterns/notify');
  try {
    const result = await appStore.dispatch(
      leaveGuestWorkspaceRequested(target.sessionId, target.workspaceId),
    );
    if (result?.refused === 'host-membership-required') {
      notify.error(m.collaboration_workspace_inherited_error());
    }
  } catch (error) {
    if (error instanceof GuestSessionOperationError && error.code === 'cancelled') return;
    notify.error(
      m.settings_guestSessions_leaveWorkspace_error({ workspace: target.workspaceTitle }),
    );
  }
}
