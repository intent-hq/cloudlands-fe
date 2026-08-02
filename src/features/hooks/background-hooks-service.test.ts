/**
 * Background-hooks service wire contract + event folding (PROTOCOL §5.40 /
 * §6.5, v2.10).
 *
 * FAKE transport only: the backend-transport seam is mocked. Asserts the
 * exact `hook.list` / `hook.runNow` / `hook.cancel` request shapes, the
 * `hook:*` events.subscribe registration, and the pure fold of each hook
 * lifecycle event into the chip list.
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
  cancelHook,
  foldHookEvent,
  listHooks,
  runHookNow,
  subscribeBackgroundHooks,
  type BackgroundHook,
} from './background-hooks-service';

const mockedRequest = vi.mocked(backendRequest);
const mockedSubscribe = vi.mocked(backendSubscribe);
const mockedUnsubscribe = vi.mocked(backendUnsubscribe);
const mockedOnNotification = vi.mocked(onBackendNotification);

/** PROTOCOL §5.40 Hook wire shape (`code` arrives from hook.list only). */
function makeHook(overrides: Partial<BackgroundHook> = {}): BackgroundHook {
  return {
    hookId: 'hook-1',
    workspaceId: 'ws-1',
    agentId: 'agent-1',
    name: 'ci-watch',
    code: 'const status = await ws.ci.status();',
    delayMs: 60000,
    state: 'scheduled',
    createdAt: '2026-07-31T10:00:00Z',
    lastRunAt: '2026-07-31T10:05:00Z',
    nextRunAt: '2026-07-31T10:06:00Z',
    runCount: 6,
    ...overrides,
  };
}

describe('foldHookEvent (§6.5 hook:* lifecycle)', () => {
  it('hook:run-started flips the hook to running', () => {
    const { hooks, needsRefetch } = foldHookEvent([makeHook()], 'hook:run-started', {
      hookId: 'hook-1',
    });
    expect(hooks[0].state).toBe('running');
    expect(needsRefetch).toBe(false);
  });

  it('hook:run-completed reschedules with the event nextRunAt', () => {
    const { hooks } = foldHookEvent(
      [makeHook({ state: 'running' })],
      'hook:run-completed',
      { hookId: 'hook-1', nextRunAt: '2026-07-31T10:07:00Z' },
    );
    expect(hooks[0].state).toBe('scheduled');
    expect(hooks[0].nextRunAt).toBe('2026-07-31T10:07:00Z');
  });

  it('hook:run-completed without nextRunAt clears it (terminal event follows)', () => {
    const { hooks } = foldHookEvent([makeHook({ state: 'running' })], 'hook:run-completed', {
      hookId: 'hook-1',
    });
    expect(hooks[0].state).toBe('scheduled');
    expect(hooks[0].nextRunAt).toBeUndefined();
  });

  it.each(['hook:dispatched', 'hook:evicted', 'hook:cancelled'])(
    '%s removes the hook',
    (type) => {
      const other = makeHook({ hookId: 'hook-2' });
      const { hooks, needsRefetch } = foldHookEvent([makeHook(), other], type, {
        hookId: 'hook-1',
      });
      expect(hooks).toEqual([other]);
      expect(needsRefetch).toBe(false);
    },
  );

  it('hook:scheduled updates a known hook nextRunAt', () => {
    const { hooks, needsRefetch } = foldHookEvent([makeHook()], 'hook:scheduled', {
      hookId: 'hook-1',
      nextRunAt: '2026-07-31T10:08:00Z',
    });
    expect(hooks[0].nextRunAt).toBe('2026-07-31T10:08:00Z');
    expect(needsRefetch).toBe(false);
  });

  it('hook:scheduled for an unseen hook requests a refetch (missing wire fields)', () => {
    const { hooks, needsRefetch } = foldHookEvent([], 'hook:scheduled', { hookId: 'hook-9' });
    expect(hooks).toEqual([]);
    expect(needsRefetch).toBe(true);
  });

  it('ignores unknown hook event types and events without hookId', () => {
    const initial = [makeHook()];
    expect(foldHookEvent(initial, 'hook:unknown', { hookId: 'hook-1' }).hooks).toBe(initial);
    expect(foldHookEvent(initial, 'hook:cancelled', {}).hooks).toBe(initial);
  });

  it.each(['hook:scheduled', 'hook:run-started', 'hook:run-completed'])(
    '%s retains the code captured from hook.list (events never carry it)',
    (type) => {
      const { hooks } = foldHookEvent([makeHook()], type, {
        hookId: 'hook-1',
        nextRunAt: '2026-07-31T10:07:00Z',
      });
      expect(hooks[0].code).toBe('const status = await ws.ci.status();');
    },
  );
});

