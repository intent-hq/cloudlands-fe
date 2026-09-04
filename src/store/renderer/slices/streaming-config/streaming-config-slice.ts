import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import { DEFAULT_PROFILE, type StreamingConfigState } from './streaming-config-types';

// ============================================================================
// Initial State
// ============================================================================

export const initialState: StreamingConfigState = {
  currentProfile: DEFAULT_PROFILE,
  customConfig: null,
  sessionProfiles: {},
};

// ============================================================================
// Reducer
// ============================================================================

export const streamingConfigReducer = createReducer<StreamingConfigState>(initialState);
