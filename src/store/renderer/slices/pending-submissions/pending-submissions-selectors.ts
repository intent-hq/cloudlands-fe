import { store } from '../../store';
import type { AppSelector } from '../../types';
import { selectAgentQueueMessages } from '../agent-queue/agent-queue-selectors';
import { selectWorkspaceParticipationContext } from '../workspace/workspace-selectors';
import { selectPrincipalSnapshot } from '../principal/principal-selectors';
import { sameSubmissionScope } from './pending-submissions-model';
import { projectPendingSubmissions } from './pending-submissions-projection';
import type {
  PendingSubmissionEntry,
  PendingSubmissionsState,
  SubmissionScope,
} from './pending-submissions-types';

/** Call at render time with the same ownership captured for admission. Stale views show no pending text. */
const selectPendingSubmissionEntry: AppSelector<
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
