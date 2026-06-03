import { store } from "../../store";
/**
 * Selectors for the agent-follow slice.
 */


export const selectIsFollowing = store.createSelector(
  (state) => state.agentFollow.isFollowing,
);

export const selectFollowedAgentId = store.createSelector(
  (state) => state.agentFollow.followedAgentId,
);

export const selectAgentColor = store.createSelector(
  (state) => state.agentFollow.agentColor,
);

export const selectCurrentFile = store.createSelector(
  (state) => state.agentFollow.currentFile,
);

export const selectCurrentNoteId = store.createSelector(
  (state) => state.agentFollow.currentNoteId,
);

export const selectIsAnimating = store.createSelector(
  (state) => state.agentFollow.isAnimating,
);

export const selectIsPaused = store.createSelector(
  (state) => state.agentFollow.isPaused,
);

export const selectTypingSpeed = store.createSelector(
  (state) => state.agentFollow.typingSpeed,
);

export const selectIsFollowingAgent = store.createSelector(
  (state, agentId: string) =>
    state.agentFollow.isFollowing && state.agentFollow.followedAgentId === agentId,
);

export const selectFocusRingStyle = store.createSelector((state) => {
  const { isFollowing, agentColor } = state.agentFollow;
  if (!isFollowing || !agentColor) return "";
  return `box-shadow: 0 0 0 3px ${agentColor.start}40, 0 0 0 1px ${agentColor.start}`;
});

