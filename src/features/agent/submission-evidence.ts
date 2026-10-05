import { store as appStore } from '$store/renderer/store';
import { selectPendingSubmissionEntry } from '$store/renderer/slices/pending-submissions/pending-submissions-selectors';
import { submissionReadIsCurrent } from '$store/renderer/slices/pending-submissions/pending-submissions-model';
import {
  pendingEvidenceObserved,
  pendingReadStarted,
  pendingReadCompleted,
  pendingLifecycleObserved,
  pendingDeliveryAnnounced,
} from '$store/renderer/slices/pending-submissions/pending-submissions-slice';
import type {
  SubmissionEvidence,
  SubmissionRead,
} from '$store/renderer/slices/pending-submissions/pending-submissions-types';
import type { AgentMessage } from '$shared/types';

function currentEntry(agentId: string, workspaceId?: string) {
  const scope = appStore.state.pendingSubmissions?.byAgentId[agentId]?.scope;
  return scope && (workspaceId === undefined || scope.workspaceId === workspaceId)
    ? selectPendingSubmissionEntry.select(appStore.state, scope)
    : undefined;
}

export function submissionHistoryEvidence(messages: AgentMessage[]): SubmissionEvidence[] {
  return messages
    .filter((message) => message.role === 'user')
    .map((message) => ({
      id: message.id,
      author: message.author,
      submissionIds: message.metadata?.submissionIds,
      recoverySources: message.metadata?.recoverySources,
    }));
}

export function observeSubmissionEvidence(
  agentId: string,
  workspaceId: string | undefined,
  kind: 'queue' | 'processing' | 'history',
  rows: SubmissionEvidence[],
) {
  const entry = currentEntry(agentId, workspaceId);
  if (entry) appStore.dispatch(pendingEvidenceObserved(entry.scope, kind, rows, Date.now()));
}

export function announceSubmissionDelivery(
  agentId: string,
  workspaceId: string | undefined,
  rows: SubmissionEvidence[],
) {
  const entry = currentEntry(agentId, workspaceId);
  if (entry) appStore.dispatch(pendingDeliveryAnnounced(entry.scope, rows));
}

export function observeSubmissionLifecycle(
  agentId: string,
  workspaceId: string | undefined,
  active: boolean,
) {
  const entry = currentEntry(agentId, workspaceId);
  if (entry) appStore.dispatch(pendingLifecycleObserved(entry.scope, active));
}

/** Also fences a read begun before admission: it cannot publish over the new lifetime. */
export function beginSubmissionRead(
  agentId: string,
  workspaceId: string | undefined,
  kind: 'queue' | 'history',
) {
  const entry = currentEntry(agentId, workspaceId);
  const token: SubmissionRead | undefined = entry && {
    scope: entry.scope,
    kind,
    id: crypto.randomUUID(),
    generation: entry.generation,
  };
  if (token) appStore.dispatch(pendingReadStarted(token));
  return {
    isCurrent: () =>
      token
        ? submissionReadIsCurrent(currentEntry(agentId, workspaceId), token)
        : !currentEntry(agentId, workspaceId),
    complete: (rows: SubmissionEvidence[]) => {
      if (token) appStore.dispatch(pendingReadCompleted(token, rows, Date.now()));
    },
  };
}
