import { store } from '../../store';
/**
 * Selectors for the agent-follow slice.
 */

export const selectIsFollowing = store.createSelector((state) => state.agentFollow.isFollowing);

export const selectAgentColor = store.createSelector((state) => state.agentFollow.agentColor);
