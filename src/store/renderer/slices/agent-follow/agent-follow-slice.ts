/**
 * Agent Follow Slice
 *
 * Manages state for following agents in the workspace.
 * Tracks which agent is being followed and the current file/note context.
 */

import { createAction } from '@augmentcode/themis/utils/store/create-action';
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
  pendingChanges: [],
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Set the current file being tracked. */
const setCurrentFile = createAction<[file: string]>('agentFollow/setCurrentFile');

/** Set animating flag. */
const setIsAnimating = createAction<[isAnimating: boolean]>('agentFollow/setIsAnimating');

/** Queue a pending text animation change. */
const queueTextAnimation = createAction<[file: string, content: string, isAddition: boolean]>(
  'agentFollow/queueTextAnimation',
);

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export const agentFollowReducer = createReducer<AgentFollowState>(initialState);

agentFollowReducer.with(setCurrentFile, (state, { payload: [file] }) => {
  if (state.currentFile === file) return state;
  return {
    ...state,
    currentFile: file,
    currentNoteId: null,
  };
});
agentFollowReducer.with(setIsAnimating, (state, { payload: [isAnimating] }) => {
  if (state.isAnimating === isAnimating) return state;
  return { ...state, isAnimating };
});
agentFollowReducer.with(queueTextAnimation, (state, { payload: [file, content, isAddition] }) => {
  if (!state.isFollowing) return state;
  const change: PendingChange = {
    file,
    content,
    isAddition,
    timestamp: 0, // Saga sets real timestamp
  };
  return {
    ...state,
    pendingChanges: [...state.pendingChanges, change],
  };
});
