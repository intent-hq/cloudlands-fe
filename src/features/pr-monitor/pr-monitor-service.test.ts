/**
 * PR-monitor service wire contract + event folding (PROTOCOL §6.9 / §6.5,
 * v6.1).
 *
 * FAKE transport only: the backend-transport seam is mocked. Asserts the
 * exact `prMonitor.list` / `prMonitor.cancel` / `prMonitor.flush` request
 * shapes, the `prMonitor:*` events.subscribe registration, and the pure fold
 * of each monitor lifecycle event into the row list.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  backendSubscribe: vi.fn(),
  backendUnsubscribe: vi.fn().mockResolvedValue(undefined),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));

import {
  backendRequest,
  backendSubscribe,
  backendUnsubscribe,
  onBackendNotification,
  type BackendNotification,
} from '$lib/client/live/backend-transport';
import {
  cancelPrMonitor,
  flushPrMonitor,
  foldPrMonitorEvent,
  listPrMonitors,
  subscribePrMonitors,
  type PrMonitorRow,
} from './pr-monitor-service';

const mockedRequest = vi.mocked(backendRequest);
const mockedSubscribe = vi.mocked(backendSubscribe);
const mockedUnsubscribe = vi.mocked(backendUnsubscribe);
const mockedOnNotification = vi.mocked(onBackendNotification);

/** PROTOCOL §6.9 prMonitor.list row (`lastSnapshot` arrives on list only). */
function makeMonitor(overrides: Partial<PrMonitorRow> = {}): PrMonitorRow {
  return {
    monitorId: 'mon-1',
    workspaceId: 'ws-1',
    agentId: 'agent-1',
    repo: 'acme/widgets',
    prNumber: 42,
    state: 'active',
    pendingChanges: [],
    hasPendingChanges: false,
    createdAt: '2026-08-07T10:00:00Z',
    updatedAt: '2026-08-07T10:05:00Z',
    title: 'Fix widget rendering',
    url: 'https://github.com/acme/widgets/pull/42',
    lastSnapshot: {
      state: 'open',
      isDraft: false,
      hasConflicts: false,
      isBehind: false,
      mergeable: true,
      checks: {
        total: 4,
        passed: 4,
        failed: 0,
        pending: 0,
        failingRequired: 0,
        pendingRequired: 0,
        requiredKnown: true,
      },
      approvals: { decision: 'APPROVED', have: 1, needed: 1, changesRequested: 0 },
      threads: { unresolved: 0, resolutionRequired: false },
      rulesKnown: true,
    },
    ...overrides,
  };
}

