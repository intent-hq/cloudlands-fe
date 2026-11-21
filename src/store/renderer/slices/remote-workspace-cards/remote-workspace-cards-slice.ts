/**
 * Workspaces the Assistant names on another machine, read over this app's
 * saved connection to that machine (`connections:workspace-cards`).
 */
import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import type { Workspace } from '$shared/types';

export type RemoteWorkspaceCardEntry =
  | { status: 'loading' }
  | { status: 'found'; machineName: string; workspace: Workspace; loadedAt: number }
  | { status: 'missing'; machineName: string; loadedAt: number }
  /** This app has no saved connection for the machine (or cannot reach others at all). */
  | { status: 'unknown-backend'; loadedAt: number }
  | { status: 'unreachable'; machineName: string; loadedAt: number };

export type RemoteWorkspaceCardsOutcome =
  | { status: 'ok'; machineName: string; workspaces: Workspace[] }
  | { status: 'unknown-backend' }
  | { status: 'unreachable'; machineName: string };

export interface RemoteWorkspaceCardsState {
  byKey: Record<string, RemoteWorkspaceCardEntry>;
}

const initialState: RemoteWorkspaceCardsState = { byKey: {} };

export function remoteWorkspaceCardKey(backendId: string, workspaceId: string): string {
  return `${backendId}\n${workspaceId}`;
}

export const remoteWorkspaceCardsRequested = createAction<
  [backendId: string, workspaceIds: string[]],
  { backendId: string; workspaceIds: string[] }
>('remoteWorkspaceCards/requested', (backendId, workspaceIds) => ({ backendId, workspaceIds }));

export const remoteWorkspaceCardsStarted = createAction<
  [backendId: string, workspaceIds: string[]],
  { backendId: string; workspaceIds: string[] }
>('remoteWorkspaceCards/started', (backendId, workspaceIds) => ({ backendId, workspaceIds }));

export const remoteWorkspaceCardsReceived = createAction<
  [backendId: string, workspaceIds: string[], outcome: RemoteWorkspaceCardsOutcome, at: number],
  { backendId: string; workspaceIds: string[]; outcome: RemoteWorkspaceCardsOutcome; at: number }
>('remoteWorkspaceCards/received', (backendId, workspaceIds, outcome, at) => ({
  backendId,
  workspaceIds,
  outcome,
  at,
}));

/** Open the workspace on its machine, adding the machine to this window's rail when needed. */
export const remoteWorkspaceOpenRequested = createAction<
  [backendId: string, workspaceId: string],
  { backendId: string; workspaceId: string }
>('remoteWorkspaceCards/openRequested', (backendId, workspaceId) => ({ backendId, workspaceId }));

function entryFor(
  outcome: RemoteWorkspaceCardsOutcome,
  workspaceId: string,
  at: number,
): RemoteWorkspaceCardEntry {
  if (outcome.status === 'unknown-backend') return { status: 'unknown-backend', loadedAt: at };
  if (outcome.status === 'unreachable') {
    return { status: 'unreachable', machineName: outcome.machineName, loadedAt: at };
  }
  const workspace = outcome.workspaces.find((candidate) => candidate.id === workspaceId);
  return workspace
    ? { status: 'found', machineName: outcome.machineName, workspace, loadedAt: at }
    : { status: 'missing', machineName: outcome.machineName, loadedAt: at };
}

export const remoteWorkspaceCardsReducer = createReducer<RemoteWorkspaceCardsState>(initialState);
remoteWorkspaceCardsReducer.with(remoteWorkspaceCardsStarted, (state, { payload }) => {
  const byKey = { ...state.byKey };
  for (const workspaceId of payload.workspaceIds) {
    const key = remoteWorkspaceCardKey(payload.backendId, workspaceId);
    // A refresh keeps the shown card until its answer arrives.
    if (!byKey[key]) byKey[key] = { status: 'loading' };
  }
  return { ...state, byKey };
});
remoteWorkspaceCardsReducer.with(remoteWorkspaceCardsReceived, (state, { payload }) => {
  const byKey = { ...state.byKey };
  for (const workspaceId of payload.workspaceIds) {
    byKey[remoteWorkspaceCardKey(payload.backendId, workspaceId)] = entryFor(
      payload.outcome,
      workspaceId,
      payload.at,
    );
  }
  return { ...state, byKey };
});
