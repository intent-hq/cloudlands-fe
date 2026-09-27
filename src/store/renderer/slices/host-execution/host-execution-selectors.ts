import type { HostExecutionContext } from '$shared/types/host-execution';
import { store } from '../../store';
import type { AppSelector } from '../../types';
import {
  selectHostRole,
  selectPrincipalConnectionContext,
  selectPrincipalSnapshot,
} from '../principal/principal-selectors';

export const selectHostExecutionReadContext: AppSelector<string | null> = store.createSelector(
  (state) => {
    const role = selectHostRole.select(state);
    const connection = selectPrincipalConnectionContext.select(state);
    if (state.hostExecution?.connection !== connection) return null;
    return (role === 'owner' || role === 'member') &&
      selectPrincipalSnapshot.select(state)?.capabilities.hostMembership
      ? selectPrincipalConnectionContext.select(state)
      : null;
  },
);

export const selectHostExecutionContext: AppSelector<HostExecutionContext | null> =
  store.createSelector((state) =>
    state.hostExecution?.connection === selectHostExecutionReadContext.select(state)
      ? (state.hostExecution?.context ?? null)
      : null,
  );

export const selectIsHostMember: AppSelector<boolean> = store.createSelector(
  (state) => selectHostRole.select(state) === 'member',
);

export const selectHostExecutionGeneration: AppSelector<number> = store.createSelector(
  (state) => state.hostExecution.generation,
);
