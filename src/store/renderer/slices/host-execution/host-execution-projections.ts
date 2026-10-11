import {
  getHostRole,
  getPrincipalConnectionContext,
  getPrincipalSnapshot,
  type PrincipalProjectionState,
} from '../principal/principal-projections';
import type { HostExecutionState } from './host-execution-types';
export type HostExecutionProjectionState = PrincipalProjectionState & {
  hostExecution: HostExecutionState;
};
export const getHostExecutionReadContext = (state: HostExecutionProjectionState) => {
  const role = getHostRole(state);
  const connection = getPrincipalConnectionContext(state);
  if (state.hostExecution?.connection !== connection) return null;
  return (role === 'owner' || role === 'member') &&
    getPrincipalSnapshot(state)?.capabilities.hostMembership
    ? getPrincipalConnectionContext(state)
    : null;
};

export const getHostExecutionContext = (state: HostExecutionProjectionState) =>
  state.hostExecution?.connection === getHostExecutionReadContext(state)
    ? (state.hostExecution?.context ?? null)
    : null;

export const getIsHostMember = (state: HostExecutionProjectionState) =>
  getHostRole(state) === 'member';

export const getHostExecutionGeneration = (state: HostExecutionProjectionState) =>
  state.hostExecution.generation;
