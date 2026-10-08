import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('./backend-transport', () => ({
  backendRequest: vi.fn(),
  subscribeBackendNoteDeletion: vi.fn(),
  observeBackendNodeCapabilities: vi.fn(),
  backendSubscribe: vi.fn(),
  backendUnsubscribe: vi.fn().mockResolvedValue(undefined),
  onBackendNotification: vi.fn(),
  onBackendReconnected: vi.fn(),
}));
import {
  backendRequest,
  subscribeBackendNoteDeletion,
  backendSubscribe,
  backendUnsubscribe,
  observeBackendNodeCapabilities,
  onBackendNotification,
  onBackendReconnected,
} from './backend-transport';
import type { BackendNotification } from './backend-transport';
import { LiveNoteDeleteClient } from './live-note-delete-client';

const epoch = 'c0e57cf0-775e-4a25-9e2d-3a8fb076b332';
const operationKey = { epoch, issuedTickMs: 100, nonce: '925dc7bb-a97b-43dc-9c72-237e23ccf859' };
const scope = { workspaceId: 'ws', noteId: 'spec' };
const request = { ...scope, operationKey };
const schedule = {
  ...request,
  noteInstanceId: 'instance',
  expectedVersion: 7,
  sourceRevision: 'opaque:7:世代',
};
const snapshot = { epoch, serverTickMs: 200, sequence: 1 };
const receipt = {
  ...request,
  noteInstanceId: 'instance',
  state: 'PENDING',
  sequence: 1,
  deadlineTickMs: 15100,
  deleteAt: '2026-10-08T15:00:00Z',
  expiresTickMs: null,
  reason: null,
};
const status = { ...snapshot, current: null, pending: [], operation: null };
const event = {
  ...scope,
  noteInstanceId: 'instance',
  operationKey,
  epoch,
  state: 'PENDING',
  sequence: 1,
  deadlineTickMs: 15100,
};
const rpc = vi.mocked(backendRequest);
const notifications = new Set<(n: BackendNotification) => void>();
const reconnects = new Set<() => void>();
const notify = (data: unknown, subscriptionId = 'sub-1') => {
  for (const listener of notifications)
    listener({
      method: 'events.event',
      params: { subscriptionId, event: { type: 'note:delete-operation', data } },
    });
};
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
beforeEach(() => {
  vi.clearAllMocks();
  notifications.clear();
  reconnects.clear();
  rpc.mockReset();
  vi.mocked(backendSubscribe).mockReset().mockResolvedValue({ subscriptionId: 'sub-1' });
  vi.mocked(subscribeBackendNoteDeletion).mockImplementation(async (workspaceId) => {
    const ack = await backendSubscribe<{ subscriptionId: string }>({
      workspaceId,
      eventTypes: ['note:delete-operation'],
    });
    return { ...ack, unsubscribe: () => backendUnsubscribe(ack.subscriptionId, workspaceId) };
  });
  vi.mocked(observeBackendNodeCapabilities).mockReset();
  vi.mocked(onBackendNotification).mockImplementation((fn) => {
    notifications.add(fn);
    return () => {
      notifications.delete(fn);
    };
  });
  vi.mocked(onBackendReconnected).mockImplementation((fn) => {
    reconnects.add(fn);
    return () => {
      reconnects.delete(fn);
    };
  });
});

