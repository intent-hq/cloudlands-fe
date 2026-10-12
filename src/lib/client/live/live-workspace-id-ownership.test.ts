import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { BackendNotification, BackendTransport } from './backend-transport-types';

type Request = (...args: Parameters<BackendTransport['request']>) => Promise<unknown>;
type Ports = Pick<
  BackendTransport,
  'request' | 'subscribe' | 'unsubscribe' | 'onNotification' | 'onReconnected'
>;

function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

const cleanups: Array<() => Promise<void>> = [];

function attemptCleanup(failures: unknown[], operation: () => void): void {
  try {
    operation();
  } catch (error) {
    failures.push(error);
  }
}

// Control only the real source transport boundary. Every collection client,
// discovery helper, matcher, typed channel and Git subscriber stays actual.
async function fixture() {
  const exportReads: string[] = [];
  let ports: Ports | undefined;
  function read<K extends keyof Ports>(key: K): Ports[K] {
    exportReads.push(key);
    if (!ports) throw new Error(`Transport ${key} read before installation`);
    return ports[key];
  }
  vi.doMock('./backend-transport', () => ({
    get backendRequest() {
      return read('request');
    },
    get backendSubscribe() {
      return read('subscribe');
    },
    get backendUnsubscribe() {
      return read('unsubscribe');
    },
    get onBackendNotification() {
      return read('onNotification');
    },
    get onBackendReconnected() {
      return read('onReconnected');
    },
  }));
  const [
    support,
    { LiveNotesClient },
    { LiveTasksClient },
    { LiveAgentsClient },
    { LiveGitClient },
  ] = await Promise.all([
    import('./live-support'),
    import('./live-notes-client'),
    import('./live-tasks-client'),
    import('./live-agents-client'),
    import('./live-git-client'),
  ]);
  const notes = new LiveNotesClient();
  const tasks = new LiveTasksClient();
  const agents = new LiveAgentsClient();
  const git = new LiveGitClient();
  expect(exportReads).toEqual([]);

  const notifications = new Set<(notification: BackendNotification) => void>();
  const reconnects = new Set<() => void>();
  const registrationStops: Mock<() => void>[] = [];
  const ownerStops: Array<() => void> = [];
  const held: ReturnType<typeof deferred>[] = [];
  const activeChannels = new Map<string, { workspaceId?: string; unsubscribe: string }>();
  const unexpected: string[] = [];
  const onNotification = vi.fn<BackendTransport['onNotification']>((handler) => {
    notifications.add(handler);
    const stop = vi.fn(() => {
      notifications.delete(handler);
    });
    registrationStops.push(stop);
    return stop;
  });
  const onReconnected = vi.fn<BackendTransport['onReconnected']>((handler) => {
    reconnects.add(handler);
    const stop = vi.fn(() => {
      reconnects.delete(handler);
    });
    registrationStops.push(stop);
    return stop;
  });
  const request = vi.fn<Request>((method, params) => {
    const failure = `Unexpected request ${method} ${JSON.stringify(params)}`;
    unexpected.push(failure);
    return Promise.reject(new Error(failure));
  });
  const subscribe = vi.fn<(params: unknown) => Promise<unknown>>(() => {
    const id = 'git-events';
    if (activeChannels.has(id)) throw new Error('Duplicate Git event registration');
    activeChannels.set(id, { unsubscribe: 'events.unsubscribe' });
    return Promise.resolve({ subscriptionId: id });
  });
  const unsubscribe = vi.fn<BackendTransport['unsubscribe']>((id, workspaceId) => {
    const channel = activeChannels.get(id);
    if (
      !channel ||
      channel.unsubscribe !== 'events.unsubscribe' ||
      channel.workspaceId !== workspaceId
    ) {
      throw new Error(`Unknown Git subscription ${id}`);
    }
    activeChannels.delete(id);
    return Promise.resolve();
  });
  ports = {
    request: <T>(...args: Parameters<BackendTransport['request']>): Promise<T> =>
      request(...args) as Promise<T>,
    subscribe: <T>(params: unknown): Promise<T> => subscribe(params) as Promise<T>,
    unsubscribe,
    onNotification,
    onReconnected,
  };
  const hold = () => {
    const response = deferred();
    held.push(response);
    return response;
  };
  const own = (stop: () => void) => {
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      stop();
    };
    ownerStops.push(close);
    return close;
  };
  const emit = (notification: BackendNotification) => {
    for (const listener of [...notifications]) listener(notification);
  };
  const close = async () => {
    const failures: unknown[] = [];
    for (const stop of [...ownerStops].reverse()) attemptCleanup(failures, stop);
    for (const response of held) {
      attemptCleanup(failures, () => {
        response.resolve({ workspaces: [] });
      });
    }
    try {
      await vi.advanceTimersByTimeAsync(0);
    } catch (error) {
      failures.push(error);
    }
    attemptCleanup(failures, () => {
      expect(notifications.size).toBe(0);
    });
    attemptCleanup(failures, () => {
      expect(reconnects.size).toBe(0);
    });
    attemptCleanup(failures, () => {
      expect(activeChannels.size).toBe(0);
    });
    attemptCleanup(failures, () => {
      expect(unexpected).toEqual([]);
    });
    for (const stop of registrationStops) {
      attemptCleanup(failures, () => {
        expect(stop).toHaveBeenCalledTimes(1);
      });
    }
    if (failures.length > 0) throw new AggregateError(failures, 'Source workspace cleanup failed');
  };
  cleanups.push(close);
  return {
    support,
    notes,
    tasks,
    agents,
    git,
    request,
    subscribe,
    unsubscribe,
    activeChannels,
    notifications,
    reconnects,
    registrationStops,
    unexpected,
    onNotification,
    onReconnected,
    hold,
    own,
    emit,
    close,
    replaceRequest(next: BackendTransport['request']) {
      if (!ports) throw new Error('Ports not installed');
      ports.request = next;
    },
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.spyOn(console, 'debug').mockImplementation(() => {});
});

