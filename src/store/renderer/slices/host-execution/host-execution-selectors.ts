import { store } from '../../store';
import {
  selectHostRole,
  selectPrincipalConnectionContext,
  selectPrincipalSnapshot,
} from '../principal/principal-selectors';

export const selectHostExecutionReadContext = store.createSelector((state) => {
  const role = selectHostRole.select(state);
  const connection = selectPrincipalConnectionContext.select(state);
  if (state.hostExecution?.connection !== connection) return null;
  return (role === 'owner' || role === 'member') &&
    selectPrincipalSnapshot.select(state)?.capabilities.hostMembership
    ? selectPrincipalConnectionContext.select(state)
    : null;
});

export const selectHostExecutionContext = store.createSelector((state) =>
  state.hostExecution?.connection === selectHostExecutionReadContext.select(state)
    ? (state.hostExecution?.context ?? null)
    : null,
);

export const selectIsHostMember = store.createSelector(
  (state) => selectHostRole.select(state) === 'member',
);

export const selectHostExecutionGeneration = store.createSelector(
  (state) => state.hostExecution.generation,
);
