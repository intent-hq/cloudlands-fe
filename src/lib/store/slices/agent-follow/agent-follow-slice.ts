/**
 * Agent Follow Slice
 *
 * Manages state for following agents in the workspace.
 * Tracks which agent is being followed and the current file/note context.
 */

import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";
import type { AgentFollowState, AgentColor, PendingChange } from "./agent-follow-types";

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
// Actions
// ---------------------------------------------------------------------------

/** Start following an agent. The saga handles computing agentColor & emitting events. */
export const startFollowing = createAction<[agentId: string, agentColor: AgentColor]>(
  "agentFollow/startFollowing",
);

/** Stop following the current agent. */
export const stopFollowing = createAction("agentFollow/stopFollowing");

/** Pause following (animations continue to queue). */
export const pauseFollowing = createAction("agentFollow/pauseFollowing");

/** Resume following. */
export const resumeFollowing = createAction("agentFollow/resumeFollowing");

/** Set the current file being tracked. */
export const setCurrentFile = createAction<[file: string]>("agentFollow/setCurrentFile");

/** Set the current note being tracked. */
export const setCurrentNote = createAction<[noteId: string]>("agentFollow/setCurrentNote");

/** Set animating flag. */
export const setIsAnimating = createAction<[isAnimating: boolean]>("agentFollow/setIsAnimating");

/** Queue a pending text animation change. */
export const queueTextAnimation = createAction<[file: string, content: string, isAddition: boolean]>(
  "agentFollow/queueTextAnimation",
);

/** Clear pending changes (used internally by saga). */
export const clearPendingChanges = createAction("agentFollow/clearPendingChanges");

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export const agentFollowReducer = createReducer<AgentFollowState>(initialState)
  .with(startFollowing, (state, { payload: [agentId, agentColor] }) => ({
    ...state,
    isFollowing: true,
    followedAgentId: agentId,
    agentColor,
    // Reset animation state
    isAnimating: false,
    isPaused: false,
    pendingChanges: [],
  }))
  .with(stopFollowing, () => initialState)
  .with(pauseFollowing, (state) => ({
    ...state,
    isPaused: true,
  }))
  .with(resumeFollowing, (state) => ({
    ...state,
    isPaused: false,
  }))
  .with(setCurrentFile, (state, { payload: [file] }) => {
    if (state.currentFile === file) return state;
    return {
      ...state,
      currentFile: file,
      currentNoteId: null,
    };
  })
  .with(setCurrentNote, (state, { payload: [noteId] }) => {
    if (state.currentNoteId === noteId) return state;
    return {
      ...state,
      currentNoteId: noteId,
      currentFile: null,
    };
  })
  .with(setIsAnimating, (state, { payload: [isAnimating] }) => {
    if (state.isAnimating === isAnimating) return state;
    return { ...state, isAnimating };
  })
  .with(queueTextAnimation, (state, { payload: [file, content, isAddition] }) => {
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
  })
  .with(clearPendingChanges, (state) => {
    if (state.pendingChanges.length === 0) return state;
    return { ...state, pendingChanges: [] };
  });