describe('wire requests (§5.40, fake transport)', () => {
  afterEach(() => vi.clearAllMocks());

  it('listHooks forwards hook.list { workspaceId } and unwraps hooks', async () => {
    mockedRequest.mockResolvedValueOnce({ hooks: [makeHook()] });
    const hooks = await listHooks('ws-1');
    expect(mockedRequest).toHaveBeenCalledWith('hook.list', { workspaceId: 'ws-1' });
    expect(hooks).toEqual([makeHook()]);
  });

  it('runHookNow forwards hook.runNow { workspaceId, hookId }', async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true, hookId: 'hook-1' });
    await runHookNow('ws-1', 'hook-1');
    expect(mockedRequest).toHaveBeenCalledWith('hook.runNow', {
      workspaceId: 'ws-1',
      hookId: 'hook-1',
    });
  });

  it('cancelHook forwards hook.cancel { workspaceId, hookId }', async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true, hook: makeHook({ state: 'cancelled' }) });
    await cancelHook('ws-1', 'hook-1');
    expect(mockedRequest).toHaveBeenCalledWith('hook.cancel', {
      workspaceId: 'ws-1',
      hookId: 'hook-1',
    });
  });
});

describe('subscribeBackgroundHooks (hook:* events.subscribe + fold)', () => {
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

  it('registers a workspace-scoped hook:* subscription, seeds from hook.list, folds events', async () => {
    mockedRequest.mockResolvedValue({ hooks: [makeHook()] });
    const seen: BackgroundHook[][] = [];
    const dispose = subscribeBackgroundHooks('ws-1', (hooks) => seen.push(hooks));
    await flush();

    expect(mockedSubscribe).toHaveBeenCalledWith({ eventTypes: ['hook:*'], workspaceId: 'ws-1' });
    expect(mockedRequest).toHaveBeenCalledWith('hook.list', { workspaceId: 'ws-1' });
    expect(seen.at(-1)).toEqual([makeHook()]);

    notify?.({
      method: 'events.event',
      params: {
        subscriptionId: 'ws-sub-7',
        event: { type: 'hook:run-started', workspaceId: 'ws-1', data: { hookId: 'hook-1' } },
      },
    });
    expect(seen.at(-1)?.[0].state).toBe('running');

    notify?.({
      method: 'events.event',
      params: {
        subscriptionId: 'ws-sub-7',
        event: { type: 'hook:cancelled', workspaceId: 'ws-1', data: { hookId: 'hook-1' } },
      },
    });
    expect(seen.at(-1)).toEqual([]);

    dispose();
    expect(mockedUnsubscribe).toHaveBeenCalledWith('ws-sub-7');
  });

  it('ignores foreign-workspace and foreign-subscription events', async () => {
    mockedRequest.mockResolvedValue({ hooks: [makeHook()] });
    const seen: BackgroundHook[][] = [];
    const dispose = subscribeBackgroundHooks('ws-1', (hooks) => seen.push(hooks));
    await flush();
    const baseline = seen.length;

    notify?.({
      method: 'events.event',
      params: {
        subscriptionId: 'ws-sub-7',
        event: { type: 'hook:cancelled', workspaceId: 'ws-2', data: { hookId: 'hook-1' } },
      },
    });
    notify?.({
      method: 'events.event',
      params: {
        subscriptionId: 'ws-sub-other',
        event: { type: 'hook:cancelled', workspaceId: 'ws-1', data: { hookId: 'hook-1' } },
      },
    });
    expect(seen.length).toBe(baseline);
    dispose();
  });

  it('refetches when an event references an unseen hook', async () => {
    mockedRequest
      .mockResolvedValueOnce({ hooks: [] })
      .mockResolvedValueOnce({ hooks: [makeHook({ hookId: 'hook-9' })] });
    const seen: BackgroundHook[][] = [];
    const dispose = subscribeBackgroundHooks('ws-1', (hooks) => seen.push(hooks));
    await flush();

    notify?.({
      method: 'events.event',
      params: {
        subscriptionId: 'ws-sub-7',
        event: { type: 'hook:scheduled', workspaceId: 'ws-1', data: { hookId: 'hook-9' } },
      },
    });
    await flush();

    expect(mockedRequest).toHaveBeenCalledTimes(2);
    expect(seen.at(-1)).toEqual([makeHook({ hookId: 'hook-9' })]);
    dispose();
  });
});
