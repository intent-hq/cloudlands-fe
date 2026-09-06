import { describe, it, expect } from 'vitest';
import { streamingConfigReducer, initialState } from './streaming-config-slice';
import {
  STREAMING_PROFILES,
  resolveStreamingConfig,
  calculateBackoff,
} from './streaming-config-types';

describe('streamingConfigReducer', () => {
  it('should return initial state', () => {
    const state = streamingConfigReducer(undefined, { type: '@@INIT' });
    expect(state).toEqual(initialState);
    expect(state.currentProfile).toBe('standard');
    expect(state.customConfig).toBeNull();
    expect(state.sessionProfiles).toEqual({});
  });
});

describe('resolveStreamingConfig', () => {
  it('should return profile config without custom overrides', () => {
    const config = resolveStreamingConfig('fast');
    expect(config).toEqual(STREAMING_PROFILES.fast.config);
  });

  it('should merge custom overrides', () => {
    const config = resolveStreamingConfig('standard', { chunkFlushInterval: 100 });
    expect(config.chunkFlushInterval).toBe(100);
    expect(config.completionDetection).toBe(STREAMING_PROFILES.standard.config.completionDetection);
  });
});

describe('calculateBackoff', () => {
  it('should apply exponential backoff', () => {
    const config = STREAMING_PROFILES.standard.config;
    const backoff0 = calculateBackoff(0, config);
    const backoff1 = calculateBackoff(1, config);
    expect(backoff0).toBe(1000); // 1.5^0 * 1000 = 1000
    expect(backoff1).toBe(1500); // 1.5^1 * 1000 = 1500
  });

  it('should cap at maxBackoffTime', () => {
    const config = STREAMING_PROFILES.standard.config;
    const backoff = calculateBackoff(100, config);
    expect(backoff).toBe(config.maxBackoffTime);
  });
});
