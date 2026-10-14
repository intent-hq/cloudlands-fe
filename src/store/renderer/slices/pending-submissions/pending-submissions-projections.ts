import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import { getAgentQueueMessages } from '../agent-queue/agent-queue-projections';
import {
  getWorkspaceParticipationContext,
  type WorkspaceAuthorityProjectionState,
} from '../workspace/workspace-authority-projections';
import { getPrincipalSnapshot } from '../principal/principal-projections';
import { sameSubmissionScope } from './pending-submissions-model';
import {
  projectPendingSubmissions,
  queueDisplayBlocksMutation,
} from './pending-submissions-projection';
import type { PendingSubmissionsState, SubmissionScope } from './pending-submissions-types';

import type { AgentSessionState } from '../agent-session/agent-session-types';
import type { AgentQueueState } from '../agent-queue/agent-queue-types';
export type SubmissionProjectionState = WorkspaceAuthorityProjectionState & {
  agentSessions: AgentSessionState;
  pendingSubmissions: PendingSubmissionsState;
  agentQueue: AgentQueueState;
};
export const getPendingSubmissionEntry = (
  state: SubmissionProjectionState,
  scope: SubmissionScope,
) => {
  const entry = state.pendingSubmissions?.byAgentId[scope.agentId];
  if (!entry || !sameSubmissionScope(entry.scope, scope)) return undefined;
  if (
    getWorkspaceParticipationContext(state, scope.workspaceId) !== scope.participation ||
    getPrincipalSnapshot(state)?.principal.id !== scope.principalId
  )
    return undefined;
  const workspace = state.agentSessions?.byAgentId[scope.agentId]?.workspaceId;
  return workspace !== undefined && workspace !== scope.workspaceId ? undefined : entry;
};
export const getPendingSubmissionDisplay = (
  state: SubmissionProjectionState,
  scope: SubmissionScope,
) =>
  projectPendingSubmissions(
    getPendingSubmissionEntry(state, scope),
    getAgentQueueMessages(state, scope.agentId, scope.workspaceId),
  );
export const getSubmissionIsCurrent = (
  state: SubmissionProjectionState,
  reference: import('./pending-submissions-types').SubmissionReference,
) => {
  const entry = getPendingSubmissionEntry(state, reference.scope);
  return (
    !!entry &&
    (!!getItem(entry.operations, reference.id) || !!getItem(entry.submissions, reference.id))
  );
};
export const getAgentSubmissionDisplay = (
  state: SubmissionProjectionState,
  agentId: string,
  workspaceId: string,
) => {
  const scope = state.pendingSubmissions?.byAgentId[agentId]?.scope;
  return scope?.workspaceId === workspaceId
    ? getPendingSubmissionDisplay(state, scope)
    : projectPendingSubmissions(undefined, getAgentQueueMessages(state, agentId, workspaceId));
};
export const getSubmissionObserved = (
  state: SubmissionProjectionState,
  reference: import('./pending-submissions-types').SubmissionReference,
) => {
  const entry = getPendingSubmissionEntry(state, reference.scope);
  return !!entry && getItem(entry.operations, reference.id)?.observed === true;
};
export const getQueueMutationBlocked = (
  state: SubmissionProjectionState,
  agentId: string,
  workspaceId: string,
  messageId?: string,
) =>
  queueDisplayBlocksMutation(
    getAgentSubmissionDisplay(state, agentId, workspaceId).queue,
    messageId,
  );
