/**
 * Agent Follow Slice
 *
 * Manages state for following agents in the workspace.
 * Tracks which agent is being followed and the current file/note context.
 */

import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import type { AgentFollowState, PendingChange } from './agent-follow-types';

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const initialState: AgentFollowState = {
  isFollowing: false,
  followedAgentId: null,
  agentColor: null,
  currentFile: null,
  currentNoteId: null,
  isAnimating: false,
  isPaused: false,
  typingSpeed: 30,
  pendingChanges: [] as PendingChange[],
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export const agentFollowReducer = createReducer<AgentFollowState>(initialState);
