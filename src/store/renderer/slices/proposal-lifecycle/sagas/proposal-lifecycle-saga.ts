import { toast } from 'svelte-sonner';
import {
  call,
  delay,
  fork,
  put,
  takeEvery,
  takeLatest,
  type SagaGenerator,
} from 'typed-redux-saga';
import { m } from '$shared/paraglide/messages.js';
import {
  getLocalStorageJSON,
  setLocalStorageJSON,
} from '$store/renderer/utils/safe-local-storage-saga';
import {
  clearProposalApplied,
  recordProposalApplied,
} from '../../settings-proposal-history/settings-proposal-history-slice';
import { selectProposalAppliedState } from '../../settings-proposal-history/settings-proposal-history-selectors';
import {
  clearSpecialistApplied,
  recordSpecialistApplied,
} from '../../specialist-proposal-history/specialist-proposal-history-slice';
import { selectSpecialistProposalAppliedState } from '../../specialist-proposal-history/specialist-proposal-history-selectors';
import {
  applyProposalRequested,
  clearProposalLifecycle,
  proposalApplyStarted,
  proposalApplySucceeded,
  proposalFailed,
  proposalResolutionReconciled,
  proposalUndoStarted,
  proposalUndoSucceeded,
  hydrateProposalLifecycle,
  pruneAppliedProposalLifecycleEntries,
  undoProposalRequested,
} from '../proposal-lifecycle-slice';
import {
  selectProposalLifecycleEntry,
  selectProposalLifecycleMap,
} from '../proposal-lifecycle-selectors';
import type { ProposalApplyResult, ProposalLifecycleEntry } from '../proposal-lifecycle-types';
import {
  applySettingsProposalWork,
  undoSettingsProposalWork,
} from '$lib/components/chat/proposals/settings-proposal-actions';
import {
  applySpecialistProposalWork,
  undoSpecialistProposalWork,
} from '$lib/components/chat/proposals/specialist-proposal-actions';

export const PROPOSAL_LIFECYCLE_STORAGE_KEY = 'intent:proposal-lifecycle:v1';
const PROPOSAL_LIFECYCLE_MAX_PERSISTED_ENTRIES = 300;
const PROPOSAL_LIFECYCLE_PERSIST_DEBOUNCE_MS = 300;

function isProposalApplyResult(value: unknown): value is ProposalApplyResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<ProposalApplyResult>;
  return candidate.workspaceId === undefined || typeof candidate.workspaceId === 'string';
}

function isPersistedLifecycleEntry(value: unknown): value is ProposalLifecycleEntry {
  const candidate = value as Partial<ProposalLifecycleEntry>;
  return (
    !!candidate &&
    (candidate.status === 'applied' || candidate.status === 'dismissed') &&
    typeof candidate.completedAt === 'number' &&
    (candidate.startedAt === undefined || typeof candidate.startedAt === 'number') &&
    (candidate.lastAction === undefined ||
      candidate.lastAction === 'apply' ||
      candidate.lastAction === 'dismiss') &&
    (candidate.result === undefined || isProposalApplyResult(candidate.result))
  );
}

export function validateProposalLifecycleEntries(
  value: unknown,
): Record<string, ProposalLifecycleEntry> {
  const entries =
    value && typeof value === 'object' ? (value as { entries?: unknown }).entries : undefined;
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return {};
  const validEntries: Record<string, ProposalLifecycleEntry> = {};
  for (const [key, entry] of Object.entries(entries as Record<string, unknown>)) {
    if (key && isPersistedLifecycleEntry(entry)) validEntries[key] = entry;
  }
  return validEntries;
}

function serializeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Unknown action error');
}

function canApply(entry: ProposalLifecycleEntry | null): boolean {
  return (
    !entry || entry.status === 'idle' || (entry.status === 'failed' && entry.lastAction === 'apply')
  );
}

function canUndo(entry: ProposalLifecycleEntry | null, hasHistory: boolean): boolean {
  return (
    entry?.status === 'applied' ||
    (entry?.status === 'failed' && entry.lastAction === 'undo') ||
    hasHistory
  );
}

function* hasUndoHistory(kind: string, proposalId: string): SagaGenerator<boolean> {
  if (kind === 'settings-change') {
    return Boolean(yield* selectProposalAppliedState.effect(proposalId));
  }
  if (kind === 'specialist-edit') {
    return Boolean(yield* selectSpecialistProposalAppliedState.effect(proposalId));
  }
  return false;
}

const activeProposalWork = new Set<string>();

function beginProposalWork(proposalId: string): boolean {
  if (activeProposalWork.has(proposalId)) return false;
  activeProposalWork.add(proposalId);
  return true;
}

function endProposalWork(proposalId: string): void {
  activeProposalWork.delete(proposalId);
}

