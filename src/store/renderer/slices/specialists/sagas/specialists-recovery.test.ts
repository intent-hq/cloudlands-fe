import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock(
  '$lib/client/live/backend-transport',
  async () =>
    (await import('../../../../../test/mocks/backend-transport.mock')).mockBackendTransportModule,
);
import { BackendError, backendRequest } from '$lib/client/live/backend-transport';
import { rendererEventRecovery } from '$features/events/renderer-event-recovery';
import {
  createEventRecoverySession,
  type RecoveryNotification,
} from '$shared/event-recovery/session';
import {
  installMockBackend,
  resetMockBackend,
  type MockBackendHandle,
} from '../../../../../test/mocks/backend-transport.mock';
import { admitLegacyPrincipal } from '../../../../../test/fixtures/principal-state';
import { store } from '../../../store';
import { specialistsSaga } from './specialists-saga';
import { selectFileSpecialists } from '../specialists-selectors';

let backend: MockBackendHandle;
let stop: () => void;
let dispose: () => void;
beforeEach(() => {
  vi.useFakeTimers();
  resetMockBackend();
  backend = installMockBackend();
  dispose = store.init();
  admitLegacyPrincipal();
});
afterEach(() => {
  stop?.();
  rendererEventRecovery.dispose();
  dispose();
  resetMockBackend();
  vi.useRealTimers();
});

async function attachRecovery(supported = true) {
  let receive!: (notification: RecoveryNotification) => void;
  let sequence = 0;
  const wire = vi.fn(async (method: string, params?: unknown) => {
    if (method === 'events.subscribe')
      return { subscriptionId: `specialists-${++sequence}`, lossRecovery: 1 };
    if (method === 'events.fence') return params;
    return backendRequest(method, params);
  });
  const scope = rendererEventRecovery.attach(
    createEventRecoverySession({
      supported,
      isCurrent: () => true,
      onNotification: (handler) => {
        receive = handler;
        return () => {};
      },
      onRetired: () => () => {},
      dispose: () => {},
      request: async (method, params, observe) => {
        const result = await wire(method, params);
        observe?.(result);
        return result;
      },
    }),
  );
  await scope.subscribe(
    { eventTypes: ['specialists:changed', 'skills:changed', 'settings:changed'] },
    { recover: true },
  );
  return {
    wire,
    scope,
    receive,
    event: () =>
      receive({
        method: 'events.event',
        params: {
          subscriptionId: 'specialists-1',
          event: { type: 'specialists:changed', workspaceId: 'workspace', data: {} },
        },
      }),
    lose: (generation = '1') =>
      receive({
        method: 'events.lost',
        params: { subscriptionId: 'specialists-1', generation, scope: { workspaceId: null } },
      }),
  };
}
const catalog = (name: string) => ({
  specialists: [{ id: 'reviewer', name, description: '', source: 'user', path: '/specialist' }],
});

it('restores the specialist store after final generic loss with one read and two fences', async () => {
  const { wire, lose } = await attachRecovery();
  backend.onRequest('specialist.list', () => catalog('old'));
  stop = store.runSaga(specialistsSaga);
  await vi.advanceTimersByTimeAsync(0);
  expect(selectFileSpecialists.select(store.state)[0]?.name).toBe('old');
  wire.mockClear();
  backend.onRequest('specialist.list', () => catalog('current'));
  lose();
  await vi.advanceTimersByTimeAsync(0);
  expect(selectFileSpecialists.select(store.state)[0]?.name).toBe('current');
  expect(wire.mock.calls.filter(([method]) => method === 'specialist.list')).toHaveLength(1);
  expect(wire.mock.calls.filter(([method]) => method === 'events.fence')).toHaveLength(2);
});

