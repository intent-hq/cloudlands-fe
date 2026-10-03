import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import { store } from '../../store';
import type { AppSelector } from '../../types';
import { selectAgentQueueMessages } from '../agent-queue/agent-queue-selectors';
import { selectWorkspaceParticipationContext } from '../workspace/workspace-selectors';
import { selectPrincipalSnapshot } from '../principal/principal-selectors';
import { sameSubmissionScope } from './pending-submissions-model';
import {
  projectPendingSubmissions,
  queueDisplayBlocksMutation,
} from './pending-submissions-projection';
import type {
  PendingSubmissionEntry,
  PendingSubmissionsState,
  SubmissionScope,
} from './pending-submissions-types';

/** Call at render time with the same ownership captured for admission. Stale views show no pending text. */
export const selectPendingSubmissionEntry: AppSelector<
  PendingSubmissionEntry | undefined,
  [scope: SubmissionScope]
> = store.createSelector<[scope: SubmissionScope], PendingSubmissionEntry | undefined>(
  (state, scope) => {
    const entry = state.pendingSubmissions?.byAgentId[scope.agentId];
    if (!entry || !sameSubmissionScope(entry.scope, scope)) return undefined;
    if (
      selectWorkspaceParticipationContext.select(state, scope.workspaceId) !==
        scope.participation ||
      selectPrincipalSnapshot.select(state)?.principal.id !== scope.principalId
    )
      return undefined;
    const workspace = state.agentSessions?.byAgentId[scope.agentId]?.workspaceId;
    return workspace !== undefined && workspace !== scope.workspaceId ? undefined : entry;
  },
);

export const selectPendingSubmissionDisplay: AppSelector<
  ReturnType<typeof projectPendingSubmissions>,
  [scope: SubmissionScope]
> = store.createSelector<[scope: SubmissionScope], ReturnType<typeof projectPendingSubmissions>>(
  (state, scope) =>
    projectPendingSubmissions(
      selectPendingSubmissionEntry.select(state, scope),
      selectAgentQueueMessages.select(state, scope.agentId, scope.workspaceId),
    ),
);

export const selectPendingSubmissionsState: AppSelector<PendingSubmissionsState> =
  store.createSelector((state) => state.pendingSubmissions);

export const selectSubmissionIsCurrent = store.createSelector(
  (state, reference: import('./pending-submissions-types').SubmissionReference) => {
    const entry = selectPendingSubmissionEntry.select(state, reference.scope);
    return (
      !!entry &&
      (!!getItem(entry.operations, reference.id) || !!getItem(entry.submissions, reference.id))
    );
  },
);

/** Scope comes from the admitted entry; selectors still validate the current view's workspace. */
export const selectAgentSubmissionDisplay = store.createSelector(
  (state, agentId: string, workspaceId: string) => {
    const scope = state.pendingSubmissions?.byAgentId[agentId]?.scope;
    return scope?.workspaceId === workspaceId
      ? selectPendingSubmissionDisplay.select(state, scope)
      : projectPendingSubmissions(
          undefined,
          selectAgentQueueMessages.select(state, agentId, workspaceId),
        );
  },
);

export const selectSubmissionObserved = store.createSelector(
  (state, reference: import('./pending-submissions-types').SubmissionReference) => {
    const entry = selectPendingSubmissionEntry.select(state, reference.scope);
    return !!entry && getItem(entry.operations, reference.id)?.observed === true;
  },
);

/** Recheck at execution time too: a command can wait behind a queue submission. */
export const selectQueueMutationBlocked = store.createSelector(
  (state, agentId: string, workspaceId: string, messageId?: string) =>
    queueDisplayBlocksMutation(
      selectAgentSubmissionDisplay.select(state, agentId, workspaceId).queue,
      messageId,
    ),
);
