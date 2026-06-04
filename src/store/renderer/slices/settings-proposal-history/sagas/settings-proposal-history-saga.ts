import { call, debounce, fork, put, type SagaGenerator } from 'typed-redux-saga';
import { getLocalStorageJSON, setLocalStorageJSON } from '$store/renderer/utils/safe-local-storage-saga';
import {
  clearProposalApplied,
  hydrateProposalHistory,
  pruneExpiredProposalHistoryEntries,
  recordProposalApplied,
} from '../settings-proposal-history-slice';
import { selectSettingsProposalHistoryEntries } from '../settings-proposal-history-selectors';
import type {
  SettingsProposalHistoryEntry,
  SettingsProposalReverseChange,
} from '../settings-proposal-history-types';

export const SETTINGS_PROPOSAL_HISTORY_STORAGE_KEY = 'intent:settings-proposal-history:v1';
export const SETTINGS_PROPOSAL_HISTORY_PERSIST_DEBOUNCE_MS = 500;
export const SETTINGS_PROPOSAL_HISTORY_MAX_PERSISTED_ENTRIES = 200;

function isApplyPlan(value: unknown): boolean {
  return (
    !!value && typeof value === 'object' && typeof (value as { kind?: unknown }).kind === 'string'
  );
}

function isReverseChange(value: unknown): value is SettingsProposalReverseChange {
  const candidate = value as Partial<SettingsProposalReverseChange>;
  return !!candidate && typeof candidate.path === 'string' && isApplyPlan(candidate.apply);
}

function isHistoryEntry(value: unknown): value is SettingsProposalHistoryEntry {
  const candidate = value as Partial<SettingsProposalHistoryEntry>;
  return (
    !!candidate &&
    typeof candidate.appliedAt === 'number' &&
    Array.isArray(candidate.reverseChanges) &&
    candidate.reverseChanges.every(isReverseChange)
  );
}

export function validateProposalHistoryEntries(
  value: unknown,
): Record<string, SettingsProposalHistoryEntry> {
  const entries =
    value && typeof value === 'object' ? (value as { entries?: unknown }).entries : undefined;
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return {};
  const validEntries: Record<string, SettingsProposalHistoryEntry> = {};
  for (const [key, entry] of Object.entries(entries as Record<string, unknown>)) {
    if (key && isHistoryEntry(entry)) validEntries[key] = entry;
  }
  return validEntries;
}

export function* hydrateSettingsProposalHistorySaga(): SagaGenerator<void> {
  const stored = yield* call(getLocalStorageJSON<unknown>, SETTINGS_PROPOSAL_HISTORY_STORAGE_KEY);
  const validEntries = validateProposalHistoryEntries(stored);
  const prunedEntries = pruneExpiredProposalHistoryEntries(validEntries, Date.now());
  yield* put(hydrateProposalHistory(prunedEntries));
}

export function* persistSettingsProposalHistorySaga(): SagaGenerator<void> {
  const entries = yield* selectSettingsProposalHistoryEntries.effect();
  const prunedEntries = pruneExpiredProposalHistoryEntries(entries, Date.now());
  const cappedEntries = Object.fromEntries(
    Object.entries(prunedEntries)
      .sort(([, a], [, b]) => b.appliedAt - a.appliedAt)
      .slice(0, SETTINGS_PROPOSAL_HISTORY_MAX_PERSISTED_ENTRIES),
  );
  yield* call(setLocalStorageJSON, SETTINGS_PROPOSAL_HISTORY_STORAGE_KEY, {
    entries: cappedEntries,
  });
}

export function* watchSettingsProposalHistoryPersistenceSaga(): SagaGenerator<void> {
  yield* debounce(
    SETTINGS_PROPOSAL_HISTORY_PERSIST_DEBOUNCE_MS,
    [recordProposalApplied.type, clearProposalApplied.type],
    persistSettingsProposalHistorySaga,
  );
}

export function* settingsProposalHistorySaga(): SagaGenerator<void> {
  yield* call(hydrateSettingsProposalHistorySaga);
  yield* fork(watchSettingsProposalHistoryPersistenceSaga);
}
