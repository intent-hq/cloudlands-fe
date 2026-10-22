import { expect, it } from 'vitest';
import { frameMetadata } from './payload-stream';

it('does not invent an interval origin for older frames without origin metadata', () => {
  const text = frameMetadata({
    sequence: 8,
    side: 'response',
    rpcMethod: 'events.event',
    timestamp: 1000,
    intervalMs: 5,
    payload: { text: '{}', state: 'complete', originalBytes: 2, retainedBytes: 2 },
  });
  expect(text).toContain('5 ms');
  expect(text).not.toContain('since request');
  expect(text).not.toContain('since previous');
});
