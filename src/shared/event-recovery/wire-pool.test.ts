import { afterEach, expect, it, vi } from 'vitest';
import { RecoveryWirePool } from './wire-pool';

afterEach(() => vi.useRealTimers());
it('signals a confirmed identity only when old physical work drains and detaches listeners', async () => {
  vi.useFakeTimers();
  const pool = new RecoveryWirePool();
  let identity: object | undefined = {};
  const old = identity;
  const held = Promise.withResolvers<unknown>();
  const request = pool
    .capture(
      old,
      () => identity === old,
      () => held.promise,
    )!
    .request('read');
  const changes = vi.fn();
  const off = pool.onChange(changes);
  identity = undefined;
  expect(pool.canCapture(identity)).toBe(false);
  await vi.advanceTimersByTimeAsync(60_000);
  identity = {};
  expect(pool.canCapture(identity)).toBe(false);
  changes.mockClear();
  held.resolve('stale');
  await request;
  expect(pool.canCapture(identity)).toBe(true);
  expect(changes).toHaveBeenCalledTimes(1);
  off();
  pool
    .capture(
      identity,
      () => true,
      async () => null,
    )!
    .dispose();
  expect(changes).toHaveBeenCalledTimes(1);
});
it('rejects captured hello and reserves a finite cleanup queue before subscribing', async () => {
  const pool = new RecoveryWirePool();
  const raw = vi.fn(async (_method, _params, observe) => {
    const ack = { subscriptionId: String(raw.mock.calls.length) };
    observe?.(ack);
    return ack;
  });
  const capture = pool.capture({}, () => true, raw)!;
  await expect(capture.request('client.hello')).rejects.toThrow();
  expect(raw).not.toHaveBeenCalled();
  for (let i = 0; i < 128; i++) await capture.request('events.subscribe');
  await expect(capture.request('events.subscribe')).rejects.toThrow('limit');
  expect(raw).toHaveBeenCalledTimes(128);
  capture.dispose();
});
it('observes explicit cleanup replies and deduplicates a second cleanup after settlement', async () => {
  const pool = new RecoveryWirePool();
  const raw = vi.fn(async (method, _params, observe) => {
    const result = method === 'events.subscribe' ? { subscriptionId: 'one' } : {};
    observe?.(result);
    return result;
  });
  const capture = pool.capture({}, () => true, raw)!;
  await capture.request('events.subscribe');
  const observe = vi.fn();
  await capture.request('events.unsubscribe', { subscriptionId: 'one' }, observe);
  expect(observe).toHaveBeenCalledTimes(1);
  await expect(capture.request('events.unsubscribe', { subscriptionId: 'one' })).rejects.toThrow();
  expect(raw).toHaveBeenCalledTimes(2);
  capture.dispose();
});

it('drops queued old-authority cleanup without sending it on a successor', async () => {
  vi.useFakeTimers();
  const pool = new RecoveryWirePool();
  let current = true;
  const held: ReturnType<typeof Promise.withResolvers<unknown>>[] = [];
  const raw = vi.fn((method, _params, observe) => {
    if (method === 'events.subscribe') {
      const ack = { subscriptionId: String(raw.mock.calls.length) };
      observe?.(ack);
      return Promise.resolve(ack);
    }
    const row = Promise.withResolvers<unknown>();
    held.push(row);
    return row.promise;
  });
  const old = pool.capture({}, () => current, raw)!;
  for (let i = 0; i < 70; i++) await old.request('events.subscribe');
  old.dispose();
  expect(held).toHaveLength(64);
  current = false;
  const next = {};
  expect(pool.capture(next, () => true, raw)).toBeUndefined();
  for (const row of held) row.resolve({});
  for (let i = 0; i < 40; i++) await Promise.resolve();
  expect(held).toHaveLength(64);
  expect(pool.canCapture(next)).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it('observes unsubscribe acknowledgement synchronously before the following wire frame', async () => {
  let reply: (() => void) | undefined;
  const pool = new RecoveryWirePool();
  const capture = pool.capture(
    {},
    () => true,
    (method, _params, observe) => {
      if (method === 'events.subscribe') {
        const result = { subscriptionId: 'owned' };
        observe?.(result);
        return Promise.resolve(result);
      }
      return new Promise((resolve) => {
        reply = () => {
          observe?.({});
          resolve({});
        };
      });
    },
  )!;
  await capture.request('events.subscribe');
  const observe = vi.fn();
  const pending = capture.request('events.unsubscribe', { subscriptionId: 'owned' }, observe);
  reply!();
  expect(observe).toHaveBeenCalledTimes(1);
  await pending;
  capture.dispose();
});

it('bounds ordinary correlation and cancellable drainage waits without polling', async () => {
  vi.useFakeTimers();
  const pool = new RecoveryWirePool(),
    identity = {};
  const rows = Array.from({ length: 256 }, () => pool.trackOrdinary(identity));
  expect(() => pool.trackOrdinary(identity)).toThrow('limit');
  rows[0].timeout();
  expect(pool.canCapture(identity)).toBe(false);
  const waits = Array.from({ length: 64 }, () => pool.waitForOrdinary(identity)!);
  const results = waits.map((wait) => wait.promise.catch((e) => e));
  expect(() => pool.waitForOrdinary(identity)).toThrow('limit');
  waits[0].cancel();
  expect(await results[0]).toBeInstanceOf(Error);
  const replacement = pool.waitForOrdinary(identity)!;
  rows[0].settle();
  await Promise.all([...results, replacement.promise]);
  expect(pool.canCapture(identity)).toBe(true);
  rows.slice(1).forEach((row) => row.settle());
  expect(vi.getTimerCount()).toBe(0);
});
