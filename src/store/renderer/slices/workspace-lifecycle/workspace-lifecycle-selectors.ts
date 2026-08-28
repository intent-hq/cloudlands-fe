import { store } from '../../store';

export const selectWorkspaceSessionPhase = store.createSelector<[wsId: string]>(
  (state, wsId) => state.workspaceLifecycle.sessionPhaseByWorkspaceId[wsId],
);

export const selectIsWorkspaceHydrated = store.createSelector<[wsId: string], boolean>(
  (state, wsId) => {
    const phase = selectWorkspaceSessionPhase.select(state, wsId);
    return phase === 'hydrated' || phase === 'live';
  },
);

export const selectIsWorkspaceSessionLive = store.createSelector<[wsId: string], boolean>(
  (state, wsId) => selectWorkspaceSessionPhase.select(state, wsId) === 'live',
);
