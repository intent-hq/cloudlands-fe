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
import type { ChatTranscript } from '$lib/client/app-client';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';

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

/** Compare only accepted deliveries in the same admitted submission lifetime. */
export function observeSubmissionTranscript(
  agentId: string,
  workspaceId: string | undefined,
  transcript: ChatTranscript,
  previousEvidence?: string,
): string | undefined {
  const entry = currentEntry(agentId, workspaceId);
  if (!entry) return undefined;
  const rows = submissionHistoryEvidence(transcript.messages);
  const evidence = JSON.stringify([
    entry.scope,
    rows,
    transcript.truncated,
    transcript.nextToken ?? null,
    transcript.initialHistory,
    // Appended assistant rows explain count growth; unseen history does not.
    transcript.totalMessages - transcript.messages.length,
  ]);
  const unchanged =
    evidence === previousEvidence &&
    transcript.resumed === undefined &&
    transcript.resetCachedTranscript !== true;
  const settled =
    entry.queueFresh &&
    !entry.refreshNeeded &&
    getItems(entry.submissions).length === 0 &&
    getItems(entry.seeds).length === 0 &&
    getItems(entry.processing).length === 0;
  // A complete queue alone cannot prove history absence. Only unchanged
  // accepted transcript evidence may preserve its already settled authority.
  // Stale/unresolved state still receives evidence to retry bounded recovery.
  if (!unchanged || !settled)
    appStore.dispatch(pendingEvidenceObserved(entry.scope, 'history', rows, Date.now()));
  return evidence;
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
