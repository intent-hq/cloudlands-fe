import {
  getAvatarState,
  getAvatarStateForSession,
  type AvatarState,
} from '$features/agent/components/agent-avatar/avatar-state';
import { resolveWorkspaceStatusState } from '$lib/components/workspace/utils/workspace-status-presentation';
import type { AgentSession, Workspace } from '$shared/types';
import { workspaceReminderStatus } from '$shared/utils/workspace-attention-reminder';
import type { DockWorkspaceView } from '$store/renderer/slices/hud/hud-selectors';

const QUIET_STATES: ReadonlySet<AvatarState> = new Set(['idle', 'completed', 'unread']);

/** A dock surface's workspace, with the HUD row flags when the surface has them. */
export type DockAvatarItem = Pick<DockWorkspaceView, 'workspace'> &
  Partial<Pick<DockWorkspaceView, 'isRunning' | 'isUnread' | 'isWaiting' | 'badgeKind'>>;

/**
 * The app's avatar state for a dock workspace. With the workspace agent's session in the
 * store, it is exactly the app's session state (the dock's question badge is the additive
 * store-only question signal, as in the sidebar launcher). Without a session, the
 * workspace's status feeds the same `getAvatarState` precedence instead.
 */
export function dockWorkspaceAvatarState(
  item: DockAvatarItem,
  session?: AgentSession | null,
): AvatarState {
  const hasQuestion = item.badgeKind === 'question';
  const workspace: Workspace = item.workspace;
  const status = workspaceReminderStatus(workspace);
  // The same resolver as the header's status count, so a yellow header dot always has a row.
  const workspaceRunning =
    !!item.isRunning || resolveWorkspaceStatusState(workspace) === 'in_progress';
  if (session) {
    const state = getAvatarStateForSession(session, { hasQuestion });
    // Another agent in the workspace (e.g. a sub-agent) is working while this one
    // rests: the row shows the work, matching the header's running count.
    return workspaceRunning && QUIET_STATES.has(state)
      ? getAvatarState({ isStreaming: true })
      : state;
  }
  return getAvatarState(
    {
      isStreaming: workspaceRunning,
      status:
        status === 'waiting' || (item.isWaiting ?? workspace.waiting === true)
          ? 'waiting'
          : undefined,
    },
    {
      isFailed: status === 'failed',
      hasQuestion,
      attentionKind:
        status === 'blocked' ? 'blocker' : status === 'needs_attention' ? 'discussion' : null,
      hasUnread: item.isUnread ?? workspace.attention === 'unread',
    },
  );
}
