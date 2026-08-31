/**
 * Background-hooks service wire contract + event folding (PROTOCOL §5.40 /
 * §6.5, v2.10).
 *
 * FAKE transport only: the backend-transport seam is mocked. Asserts the
 * exact `hook.list` / `hook.runNow` / `hook.cancel` request shapes and the
 * pure fold of each hook lifecycle event into the chip list.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
}));

import { backendRequest } from '$lib/client/live/backend-transport';
import {
  cancelHook,
  foldHookEvent,
  listHooks,
  runHookNow,
  type BackgroundHook,
} from './background-hooks-service';

const mockedRequest = vi.mocked(backendRequest);

/** PROTOCOL §5.40 Hook wire shape (`code`/`lastLogs` arrive from hook.list only). */
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
    lastLogs: 'checking CI\nall green',
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
    const { hooks } = foldHookEvent([makeHook({ state: 'running' })], 'hook:run-completed', {
      hookId: 'hook-1',
      nextRunAt: '2026-07-31T10:07:00Z',
    });
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

  it.each(['hook:dispatched', 'hook:evicted', 'hook:cancelled', 'hook:expired'])(
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
    '%s retains the code and lastLogs captured from hook.list (events never carry them)',
    (type) => {
      const { hooks } = foldHookEvent([makeHook()], type, {
        hookId: 'hook-1',
        nextRunAt: '2026-07-31T10:07:00Z',
      });
      expect(hooks[0].code).toBe('const status = await ws.ci.status();');
      expect(hooks[0].lastLogs).toBe('checking CI\nall green');
    },
  );

  it('retains cron/runAt schedule fields across folds (events never carry them)', () => {
    const cronHook = makeHook({ delayMs: 0, cron: '0 9 * * *' });
    const runAtHook = makeHook({ hookId: 'hook-2', delayMs: 0, runAt: '2026-08-01T09:00:00Z' });
    const { hooks } = foldHookEvent([cronHook, runAtHook], 'hook:run-completed', {
      hookId: 'hook-1',
      nextRunAt: '2026-07-31T10:07:00Z',
    });
    expect(hooks[0].cron).toBe('0 9 * * *');
    expect(hooks[1].runAt).toBe('2026-08-01T09:00:00Z');
  });
});

describe('wire requests (§5.40, fake transport)', () => {
  afterEach(() => vi.clearAllMocks());

  it('listHooks forwards hook.list { workspaceId } and unwraps hooks', async () => {
    mockedRequest.mockResolvedValueOnce({ hooks: [makeHook()] });
    const hooks = await listHooks('ws-1');
    expect(mockedRequest).toHaveBeenCalledWith('hook.list', { workspaceId: 'ws-1' });
    expect(hooks).toEqual([makeHook()]);
  });

  it('listHooks passes cron/runAt schedule kinds through unmodified', async () => {
    const cronHook = makeHook({ hookId: 'hook-cron', delayMs: 0, cron: '0 9 * * *' });
    const runAtHook = makeHook({ hookId: 'hook-once', delayMs: 0, runAt: '2026-08-01T09:00:00Z' });
    mockedRequest.mockResolvedValueOnce({ hooks: [cronHook, runAtHook] });
    const hooks = await listHooks('ws-1');
    expect(hooks).toEqual([cronHook, runAtHook]);
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