it('waits for an old initial read, rejects its snapshot, and coalesces repeated loss', async () => {
  const { wire, lose } = await attachRecovery();
  let release!: (value: ReturnType<typeof catalog>) => void;
  backend.onRequest(
    'specialist.list',
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  stop = store.runSaga(specialistsSaga);
  await vi.advanceTimersByTimeAsync(0);
  expect(wire.mock.calls.filter(([method]) => method === 'specialist.list')).toHaveLength(1);
  lose();
  lose();
  lose('2');
  await vi.advanceTimersByTimeAsync(0);
  expect(wire.mock.calls.filter(([method]) => method === 'specialist.list')).toHaveLength(1);
  backend.onRequest('specialist.list', () => catalog('current'));
  release(catalog('retired'));
  await vi.advanceTimersByTimeAsync(0);
  expect(selectFileSpecialists.select(store.state)[0]?.name).toBe('current');
  expect(wire.mock.calls.filter(([method]) => method === 'specialist.list')).toHaveLength(2);
  expect(wire.mock.calls.filter(([method]) => method === 'events.fence')).toHaveLength(2);
});

it('coalesces losses during a held recovery into one trailing snapshot', async () => {
  const { wire, lose } = await attachRecovery();
  backend.onRequest('specialist.list', () => catalog('initial'));
  stop = store.runSaga(specialistsSaga);
  await vi.advanceTimersByTimeAsync(0);
  wire.mockClear();
  let release!: (value: ReturnType<typeof catalog>) => void;
  backend.onRequest(
    'specialist.list',
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  lose();
  await vi.advanceTimersByTimeAsync(0);
  for (let i = 2; i < 12; i++) lose(String(i));
  backend.onRequest('specialist.list', () => catalog('current'));
  release(catalog('outdated-recovery'));
  await vi.advanceTimersByTimeAsync(0);
  expect(selectFileSpecialists.select(store.state)[0]?.name).toBe('initial');
  await vi.advanceTimersByTimeAsync(250);
  expect(selectFileSpecialists.select(store.state)[0]?.name).toBe('current');
  expect(wire.mock.calls.filter(([method]) => method === 'specialist.list')).toHaveLength(2);
  expect(wire.mock.calls.filter(([method]) => method === 'events.fence')).toHaveLength(4);
});

it('clears protected definitions on canonical denial without retries or stale restoration', async () => {
  const { wire, lose } = await attachRecovery();
  backend.onRequest('specialist.list', () => catalog('private'));
  stop = store.runSaga(specialistsSaga);
  await vi.advanceTimersByTimeAsync(0);
  wire.mockClear();
  backend.onRequest('specialist.list', () => {
    throw new BackendError({ code: 'FORBIDDEN', message: 'Forbidden', rpcCode: -32003 });
  });
  lose();
  await vi.advanceTimersByTimeAsync(5000);
  expect(selectFileSpecialists.select(store.state)).toEqual([]);
  expect(wire.mock.calls.filter(([method]) => method === 'specialist.list')).toHaveLength(1);
});

it('rejects held recovery replies after the captured session retires', async () => {
  const { lose } = await attachRecovery();
  backend.onRequest('specialist.list', () => catalog('private'));
  stop = store.runSaga(specialistsSaga);
  await vi.advanceTimersByTimeAsync(0);
  let release!: (value: ReturnType<typeof catalog>) => void;
  backend.onRequest(
    'specialist.list',
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  lose();
  await vi.advanceTimersByTimeAsync(0);
  rendererEventRecovery.dispose();
  expect(selectFileSpecialists.select(store.state)).toEqual([]);
  release(catalog('retired'));
  await vi.advanceTimersByTimeAsync(0);
  expect(selectFileSpecialists.select(store.state)).toEqual([]);
});

it('refreshes only from admitted generic events while a captured session owns the catalog', async () => {
  const { wire, event } = await attachRecovery();
  backend.onRequest('specialist.list', () => catalog('initial'));
  stop = store.runSaga(specialistsSaga);
  await vi.advanceTimersByTimeAsync(0);
  wire.mockClear();
  backend.onRequest('specialist.list', () => catalog('current'));
  event();
  await vi.advanceTimersByTimeAsync(250);
  expect(selectFileSpecialists.select(store.state)[0]?.name).toBe('current');
  expect(wire.mock.calls.filter(([method]) => method === 'specialist.list')).toHaveLength(1);
  expect(wire.mock.calls.filter(([method]) => method === 'events.fence')).toHaveLength(0);
  backend.onRequest('specialist.list', () => catalog('raw-old-source'));
  backend.pushEvent({ method: 'specialists:changed', params: {} });
  await vi.advanceTimersByTimeAsync(250);
  expect(selectFileSpecialists.select(store.state)[0]?.name).toBe('current');
  expect(wire.mock.calls.filter(([method]) => method === 'specialist.list')).toHaveLength(1);
});

it('rejects a held recovery when the principal changes while the transport remains live', async () => {
  const { lose } = await attachRecovery();
  backend.onRequest('specialist.list', () => catalog('owner-only'));
  stop = store.runSaga(specialistsSaga);
  await vi.advanceTimersByTimeAsync(0);
  let release!: (value: ReturnType<typeof catalog>) => void;
  backend.onRequest(
    'specialist.list',
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  lose();
  await vi.advanceTimersByTimeAsync(0);
  backend.onRequest('specialist.list', () => catalog('guest-view'));
  admitLegacyPrincipal('guest');
  await vi.advanceTimersByTimeAsync(0);
  release(catalog('old-owner-result'));
  await vi.advanceTimersByTimeAsync(0);
  expect(selectFileSpecialists.select(store.state)[0]?.name).toBe('guest-view');
});

it('does not overlap an initial specialist read when a covering lease changes', async () => {
  const { wire, receive, scope } = await attachRecovery();
  let release!: (value: ReturnType<typeof catalog>) => void;
  backend.onRequest(
    'specialist.list',
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  stop = store.runSaga(specialistsSaga);
  await vi.advanceTimersByTimeAsync(0);
  await scope.subscribe(
    {
      eventTypes: ['specialists:changed', 'skills:changed', 'settings:changed'],
      replaceGroup: 'replacement',
    },
    { recover: true },
  );
  receive({
    method: 'events.lost',
    params: { subscriptionId: 'specialists-3', generation: '1', scope: { workspaceId: null } },
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(wire.mock.calls.filter(([method]) => method === 'specialist.list')).toHaveLength(1);
  backend.onRequest('specialist.list', () => catalog('current'));
  release(catalog('obsolete'));
  await vi.advanceTimersByTimeAsync(0);
  expect(selectFileSpecialists.select(store.state)[0]?.name).toBe('current');
  expect(wire.mock.calls.filter(([method]) => method === 'specialist.list')).toHaveLength(2);
});

it('ignores appearance settings but refreshes model-resolution settings from admitted events', async () => {
  const { wire, receive } = await attachRecovery();
  backend.onRequest('specialist.list', () => catalog('initial'));
  stop = store.runSaga(specialistsSaga);
  await vi.advanceTimersByTimeAsync(0);
  wire.mockClear();
  const settings = (path: string) =>
    receive({
      method: 'events.event',
      params: {
        subscriptionId: 'specialists-1',
        event: { type: 'settings:changed', data: { changes: [{ path, value: 'changed' }] } },
      },
    });
  settings('appearance.theme');
  await vi.advanceTimersByTimeAsync(250);
  expect(wire.mock.calls.filter(([method]) => method === 'specialist.list')).toHaveLength(0);
  backend.onRequest('specialist.list', () => catalog('current'));
  settings('model.defaultProvider');
  await vi.advanceTimersByTimeAsync(250);
  expect(selectFileSpecialists.select(store.state)[0]?.name).toBe('current');
  expect(wire.mock.calls.filter(([method]) => method === 'specialist.list')).toHaveLength(1);
});

it('keeps a held initial specialist read valid across unrelated settings events', async () => {
  const { wire, receive } = await attachRecovery();
  let release!: (value: ReturnType<typeof catalog>) => void;
  backend.onRequest(
    'specialist.list',
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  stop = store.runSaga(specialistsSaga);
  await vi.advanceTimersByTimeAsync(0);
  receive({
    method: 'events.event',
    params: {
      subscriptionId: 'specialists-1',
      event: {
        type: 'settings:changed',
        data: { changes: [{ path: 'appearance.theme', value: 'dark' }] },
      },
    },
  });
  release(catalog('initial'));
  await vi.advanceTimersByTimeAsync(250);
  expect(selectFileSpecialists.select(store.state)[0]?.name).toBe('initial');
  expect(wire.mock.calls.filter(([method]) => method === 'specialist.list')).toHaveLength(1);
});

it('ignores irrelevant settings after recovery but retains settings-only loss coverage', async () => {
  const { wire, receive, scope, lose } = await attachRecovery();
  backend.onRequest('specialist.list', () => catalog('initial'));
  stop = store.runSaga(specialistsSaga);
  await vi.advanceTimersByTimeAsync(0);
  lose();
  await vi.advanceTimersByTimeAsync(0);
  wire.mockClear();
  receive({
    method: 'events.event',
    params: {
      subscriptionId: 'specialists-1',
      event: {
        type: 'settings:changed',
        data: { changes: [{ path: 'appearance.theme', value: 'dark' }] },
      },
    },
  });
  await vi.advanceTimersByTimeAsync(250);
  expect(wire.mock.calls.filter(([method]) => method === 'specialist.list')).toHaveLength(0);
  const settingsLease = await scope.subscribe(
    { eventTypes: ['settings:changed'] },
    { recover: true },
  );
  backend.onRequest('specialist.list', () => catalog('changed-model-resolution'));
  if (!settingsLease) throw new Error('Expected admitted settings lease');
  receive({
    method: 'events.lost',
    params: { subscriptionId: settingsLease.id, generation: '1', scope: { workspaceId: null } },
  });
  await vi.advanceTimersByTimeAsync(250);
  expect(selectFileSpecialists.select(store.state)[0]?.name).toBe('changed-model-resolution');
  expect(wire.mock.calls.filter(([method]) => method === 'specialist.list')).toHaveLength(1);
});