it.each([true, '1', 2, null, undefined])(
  'does not advertise grace for unsupported capability %s',
  async (value) => {
    vi.mocked(observeBackendNodeCapabilities).mockResolvedValue({
      server: { capabilities: { noteDeleteGrace: value } },
    });
    expect(await new LiveNoteDeleteClient().capability()).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  },
);
it('observes numeric capability on the selected transport without another hello', async () => {
  vi.mocked(observeBackendNodeCapabilities).mockResolvedValue({
    server: { capabilities: { noteDeleteGrace: 1 } },
  });
  expect(await new LiveNoteDeleteClient().capability()).toBe(true);
  expect(rpc).not.toHaveBeenCalled();
});
it('sends all three exact requests and never generates a replacement operation key', async () => {
  const client = new LiveNoteDeleteClient();
  rpc.mockResolvedValueOnce(status);
  expect(await client.status({ workspaceId: 'ws' })).toEqual(status);
  expect(rpc).toHaveBeenLastCalledWith('note.deleteStatus', { workspaceId: 'ws' });
  rpc.mockResolvedValue({ ...snapshot, operation: receipt });
  expect(await client.schedule(schedule)).toEqual({ ...snapshot, operation: receipt });
  expect(rpc).toHaveBeenLastCalledWith('note.deleteSchedule', schedule);
  await client.schedule(schedule);
  expect(rpc).toHaveBeenLastCalledWith('note.deleteSchedule', schedule);
  await client.cancel(request);
  expect(rpc).toHaveBeenLastCalledWith('note.deleteCancel', request);
  expect(rpc.mock.calls.map(([method]) => method)).toEqual([
    'note.deleteStatus',
    'note.deleteSchedule',
    'note.deleteSchedule',
    'note.deleteCancel',
  ]);
});
it('preserves daemon rejection and uncertain transport failure without fallback requests', async () => {
  const client = new LiveNoteDeleteClient();
  for (const error of [
    Object.assign(new Error('Rejected'), {
      rpcCode: -32005,
      data: { code: 'NOTE_DELETE_ALREADY_PENDING' },
    }),
    new Error('Timeout'),
  ]) {
    rpc.mockRejectedValueOnce(error);
    await expect(client.schedule(schedule)).rejects.toBe(error);
  }
  expect(rpc.mock.calls.map(([method]) => method)).toEqual([
    'note.deleteSchedule',
    'note.deleteSchedule',
  ]);
});
it('validates requests before transport and checks the returned schedule incarnation', async () => {
  const client = new LiveNoteDeleteClient();
  await expect(client.schedule({ ...schedule, undoDelayMs: 0 })).rejects.toThrow();
  expect(rpc).not.toHaveBeenCalled();
  rpc.mockResolvedValue({ ...snapshot, operation: { ...receipt, noteInstanceId: 'replacement' } });
  await expect(client.schedule(schedule)).rejects.toThrow();
});
it('waits for event registration before snapshot and delivers only matching buffered events', async () => {
  let ack!: (value: { subscriptionId: string }) => void;
  vi.mocked(backendSubscribe).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        ack = resolve;
      }),
  );
  rpc.mockResolvedValue(status);
  const client = new LiveNoteDeleteClient(),
    listener = vi.fn();
  const dispose = client.subscribe('ws', listener);
  const reading = client.status({ workspaceId: 'ws' });
  expect(rpc).not.toHaveBeenCalled();
  notify(event);
  notify(event, 'foreign');
  ack({ subscriptionId: 'sub-1' });
  await reading;
  expect(backendSubscribe).toHaveBeenCalledWith({
    workspaceId: 'ws',
    eventTypes: ['note:delete-operation'],
  });
  expect(listener).toHaveBeenCalledTimes(1);
  expect(listener).toHaveBeenCalledWith(event);
  notify({ ...event, workspaceId: 'foreign' });
  notify({ ...event, sequence: 30 });
  expect(listener).toHaveBeenCalledTimes(2); // Global sequence gaps are not event loss.
  dispose();
  expect(backendUnsubscribe).toHaveBeenCalledWith('sub-1', 'ws');
  notify(event);
  expect(listener).toHaveBeenCalledTimes(2);
});
it('resubscribes on reconnect, discards stale ACKs, and cleans up late ACK after disposal', async () => {
  const acks: Array<(value: { subscriptionId: string }) => void> = [];
  vi.mocked(backendSubscribe).mockImplementation(
    () =>
      new Promise((resolve) => {
        acks.push(resolve);
      }),
  );
  const client = new LiveNoteDeleteClient(),
    listener = vi.fn(),
    reset = vi.fn();
  const dispose = client.subscribe('ws', listener),
    off = client.onReconnected(reset);
  for (const fn of reconnects) fn();
  acks[1]({ subscriptionId: 'new' });
  acks[0]({ subscriptionId: 'old' });
  await flush();
  expect(backendUnsubscribe).toHaveBeenCalledWith('old', 'ws');
  notify(event, 'old');
  notify(event, 'new');
  expect(listener).toHaveBeenCalledTimes(1);
  expect(reset).toHaveBeenCalledTimes(1);
  for (const fn of reconnects) fn();
  dispose();
  off();
  acks[2]({ subscriptionId: 'late' });
  await flush();
  expect(backendUnsubscribe).toHaveBeenCalledWith('late', 'ws');
  expect(notifications.size).toBe(0);
  expect(reconnects.size).toBe(0);
});
it('exposes subscription failure to snapshot readers without issuing an unsafe snapshot', async () => {
  const failure = new Error('Subscribe failed');
  vi.mocked(backendSubscribe).mockRejectedValueOnce(failure);
  const client = new LiveNoteDeleteClient(),
    reset = vi.fn();
  const off = client.onReconnected(reset),
    dispose = client.subscribe('ws', vi.fn());
  await expect(client.status({ workspaceId: 'ws' })).rejects.toBe(failure);
  expect(rpc).not.toHaveBeenCalled();
  expect(reset).toHaveBeenCalledTimes(1);
  dispose();
  off();
});
it('requests reconciliation on malformed matching events and bounded early-buffer overflow', async () => {
  const client = new LiveNoteDeleteClient(),
    reset = vi.fn(),
    listener = vi.fn();
  const off = client.onReconnected(reset),
    dispose = client.subscribe('ws', listener);
  await flush();
  notify({ ...event, sequence: -1 });
  expect(reset).toHaveBeenCalledTimes(1);
  expect(listener).not.toHaveBeenCalled();
  dispose();
  let ack!: (value: { subscriptionId: string }) => void;
  vi.mocked(backendSubscribe).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        ack = resolve;
      }),
  );
  const disposeEarly = client.subscribe('ws', listener);
  for (let i = 0; i < 257; i++) notify({ ...event, sequence: i });
  ack({ subscriptionId: 'sub-1' });
  await flush();
  expect(reset).toHaveBeenCalledTimes(2);
  expect(listener).not.toHaveBeenCalled();
  disposeEarly();
  off();
});

