import { afterEach, describe, expect, it, vi } from 'vitest';
import corpus from './__fixtures__/contract.json';
import { RecoveryResource } from './resource';

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

it('does not retry authorization failures and permits an explicit fresh budget after transient exhaustion', async () => {
  const h = setup();
  h.read.mockRejectedValueOnce({ rpcCode: -32003 });
  h.resource.invalidate();
  await settle();
  expect(h.retired).toHaveBeenCalledOnce();
  expect(h.resource.status.suspended).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  h.resource.dispose();
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
