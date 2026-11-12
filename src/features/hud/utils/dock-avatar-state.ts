import {
  getAvatarState,
  getAvatarStateForSession,
  type AvatarState,
} from '$features/agent/components/agent-avatar/avatar-state';
import { resolveWorkspaceStatusState } from '$lib/components/workspace/utils/workspace-status-presentation';
import type { AgentSession, Workspace } from '$shared/types';
import type { DockWorkspaceView } from '$store/renderer/slices/hud/hud-selectors';

const QUIET_STATES: ReadonlySet<AvatarState> = new Set(['idle', 'completed', 'unread']);

/** A dock surface's workspace, with the HUD row flags when the surface has them. */
export type DockAvatarItem = Pick<DockWorkspaceView, 'workspace'> &
  Partial<Pick<DockWorkspaceView, 'isRunning' | 'isUnread' | 'isWaiting' | 'badgeKind'>>;

/**
 * The app's avatar state for a dock workspace. With the workspace agent's session in the
 * store, live and attention states retain their session precedence. Quiet agents
 * reflect workspace-wide work and unread activity, including other agents in the
 * workspace. Without a session, workspace status feeds `getAvatarState` instead.
 */
export function dockWorkspaceAvatarState(
  item: DockAvatarItem,
  session?: AgentSession | null,
): AvatarState {
  const hasQuestion = item.badgeKind === 'question';
  const workspace: Workspace = item.workspace;
  const status = workspace.displayStatus;
  // Use the header's resolver for aggregate activity from the whole workspace.
  const workspaceState = resolveWorkspaceStatusState(workspace);
  const workspaceRunning = !!item.isRunning || workspaceState === 'in_progress';
  const workspaceUnread = workspaceState === 'unread';
  if (session) {
    const state = getAvatarStateForSession(session, { hasQuestion });
    // Another agent may be working or unread while this one rests.
    if (QUIET_STATES.has(state)) {
      if (workspaceRunning) return getAvatarState({ isStreaming: true });
      if (workspaceUnread) return getAvatarState({}, { hasUnread: true });
    }
    return state;
  }
  return getAvatarState(
    {
      isStreaming: workspaceRunning,
      status: (item.isWaiting ?? workspace.waiting === true) ? 'waiting' : undefined,
    },
    {
      isFailed: status === 'failed',
      hasQuestion,
      attentionKind:
        status === 'blocked' ? 'blocker' : status === 'needs_attention' ? 'discussion' : null,
      hasUnread: workspaceUnread || item.isUnread === true,
    },
  );
}
