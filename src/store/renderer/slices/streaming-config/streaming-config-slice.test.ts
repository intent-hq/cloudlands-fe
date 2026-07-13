import {
  describe,
  it,
  expect,
} from 'vitest';
import {
  streamingConfigReducer,
  initialState,
  setStreamingProfile,
  resetStreamingConfig,
  hydrateStreamingProfile,
} from './streaming-config-slice';
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

  describe('setStreamingProfile', () => {
    it('should set a valid profile', () => {
      const state = streamingConfigReducer(initialState, setStreamingProfile('fast'));
      expect(state.currentProfile).toBe('fast');
    });

    it('should fallback to default for unknown profile', () => {
      const state = streamingConfigReducer(
        initialState,
        setStreamingProfile('nonexistent' as any),
      );
      expect(state.currentProfile).toBe('standard');
    });

    it('should not mutate previous state', () => {
      const state = streamingConfigReducer(initialState, setStreamingProfile('longRunning'));
      expect(initialState.currentProfile).toBe('standard');
      expect(state.currentProfile).toBe('longRunning');
    });
  });

  describe('resetStreamingConfig', () => {
    it('should reset to defaults', () => {
      const state = streamingConfigReducer(
        initialState,
        setStreamingProfile('longRunning'),
      );

      const reset = streamingConfigReducer(state, resetStreamingConfig());
      expect(reset.currentProfile).toBe('standard');
      expect(reset.customConfig).toBeNull();
      expect(reset.sessionProfiles).toEqual({});
    });
  });

  describe('hydrateStreamingProfile', () => {
    it('should set profile from localStorage', () => {
      const state = streamingConfigReducer(initialState, hydrateStreamingProfile('toolHeavy'));
      expect(state.currentProfile).toBe('toolHeavy');
    });
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

