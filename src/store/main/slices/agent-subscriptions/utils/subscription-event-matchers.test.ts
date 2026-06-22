import { describe, expect, it } from 'vitest';
import type { WorkspaceEvent } from '../../../../../features/events/types';
import type { SerializableDataMatcher } from '../types';
import { matchesDataMatcher, matchesDataMatchers } from './subscription-event-matchers';

function event(data: Record<string, unknown>): WorkspaceEvent {
  return {
    id: 'event-1',
    type: 'agent:idle',
    timestamp: '2026-06-22T00:00:00.000Z',
    data,
  } as WorkspaceEvent;
}

describe('subscription event matchers', () => {
  it('supports regex object and string patterns', () => {
    const idleEvent = event({ reason: 'stream_complete' });

    expect(
      matchesDataMatcher(idleEvent, {
        field: 'data.reason',
        operator: 'matches',
        value: { pattern: '^stream_', flags: '' },
      }),
    ).toBe(true);
    expect(
      matchesDataMatcher(idleEvent, {
        field: 'data.reason',
        operator: 'matches',
        value: '^stream_',
      }),
    ).toBe(true);
  });

  it('does not treat matcher objects without a pattern as match-all regexes', () => {
    expect(
      matchesDataMatcher(event({ reason: 'stream_complete' }), {
        field: 'data.reason',
        operator: 'matches',
        value: { flags: '' } as unknown as SerializableDataMatcher['value'],
      }),
    ).toBe(false);
  });

  it('requires all data matchers to match', () => {
    expect(
      matchesDataMatchers(event({ reason: 'stream_complete', status: 'idle' }), [
        { field: 'data.reason', operator: 'contains', value: 'stream' },
        { field: 'data.status', operator: 'equals', value: 'idle' },
      ]),
    ).toBe(true);
    expect(
      matchesDataMatchers(event({ reason: 'stream_complete', status: 'idle' }), [
        { field: 'data.reason', operator: 'contains', value: 'stream' },
        { field: 'data.status', operator: 'equals', value: 'busy' },
      ]),
    ).toBe(false);
  });
});