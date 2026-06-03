import { createAction } from 'ag-redux-toolkit/utils/store/create-action';
import { createReducer } from 'ag-redux-toolkit/utils/store/create-reducer';
import {
  DEFAULT_PROFILE,
  STREAMING_PROFILES,
  type StreamingConfigState,
  type StreamingProfileName,
} from './streaming-config-types';

// ============================================================================
// Initial State
// ============================================================================

export const initialState: StreamingConfigState = {
  currentProfile: DEFAULT_PROFILE,
  customConfig: null,
  sessionProfiles: {},
};

// ============================================================================
// Reducer Actions (pure state updates)
// ============================================================================

/** Set the active streaming profile for all sessions */
export const setStreamingProfile = createAction<[profileName: StreamingProfileName]>(
  'streamingConfig/setProfile',
);

/** Reset all streaming config to defaults */
export const resetStreamingConfig = createAction('streamingConfig/reset');

/** Hydrate from localStorage (used by init saga) */
export const hydrateStreamingProfile = createAction<[profileName: StreamingProfileName]>(
  'streamingConfig/hydrate',
);

// ============================================================================
// Reducer
// ============================================================================

function isValidProfile(name: string): name is StreamingProfileName {
  return Object.hasOwn(STREAMING_PROFILES, name);
}

export const streamingConfigReducer = createReducer<StreamingConfigState>(initialState)
  .with(setStreamingProfile, (state, { payload: [profileName] }) => {
    const validProfile = isValidProfile(profileName) ? profileName : DEFAULT_PROFILE;
    return { ...state, currentProfile: validProfile };
  })
  .with(resetStreamingConfig, () => ({
    ...initialState,
    sessionProfiles: {},
  }))
  .with(hydrateStreamingProfile, (state, { payload: [profileName] }) => {
    const validProfile = isValidProfile(profileName) ? profileName : DEFAULT_PROFILE;
    return { ...state, currentProfile: validProfile };
  });

