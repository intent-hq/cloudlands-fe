import { describe, expect, it, vi } from 'vitest';
import {
  createEventRecoverySession,
  RecoveryRequestTimeoutError,
  type RecoveryNotification,
} from './session';

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

it('retires a stalled ingress rather than retaining an event-sized unbounded queue', async () => {
  let receive!: (n: RecoveryNotification) => void, release!: () => void;
  const retired = vi.fn();
  const session = createEventRecoverySession({
    supported: true,
    isCurrent: () => true,
    onRetired: () => () => {},
    onNotification: (fn) => {
      receive = fn;
      return () => {};
    },
    request: async () => ({}),
    dispose: () => {},
  });
  session.onRetired(retired);
  session.onNotification(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  for (let i = 0; i < 1025; i++) receive({ method: 'events.event' });
  expect(retired).toHaveBeenCalledOnce();
  expect(session.isCurrent()).toBe(false);
  release();
  for (let i = 0; i < 10; i++) await Promise.resolve();
  session.dispose();
});

it('reports timeout immediately but drains both the wire reply and preceding owner work', async () => {
  vi.useFakeTimers();
  try {
    let receive!: (n: RecoveryNotification) => void;
    let observe!: (result: unknown) => void;
    const wire = Promise.withResolvers<unknown>();
    const owner = Promise.withResolvers<void>();
    const session = createEventRecoverySession({
      supported: true,
      isCurrent: () => true,
      onRetired: () => () => {},
      onNotification: (handler) => {
        receive = handler;
        return () => {};
      },
      request: (_method, _params, callback) => {
        observe = callback!;
        return wire.promise;
      },
      dispose: () => {},
    });
    session.onNotification(() => owner.promise);
    receive({ method: 'held' });
    const apply = vi.fn();
    const failure = session.fence(['a'], apply).catch((error: unknown) => error);
    observe({ subscriptionIds: ['a'] });
    await vi.advanceTimersByTimeAsync(5000);
    const error = (await failure) as { message: string; drained: Promise<void> };
    expect(error).toMatchObject({
      message: 'Event recovery request timed out',
      drained: expect.any(Promise),
    });
    const drained = vi.fn();
    void error.drained.then(drained);
    wire.resolve({ subscriptionIds: ['a'] });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(drained).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    owner.resolve();
    await error.drained;
    expect(drained).toHaveBeenCalledOnce();
    expect(apply).not.toHaveBeenCalled();
    session.dispose();
  } finally {
    vi.useRealTimers();
  }
});

it('releases timeout drain waiters on retirement without accepting a late reply', async () => {
  vi.useFakeTimers();
  try {
    const wire = Promise.withResolvers<unknown>();
    let retire = () => {};
    const session = createEventRecoverySession({
      supported: true,
      isCurrent: () => true,
      onRetired: (handler) => {
        retire = handler;
        return () => {};
      },
      onNotification: () => () => {},
      request: () => wire.promise,
      dispose: () => {},
    });
    const failure = session.request('data.read').catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(30_000);
    const error = (await failure) as { drained: Promise<void> };
    expect(error.drained).toBeInstanceOf(Promise);
    retire();
    await error.drained;
    expect(session.isCurrent()).toBe(false);
    wire.resolve('expired');
    await expect(session.request('data.read')).rejects.toThrow('retired');
    expect(vi.getTimerCount()).toBe(0);
    session.dispose();
  } finally {
    vi.useRealTimers();
  }
});

for (const retired of [false, true])
  it(`exposes eventual timeout failures only within the original session (retired=${retired})`, async () => {
    vi.useFakeTimers();
    try {
      const wire = Promise.withResolvers<unknown>();
      const session = createEventRecoverySession({
        supported: true,
        isCurrent: () => true,
        onRetired: () => () => {},
        onNotification: () => () => {},
        request: () => wire.promise,
        dispose: () => {},
      });
      const failed = session.request('data.read').catch((error) => error);
      await vi.advanceTimersByTimeAsync(30_000);
      const timeout = (await failed) as RecoveryRequestTimeoutError;
      expect(timeout.completion).toBeInstanceOf(Promise);
      if (retired) session.dispose();
      const error = { rpcCode: -32003 };
      wire.reject(error);
      expect(await timeout.completion).toEqual({ retired, errors: retired ? [] : [error] });
      await timeout.drained;
      session.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