describe('foldPrMonitorEvent (§6.5 prMonitor:* lifecycle)', () => {
  it('prMonitor:cancelled removes the monitor', () => {
    const other = makeMonitor({ monitorId: 'mon-2' });
    const { monitors, needsRefetch } = foldPrMonitorEvent(
      [makeMonitor(), other],
      'prMonitor:cancelled',
      { monitorId: 'mon-1' },
    );
    expect(monitors).toEqual([other]);
    expect(needsRefetch).toBe(false);
  });

  it('prMonitor:changed replaces pendingChanges and requests a snapshot refetch', () => {
    const { monitors, needsRefetch } = foldPrMonitorEvent([makeMonitor()], 'prMonitor:changed', {
      monitorId: 'mon-1',
      changes: ['checks: 4/4 passing → 3/4 failing'],
    });
    expect(monitors[0].pendingChanges).toEqual(['checks: 4/4 passing → 3/4 failing']);
    expect(monitors[0].hasPendingChanges).toBe(true);
    expect(needsRefetch).toBe(true);
  });

  it('prMonitor:emitted clears the pending changes', () => {
    const { monitors, needsRefetch } = foldPrMonitorEvent(
      [makeMonitor({ pendingChanges: ['x'], hasPendingChanges: true })],
      'prMonitor:emitted',
      { monitorId: 'mon-1' },
    );
    expect(monitors[0].pendingChanges).toEqual([]);
    expect(monitors[0].hasPendingChanges).toBe(false);
    expect(needsRefetch).toBe(false);
  });

  it('prMonitor:completed keeps the row, flips state, and requests a refetch', () => {
    const { monitors, needsRefetch } = foldPrMonitorEvent(
      [makeMonitor({ pendingChanges: ['x'], hasPendingChanges: true })],
      'prMonitor:completed',
      { monitorId: 'mon-1' },
    );
    expect(monitors[0].state).toBe('completed');
    expect(monitors[0].pendingChanges).toEqual([]);
    expect(needsRefetch).toBe(true);
  });

  it('prMonitor:registered for an unseen monitor requests a refetch (missing wire fields)', () => {
    const { monitors, needsRefetch } = foldPrMonitorEvent([], 'prMonitor:registered', {
      monitorId: 'mon-9',
    });
    expect(monitors).toEqual([]);
    expect(needsRefetch).toBe(true);
  });

  it('prMonitor:registered re-arms a known monitor to active', () => {
    const { monitors, needsRefetch } = foldPrMonitorEvent(
      [makeMonitor({ state: 'completed' })],
      'prMonitor:registered',
      { monitorId: 'mon-1' },
    );
    expect(monitors[0].state).toBe('active');
    expect(needsRefetch).toBe(false);
  });

  it('ignores unknown event types and events without monitorId', () => {
    const initial = [makeMonitor()];
    expect(foldPrMonitorEvent(initial, 'prMonitor:unknown', { monitorId: 'mon-1' }).monitors).toBe(
      initial,
    );
    expect(foldPrMonitorEvent(initial, 'prMonitor:cancelled', {}).monitors).toBe(initial);
  });
});

describe('wire requests (§6.9, fake transport)', () => {
  afterEach(() => vi.clearAllMocks());

  it('listPrMonitors forwards prMonitor.list { workspaceId } and unwraps monitors', async () => {
    mockedRequest.mockResolvedValueOnce({ monitors: [makeMonitor()] });
    const monitors = await listPrMonitors('ws-1');
    expect(mockedRequest).toHaveBeenCalledWith('prMonitor.list', { workspaceId: 'ws-1' });
    expect(monitors).toEqual([makeMonitor()]);
  });

  it('cancelPrMonitor forwards prMonitor.cancel { workspaceId, monitorId }', async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true, monitor: makeMonitor() });
    await cancelPrMonitor('ws-1', 'mon-1');
    expect(mockedRequest).toHaveBeenCalledWith('prMonitor.cancel', {
      workspaceId: 'ws-1',
      monitorId: 'mon-1',
    });
  });

  it('flushPrMonitor forwards prMonitor.flush { workspaceId, monitorId } (no check key when omitted)', async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true, flushed: true });
    await flushPrMonitor('ws-1', 'mon-1');
    expect(mockedRequest).toHaveBeenCalledWith('prMonitor.flush', {
      workspaceId: 'ws-1',
      monitorId: 'mon-1',
    });
    // The additive §5.42 `check` param must be absent, not false/undefined.
    const params = mockedRequest.mock.calls[0][1] as Record<string, unknown>;
    expect('check' in params).toBe(false);
  });

  it('flushPrMonitor with check sends prMonitor.flush { workspaceId, monitorId, check: true } (§5.42)', async () => {
    // PROTOCOL-shaped response: flushed: false when the fresh check found nothing.
    mockedRequest.mockResolvedValueOnce({ ok: true, flushed: false });
    await flushPrMonitor('ws-1', 'mon-1', true);
    expect(mockedRequest).toHaveBeenCalledWith('prMonitor.flush', {
      workspaceId: 'ws-1',
      monitorId: 'mon-1',
      check: true,
    });
  });
});

