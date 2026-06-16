import { store } from "../../store";
import { type StreamingProfileName } from './streaming-config-types';

/** Select the current profile name */
export const selectStreamingProfileName = store.createSelector(
  (state): StreamingProfileName => state.streamingConfig.currentProfile,
);

