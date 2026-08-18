import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";
import type {
  SpecialistProposalHistoryEntry,
  SpecialistProposalHistoryState,
} from './specialist-proposal-history-types';

export const SPECIALIST_PROPOSAL_HISTORY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export const initialState: SpecialistProposalHistoryState = { entries: {} };

export function pruneExpiredSpecialistProposalHistoryEntries(
  entries: Record<string, SpecialistProposalHistoryEntry>,
  now: number,
): Record<string, SpecialistProposalHistoryEntry> {
  const cutoff = now - SPECIALIST_PROPOSAL_HISTORY_RETENTION_MS;
  return Object.fromEntries(
    Object.entries(entries).filter(([, entry]) => entry.appliedAt >= cutoff),
  );
}

export const specialistProposalHistoryReducer = createReducer<SpecialistProposalHistoryState>(
  initialState,
);
