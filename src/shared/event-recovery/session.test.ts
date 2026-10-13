import { describe, expect, it, vi } from 'vitest';
import { createEventRecoverySession, type RecoveryNotification } from './session';

describe('ordered recovery ingress', () => {
  it('waits for the owner callback and commits at the end boundary before later frames', async () => {
    let receive!: (n: RecoveryNotification) => void;
    let observe!: (result: unknown) => void;
    let release!: () => void;
    const order: string[] = [];
    const session = createEventRecoverySession({
      supported: true,
      isCurrent: () => true,
      onRetired: () => () => {},
      onNotification: (handler) => {
        receive = handler;
        return () => {};
      },
      request: vi.fn((_method, _params, callback) => {
        observe = callback!;
        return new Promise(() => {});
      }),
      dispose: () => {},
    });
    session.onNotification((n) =>
      n.method === 'old'
        ? new Promise<void>((resolve) => {
            release = () => {
              order.push('old');
              resolve();
            };
          })
        : void order.push(n.method),
    );
    receive({ method: 'old' });
    const fence = session.fence(['a'], () => {
      order.push('fence');
    });
    observe({ subscriptionIds: ['a'] });
    receive({ method: 'later' });
    expect(order).toEqual([]);
    release();
    await fence;
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(['old', 'fence', 'later']);
    session.dispose();
  });
  it('fails closed when an owner callback fails or a fence echoes a different set', async () => {
    let receive!: (n: RecoveryNotification) => void;
    const session = createEventRecoverySession({
      supported: true,
      isCurrent: () => true,
      onRetired: () => () => {},
      onNotification: (h) => {
        receive = h;
        return () => {};
      },
      request: async (_m, _p, observe) => {
        observe?.({ subscriptionIds: ['foreign'] });
        return {};
      },
      dispose: () => {},
    });
    await expect(session.fence(['a'], () => {})).rejects.toThrow();
    session.onNotification(() => {
      throw Error('owner failed');
    });
    receive({ method: 'events.event' });
    expect(session.isCurrent()).toBe(false);
  });
});

it('never commits a fence whose callback is released after its finite timeout', async () => {
  vi.useFakeTimers();
  let receive!: (n: RecoveryNotification) => void,
    observed!: (result: unknown) => void,
    release!: () => void;
  const session = createEventRecoverySession({
    supported: true,
    isCurrent: () => true,
    onRetired: () => () => {},
    onNotification: (fn) => {
      receive = fn;
      return () => {};
    },
    request: (_m, _p, fn) => {
      observed = fn!;
      return new Promise(() => {});
    },
    dispose: () => {},
  });
  session.onNotification(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  receive({ method: 'held' });
  const apply = vi.fn(),
    fence = session.fence(['a'], apply);
  const failed = expect(fence).rejects.toThrow('timed out');
  observed({ subscriptionIds: ['a'] });
  await vi.advanceTimersByTimeAsync(5000);
  await failed;
  release();
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(apply).not.toHaveBeenCalled();
  session.dispose();
  vi.useRealTimers();
});
