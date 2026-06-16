import { store } from "../../store";
/**
 * Selectors for the agent-follow slice.
 */


export const selectIsFollowing = store.createSelector(
  (state) => state.agentFollow.isFollowing,
);

export const selectAgentColor = store.createSelector(
  (state) => state.agentFollow.agentColor,
);

export const selectCurrentFile = store.createSelector(
  (state) => state.agentFollow.currentFile,
);

export const selectIsPaused = store.createSelector(
  (state) => state.agentFollow.isPaused,
);

export const selectTypingSpeed = store.createSelector(
  (state) => state.agentFollow.typingSpeed,
);

