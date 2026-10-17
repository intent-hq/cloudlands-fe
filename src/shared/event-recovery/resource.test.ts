import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackendError } from '$lib/client/live/backend-transport-types';
import corpus from './__fixtures__/contract.json';
import { RecoveryResource } from './resource';
import { createEventRecoverySession, RecoveryRequestTimeoutError } from './session';

function held<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
function setup() {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const applied = vi.fn(),
    invalidated = vi.fn(),
    retired = vi.fn();
  const read = vi.fn(async () => 'snapshot');
  const fence = vi.fn(async (_ids: readonly string[], observe: () => void) => {
    observe();
  });
  const resource = new RecoveryResource({
    sourceOrdered: true,
    read,
    fence,
    apply: applied,
    invalidate: invalidated,
    retire: retired,
  });
  resource.setLeases([
    { id: 'a', lifetime: {} },
    { id: 'b', lifetime: {} },
  ]);
  return { resource, applied, invalidated, retired, read, fence };
}
afterEach(() => vi.useRealTimers());

describe('bounded fenced recovery', () => {
  it('coalesces overlap and held overflow into one paced trailing cycle', async () => {
    const h = setup(),
      first = held<string>();
    h.read.mockReturnValueOnce(first.promise);
    h.resource.invalidate();
    h.resource.invalidate();
    await settle();
    expect(h.read).toHaveBeenCalledOnce();
    for (let i = 0; i < 100; i++) h.resource.invalidate();
    first.resolve('old');
    await settle();
    expect(h.applied).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(249);
    expect(h.read).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.read).toHaveBeenCalledTimes(2);
    expect(h.fence).toHaveBeenCalledTimes(4);
    expect(h.applied).toHaveBeenCalledExactlyOnceWith('snapshot');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('holds snapshot until end fence and applies before following pushes', async () => {
    const h = setup();
    let end: (() => void) | undefined;
    h.fence.mockImplementationOnce(async (_ids, observe) => observe());
    h.fence.mockImplementationOnce(
      (_ids, observe) =>
        new Promise<void>((resolve) => {
          end = () => {
            observe();
            resolve();
          };
        }),
    );
    h.resource.invalidate();
    await settle();
    expect(h.applied).not.toHaveBeenCalled();
    end!();
    expect(h.applied).toHaveBeenCalledExactlyOnceWith('snapshot');
  });

  it('a queued old push conflicts instead of overwriting the held snapshot', async () => {
    const h = setup(),
      first = held<string>();
    h.read.mockReturnValueOnce(first.promise);
    h.resource.invalidate();
    await settle();
    first.resolve('snapshot');
    expect(h.resource.push()).toBe(false);
    await settle();
    expect(h.applied).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);
    expect(h.applied).toHaveBeenCalledOnce();
    expect(h.resource.push()).toBe(true);
  });

  for (const phase of ['begin', 'read', 'end'] as const)
    it(`bounds failed ${phase} cycles including successful data reads`, async () => {
      const h = setup();
      const starts: number[] = [];
      h.read.mockImplementation(async () => {
        starts.push(Date.now());
        if (phase === 'read') throw Error('failed');
        return 'snapshot';
      });
      let calls = 0;
      h.fence.mockImplementation(async (_ids, observe) => {
        calls++;
        if (phase === 'begin' || (phase === 'end' && calls % 2 === 0)) throw Error('failed');
        observe();
      });
      h.resource.invalidate();
      await settle();
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(4000);
      for (let i = 0; i < 100; i++) h.resource.invalidate();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(h.fence.mock.calls.length + h.read.mock.calls.length).toBe(
        phase === 'begin' ? 3 : phase === 'read' ? 6 : 9,
      );
      expect(h.resource.status).toMatchObject({ stale: true, suspended: true, failures: 3 });
      expect(starts).toEqual(phase === 'begin' ? [] : [0, 1000, 5000]);
      expect(h.applied).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });

  for (const transition of ['workspace', 'subscription', 'new-overlap', 'dispose'] as const)
    it(`rejects held replies after ${transition} lifetime changes`, async () => {
      const h = setup(),
        first = held<string>();
      h.read.mockReturnValueOnce(first.promise);
      h.resource.invalidate();
      await settle();
      if (transition === 'dispose') h.resource.dispose();
      else if (transition === 'workspace') {
        h.resource.changeLifetime();
        h.resource.changeLifetime();
      } else
        h.resource.setLeases([
          { id: 'a', lifetime: {} },
          { id: 'b', lifetime: {} },
          ...(transition === 'new-overlap' ? [{ id: 'c', lifetime: {} }] : []),
        ]);
      first.resolve('old');
      await settle();
      expect(h.applied).not.toHaveBeenCalled();
      expect(h.fence).toHaveBeenCalledOnce();
      h.resource.dispose();
      await vi.runAllTimersAsync();
      expect(h.read).toHaveBeenCalledOnce();
    });

  it('retains inactive dirtiness, resumes on demand and does not poll when clean', async () => {
    const h = setup();
    h.resource.setActive(false);
    h.resource.invalidate();
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.read).not.toHaveBeenCalled();
    h.resource.setActive(true);
    await settle();
    expect(h.read).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.read).toHaveBeenCalledOnce();
  });

  it('paces sustained overflow with the canonical read starts', async () => {
    const h = setup(),
      starts: number[] = [];
    vi.setSystemTime(0);
    h.read.mockImplementation(async () => {
      starts.push(Date.now());
      return 'snapshot';
    });
    for (let i = 0; i < 1000; i++) {
      h.resource.invalidate();
      await vi.advanceTimersByTimeAsync(1);
    }
    expect(starts).toEqual(
      corpus.scenarios.find((x) => x.id === 'sustained-success')!.expect.startTimesMs,
    );
    expect(vi.getTimerCount()).toBe(0);
  });
});

