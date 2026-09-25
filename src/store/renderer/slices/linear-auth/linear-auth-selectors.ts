import { store } from '../../store';

export const selectLinearAuthOperation = store.createSelector(
  (state) => state.linearAuth.operation,
);

export const selectLinearAuthConsumerOperation = store.createSelector(
  (state, consumerId: string) =>
    state.linearAuth.operation?.consumerId === consumerId ? state.linearAuth.operation : null,
);

export const selectLinearIsDisconnecting = store.createSelector(
  (state) =>
    state.linearAuth.operation?.kind === 'logout' &&
    state.linearAuth.operation.status === 'pending',
);

export const selectLinearIsAuthenticated = store.createSelector(
  (state) => state.linearAuth.isAuthenticated,
);

export const selectLinearRequiresDaemonAuth = store.createSelector(
  (state) => state.linearAuth.requiresDaemonAuth,
);

export const selectLinearIsAuthenticating = store.createSelector(
  (state) => state.linearAuth.isAuthenticating,
);

export const selectLinearError = store.createSelector((state) => state.linearAuth.error);