describe('subscribePrMonitors (prMonitor:* events.subscribe + fold)', () => {
  let notify: ((n: BackendNotification) => void) | undefined;

  beforeEach(() => {
    mockedOnNotification.mockImplementation((handler) => {
      notify = handler;
      return () => {};
    });
    mockedSubscribe.mockResolvedValue({ subscriptionId: 'ws-sub-7' });
  });

  afterEach(() => {
    notify = undefined;
    vi.clearAllMocks();
  });

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('preserves cached rows and reports when the initial prMonitor.list seed fails', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('list failed'));
    const seen: PrMonitorRow[][] = [];
    const statuses: string[] = [];
    const { dispose } = subscribePrMonitors(
      'ws-1',
      (monitors) => seen.push(monitors),
      (status) => statuses.push(status),
    );
    await flush();

    expect(seen.at(-1)).toEqual([]);
    expect(statuses).toEqual(['failed']);
    dispose();
  });

  it('issues the prMonitor.list seed concurrently with events.subscribe (single RTT)', async () => {
    let resolveSubscribe: ((value: { subscriptionId: string }) => void) | undefined;
    mockedSubscribe.mockImplementationOnce(
      () => new Promise((resolve) => (resolveSubscribe = resolve)),
    );
    mockedRequest.mockResolvedValue({ monitors: [makeMonitor()] });
    const seen: PrMonitorRow[][] = [];
    const { dispose } = subscribePrMonitors('ws-1', (monitors) => seen.push(monitors));

    // Both wire calls leave immediately — the seed does not wait for the ack.
    expect(mockedSubscribe).toHaveBeenCalledWith({
      eventTypes: ['prMonitor:*'],
      workspaceId: 'ws-1',
    });
    expect(mockedRequest).toHaveBeenCalledWith('prMonitor.list', { workspaceId: 'ws-1' });
    await flush();
    // The seed emits before the subscribe ack lands.
    expect(seen.at(-1)).toEqual([makeMonitor()]);
    resolveSubscribe?.({ subscriptionId: 'ws-sub-7' });
    await flush();
    dispose();
    expect(mockedUnsubscribe).toHaveBeenCalledWith('ws-sub-7');
  });

  it('re-lists after the ack when the seed settled before the subscription window opened (event-gap race)', async () => {
    let resolveSubscribe: ((value: { subscriptionId: string }) => void) | undefined;
    mockedSubscribe.mockImplementationOnce(
      () => new Promise((resolve) => (resolveSubscribe = resolve)),
    );
    // The gap: mon-1 was registered between the list snapshot and the
    // subscription window — only the trailing re-list can observe it.
    mockedRequest
      .mockResolvedValueOnce({ monitors: [] })
      .mockResolvedValueOnce({ monitors: [makeMonitor()] });
    const seen: PrMonitorRow[][] = [];
    const { dispose } = subscribePrMonitors('ws-1', (monitors) => seen.push(monitors));
    await flush();
    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(seen.at(-1)).toEqual([]);

    resolveSubscribe?.({ subscriptionId: 'ws-sub-7' });
    await flush();
    expect(mockedRequest).toHaveBeenCalledTimes(2);
    expect(mockedRequest).toHaveBeenNthCalledWith(2, 'prMonitor.list', { workspaceId: 'ws-1' });
    expect(seen.at(-1)).toEqual([makeMonitor()]);
    dispose();
  });

  it('re-lists once (coalesced) even when the ack lands before the seed settles', async () => {
    // Response ordering proves nothing about snapshot ordering — the seed
    // can snapshot before the subscription window opens yet respond after
    // the ack — so the post-ack re-list is unconditional, coalesced into
    // exactly one trailing prMonitor.list.
    mockedRequest.mockResolvedValue({ monitors: [makeMonitor()] });
    const seen: PrMonitorRow[][] = [];
    const { dispose } = subscribePrMonitors('ws-1', (monitors) => seen.push(monitors));
    await flush();
    await flush();

    expect(mockedRequest).toHaveBeenCalledTimes(2);
    expect(mockedRequest).toHaveBeenNthCalledWith(2, 'prMonitor.list', { workspaceId: 'ws-1' });
    expect(seen.at(-1)).toEqual([makeMonitor()]);
    dispose();
  });

  it('still serves the one-shot seed when events.subscribe fails', async () => {
    mockedSubscribe.mockRejectedValueOnce(new Error('subscribe failed'));
    mockedRequest.mockResolvedValue({ monitors: [makeMonitor()] });
    const seen: PrMonitorRow[][] = [];
    const { dispose } = subscribePrMonitors('ws-1', (monitors) => seen.push(monitors));
    await flush();

    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(seen.at(-1)).toEqual([makeMonitor()]);
    dispose();
  });

  it('registers a workspace-scoped prMonitor:* subscription, seeds from prMonitor.list, folds events', async () => {
    mockedRequest.mockResolvedValue({ monitors: [makeMonitor()] });
    const seen: PrMonitorRow[][] = [];
    const { dispose } = subscribePrMonitors('ws-1', (monitors) => seen.push(monitors));
    await flush();

    expect(mockedSubscribe).toHaveBeenCalledWith({
      eventTypes: ['prMonitor:*'],
      workspaceId: 'ws-1',
    });
    expect(mockedRequest).toHaveBeenCalledWith('prMonitor.list', { workspaceId: 'ws-1' });
    expect(seen.at(-1)).toEqual([makeMonitor()]);

    notify?.({
      method: 'events.event',
      params: {
        subscriptionId: 'ws-sub-7',
        event: {
          type: 'prMonitor:emitted',
          workspaceId: 'ws-1',
          data: { monitorId: 'mon-1' },
        },
      },
    });
    expect(seen.at(-1)?.[0].hasPendingChanges).toBe(false);

    notify?.({
      method: 'events.event',
      params: {
        subscriptionId: 'ws-sub-7',
        event: {
          type: 'prMonitor:cancelled',
          workspaceId: 'ws-1',
          data: { monitorId: 'mon-1' },
        },
      },
    });
    expect(seen.at(-1)).toEqual([]);

    dispose();
    expect(mockedUnsubscribe).toHaveBeenCalledWith('ws-sub-7');
  });

  it('ignores foreign-workspace and foreign-subscription events', async () => {
    mockedRequest.mockResolvedValue({ monitors: [makeMonitor()] });
    const seen: PrMonitorRow[][] = [];
    const { dispose } = subscribePrMonitors('ws-1', (monitors) => seen.push(monitors));
    await flush();
    const baseline = seen.length;

    notify?.({
      method: 'events.event',
      params: {
        subscriptionId: 'ws-sub-7',
        event: {
          type: 'prMonitor:cancelled',
          workspaceId: 'ws-2',
          data: { monitorId: 'mon-1' },
        },
      },
    });
    notify?.({
      method: 'events.event',
      params: {
        subscriptionId: 'ws-sub-other',
        event: {
          type: 'prMonitor:cancelled',
          workspaceId: 'ws-1',
          data: { monitorId: 'mon-1' },
        },
      },
    });
    expect(seen.length).toBe(baseline);
    dispose();
  });

  it('refetches when an event references an unseen monitor', async () => {
    mockedRequest
      .mockResolvedValueOnce({ monitors: [] })
      .mockResolvedValueOnce({ monitors: [makeMonitor({ monitorId: 'mon-9' })] });
    const seen: PrMonitorRow[][] = [];
    const { dispose } = subscribePrMonitors('ws-1', (monitors) => seen.push(monitors));
    await flush();

    notify?.({
      method: 'events.event',
      params: {
        subscriptionId: 'ws-sub-7',
        event: {
          type: 'prMonitor:registered',
          workspaceId: 'ws-1',
          data: { monitorId: 'mon-9' },
        },
      },
    });
    await flush();

    expect(mockedRequest).toHaveBeenCalledTimes(2);
    expect(seen.at(-1)).toEqual([makeMonitor({ monitorId: 'mon-9' })]);
    dispose();
  });

  it('drops a locally-cancelled monitor from a list response that was in flight during the cancel', async () => {
    let resolveSecondList: ((value: unknown) => void) | undefined;
    mockedRequest
      .mockResolvedValueOnce({ monitors: [makeMonitor()] })
      .mockImplementationOnce(() => new Promise((resolve) => (resolveSecondList = resolve)));
    const seen: PrMonitorRow[][] = [];
    const { refetch, dispose } = subscribePrMonitors('ws-1', (monitors) => seen.push(monitors));
    await flush();
    expect(seen.at(-1)).toEqual([makeMonitor()]);

    // Start a second list, then cancel while it is in flight. The stale
    // response still carries the row — it must not resurrect the monitor.
    refetch();
    notify?.({
      method: 'events.event',
      params: {
        subscriptionId: 'ws-sub-7',
        event: {
          type: 'prMonitor:cancelled',
          workspaceId: 'ws-1',
          data: { monitorId: 'mon-1' },
        },
      },
    });
    expect(seen.at(-1)).toEqual([]);

    resolveSecondList?.({ monitors: [makeMonitor()] });
    await flush();
    expect(seen.at(-1)).toEqual([]);
    dispose();
  });

  it('queues a trailing refetch when a fold lands while a list request is in flight', async () => {
    let resolveSecondList: ((value: unknown) => void) | undefined;
    mockedRequest
      .mockResolvedValueOnce({ monitors: [makeMonitor()] })
      .mockImplementationOnce(() => new Promise((resolve) => (resolveSecondList = resolve)))
      .mockResolvedValueOnce({
        monitors: [makeMonitor({ pendingChanges: [], hasPendingChanges: false })],
      });
    const seen: PrMonitorRow[][] = [];
    const { refetch, dispose } = subscribePrMonitors('ws-1', (monitors) => seen.push(monitors));
    await flush();

    refetch();
    // Fold arriving mid-flight would be clobbered by the older list response
    // — a trailing (coalesced) refetch converges.
    notify?.({
      method: 'events.event',
      params: {
        subscriptionId: 'ws-sub-7',
        event: {
          type: 'prMonitor:emitted',
          workspaceId: 'ws-1',
          data: { monitorId: 'mon-1' },
        },
      },
    });
    resolveSecondList?.({
      monitors: [makeMonitor({ pendingChanges: ['stale'], hasPendingChanges: true })],
    });
    await flush();
    await flush();

    // seed + in-flight list + trailing refetch = 3 list calls total.
    expect(mockedRequest).toHaveBeenCalledTimes(3);
    expect(seen.at(-1)?.[0].hasPendingChanges).toBe(false);
    dispose();
  });

  it('refetch() re-runs prMonitor.list and emits the fresh list (lastSnapshot arrives on list only)', async () => {
    const refreshed = makeMonitor({
      lastSnapshot: { ...makeMonitor().lastSnapshot!, state: 'merged' },
      state: 'completed',
    });
    // Seed + unconditional post-ack re-list, then the explicit refetch.
    mockedRequest
      .mockResolvedValueOnce({ monitors: [makeMonitor()] })
      .mockResolvedValueOnce({ monitors: [makeMonitor()] })
      .mockResolvedValueOnce({ monitors: [refreshed] });
    const seen: PrMonitorRow[][] = [];
    const { refetch, dispose } = subscribePrMonitors('ws-1', (monitors) => seen.push(monitors));
    await flush();
    await flush();
    expect(mockedRequest).toHaveBeenCalledTimes(2);
    expect(seen.at(-1)?.[0].state).toBe('active');

    refetch();
    await flush();

    expect(mockedRequest).toHaveBeenCalledTimes(3);
    expect(mockedRequest).toHaveBeenNthCalledWith(3, 'prMonitor.list', { workspaceId: 'ws-1' });
    expect(seen.at(-1)).toEqual([refreshed]);
    dispose();
  });
});
