import { runSaga, stdChannel } from 'redux-saga';
import { call, type SagaGenerator } from 'typed-redux-saga';
import { expect, it } from 'vitest';
import {
  mcpRecoveryInvalidated,
  settingsAuthorityRetired,
  settingsRecoveryInvalidated,
} from '../settings-events-slice';
import { settingsWorkScope } from './settings-work-scope';

it.each(['settings', 'mcp'] as const)(
  'restarts only the invalidated %s work and cancels it on authority retirement',
  async (resource) => {
    const channel = stdChannel();
    let starts = 0;
    let stops = 0;
    const pending = new Promise<void>(() => {});
    function* work(): SagaGenerator<void> {
      starts++;
      try {
        yield* call(() => pending);
      } finally {
        stops++;
      }
    }
    const task = runSaga({ channel }, settingsWorkScope, work, resource);
    try {
      expect(starts).toBe(1);
      const own = resource === 'mcp' ? mcpRecoveryInvalidated : settingsRecoveryInvalidated;
      const other = resource === 'mcp' ? settingsRecoveryInvalidated : mcpRecoveryInvalidated;
      channel.put(other());
      expect([starts, stops]).toEqual([1, 0]);
      channel.put(own());
      expect([starts, stops]).toEqual([2, 1]);
      channel.put(settingsAuthorityRetired());
      expect([starts, stops]).toEqual([3, 2]);
    } finally {
      task.cancel();
      await task.toPromise();
      channel.close();
    }
    expect(stops).toBe(3);
  },
);
