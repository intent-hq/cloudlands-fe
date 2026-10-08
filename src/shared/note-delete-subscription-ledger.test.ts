import { expect, it, vi } from 'vitest';
import {
  NoteDeleteSubscriptionLedger,
  type NoteDeleteSubscriptionOrigin,
} from './note-delete-subscription-ledger';
const origin = (incarnation = {}, principal = {}) => ({
  incarnation,
  principal,
  isLive: () => true,
  request: vi.fn<NoteDeleteSubscriptionOrigin['request']>(async (method) =>
    method === 'events.subscribe' ? { subscriptionId: 'server-id' } : { success: true },
  ),
});
function ledger() {
  let id = 0;
  return new NoteDeleteSubscriptionLedger(() => `binding-${++id}`);
}

it('shares 64 exact-connection slots across renderer principals and returns only acknowledged cleanup credit', async () => {
  const debt = ledger(),
    socket = {},
    a = origin(socket),
    b = origin(socket);
  const acks = [];
  for (let i = 0; i < 64; i++) acks.push(await debt.subscribe(i % 2 ? a : b, 'ws'));
  await expect(debt.subscribe(origin(socket), 'ws')).rejects.toMatchObject({
    code: 'NOTE_DELETE_REGISTRATION_LIMIT',
  });
  await debt.cleanup(b.principal, acks[0].handle);
  await expect(debt.subscribe(origin(socket), 'ws')).resolves.toMatchObject({
    subscriptionId: 'server-id',
  });
  await expect(debt.cleanup(b.principal, acks[0].handle)).rejects.toThrow();
  await expect(debt.subscribe(origin(socket), 'ws')).rejects.toMatchObject({
    code: 'NOTE_DELETE_REGISTRATION_LIMIT',
  });
});
it('supports repeated healthy mount cycles without accumulating charged slots', async () => {
  const debt = ledger(),
    socket = {};
  for (let i = 0; i < 128; i++) {
    const view = origin(socket),
      ack = await debt.subscribe(view, 'ws');
    await debt.cleanup(view.principal, ack.handle);
  }
  await expect(debt.subscribe(origin(socket), 'ws')).resolves.toBeTruthy();
});
it('holds all timed-out subscribe debt across new principals and ignores later lost ACKs', async () => {
  const debt = ledger(),
    socket = {},
    wire = origin(socket);
  wire.request.mockRejectedValue(new Error('Timeout after send'));
  for (let i = 0; i < 64; i++)
    await expect(debt.subscribe({ ...wire, principal: {} }, 'ws')).rejects.toThrow('Timeout');
  const fresh = origin(socket);
  await expect(debt.subscribe(fresh, 'ws')).rejects.toMatchObject({
    code: 'NOTE_DELETE_REGISTRATION_LIMIT',
  });
  expect(fresh.request).not.toHaveBeenCalled();
});
it.each([false, undefined, 'lost'] as const)(
  'does not refund unconfirmed cleanup %s or issue another cleanup attempt',
  async (outcome) => {
    const debt = ledger(),
      socket = {},
      view = origin(socket);
    const acks = [];
    for (let i = 0; i < 64; i++) acks.push(await debt.subscribe(view, 'ws'));
    if (outcome === 'lost') view.request.mockRejectedValueOnce(new Error('Lost cleanup ACK'));
    else view.request.mockResolvedValueOnce({ success: outcome } as never);
    const first = debt.cleanup(view.principal, acks[0].handle);
    const duplicate = debt.cleanup(view.principal, acks[0].handle);
    expect(duplicate).toBe(first);
    expect(
      (await Promise.allSettled([first, duplicate])).every((x) => x.status === 'rejected'),
    ).toBe(true);
    await expect(debt.cleanup(view.principal, acks[0].handle)).rejects.toThrow();
    expect(view.request).toHaveBeenCalledTimes(65);
    await expect(debt.subscribe(origin(socket), 'ws')).rejects.toMatchObject({
      code: 'NOTE_DELETE_REGISTRATION_LIMIT',
    });
  },
);
it('binds cleanup to original connection despite a server-ID collision on another connection', async () => {
  const debt = ledger(),
    principal = {},
    a = origin({}, principal),
    b = origin({}, principal);
  const ackA = await debt.subscribe(a, 'ws'),
    ackB = await debt.subscribe(b, 'ws');
  expect(ackA.subscriptionId).toBe(ackB.subscriptionId);
  await debt.cleanup(principal, ackA.handle);
  expect(a.request).toHaveBeenLastCalledWith('events.unsubscribe', {
    subscriptionId: 'server-id',
    workspaceId: 'ws',
  });
  expect(b.request).toHaveBeenCalledTimes(1);
  await expect(debt.cleanup({}, ackB.handle)).rejects.toThrow();
  expect(b.request).toHaveBeenCalledTimes(1);
});
it('retains pending physical registration through subscriber retirement and cleans a known late ACK on origin only', async () => {
  const debt = ledger(),
    view = origin();
  let alive = true;
  let ack!: (value: { subscriptionId: string }) => void;
  view.isLive = () => alive;
  view.request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        ack = resolve;
      }),
  );
  const subscribing = debt.subscribe(view, 'ws');
  const outcome = Promise.allSettled([subscribing]);
  await Promise.resolve();
  alive = false;
  ack({ subscriptionId: 'late-id' });
  expect((await outcome)[0].status).toBe('rejected');
  for (let i = 0; i < 8; i++) await Promise.resolve();
  expect(view.request).toHaveBeenLastCalledWith('events.unsubscribe', {
    subscriptionId: 'late-id',
    workspaceId: 'ws',
  });
});
it('bounds global debt at 256 and retained owners at eight without eviction', async () => {
  const debt = ledger();
  for (let owner = 0; owner < 4; owner++) {
    const view = origin();
    for (let i = 0; i < 64; i++) await debt.subscribe(view, 'ws');
  }
  const ninth = origin();
  await expect(debt.subscribe(ninth, 'ws')).rejects.toMatchObject({
    code: 'NOTE_DELETE_REGISTRATION_LIMIT',
  });
  expect(ninth.request).not.toHaveBeenCalled();
  const ownerDebt = ledger();
  for (let i = 0; i < 8; i++) await ownerDebt.subscribe(origin(), 'ws');
  const extra = origin();
  await expect(ownerDebt.subscribe(extra, 'ws')).rejects.toMatchObject({
    code: 'NOTE_DELETE_REGISTRATION_LIMIT',
  });
  expect(extra.request).not.toHaveBeenCalled();
});

