import { call, debounce, fork, put, type SagaGenerator } from 'typed-redux-saga';
import { getLocalStorageJSON, setLocalStorageJSON } from '$store/renderer/utils/safe-local-storage-saga';
import {
  clearSpecialistApplied,
  hydrateSpecialistProposalHistory,
  pruneExpiredSpecialistProposalHistoryEntries,
  recordSpecialistApplied,
} from '../specialist-proposal-history-slice';
import { selectSpecialistProposalHistoryEntries } from '../specialist-proposal-history-selectors';
import type {
  FileSpecialistWritePayload,
  SpecialistProposalHistoryEntry,
  SpecialistReverseAction,
} from '../specialist-proposal-history-types';

export const SPECIALIST_PROPOSAL_HISTORY_STORAGE_KEY = 'intent.specialistProposalHistory.v1';
export const SPECIALIST_PROPOSAL_HISTORY_PERSIST_DEBOUNCE_MS = 500;
export const SPECIALIST_PROPOSAL_HISTORY_MAX_PERSISTED_ENTRIES = 200;

function isSpecialistFileScope(value: unknown): value is 'project' | 'user' {
  return value === 'project' || value === 'user';
}

function isModelTier(value: unknown): value is 'fast' | 'balanced' | 'smart' {
  return value === 'fast' || value === 'balanced' || value === 'smart';
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isFileSpecialistWritePayload(value: unknown): value is FileSpecialistWritePayload {
  const candidate = value as Partial<FileSpecialistWritePayload>;
  return (
    !!candidate &&
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.description === 'string' &&
    typeof candidate.behaviorPrompt === 'string' &&
    isOptionalString(candidate.codingAgent) &&
    isOptionalString(candidate.model) &&
    (candidate.modelTier === undefined || isModelTier(candidate.modelTier)) &&
    isOptionalString(candidate.roleReminder) &&
    (candidate.scope === undefined || isSpecialistFileScope(candidate.scope)) &&
    isOptionalString(candidate.workspacePath)
  );
}

function isReverseAction(value: unknown): value is SpecialistReverseAction {
  const candidate = value as Partial<SpecialistReverseAction>;
  if (!candidate || typeof candidate !== 'object') return false;
  if (candidate.kind === 'delete') {
    const deleteAction = candidate as Partial<Extract<SpecialistReverseAction, { kind: 'delete' }>>;
    return (
      typeof deleteAction.id === 'string' &&
      isSpecialistFileScope(deleteAction.scope) &&
      isOptionalString(deleteAction.workspacePath)
    );
  }
  if (candidate.kind === 'save') {
    return isFileSpecialistWritePayload(
      (candidate as Partial<Extract<SpecialistReverseAction, { kind: 'save' }>>).specialist,
    );
  }
  return false;
}

function isHistoryEntry(value: unknown): value is SpecialistProposalHistoryEntry {
  const candidate = value as Partial<SpecialistProposalHistoryEntry>;
  return (
    !!candidate && typeof candidate.appliedAt === 'number' && isReverseAction(candidate.reverse)
  );
}

export function validateSpecialistProposalHistoryEntries(
  value: unknown,
): Record<string, SpecialistProposalHistoryEntry> {
  const entries =
    value && typeof value === 'object' ? (value as { entries?: unknown }).entries : undefined;
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return {};
  const validEntries: Record<string, SpecialistProposalHistoryEntry> = {};
  for (const [key, entry] of Object.entries(entries as Record<string, unknown>)) {
    if (key && isHistoryEntry(entry)) validEntries[key] = entry;
  }
  return validEntries;
}

export function* hydrateSpecialistProposalHistorySaga(): SagaGenerator<void> {
  const stored = yield* call(getLocalStorageJSON<unknown>, SPECIALIST_PROPOSAL_HISTORY_STORAGE_KEY);
  const validEntries = validateSpecialistProposalHistoryEntries(stored);
  const prunedEntries = pruneExpiredSpecialistProposalHistoryEntries(validEntries, Date.now());
  yield* put(hydrateSpecialistProposalHistory(prunedEntries));
}

export function* persistSpecialistProposalHistorySaga(): SagaGenerator<void> {
  const entries = yield* selectSpecialistProposalHistoryEntries.effect();
  const prunedEntries = pruneExpiredSpecialistProposalHistoryEntries(entries, Date.now());
  const cappedEntries = Object.fromEntries(
    Object.entries(prunedEntries)
      .sort(([, a], [, b]) => b.appliedAt - a.appliedAt)
      .slice(0, SPECIALIST_PROPOSAL_HISTORY_MAX_PERSISTED_ENTRIES),
  );
  yield* call(setLocalStorageJSON, SPECIALIST_PROPOSAL_HISTORY_STORAGE_KEY, {
    entries: cappedEntries,
  });
}

export function* watchSpecialistProposalHistoryPersistenceSaga(): SagaGenerator<void> {
  yield* debounce(
    SPECIALIST_PROPOSAL_HISTORY_PERSIST_DEBOUNCE_MS,
    [recordSpecialistApplied.type, clearSpecialistApplied.type],
    persistSpecialistProposalHistorySaga,
  );
}

export function* specialistProposalHistorySaga(): SagaGenerator<void> {
  yield* call(hydrateSpecialistProposalHistorySaga);
  yield* fork(watchSpecialistProposalHistoryPersistenceSaga);
}
