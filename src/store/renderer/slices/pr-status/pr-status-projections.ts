import type { PRStatusState } from './pr-status-types';
import { getPRStatusWorkspaceState } from './pr-status-slice';

type PrStatusProjectionState = { prStatus: PRStatusState };

export const getPRStatusLastRefreshTime = (state: PrStatusProjectionState, wsId: string) =>
  getPRStatusWorkspaceState(state.prStatus, wsId).lastRefreshTime;

export const getPRStatusRefreshMetadata = (state: PrStatusProjectionState, wsId: string) =>
  getPRStatusWorkspaceState(state.prStatus, wsId);
