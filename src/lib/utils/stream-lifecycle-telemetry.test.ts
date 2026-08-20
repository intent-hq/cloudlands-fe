import { beforeEach, describe, expect, it, vi } from 'vitest';

const { infoSpy } = vi.hoisted(() => ({ infoSpy: vi.fn() }));

vi.mock('$lib/logging/logger.svelte', () => ({
  LogCategory: { AGENT: 'agent' },
  logger: { info: infoSpy },
}));

import {
  __resetStreamLifecycleTelemetryForTests,
  MAX_STREAM_LIFECYCLE_DIAGNOSTICS,
  reportStreamLifecycle,
  streamTurnCorrelation,
} from './stream-lifecycle-telemetry';

describe('stream lifecycle telemetry', () => {
  beforeEach(() => {
    infoSpy.mockClear();
    __resetStreamLifecycleTelemetryForTests();
  });

  it('matches the daemon FNV-1a 64-bit UTF-8 correlation format', () => {
    expect(streamTurnCorrelation('hello')).toBe('a430d84680aabd0b');
    expect(streamTurnCorrelation('')).toBeUndefined();
    expect(streamTurnCorrelation(undefined)).toBeUndefined();
  });

  it('hard-caps persisted diagnostic records for one renderer session', () => {
    for (let index = 0; index < MAX_STREAM_LIFECYCLE_DIAGNOSTICS + 2; index += 1) {
      reportStreamLifecycle({ stage: 'store', event: 'update-applied', blockCount: 1 });
    }

    expect(infoSpy).toHaveBeenCalledTimes(MAX_STREAM_LIFECYCLE_DIAGNOSTICS);
  });
});
