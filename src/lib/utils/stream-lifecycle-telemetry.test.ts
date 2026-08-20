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
  RESERVED_TERMINAL_STREAM_LIFECYCLE_DIAGNOSTICS,
  streamTurnCorrelation,
} from './stream-lifecycle-telemetry';

describe('stream lifecycle telemetry', () => {
  beforeEach(() => {
    infoSpy.mockClear();
    __resetStreamLifecycleTelemetryForTests();
  });

  it('matches the daemon FNV-1a 64-bit UTF-8 correlation format', () => {
    expect(streamTurnCorrelation('hello')).toBe('a430d84680aabd0b');
    expect(streamTurnCorrelation('café')).toBe('48e8823acfa40d89');
    expect(streamTurnCorrelation('漢字')).toBe('e59f68cdb8251392');
    expect(streamTurnCorrelation('🙂')).toBe('ff026b387504e24b');
    expect(streamTurnCorrelation('agent-漢🙂')).toBe('c964da79f5a85701');
    expect(streamTurnCorrelation('')).toBeUndefined();
    expect(streamTurnCorrelation(undefined)).toBeUndefined();
  });

  it('reserves bounded capacity for late terminal diagnostics after ordinary exhaustion', () => {
    const ordinaryLimit =
      MAX_STREAM_LIFECYCLE_DIAGNOSTICS - RESERVED_TERMINAL_STREAM_LIFECYCLE_DIAGNOSTICS;
    for (let index = 0; index < MAX_STREAM_LIFECYCLE_DIAGNOSTICS + 2; index += 1) {
      reportStreamLifecycle({ stage: 'store', event: 'update-applied', blockCount: 1 });
    }

    expect(infoSpy).toHaveBeenCalledTimes(ordinaryLimit);

    reportStreamLifecycle({
      stage: 'bridge',
      event: 'stream-complete-dispatched',
      storeStreamState: 'idle',
    });
    reportStreamLifecycle({
      stage: 'bridge',
      event: 'agent-failed-received',
      storeStreamState: 'error',
    });
    reportStreamLifecycle({
      stage: 'render',
      event: 'assistant-message-committed',
      storeStreamState: 'idle',
      terminalErrorVisible: true,
    });
    expect(infoSpy).toHaveBeenCalledTimes(ordinaryLimit + 3);
    expect(infoSpy).toHaveBeenLastCalledWith(
      'agent',
      'stream-lifecycle',
      expect.objectContaining({ terminalErrorVisible: true }),
    );

    for (let index = 0; index < RESERVED_TERMINAL_STREAM_LIFECYCLE_DIAGNOSTICS; index += 1) {
      reportStreamLifecycle({ stage: 'bridge', event: 'stream-complete-dispatched' });
      reportStreamLifecycle({ stage: 'bridge', event: 'agent-failed-received' });
      reportStreamLifecycle({
        stage: 'render',
        event: 'assistant-message-not-committed',
        callbackResult: 'ignored',
      });
    }
    expect(infoSpy).toHaveBeenCalledTimes(MAX_STREAM_LIFECYCLE_DIAGNOSTICS);
  });
});
