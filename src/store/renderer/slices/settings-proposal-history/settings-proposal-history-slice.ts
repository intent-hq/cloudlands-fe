import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import type {
  SettingsProposalHistoryState,
} from './settings-proposal-history-types';

export const initialState: SettingsProposalHistoryState = { entries: {} };

export const settingsProposalHistoryReducer =
  createReducer<SettingsProposalHistoryState>(initialState);
