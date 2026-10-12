import { store as appStore } from '$store/renderer/store';
import {
  selectAgentSession,
  selectAgentIsResponding,
} from '$store/renderer/slices/agent-session/agent-session-selectors';

import {
  getAvatarStateForSession,
  type AvatarState,
  type AvatarStateOptions,
} from './avatar-state-core';

// Compatibility facade for existing Svelte consumers, including the two Store
// lookups below. Keep their public imports stable until the Svelte renderer is
// retired; React consumers must import the Store-free avatar-state-core instead.
export {
  AVATAR_STATE_PRECEDENCE,
  getAvatarState,
  getAvatarStateForSession,
  isAgentActivelyWorking,
  isSessionRunning,
  type AvatarState,
  type AvatarStateOptions,
  type AgentStateInput,
} from './avatar-state-core';

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

  return getAvatarStateForSession(session, options);
}

/**
 * Check if an agent is streaming by looking up in the Redux store.
 */
export function isAgentStreamingFromStore(workspaceId: string, agentId: string): boolean {
  void workspaceId;
  return selectAgentIsResponding.select(appStore.state, agentId);
}
