import { afterEach, describe, expect, it, vi } from 'vitest';
import corpus from '$shared/event-recovery/__fixtures__/contract.json';
import type { EventRecoverySession, RecoveryNotification } from '$shared/event-recovery/session';
import { EventRecoveryCoordinator } from './event-recovery-coordinator';
function harness(supported = true) {
  vi.useFakeTimers();
  let receive!: (n: RecoveryNotification) => void | Promise<void>;
  const request = vi.fn(async (method: string, _params?: unknown): Promise<unknown> =>
    method === 'events.subscribe' ? { subscriptionId: 'a', lossRecovery: 1 } : {},
  );
  let retire = () => {};
  const session: EventRecoverySession = {
    supported,
    isCurrent: () => true,
    onRetired: (fn) => {
      retire = fn;
      return () => {};
    },
    onNotification: (fn) => {
      receive = fn;
      return () => {};
    },
    request: request as EventRecoverySession['request'],
    fence: vi.fn(async (_ids, observe) => observe()),
    dispose: vi.fn(),
  };
  const coordinator = new EventRecoveryCoordinator(session),
    read = vi.fn(async () => 'snapshot'),
    apply = vi.fn();
  coordinator.registerResource({
    key: 'files:ws-a',
    workspaceId: 'ws-a',
    eventTypes: ['file:*'],
    read,
    apply,
    invalidate: vi.fn(),
    retire: vi.fn(),
  });
  return {
    coordinator,
    session,
    request,
    read,
    apply,
    receive: (n: RecoveryNotification) => receive(n),
    retire: () => retire(),
  };
}
async function settle() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}
afterEach(() => vi.useRealTimers());
const params = { workspaceId: 'ws-a', eventTypes: ['file:*'] };
const loss = (id = 'a', generation = '1'): RecoveryNotification => ({
  method: 'events.lost',
  params: { subscriptionId: id, generation, scope: { workspaceId: 'ws-a' } },
});
describe('recovery coordinator', () => {
  for (const fixture of corpus.negotiation)
    it(`negotiation ${fixture.id}`, async () => {
      const h = harness(fixture.capability === 1);
      h.request.mockResolvedValueOnce({
        subscriptionId: 'a',
        ...(fixture.ack === 1 ? { lossRecovery: 1 } : {}),
      });
      h.request.mockResolvedValueOnce({});
      h.request.mockResolvedValueOnce({ subscriptionId: 'legacy' });
      await h.coordinator.subscribe(params, { recover: fixture.request === 1 });
      const wire = h.request.mock.calls[0][1];
      expect(wire).toEqual({
        ...params,
        ...(fixture.capability === 1 && fixture.request === 1 ? { lossRecovery: 1 } : {}),
      });
      h.receive(loss());
      await settle();
      expect(h.read).toHaveBeenCalledTimes(fixture.admit ? 1 : 0);
      if (fixture.id === 'unconfirmed-ack')
        expect(h.request.mock.calls.map((c) => c[0])).toEqual([
          'events.subscribe',
          'events.unsubscribe',
          'events.subscribe',
        ]);
      h.coordinator.dispose();
    });
  it('uses independent lease watermarks and one complete covering set', async () => {
    const h = harness();
    await h.coordinator.subscribe(params, { recover: true });
    h.request.mockResolvedValueOnce({ subscriptionId: 'b', lossRecovery: 1 });
    await h.coordinator.subscribe(params, { recover: true });
    h.receive(loss('a'));
    await settle();
    expect(h.read).toHaveBeenCalledOnce();
    h.receive(loss('b'));
    h.receive(loss('a'));
    h.receive(loss('b'));
    await vi.advanceTimersByTimeAsync(250);
    expect(h.read).toHaveBeenCalledTimes(2);
    expect(h.session.fence).toHaveBeenCalledTimes(4);
    expect(vi.mocked(h.session.fence).mock.calls.every((c) => c[0].join(',') === 'a,b')).toBe(true);
  });
  it('does not issue reads before admission even with an early loss callback', async () => {
    const h = harness();
    let ack!: (value: unknown) => void;
    h.request.mockReturnValueOnce(
      new Promise((resolve) => {
        ack = resolve;
      }),
    );
    const subscribe = h.coordinator.subscribe(params, { recover: true });
    h.receive(loss());
    await settle();
    expect(h.read).not.toHaveBeenCalled();
    ack({ subscriptionId: 'a', lossRecovery: 1 });
    await subscribe;
    await settle();
    expect(h.read).toHaveBeenCalledOnce();
  });
  it('blocks reconciliation with an overlapping legacy writer', async () => {
    const h = harness();
    await h.coordinator.subscribe(params, { recover: true });
    h.request.mockResolvedValueOnce({ subscriptionId: 'legacy' });
    await h.coordinator.subscribe(params, { recover: false });
    h.receive(loss());
    await settle();
    expect(h.read).not.toHaveBeenCalled();
    await h.coordinator.unsubscribe('legacy');
    await settle();
    expect(h.read).toHaveBeenCalledOnce();
  });
  it('rejects foreign workspace losses, late retired replies and duplicate resource owners', async () => {
    const h = harness();
    await h.coordinator.subscribe(params, { recover: true });
    h.receive({
      method: 'events.lost',
      params: { subscriptionId: 'a', generation: '1', scope: { workspaceId: 'foreign' } },
    });
    await settle();
    expect(h.read).not.toHaveBeenCalled();
    let reply!: (value: string) => void;
    h.read.mockReturnValueOnce(
      new Promise((resolve) => {
        reply = resolve;
      }),
    );
    h.receive(loss());
    await settle();
    h.retire();
    reply('old');
    await settle();
    expect(h.apply).not.toHaveBeenCalled();
  });
});

describe('subscription attempt lifetimes', () => {
  it('rejects out-of-order replacement acknowledgements and unsubscribes their late IDs', async () => {
    const h = harness();
    let oldAck!: (value: unknown) => void;
    h.request.mockReturnValueOnce(
      new Promise((resolve) => {
        oldAck = resolve;
      }),
    );
    const old = h.coordinator.subscribe({ ...params, replaceGroup: 'files' }, { recover: true });
    h.request.mockResolvedValueOnce({ subscriptionId: 'b', lossRecovery: 1 });
    await h.coordinator.subscribe({ ...params, replaceGroup: 'files' }, { recover: true });
    oldAck({ subscriptionId: 'a', lossRecovery: 1 });
    await old;
    h.receive(loss('a'));
    await settle();
    expect(h.read).not.toHaveBeenCalled();
    h.receive(loss('b'));
    await settle();
    expect(h.read).toHaveBeenCalledOnce();
    expect(h.request).toHaveBeenCalledWith('events.unsubscribe', { subscriptionId: 'a' });
  });
  it('rejects an aborted subscribe even after returning to the same workspace', async () => {
    const h = harness(),
      abort = new AbortController();
    let ack!: (value: unknown) => void;
    h.request.mockReturnValueOnce(
      new Promise((resolve) => {
        ack = resolve;
      }),
    );
    const subscribing = h.coordinator.subscribe(params, { recover: true, signal: abort.signal });
    h.receive(loss());
    abort.abort();
    ack({ subscriptionId: 'a', lossRecovery: 1 });
    await subscribing;
    h.receive(loss());
    await settle();
    expect(h.read).not.toHaveBeenCalled();
    expect(h.coordinator.ownsSubscription('a')).toBe(false);
  });
});