it('rejects an in-flight snapshot registration replaced by reconnect', async () => {
  const acks: Array<(value: { subscriptionId: string }) => void> = [];
  vi.mocked(backendSubscribe).mockImplementation(
    () =>
      new Promise((resolve) => {
        acks.push(resolve);
      }),
  );
  const client = new LiveNoteDeleteClient();
  const dispose = client.subscribe('ws', vi.fn());
  const reading = client.status({ workspaceId: 'ws' });
  const rejected = expect(reading).rejects.toThrow('subscription changed');
  for (const fn of reconnects) fn();
  acks[0]({ subscriptionId: 'old' });
  await rejected;
  expect(rpc).not.toHaveBeenCalled();
  dispose();
  acks[1]({ subscriptionId: 'new' });
  await flush();
  expect(backendUnsubscribe).toHaveBeenCalledWith('new', 'ws');
});
it('retains the submitted key when the caller mutates its request while awaiting an ACK', async () => {
  let ack!: (value: unknown) => void;
  rpc.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        ack = resolve;
      }),
  );
  const mutable = { ...schedule, operationKey: { ...operationKey } };
  const saving = new LiveNoteDeleteClient().schedule(mutable);
  mutable.operationKey.issuedTickMs = 101;
  ack({ ...snapshot, operation: receipt });
  expect((await saving).operation.operationKey.issuedTickMs).toBe(100);
  expect(rpc).toHaveBeenCalledWith('note.deleteSchedule', schedule);
});
it('does not turn capability observation failure into permission to delete', async () => {
  const error = new Error('Backend changed');
  vi.mocked(observeBackendNodeCapabilities).mockRejectedValueOnce(error);
  await expect(new LiveNoteDeleteClient().capability()).rejects.toBe(error);
  expect(rpc).not.toHaveBeenCalled();
});

it('recovers a settled failed registration once for concurrent status readers, before snapshots', async () => {
  const failure = new Error('Subscribe failed');
  let ack!: (value: { subscriptionId: string }) => void;
  vi.mocked(backendSubscribe)
    .mockRejectedValueOnce(failure)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          ack = resolve;
        }),
    );
  rpc.mockResolvedValue(status);
  const client = new LiveNoteDeleteClient(),
    listener = vi.fn(),
    reset = vi.fn();
  const off = client.onReconnected(reset),
    dispose = client.subscribe('ws', listener);
  try {
    await expect(client.status({ workspaceId: 'ws' })).rejects.toBe(failure);
    expect(reset).toHaveBeenCalledTimes(1);
    const first = client.status({ workspaceId: 'ws' });
    const second = client.status({ workspaceId: 'ws' });
    const outcomes = Promise.allSettled([first, second]);
    await flush();
    expect(backendSubscribe).toHaveBeenCalledTimes(2);
    expect(rpc).not.toHaveBeenCalled();
    notify(event, 'recovered');
    notify(event, 'stale');
    ack({ subscriptionId: 'recovered' });
    expect(await outcomes).toEqual([
      { status: 'fulfilled', value: status },
      { status: 'fulfilled', value: status },
    ]);
    expect(listener).toHaveBeenCalledExactlyOnceWith(event);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(reset).toHaveBeenCalledTimes(1);
  } finally {
    dispose();
    off();
  }
  expect(backendUnsubscribe).toHaveBeenCalledWith('recovered', 'ws');
});

