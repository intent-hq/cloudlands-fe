import { AgentStatus } from '$shared/types/agent.types';
import type { AgentSession } from '$shared/types';
import { getReduxStore } from '$lib/store/redux-dispatch-bridge';
import { selectAgentById } from '$lib/store/slices/workspace-agents/workspace-agents-selectors';
import {
  selectAgentIsResponding,
  selectAgentIsWaiting,
} from '$lib/store/slices/agent-session/agent-session-selectors';

/**
 * Avatar display states for AugieAvatarWithState component
 *
 * States:
 * - running/responding: Agent is actively responding/streaming (green pulsing indicator)
 * - unread: Agent has unread messages (blue indicator)
 * - completed: Agent has finished (green checkmark)
 * - failed: Agent failed (red X)
 * - waiting: Agent is waiting (hourglass icon)
 * - idle: No special state (no indicator)
 */
export type AvatarState = 'running' | 'responding' | 'unread' | 'idle' | 'completed' | 'failed' | 'waiting' | 'needs-permission';

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
 * Get the avatar state based on agent state input and options.
 * This is the core centralized logic for determining avatar display state.
 */
export function getAvatarState(input: AgentStateInput, options: AvatarStateOptions = {}): AvatarState {
  const { hasUnread = false, isActive = false, isCompleted = false, isFailed = false, hasPermissionRequest = false } = options;

  // Completed state takes precedence
  if (isCompleted) {
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

  // Check if agent is currently running (streaming/processing/responding)
  if (isAgentActivelyWorking(input) || input.status === AgentStatus.Processing || input.status === 'streaming' || input.status === 'processing') {
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
  const state = getReduxStore().getState();
  const session = selectAgentById.select(state, agentId);
  if (!session) {
    return 'idle';
  }

  const isWaiting = selectAgentIsWaiting.select(state, agentId);
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
  return selectAgentIsResponding.select(getReduxStore().getState(), agentId);
}
