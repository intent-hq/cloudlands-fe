import { describe, expect, it } from 'vitest';

import { cancelPrMonitor, flushPrMonitor } from '$features/pr-monitor/pr-monitor-service';
import { cancelPrMonitorRequested, flushPrMonitorRequested } from '../pr-monitor-slice';
import { cancelPrMonitorWorker, flushPrMonitorWorker, prMonitorSaga } from './pr-monitor-saga';

describe('prMonitorSaga', () => {
  it('forwards flush and cancel triggers with their exact wire arguments', () => {
    const flushIterator = flushPrMonitorWorker(flushPrMonitorRequested('ws-1', 'mon-1'));
    const flushEffect = flushIterator.next().value as {
      type: string;
      payload: { fn: unknown; args: unknown[] };
    };
    expect(flushEffect.type).toBe('CALL');
    expect(flushEffect.payload.fn).toBe(flushPrMonitor);
    expect(flushEffect.payload.args).toEqual(['ws-1', 'mon-1']);

    const cancelIterator = cancelPrMonitorWorker(cancelPrMonitorRequested('ws-1', 'mon-1'));
    const cancelEffect = cancelIterator.next().value as {
      type: string;
      payload: { fn: unknown; args: unknown[] };
    };
    expect(cancelEffect.type).toBe('CALL');
    expect(cancelEffect.payload.fn).toBe(cancelPrMonitor);
    expect(cancelEffect.payload.args).toEqual(['ws-1', 'mon-1']);
  });

  it('registers subscription, unsubscription, and command watchers', () => {
    const iterator = prMonitorSaga();
    const effect = iterator.next().value as {
      type: string;
      payload: Array<{ type: string; payload: { fn: unknown } }>;
    };

    expect(effect.type).toBe('ALL');
    expect(effect.payload).toHaveLength(4);
    const childEffects = effect.payload.map(
      (child) => (child as unknown as Generator).next().value as { type: string },
    );
    expect(childEffects.map((child) => child.type)).toEqual(Array(4).fill('CALL'));
  });
});
