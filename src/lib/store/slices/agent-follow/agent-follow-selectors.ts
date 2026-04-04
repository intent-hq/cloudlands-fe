/**
 * Selectors for the agent-follow slice.
 */

import { createSelector } from "../../utils/create-selector";

export const selectIsFollowing = createSelector(
  (state) => state.agentFollow.isFollowing,
);

export const selectFollowedAgentId = createSelector(
  (state) => state.agentFollow.followedAgentId,
);

export const selectAgentColor = createSelector(
  (state) => state.agentFollow.agentColor,
);

export const selectCurrentFile = createSelector(
  (state) => state.agentFollow.currentFile,
);

export const selectCurrentNoteId = createSelector(
  (state) => state.agentFollow.currentNoteId,
);

export const selectIsAnimating = createSelector(
  (state) => state.agentFollow.isAnimating,
);

export const selectIsPaused = createSelector(
  (state) => state.agentFollow.isPaused,
);

export const selectTypingSpeed = createSelector(
  (state) => state.agentFollow.typingSpeed,
);

export const selectIsFollowingAgent = createSelector(
  (state, agentId: string) =>
    state.agentFollow.isFollowing && state.agentFollow.followedAgentId === agentId,
);

export const selectFocusRingStyle = createSelector((state) => {
  const { isFollowing, agentColor } = state.agentFollow;
  if (!isFollowing || !agentColor) return "";
  return `box-shadow: 0 0 0 3px ${agentColor.start}40, 0 0 0 1px ${agentColor.start}`;
});