it('releases only the positively closed incarnation and refuses re-admission of that same socket', async () => {
  const debt = ledger(),
    a = origin(),
    b = origin();
  a.request.mockRejectedValue(new Error('Unknown'));
  b.request.mockRejectedValue(new Error('Unknown'));
  for (let i = 0; i < 64; i++) {
    await expect(debt.subscribe(a, 'ws')).rejects.toThrow();
    await expect(debt.subscribe(b, 'ws')).rejects.toThrow();
  }
  debt.connectionClosed(a.incarnation);
  await expect(debt.subscribe(a, 'ws')).rejects.toMatchObject({
    code: 'NOTE_DELETE_SUBSCRIPTION_RETIRED',
  });
  await expect(debt.subscribe(b, 'ws')).rejects.toMatchObject({
    code: 'NOTE_DELETE_REGISTRATION_LIMIT',
  });
  await expect(debt.subscribe(origin(), 'ws')).resolves.toBeTruthy();
});

it('refunds only unissued reservations when a frame retires before the send microtask', async () => {
  const debt = ledger(),
    socket = {};
  for (let i = 0; i < 80; i++) {
    const view = origin(socket);
    let live = true;
    view.isLive = () => live;
    const pending = debt.subscribe(view, 'ws');
    live = false;
    await expect(pending).rejects.toMatchObject({ code: 'NOTE_DELETE_SUBSCRIPTION_RETIRED' });
    expect(view.request).not.toHaveBeenCalled();
  }
  const healthy = origin(socket);
  for (let i = 0; i < 64; i++) await debt.subscribe(healthy, 'ws');
  await expect(debt.subscribe(healthy, 'ws')).rejects.toMatchObject({
    code: 'NOTE_DELETE_REGISTRATION_LIMIT',
  });
  expect(healthy.request).toHaveBeenCalledTimes(64);
});

it('removes empty owner reservations and sends no RPC after a pre-send physical close', async () => {
  const debt = ledger();
  for (let i = 0; i < 16; i++) {
    const view = origin();
    let live = true;
    view.isLive = () => live;
    const pending = debt.subscribe(view, 'ws');
    live = false;
    await expect(pending).rejects.toMatchObject({ code: 'NOTE_DELETE_SUBSCRIPTION_RETIRED' });
    expect(view.request).not.toHaveBeenCalled();
  }
  const closed = origin();
  const pending = debt.subscribe(closed, 'ws');
  debt.connectionClosed(closed.incarnation);
  await expect(pending).rejects.toMatchObject({ code: 'NOTE_DELETE_SUBSCRIPTION_RETIRED' });
  expect(closed.request).not.toHaveBeenCalled();
  for (let i = 0; i < 8; i++) await debt.subscribe(origin(), 'ws');
  await expect(debt.subscribe(origin(), 'ws')).rejects.toMatchObject({
    code: 'NOTE_DELETE_REGISTRATION_LIMIT',
  });
});

it('retains debt when request invocation throws synchronously after it may have sent', async () => {
  const debt = ledger(),
    view = origin();
  view.request.mockImplementation(() => {
    throw new Error('May have issued');
  });
  for (let i = 0; i < 64; i++)
    await expect(debt.subscribe(view, 'ws')).rejects.toThrow('May have issued');
  await expect(debt.subscribe(view, 'ws')).rejects.toMatchObject({
    code: 'NOTE_DELETE_REGISTRATION_LIMIT',
  });
  expect(view.request).toHaveBeenCalledTimes(64);
});
