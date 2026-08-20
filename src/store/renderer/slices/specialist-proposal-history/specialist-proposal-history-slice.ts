import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import type {
  SpecialistProposalHistoryState,
} from './specialist-proposal-history-types';

export const initialState: SpecialistProposalHistoryState = { entries: {} };

export const specialistProposalHistoryReducer =
  createReducer<SpecialistProposalHistoryState>(initialState);