it('resumes ordinary pushes synchronously at the successful end fence', async () => {
  const h = setup();
  let fences = 0;
  h.fence.mockImplementation(async (_ids, observe) => {
    observe();
    if (++fences === 2) expect(h.resource.push()).toBe(true);
  });
  h.resource.invalidate();
  await settle();
  expect(h.read).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it('new losses cannot shorten failure delays, and explicit refresh opens a fresh bounded cycle', async () => {
  const h = setup();
  h.read
    .mockRejectedValueOnce(Error('one'))
    .mockRejectedValueOnce(Error('two'))
    .mockRejectedValueOnce(Error('three'));
  h.resource.invalidate();
  await settle();
  await vi.advanceTimersByTimeAsync(999);
  h.resource.invalidate();
  await settle();
  expect(h.read).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  expect(h.read).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(3999);
  h.resource.invalidate();
  await settle();
  expect(h.read).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(h.resource.status.suspended).toBe(true);
  h.resource.refresh();
  await vi.advanceTimersByTimeAsync(250);
  expect(h.read).toHaveBeenCalledTimes(4);
  expect(h.applied).toHaveBeenCalledExactlyOnceWith('snapshot');
  expect(h.resource.status).toMatchObject({ stale: false, suspended: false, failures: 0 });
});

describe('adapter lifetime and source ordering', () => {
  it('changes opaque identity on workspace ABA and covering lease changes', () => {
    const h = setup();
    const first = h.resource.captureLifetime();
    h.resource.changeLifetime();
    h.resource.changeLifetime();
    expect(first.isCurrent()).toBe(false);
    expect(h.resource.captureLifetime().key).not.toBe(first.key);
    const next = h.resource.captureLifetime();
    h.resource.setLeases([{ id: 'a', lifetime: {} }]);
    expect(next.isCurrent()).toBe(false);
    const last = h.resource.captureLifetime();
    h.resource.dispose();
    expect(last.commit(vi.fn())).toBe(false);
  });
  it('rejects a delayed mutation captured before loss even after reconciliation', async () => {
    const h = setup();
    const beforeLoss = h.resource.captureLifetime();
    h.resource.invalidate();
    await settle();
    const write = vi.fn();
    expect(beforeLoss.commit(write)).toBe(false);
    expect(write).not.toHaveBeenCalled();
    expect(h.resource.captureLifetime().commit(write)).toBe(true);
  });
  it('uses invalidation-only pushes after recovery unless source ordering is proven', async () => {
    vi.useFakeTimers();
    const read = vi.fn(async () => 'snapshot');
    const resource = new RecoveryResource({
      read,
      fence: async (_ids, observe) => observe(),
      apply: () => {},
      invalidate: () => {},
      retire: () => {},
    });
    resource.setLeases([{ id: 'a', lifetime: {} }]);
    expect(resource.push()).toBe(true);
    resource.invalidate();
    await settle();
    expect(resource.push()).toBe(false);
    expect(resource.status.stale).toBe(true);
    await vi.advanceTimersByTimeAsync(250);
    expect(read).toHaveBeenCalledTimes(2);
    expect(resource.push()).toBe(false);
    resource.dispose();
  });
});

describe('canonical authority failures', () => {
  for (const [rpcCode, code] of [
    [-32602, 'not-found'],
    [-32003, 'forbidden'],
    [-32001, 'unauthorized'],
  ] as const)
    for (const phase of ['begin', 'read', 'end'] as const)
      it(`retires exactly once on canonical ${code} during ${phase}`, async () => {
        const h = setup();
        const error = new BackendError({ rpcCode, code, message: 'Unavailable', data: { code } });
        if (phase === 'read') h.read.mockRejectedValue(error);
        else if (phase === 'begin') h.fence.mockRejectedValue(error);
        else
          h.fence
            .mockImplementationOnce(async (_ids, observe) => observe())
            .mockRejectedValue(error);
        const token = h.resource.captureLifetime();
        h.resource.invalidate();
        await settle();
        expect(h.retired).toHaveBeenCalledExactlyOnceWith(error);
        expect(token.isCurrent()).toBe(false);
        expect(h.resource.status).toMatchObject({ stale: false, suspended: true });
        h.resource.refresh();
        h.resource.changeLifetime();
        h.resource.invalidate();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(h.retired).toHaveBeenCalledOnce();
        expect(h.fence.mock.calls.length + h.read.mock.calls.length).toBe(
          phase === 'begin' ? 1 : phase === 'read' ? 2 : 3,
        );
        expect(h.applied).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
      });
  it.each([
    { rpcCode: -32602, code: 'invalid-params', data: { code: 'invalid-params' } },
    { rpcCode: -32602, code: 'not-found' },
    { rpcCode: -32603, code: 'not-found', data: { code: 'not-found' } },
    { code: 'forbidden' },
    { code: 'unauthorized' },
  ])('does not infer deletion or authorization from a noncanonical lookalike %j', async (shape) => {
    const h = setup();
    h.read.mockRejectedValue(new BackendError({ ...shape, message: 'not found' }));
    h.resource.invalidate();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.retired).not.toHaveBeenCalled();
    expect(h.read).toHaveBeenCalledTimes(3);
    expect(h.resource.status).toMatchObject({ stale: true, suspended: true });
  });
});

it('rejects an older mutation receipt after an accepted ordinary push without starting recovery', () => {
  const h = setup();
  expect(h.resource.push()).toBe(true);
  const older = h.resource.captureLifetime();
  expect(h.resource.push()).toBe(true);
  const newer = h.resource.captureLifetime();
  let value = '';
  expect(
    newer.commit(() => {
      value = 'new';
    }),
  ).toBe(true);
  expect(
    older.commit(() => {
      value = 'old';
    }),
  ).toBe(false);
  expect(value).toBe('new');
  expect(h.resource.status).toMatchObject({ stale: false, running: false });
  expect(h.read).not.toHaveBeenCalled();
  expect(h.fence).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

describe('timed-out recovery drains the original request', () => {
  function setupTimeout(phase: 'begin' | 'read' | 'end', repeat = false) {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const pending = Promise.withResolvers<void>();
    const stalledRequests: (typeof pending)[] = [];
    let fences = 0;
    let reads = 0;
    let retireSession = () => {};
    const request = vi.fn(
      async (method: string, _params?: unknown, observe?: (value: unknown) => void) => {
        const isRead = method === 'data.read';
        const count = isRead ? ++reads : ++fences;
        const stalled =
          phase === 'read'
            ? isRead && (repeat || count === 1)
            : !isRead && count === (phase === 'begin' ? 1 : 2);
        if (stalled) {
          const wait = stalledRequests.length ? Promise.withResolvers<void>() : pending;
          stalledRequests.push(wait);
          await wait.promise;
        }
        const value = isRead ? (stalled ? 'expired' : 'fresh') : { subscriptionIds: ['a'] };
        observe?.(value);
        return value;
      },
    );
    const session = createEventRecoverySession({
      supported: true,
      isCurrent: () => true,
      onRetired: (handler) => {
        retireSession = handler;
        return () => {};
      },
      onNotification: () => () => {},
      request,
      dispose: () => {},
    });
    const applied = vi.fn();
    const retired = vi.fn();
    const resource = new RecoveryResource({
      read: () => session.request('data.read'),
      fence: (ids, observe) => session.fence(ids, observe),
      apply: applied,
      invalidate: () => {},
      retire: retired,
    });
    resource.setLeases([{ id: 'a', lifetime: {} }]);
    session.onRetired(() => resource.dispose());
    return {
      resource,
      session,
      applied,
      retired,
      request,
      pending,
      retireSession,
      stalledRequests,
    };
  }

  for (const phase of ['begin', 'read', 'end'] as const)
    for (const settlement of ['resolve', 'reject'] as const)
      it(`holds the ${phase} request through 60s and retries only after ${settlement}`, async () => {
        const h = setupTimeout(phase);
        const before = phase === 'begin' ? 1 : phase === 'read' ? 2 : 3;
        h.resource.invalidate();
        await settle();
        const lifetime = h.resource.captureLifetime();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(h.request).toHaveBeenCalledTimes(before);
        expect(h.resource.status).toMatchObject({ stale: true, suspended: true, running: true });
        expect(lifetime.isCurrent()).toBe(false);
        expect(lifetime.commit(() => undefined)).toBe(false);
        h.resource.refresh();
        for (let i = 0; i < 100; i++) h.resource.invalidate();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(h.request).toHaveBeenCalledTimes(before);
        expect(vi.getTimerCount()).toBe(0);
        if (settlement === 'resolve') h.pending.resolve();
        else h.pending.reject(Error('late failure'));
        await settle();
        expect(h.applied).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(999);
        expect(h.request).toHaveBeenCalledTimes(before);
        await vi.advanceTimersByTimeAsync(1);
        expect(h.request).toHaveBeenCalledTimes(before + 3);
        expect(h.applied).toHaveBeenCalledExactlyOnceWith('fresh');
        expect(h.resource.status).toMatchObject({ stale: false, suspended: false, running: false });
        expect(vi.getTimerCount()).toBe(0);
        h.resource.dispose();
        h.session.dispose();
      });

  for (const phase of ['begin', 'read', 'end'] as const)
    for (const [rpcCode, code] of [
      [-32003, 'forbidden'],
      [-32001, 'unauthorized'],
      [-32602, 'not-found'],
    ] as const)
      it(`retires on eventual ${code} after ${phase} times out`, async () => {
        const h = setupTimeout(phase);
        h.resource.invalidate();
        await settle();
        await vi.advanceTimersByTimeAsync(60_000);
        const before = h.request.mock.calls.length;
        const denied = new BackendError({ rpcCode, code, data: { code }, message: 'Unavailable' });
        h.pending.reject(denied);
        await settle();
        expect(h.retired).toHaveBeenCalledExactlyOnceWith(denied);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(h.request).toHaveBeenCalledTimes(before);
        expect(h.applied).not.toHaveBeenCalled();
        expect(h.resource.status).toMatchObject({ stale: false, suspended: true, running: false });
        h.session.dispose();
      });

  it('does not retire a successor lifetime for an eventual stale denial', async () => {
    const h = setupTimeout('read');
    h.resource.invalidate();
    await settle();
    await vi.advanceTimersByTimeAsync(60_000);
    h.resource.changeLifetime();
    h.resource.changeLifetime();
    h.resource.invalidate();
    h.pending.reject(
      new BackendError({ rpcCode: -32003, code: 'forbidden', message: 'Unavailable' }),
    );
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.retired).not.toHaveBeenCalled();
    expect(h.applied).toHaveBeenCalledExactlyOnceWith('fresh');
    h.resource.dispose();
    h.session.dispose();
  });

  it('exhausts a finite failure budget after timed-out reads drain', async () => {
    const h = setupTimeout('read', true);
    h.resource.invalidate();
    await settle();
    for (let attempt = 0; attempt < 3; attempt++) {
      await vi.advanceTimersByTimeAsync(60_000);
      expect(h.request).toHaveBeenCalledTimes((attempt + 1) * 2);
      expect(vi.getTimerCount()).toBe(0);
      h.stalledRequests[attempt].resolve();
      await settle();
      expect(h.applied).not.toHaveBeenCalled();
      if (attempt < 2) await vi.advanceTimersByTimeAsync(attempt === 0 ? 1000 : 4000);
    }
    for (let i = 0; i < 100; i++) h.resource.invalidate();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.request).toHaveBeenCalledTimes(6);
    expect(h.resource.status).toMatchObject({
      stale: true,
      suspended: true,
      failures: 3,
      running: false,
    });
    expect(vi.getTimerCount()).toBe(0);
    h.resource.dispose();
    h.session.dispose();
  });

  for (const transition of [
    'workspace-ABA',
    'lease-ABA',
    'active-ABA',
    'dispose',
    'session-retire',
  ] as const)
    for (const transitionAt of [1000, 30_000])
      it(`fences the timed-out request across ${transition} at ${transitionAt}ms`, async () => {
        const h = setupTimeout('read');
        h.resource.invalidate();
        await settle();
        await vi.advanceTimersByTimeAsync(transitionAt);
        if (transition === 'workspace-ABA') {
          h.resource.changeLifetime();
          h.resource.changeLifetime();
          h.resource.invalidate();
        } else if (transition === 'lease-ABA') {
          h.resource.setLeases([{ id: 'b', lifetime: {} }]);
          h.resource.setLeases([{ id: 'a', lifetime: {} }]);
        } else if (transition === 'active-ABA') {
          h.resource.setActive(false);
          h.resource.setActive(true);
        } else if (transition === 'dispose') h.resource.dispose();
        else h.retireSession();
        await vi.advanceTimersByTimeAsync(30_000);
        expect(h.request).toHaveBeenCalledTimes(2);
        h.pending.resolve();
        await settle();
        await vi.advanceTimersByTimeAsync(5000);
        expect(h.applied.mock.calls.flat()).not.toContain('expired');
        if (transition === 'dispose' || transition === 'session-retire') {
          expect(h.applied).not.toHaveBeenCalled();
          expect(h.request).toHaveBeenCalledTimes(2);
        } else expect(h.applied).toHaveBeenCalledExactlyOnceWith('fresh');
        expect(vi.getTimerCount()).toBe(0);
        h.resource.dispose();
        h.session.dispose();
      });
});

describe('temporary demand settlement', () => {
  it('waits through held final fence and trailing invalidation before settling', async () => {
    const h = setup();
    const end = held<void>();
    h.fence.mockImplementationOnce(async (_ids, observe) => {
      observe();
    });
    h.fence.mockImplementationOnce(async (_ids, observe) => {
      await end.promise;
      observe();
    });
    h.resource.invalidate();
    await settle();
    let done = false;
    void h.resource.whenSettled().then(() => {
      done = true;
    });
    await settle();
    expect(done).toBe(false);
    h.resource.invalidate();
    end.resolve();
    await settle();
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(250);
    expect(done).toBe(true);
    expect(h.applied).toHaveBeenCalledOnce();
    expect(h.read).toHaveBeenCalledTimes(2);
  });

  it('settles clean resources and disposed resources but waits for inactive dirty demand', async () => {
    const h = setup();
    await h.resource.whenSettled();
    h.resource.setActive(false);
    h.resource.invalidate();
    let done = false;
    void h.resource.whenSettled().then(() => {
      done = true;
    });
    await settle();
    expect(done).toBe(false);
    h.resource.dispose();
    await settle();
    expect(done).toBe(true);
  });

  it('does not treat a timed-out physical drain as terminal suspension', async () => {
    const h = setup();
    const physical = held<{ retired: boolean; errors: unknown[] }>();
    h.read.mockRejectedValueOnce(new RecoveryRequestTimeoutError(physical.promise));
    h.resource.invalidate();
    let done = false;
    void h.resource.whenSettled().then(() => {
      done = true;
    });
    await settle();
    expect(h.resource.status.suspended).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(done).toBe(false);
    expect(h.read).toHaveBeenCalledOnce();
    physical.resolve({ retired: false, errors: [] });
    await settle();
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(done).toBe(true);
    expect(h.applied).toHaveBeenCalledOnce();
  });

  it('settles exhausted retry budgets without retaining temporary demand forever', async () => {
    const h = setup();
    h.read.mockRejectedValue(new Error('offline'));
    h.resource.invalidate();
    let done = false;
    void h.resource.whenSettled().then(() => {
      done = true;
    });
    await settle();
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.read).toHaveBeenCalledTimes(3);
    expect(done).toBe(true);
  });
});
