import { AgentStatus } from '$shared/types/agent.types';
import type { AgentSession } from '$shared/types';
import type { AgentAttentionKind } from '$shared/utils/agent-attention';
import { store as appStore } from '$store/renderer/store';
import {
  selectAgentSession,
  selectAgentIsResponding,
  selectAgentIsBlockedWaiting,
} from '$store/renderer/slices/agent-session/agent-session-selectors';

/**
 * Avatar display states for AugieAvatarWithState component
 *
 * States:
 * - running/responding: Agent is actively responding/streaming (green pulsing indicator)
 * - unread: Agent has unread messages (blue indicator)
 * - completed: Agent has finished (green checkmark)
 * - failed: Agent failed (red X)
 * - waiting: Agent is waiting (hourglass icon)
 * - attention-discussion: Agent requested a discussion (amber comment icon)
 * - attention-blocker: Agent reported a blocker (red exclamation icon)
 * - idle: No special state (no indicator)
 */
export type AvatarState = 'running' | 'responding' | 'unread' | 'idle' | 'completed' | 'failed' | 'waiting' | 'needs-permission' | 'attention-discussion' | 'attention-blocker';

/**
 * Options for determining avatar state
 */
export interface AvatarStateOptions {
  /** Whether the agent has unread messages */
  hasUnread?: boolean;
  /** Whether this agent is currently active/selected (unread won't show for active agents) */
  isActive?: boolean;
  /** Whether the agent has been marked as completed */
  isCompleted?: boolean;
  /** Whether the agent has failed */
  isFailed?: boolean;
  /** Whether the agent has a pending permission request that needs user action */
  hasPermissionRequest?: boolean;
  /** Kind of the agent's pending attention request (discussion/blocker), if any */
  attentionKind?: AgentAttentionKind | null;
}

/**
 * Input data for determining avatar state
 */
export interface AgentStateInput {
  /** Whether the agent is currently streaming */
  isStreaming?: boolean;
  /** Whether the agent is currently processing */
  isProcessing?: boolean;
  /** Whether the agent is currently responding */
  isResponding?: boolean;
  /** The agent's status */
  status?: AgentStatus | string;
}

/**
 * Check if an agent is actively working (streaming, processing, or responding)
 */
export function isAgentActivelyWorking(input: AgentStateInput): boolean {
  if ((input.status === AgentStatus.Idle || input.status === 'idle') && !input.isStreaming && !input.isProcessing) {
    return false;
  }

  return !!(input.isStreaming || input.isProcessing || input.isResponding);
}

/**
 * Whether the input describes a live turn — the activity flags plus the
 * running statuses the `running` branch below already accepts.
 */
function isRunningInput(input: AgentStateInput): boolean {
  return (
    isAgentActivelyWorking(input) ||
    input.status === AgentStatus.Processing ||
    input.status === 'streaming' ||
    input.status === 'processing'
  );
}

/**
 * Get the avatar state based on agent state input and options.
 * This is the core centralized logic for determining avatar display state.
 */
export function getAvatarState(input: AgentStateInput, options: AvatarStateOptions = {}): AvatarState {
  const { hasUnread = false, isActive = false, isCompleted = false, isFailed = false, hasPermissionRequest = false, attentionKind = null } = options;

  // Completed state takes precedence — EXCEPT over live work. `isCompleted`
  // comes from the delegation group's `completedAgentIds`/`deletedAgentIds`,
  // which never un-complete when an agent is re-woken, so an unconditional
  // check-mark would outlive the completion it describes for the whole of the
  // agent's next turn. Deferring to the running branch below makes the
  // check-mark return on its own once the new turn settles.
  if (isCompleted && !isRunningInput(input)) {
    return 'completed';
  }

  // Failed state
  if (isFailed || input.status === AgentStatus.Error || input.status === 'failed') {
    return 'failed';
  }

  // Needs permission - agent is blocked waiting for user approval
  // Higher priority than running/waiting since it requires user action
  if (hasPermissionRequest) {
    return 'needs-permission';
  }

  // Pending attention request (discussion/blocker) - requires user input.
  // The daemon clears the fields only on a user-origin delivery (sendMessage,
  // sendQueuedMessageNow, editAndRegenerate, drained user-origin queue entry);
  // automatic deliveries leave it pending, so a pending request implies the
  // agent is still waiting on the user.
  if (attentionKind === 'discussion') {
    return 'attention-discussion';
  }
  if (attentionKind === 'blocker') {
    return 'attention-blocker';
  }

  // Check if agent is currently running (streaming/processing/responding)
  if (isRunningInput(input)) {
    return 'running';
  }

  // Waiting state
  if (input.status === AgentStatus.Waiting || input.status === 'waiting') {
    return 'waiting';
  }

  // Check if agent has unread messages (and is not the active agent)
  if (hasUnread && !isActive) {
    return 'unread';
  }

  return 'idle';
}

/**
 * Get avatar state for an AgentSession object.
 * Convenience wrapper around getAvatarState for AgentSession objects.
 */
export function getAvatarStateForSession(
  session: AgentSession | null | undefined,
  options: AvatarStateOptions = {},
): AvatarState {
  if (!session) {
    return 'idle';
  }

  return getAvatarState(
    {
      isStreaming: session.isStreaming,
      isProcessing: session.isProcessing,
      isResponding: session.isResponding,
      status: session.status,
    },
    options,
  );
}

/**
 * Get avatar state by looking up the agent in the Redux store.
 * This checks the store's streaming state directly for the most accurate real-time state.
 */
export function getAvatarStateFromStore(
  workspaceId: string,
  agentId: string,
  options: AvatarStateOptions = {},
): AvatarState {
  void workspaceId;
  const state = appStore.state;
  const session = selectAgentSession.select(state, agentId);
  if (!session) {
    return 'idle';
  }

  // Blocked waits (explicit Waiting status / paused on peer agents / a tool
  // wait with no live turn) render the hourglass; a tool executing inside an
  // in-flight turn stays "running".
  const isWaiting = selectAgentIsBlockedWaiting.select(state, agentId);
  const isResponding = selectAgentIsResponding.select(state, agentId);

  return getAvatarState(
    {
      isStreaming: isResponding && !isWaiting,
      status: isWaiting ? AgentStatus.Waiting : session.status,
    },
    options,
  );
}

/**
 * Check if an agent is streaming by looking up in the Redux store.
 */
export function isAgentStreamingFromStore(workspaceId: string, agentId: string): boolean {
  void workspaceId;
  return selectAgentIsResponding.select(appStore.state, agentId);
}