it('does not replenish reset recovery or retry by itself after an explicit retry fails', async () => {
  const initial = new Error('First subscribe failed'),
    retry = new Error('Retry failed');
  vi.mocked(backendSubscribe).mockRejectedValueOnce(initial).mockRejectedValueOnce(retry);
  rpc.mockResolvedValue(status);
  const client = new LiveNoteDeleteClient(),
    reset = vi.fn();
  const off = client.onReconnected(reset),
    dispose = client.subscribe('ws', vi.fn());
  await expect(client.status({ workspaceId: 'ws' })).rejects.toBe(initial);
  const first = client.status({ workspaceId: 'ws' });
  const second = client.status({ workspaceId: 'ws' });
  await expect(first).rejects.toBe(retry);
  await expect(second).rejects.toBe(retry);
  await flush();
  expect(backendSubscribe).toHaveBeenCalledTimes(2);
  expect(reset).toHaveBeenCalledTimes(1);
  expect(rpc).not.toHaveBeenCalled();
  // A later manual check can recover; no new call occurred without that check.
  await expect(client.status({ workspaceId: 'ws' })).resolves.toEqual(status);
  expect(backendSubscribe).toHaveBeenCalledTimes(3);
  dispose();
  off();
});

it('retains pending recovery debt through duplicate checks and cleans up a disposed late ACK', async () => {
  let ack!: (value: { subscriptionId: string }) => void;
  vi.mocked(backendSubscribe)
    .mockRejectedValueOnce(new Error('Initial failure'))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          ack = resolve;
        }),
    );
  const client = new LiveNoteDeleteClient();
  const dispose = client.subscribe('ws', vi.fn());
  await expect(client.status({ workspaceId: 'ws' })).rejects.toThrow('Initial failure');
  const reads = Array.from({ length: 4 }, () => client.status({ workspaceId: 'ws' }));
  const results = Promise.allSettled(reads);
  await flush();
  expect(backendSubscribe).toHaveBeenCalledTimes(2);
  expect(rpc).not.toHaveBeenCalled();
  dispose();
  ack({ subscriptionId: 'late-recovery' });
  expect((await results).every((result) => result.status === 'rejected')).toBe(true);
  expect(backendUnsubscribe).toHaveBeenCalledWith('late-recovery', 'ws');
  expect(rpc).not.toHaveBeenCalled();
});

it('retries only failed registrations belonging to the requested workspace', async () => {
  vi.mocked(backendSubscribe).mockRejectedValueOnce(new Error('Other workspace failure'));
  rpc.mockResolvedValue(status);
  const client = new LiveNoteDeleteClient();
  const disposeOther = client.subscribe('other', vi.fn());
  await flush();
  const disposeHere = client.subscribe('ws', vi.fn());
  await expect(client.status({ workspaceId: 'ws' })).resolves.toEqual(status);
  expect(backendSubscribe).toHaveBeenCalledTimes(2);
  expect(backendSubscribe).toHaveBeenLastCalledWith({
    workspaceId: 'ws',
    eventTypes: ['note:delete-operation'],
  });
  disposeOther();
  disposeHere();
});

it('does not let an old failed attempt overwrite an acknowledged reconnect registration', async () => {
  let rejectOld!: (error: Error) => void;
  vi.mocked(backendSubscribe)
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectOld = reject;
        }),
    )
    .mockResolvedValueOnce({ subscriptionId: 'new-registration' });
  rpc.mockResolvedValue(status);
  const client = new LiveNoteDeleteClient(),
    reset = vi.fn();
  const dispose = client.subscribe('ws', vi.fn()),
    off = client.onReconnected(reset);
  const oldRead = client.status({ workspaceId: 'ws' });
  const oldResult = Promise.allSettled([oldRead]);
  for (const fn of reconnects) fn();
  await expect(client.status({ workspaceId: 'ws' })).resolves.toEqual(status);
  const oldFailure = new Error('Old transport rejected late');
  rejectOld(oldFailure);
  expect(await oldResult).toEqual([{ status: 'rejected', reason: oldFailure }]);
  await expect(client.status({ workspaceId: 'ws' })).resolves.toEqual(status);
  expect(backendSubscribe).toHaveBeenCalledTimes(2);
  expect(reset).toHaveBeenCalledTimes(1);
  expect(rpc).toHaveBeenCalledTimes(2);
  dispose();
  off();
  expect(backendUnsubscribe).toHaveBeenCalledWith('new-registration', 'ws');
});
