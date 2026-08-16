import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";
import type {
  SettingsProposalHistoryEntry,
  SettingsProposalHistoryState,
} from './settings-proposal-history-types';

export const SETTINGS_PROPOSAL_HISTORY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export const initialState: SettingsProposalHistoryState = { entries: {} };

export function pruneExpiredProposalHistoryEntries(
  entries: Record<string, SettingsProposalHistoryEntry>,
  now: number,
): Record<string, SettingsProposalHistoryEntry> {
  const cutoff = now - SETTINGS_PROPOSAL_HISTORY_RETENTION_MS;
  return Object.fromEntries(
    Object.entries(entries).filter(([, entry]) => entry.appliedAt >= cutoff),
  );
}

export const settingsProposalHistoryReducer = createReducer<SettingsProposalHistoryState>(
  initialState,
);