afterEach(async () => {
  const results = await Promise.allSettled(cleanups.splice(0).map((close) => close()));
  const failures: unknown[] = [];
  for (const result of results) if (result.status === 'rejected') failures.push(result.reason);
  attemptCleanup(failures, () => {
    expect(vi.getTimerCount()).toBe(0);
  });
  attemptCleanup(failures, () => {
    vi.doUnmock('./backend-transport');
  });
  attemptCleanup(failures, () => {
    vi.restoreAllMocks();
  });
  attemptCleanup(failures, () => {
    vi.useRealTimers();
  });
  attemptCleanup(failures, () => {
    vi.resetModules();
  });
  if (failures.length > 0) throw new AggregateError(failures, 'Source workspace teardown failed');
});

describe('actual source workspace enumeration ownership', () => {
  it('shares one held seed across Notes, Tasks, Agents, Git and the actual note resolver', async () => {
    const f = await fixture();
    const seed = f.hold();
    let enumerationCount = 0;
    const status = {
      branch: 'main',
      ahead: 0,
      behind: 0,
      diverged: false,
      files: [],
      hasUncommittedChanges: false,
      hasUntrackedFiles: false,
    };
    f.request.mockImplementation((method, params) => {
      if (method === 'workspace.list' && enumerationCount++ === 0) return seed.promise;
      const scope = params as { workspaceId?: string; subscriptionId?: string } | undefined;
      const workspaceId = scope?.workspaceId;
      if (['note.subscribe', 'task.subscribe', 'agent.subscribe'].includes(method) && workspaceId) {
        const id = `${method}:${workspaceId}`;
        if (f.activeChannels.has(id)) throw new Error(`Duplicate collection channel ${id}`);
        f.activeChannels.set(id, {
          workspaceId,
          unsubscribe:
            method === 'agent.subscribe'
              ? 'events.unsubscribe'
              : method.replace('subscribe', 'unsubscribe'),
        });
        return Promise.resolve({ subscriptionId: id });
      }
      if (['note.unsubscribe', 'task.unsubscribe', 'events.unsubscribe'].includes(method)) {
        const id = scope?.subscriptionId;
        const channel = id ? f.activeChannels.get(id) : undefined;
        if (
          !id ||
          !channel ||
          channel.workspaceId !== workspaceId ||
          channel.unsubscribe !== method
        ) {
          throw new Error(`Unknown collection teardown ${method}`);
        }
        f.activeChannels.delete(id);
        return Promise.resolve({});
      }
      if (method === 'note.list' && workspaceId === 'ws-a') {
        return Promise.resolve({ notes: [{ id: 'scanned-note' }, { id: 'later-note' }] });
      }
      if (method === 'git.status' && workspaceId === 'ws-a') return Promise.resolve(status);
      const failure = `Unexpected request ${method} ${JSON.stringify(params)}`;
      f.unexpected.push(failure);
      return Promise.reject(new Error(failure));
    });
    const notes = vi.fn();
    const tasks = vi.fn();
    const agents = vi.fn();
    const git = vi.fn();
    const stopNotes = f.own(f.notes.subscribe(notes));
    const stopTasks = f.own(f.tasks.subscribe(tasks));
    const stopAgents = f.own(f.agents.subscribe(agents));
    f.own(f.git.subscribe(git));
    const resolved = f.support.resolveNoteWorkspaceId('scanned-note');
    // Observe rejection immediately, while preserving the original Promise for assertions.
    const settlement = resolved.then(
      (value) => ({ status: 'fulfilled' as const, value }),
      (reason: unknown) => ({ status: 'rejected' as const, reason }),
    );
    const failures: unknown[] = [];
    try {
      expect(f.request.mock.calls).toEqual([['workspace.list']]);
      expect(f.onNotification).toHaveBeenCalledTimes(5);
      expect(f.onReconnected).toHaveBeenCalledTimes(6);
      expect(f.subscribe.mock.calls).toEqual([
        [
          {
            eventTypes: [
              'git:commit',
              'git:push',
              'git:pull',
              'git:branch',
              'git:merge',
              'changes:tracked',
              'changes:git-status',
            ],
          },
        ],
      ]);
      seed.resolve({ workspaces: [{ id: 'ws-a' }] });
      await expect(resolved).resolves.toBe('ws-a');
      await vi.advanceTimersByTimeAsync(0);
      for (const method of ['note.subscribe', 'task.subscribe', 'agent.subscribe']) {
        expect(f.request.mock.calls.filter(([name]) => name === method)).toEqual([
          [method, { workspaceId: 'ws-a' }],
        ]);
      }
      expect(f.request.mock.calls.filter(([name]) => name === 'note.list')).toEqual([
        ['note.list', { workspaceId: 'ws-a', projection: 'slim' }],
      ]);
      expect(f.request.mock.calls.filter(([name]) => name === 'git.status')).toEqual([
        ['git.status', { workspaceId: 'ws-a' }],
      ]);
      expect(git).toHaveBeenLastCalledWith(status);
      const timestamp = '2026-10-12T00:00:00Z';
      f.emit({
        method: 'subscription.push',
        params: {
          subscriptionId: 'note.subscribe:ws-a',
          kind: 'snapshot',
          seq: 0,
          snapshot: [
            {
              id: 'note-a',
              workspaceId: 'ws-a',
              title: 'Note',
              content: '',
              contentType: 'markdown',
              metadata: {},
              tags: [],
              isPinned: false,
              isArchived: false,
              visibility: 'workspace',
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          ],
        },
      });
      f.emit({
        method: 'subscription.push',
        params: {
          subscriptionId: 'task.subscribe:ws-a',
          kind: 'snapshot',
          seq: 0,
          snapshot: [
            {
              id: 'task-a',
              workspaceId: 'ws-a',
              title: 'Task',
              content: '',
              metadata: { task: { status: 'in_progress' } },
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          ],
        },
      });
      f.emit({
        method: 'subscription.push',
        params: {
          subscriptionId: 'agent.subscribe:ws-a',
          kind: 'snapshot',
          seq: 0,
          snapshot: [
            {
              id: 'agent-a',
              workspaceId: 'ws-a',
              name: 'Agent',
              status: 'idle',
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          ],
        },
      });
      expect(notes.mock.lastCall?.[0]).toMatchObject([{ id: 'note-a', workspaceId: 'ws-a' }]);
      expect(tasks.mock.lastCall?.[0]).toMatchObject([{ id: 'task-a', status: 'in_progress' }]);
      expect(agents.mock.lastCall?.[0]).toMatchObject([{ id: 'agent-a', workspaceId: 'ws-a' }]);
      f.emit({
        method: 'events.event',
        params: {
          event: {
            type: 'workspace:created',
            data: { workspace: { id: 'ws-b' } },
          },
        },
      });
      await vi.advanceTimersByTimeAsync(0);
      for (const method of ['note.subscribe', 'task.subscribe', 'agent.subscribe']) {
        expect(f.request.mock.calls.filter(([name]) => name === method)).toEqual([
          [method, { workspaceId: 'ws-a' }],
          [method, { workspaceId: 'ws-b' }],
        ]);
      }
      stopNotes();
      stopTasks();
      stopAgents();
      await vi.advanceTimersByTimeAsync(2_001);
      await expect(f.support.resolveNoteWorkspaceId('task-a')).resolves.toBe('ws-a');
      await expect(f.support.listWorkspaceIds()).resolves.toEqual(['ws-a', 'ws-b']);
      f.emit({
        method: 'events.event',
        params: { event: { type: 'changes:git-status', data: {} } },
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(f.request.mock.calls.filter(([name]) => name === 'workspace.list')).toEqual([
        ['workspace.list'],
      ]);
      expect(f.request.mock.calls.filter(([name]) => name === 'git.status')).toEqual([
        ['git.status', { workspaceId: 'ws-a' }],
        ['git.status', { workspaceId: 'ws-a' }],
      ]);
      expect(f.notifications.size).toBe(2);
      expect(f.reconnects.size).toBe(3);
      expect([...f.activeChannels.keys()]).toEqual(['git-events']);
    } catch (error) {
      failures.push(error);
    } finally {
      attemptCleanup(failures, () => {
        seed.resolve({ workspaces: [] });
      });
      // Close and drain before awaiting the observed read, even if it rejected.
      try {
        await f.close();
      } catch (error) {
        failures.push(error);
      }
      const outcome = await settlement;
      if (outcome.status === 'rejected') failures.push(outcome.reason);
    }
    if (failures.length > 0)
      throw new AggregateError(failures, 'Source workspace body or cleanup failed');
    expect(f.unsubscribe.mock.calls).toEqual([['git-events']]);
    const teardowns = f.request.mock.calls.filter(([name]) => name.endsWith('.unsubscribe'));
    expect(teardowns).toHaveLength(6);
    for (const workspaceId of ['ws-a', 'ws-b']) {
      expect(teardowns).toContainEqual([
        'note.unsubscribe',
        { subscriptionId: `note.subscribe:${workspaceId}`, workspaceId },
      ]);
      expect(teardowns).toContainEqual([
        'task.unsubscribe',
        { subscriptionId: `task.subscribe:${workspaceId}`, workspaceId },
      ]);
      expect(teardowns).toContainEqual([
        'events.unsubscribe',
        { subscriptionId: `agent.subscribe:${workspaceId}`, workspaceId },
      ]);
    }
  });

  it('keeps source request lookup lazy and the combined test reset retains positive task discoveries', async () => {
    const f = await fixture();
    f.request
      .mockResolvedValueOnce({ workspaces: [{ id: 'before-reset' }] })
      .mockResolvedValueOnce({
        tasks: [{ id: 'known-task', title: 'Known', status: 'not_started' }],
        stats: { total: 1, completed: 0, inProgress: 0 },
      });
    await expect(f.support.listWorkspaceIds()).resolves.toEqual(['before-reset']);
    await f.tasks.list('task-home');
    f.support.__resetLiveSupportCachesForTests();
    const replacement = vi
      .fn<Request>()
      .mockResolvedValueOnce({ workspaces: [{ id: 'after-reset' }] })
      .mockResolvedValueOnce({ newContent: 'Saved', rev: 3 });
    f.replaceRequest(
      <T>(...args: Parameters<BackendTransport['request']>): Promise<T> =>
        replacement(...args) as Promise<T>,
    );
    await expect(f.support.listWorkspaceIds()).resolves.toEqual(['after-reset']);
    await expect(f.notes.setContent('known-task', 'Saved')).resolves.toEqual({
      success: true,
      newContent: 'Saved',
      noteRev: 3,
    });
    expect(f.request.mock.calls).toEqual([
      ['workspace.list'],
      ['task.list', { workspaceId: 'task-home' }],
    ]);
    expect(replacement.mock.calls).toEqual([
      ['workspace.list'],
      ['note.setContent', { workspaceId: 'task-home', noteId: 'known-task', content: 'Saved' }],
    ]);
    expect(f.onNotification).not.toHaveBeenCalled();
    expect(f.onReconnected).not.toHaveBeenCalled();
    // The explicit test reset is required here. This is not a backend-change
    // invalidation guarantee; the production lifetime limitation is inherited.
  });
});
