import { createSelector } from '../../utils/create-selector';
import {
  resolveStreamingConfig,
  STREAMING_PROFILES,
  type StreamingProfileName,
  type StreamingTimeoutConfig,
  type StreamingProfile,
} from './streaming-config-types';

/** Select the current profile name */
export const selectStreamingProfileName = createSelector(
  (state): StreamingProfileName => state.streamingConfig.currentProfile,
);

/** Select the resolved config (profile + custom overrides) for the global profile */
export const selectStreamingConfig = createSelector(
  (state): StreamingTimeoutConfig => {
    const { currentProfile, customConfig } = state.streamingConfig;
    return resolveStreamingConfig(currentProfile, customConfig);
  },
);

/** Select the resolved config for a specific session */
export const selectSessionStreamingConfig = createSelector(
  (state, sessionId: string): StreamingTimeoutConfig => {
    const { currentProfile, customConfig, sessionProfiles } = state.streamingConfig;
    const profileName = sessionProfiles[sessionId] || currentProfile;
    return resolveStreamingConfig(profileName, customConfig);
  },
);

/** Select all available profiles */
export const selectStreamingProfiles = createSelector(
  (): StreamingProfile[] => Object.values(STREAMING_PROFILES),
);

/** Select the custom config overrides (null if none) */
export const selectCustomStreamingConfig = createSelector(
  (state): Partial<StreamingTimeoutConfig> | null => state.streamingConfig.customConfig,
);

