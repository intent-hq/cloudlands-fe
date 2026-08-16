/**
 * Agent Follow Slice
 *
 * Manages state for following agents in the workspace.
 * Tracks which agent is being followed and the current file/note context.
 */

import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";
import type { AgentFollowState } from "./agent-follow-types";

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

export const initialState: AgentFollowState = {
  isFollowing: false,
  followedAgentId: null,
  agentColor: null,
  currentFile: null,
  currentNoteId: null,
  isAnimating: false,
  isPaused: false,
  typingSpeed: 30,
  pendingChanges: [],
};

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export const agentFollowReducer = createReducer<AgentFollowState>(initialState);
