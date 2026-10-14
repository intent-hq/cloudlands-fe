import {
  getPendingSubmissionEntry,
  type SubmissionProjectionState,
} from '../../store/renderer/slices/pending-submissions/pending-submissions-projections';
import type { StoreDispatch } from '@themislib/themis/types';
import { submissionReadIsCurrent } from '../../store/renderer/slices/pending-submissions/pending-submissions-model';
import {
  pendingEvidenceObserved,
  pendingReadStarted,
  pendingReadCompleted,
  pendingLifecycleObserved,
  pendingDeliveryAnnounced,
} from '../../store/renderer/slices/pending-submissions/pending-submissions-slice';
import type {
  SubmissionEvidence,
  SubmissionRead,
} from '../../store/renderer/slices/pending-submissions/pending-submissions-types';

export function createSubmissionEvidence(appStore: {
  readonly state: SubmissionProjectionState;
  dispatch: StoreDispatch;
}) {
  function currentEntry(agentId: string, workspaceId?: string) {
    const scope = appStore.state.pendingSubmissions?.byAgentId[agentId]?.scope;
    return scope && (workspaceId === undefined || scope.workspaceId === workspaceId)
      ? getPendingSubmissionEntry(appStore.state, scope)
      : undefined;
  }

  function observeSubmissionEvidence(
    agentId: string,
    workspaceId: string | undefined,
    kind: 'queue' | 'processing' | 'history',
    rows: SubmissionEvidence[],
  ) {
    const entry = currentEntry(agentId, workspaceId);
    if (entry) appStore.dispatch(pendingEvidenceObserved(entry.scope, kind, rows, Date.now()));
  }

  function announceSubmissionDelivery(
    agentId: string,
    workspaceId: string | undefined,
    rows: SubmissionEvidence[],
  ) {
    const entry = currentEntry(agentId, workspaceId);
    if (entry) appStore.dispatch(pendingDeliveryAnnounced(entry.scope, rows));
  }

  function observeSubmissionLifecycle(
    agentId: string,
    workspaceId: string | undefined,
    active: boolean,
  ) {
    const entry = currentEntry(agentId, workspaceId);
    if (entry) appStore.dispatch(pendingLifecycleObserved(entry.scope, active));
  }

  /** Also fences a read begun before admission: it cannot publish over the new lifetime. */
  function beginSubmissionRead(
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

  return {
    observeSubmissionEvidence,
    announceSubmissionDelivery,
    observeSubmissionLifecycle,
    beginSubmissionRead,
  };
}