export function* handleApplyProposal(
  action: ReturnType<typeof applyProposalRequested>,
): SagaGenerator<void> {
  const [{ proposalId, kind, detail }] = action.payload;
  if (!beginProposalWork(proposalId)) return;
  const startedAt = Date.now();

  try {
    const entry = yield* selectProposalLifecycleEntry.effect(proposalId);
    if (!canApply(entry)) return;

    yield* put(proposalApplyStarted({ proposalId, startedAt }));
    if (kind === 'settings-change') {
      const { reverseChanges } = yield* call(applySettingsProposalWork, detail);
      const completedAt = Date.now();
      yield* put(proposalApplySucceeded({ proposalId, completedAt }));
      yield* put(recordProposalApplied({ proposalId, appliedAt: completedAt, reverseChanges }));
      return;
    }

    if (kind === 'specialist-edit') {
      const { reverse } = yield* call(applySpecialistProposalWork, detail);
      const completedAt = Date.now();
      yield* put(proposalApplySucceeded({ proposalId, completedAt }));
      yield* put(recordSpecialistApplied({ proposalId, appliedAt: completedAt, reverse }));
      return;
    }

    throw new Error(`Unsupported proposal kind: ${kind}`);
  } catch (error) {
    const completedAt = Date.now();
    const message = serializeError(error);
    yield* put(proposalFailed({ proposalId, error: message, completedAt, lastAction: 'apply' }));
    yield* call(toast.error, m.chat_proposalLifecycle_applyFailed_label(), {
      description: message,
    });
  } finally {
    endProposalWork(proposalId);
  }
}

export function* handleUndoProposal(
  action: ReturnType<typeof undoProposalRequested>,
): SagaGenerator<void> {
  const [{ proposalId, kind }] = action.payload;
  if (!beginProposalWork(proposalId)) return;

  try {
    const entry = yield* selectProposalLifecycleEntry.effect(proposalId);
    const historyAvailable = yield* hasUndoHistory(kind, proposalId);
    if (!canUndo(entry, historyAvailable)) return;

    const startedAt = Date.now();
    yield* put(proposalUndoStarted({ proposalId, startedAt }));
    if (kind === 'settings-change') {
      const appliedState = yield* selectProposalAppliedState.effect(proposalId);
      if (!appliedState) throw new Error('No applied settings proposal history found');
      yield* call(undoSettingsProposalWork, appliedState.reverseChanges);
      const completedAt = Date.now();
      yield* put(proposalUndoSucceeded({ proposalId, completedAt }));
      yield* put(clearProposalApplied(proposalId));
      return;
    }

    if (kind === 'specialist-edit') {
      const appliedState = yield* selectSpecialistProposalAppliedState.effect(proposalId);
      if (!appliedState) throw new Error('No applied specialist proposal history found');
      yield* call(undoSpecialistProposalWork, appliedState.reverse);
      const completedAt = Date.now();
      yield* put(proposalUndoSucceeded({ proposalId, completedAt }));
      yield* put(clearSpecialistApplied(proposalId));
      return;
    }

    throw new Error(`Unsupported proposal kind: ${kind}`);
  } catch (error) {
    const completedAt = Date.now();
    const message = serializeError(error);
    yield* put(proposalFailed({ proposalId, error: message, completedAt, lastAction: 'undo' }));
    yield* call(toast.error, m.chat_proposalLifecycle_undoFailed_label(), {
      description: message,
    });
  } finally {
    endProposalWork(proposalId);
  }
}

export function* hydrateProposalLifecycleSaga(): SagaGenerator<void> {
  const stored = yield* call(getLocalStorageJSON<unknown>, PROPOSAL_LIFECYCLE_STORAGE_KEY);
  const validEntries = validateProposalLifecycleEntries(stored);
  const prunedEntries = pruneAppliedProposalLifecycleEntries(validEntries, Date.now());
  yield* put(hydrateProposalLifecycle(prunedEntries));
}

export function* persistProposalLifecycleSaga(): SagaGenerator<void> {
  const entries = yield* selectProposalLifecycleMap.effect();
  const prunedEntries = pruneAppliedProposalLifecycleEntries(entries, Date.now());
  const cappedEntries = Object.fromEntries(
    Object.entries(prunedEntries)
      .sort(([, a], [, b]) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
      .slice(0, PROPOSAL_LIFECYCLE_MAX_PERSISTED_ENTRIES),
  );
  yield* call(setLocalStorageJSON, PROPOSAL_LIFECYCLE_STORAGE_KEY, { entries: cappedEntries });
}

function* debouncedPersistProposalLifecycleSaga(): SagaGenerator<void> {
  yield* delay(PROPOSAL_LIFECYCLE_PERSIST_DEBOUNCE_MS);
  yield* call(persistProposalLifecycleSaga);
}

function* watchProposalLifecyclePersistenceSaga(): SagaGenerator<void> {
  yield* takeLatest(
    [
      proposalApplySucceeded,
      proposalUndoSucceeded,
      proposalFailed,
      proposalResolutionReconciled,
      clearProposalLifecycle,
      hydrateProposalLifecycle,
    ],
    debouncedPersistProposalLifecycleSaga,
  );
}

export function* proposalLifecycleSaga(): SagaGenerator<void> {
  yield* call(hydrateProposalLifecycleSaga);
  yield* fork(watchProposalLifecyclePersistenceSaga);
  yield* takeEvery(applyProposalRequested, handleApplyProposal);
  yield* takeEvery(undoProposalRequested, handleUndoProposal);
}
