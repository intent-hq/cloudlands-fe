import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBackendTasksClient } from './backend-tasks-client';
import { createNoteWorkspaceDiscovery } from './backend-note-workspace-discovery';
import type { BackendTransport } from './backend-transport-types';

type Request = (...args: Parameters<BackendTransport['request']>) => Promise<unknown>;

function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

function fixture() {
  const request = vi.fn<Request>().mockRejectedValue(new Error('Unexpected task request'));
  const discoveryRequest = vi
    .fn<Request>()
    .mockRejectedValue(new Error('Unexpected discovery request'));
  const enumerate = vi
    .fn<(tag: string) => Promise<string[]>>()
    .mockRejectedValue(new Error('Unexpected enumeration'));
  const discovery = createNoteWorkspaceDiscovery({
    backendRequest: <T>(...args: Parameters<BackendTransport['request']>): Promise<T> =>
      discoveryRequest(...args) as Promise<T>,
    listWorkspaceIdsOrThrow: enumerate,
  });
  // The observed port delegates to the actual discovery owner; it is not a
  // no-op, resolver replacement, or a second task-local note cache.
  const remember = vi.fn((noteId: string, workspaceId: string) =>
    discovery.rememberNoteWorkspace(noteId, workspaceId),
  );
  const client = createBackendTasksClient({
    backendRequest: <T>(...args: Parameters<BackendTransport['request']>): Promise<T> =>
      request(...args) as Promise<T>,
    rememberNoteWorkspace: remember,
  });
  return { request, discoveryRequest, enumerate, discovery, remember, client };
}

function attemptCleanup(failures: unknown[], operation: () => void): void {
  try {
    operation();
  } catch (error) {
    failures.push(error);
  }
}

afterEach(() => {
  const failures: unknown[] = [];
  attemptCleanup(failures, () => {
    vi.doUnmock('./backend-transport');
  });
  attemptCleanup(failures, () => {
    vi.doUnmock('./backend-tasks-client');
  });
  attemptCleanup(failures, () => {
    vi.restoreAllMocks();
  });
  attemptCleanup(failures, () => {
    vi.resetModules();
  });
  if (failures.length > 0) throw new AggregateError(failures, 'Task read teardown failed');
});

describe('canonical task read contract', () => {
  it('constructs without reading the backend or touching discovery', () => {
    const f = fixture();
    expect(f.request).not.toHaveBeenCalled();
    expect(f.remember).not.toHaveBeenCalled();
    expect(f.discoveryRequest).not.toHaveBeenCalled();
    expect(f.enumerate).not.toHaveBeenCalled();
  });

  it('sends task.list exactly, preserves daemon statistics and remembers accepted IDs in row order', async () => {
    const f = fixture();
    f.request.mockResolvedValueOnce({
      tasks: [
        {
          id: 'direct',
          title: 'Direct',
          status: 'complete',
          updatedAt: 'current',
          rev: 2,
          dependsOn: ['dep'],
          conflictsWith: [],
          unmetDependsOn: [],
          specLinked: false,
        },
        { id: 'plain-note', title: 'Not a task' },
        {
          id: 'nested',
          title: 'Nested',
          status: 'cancelled',
          updated_at: 'legacy',
          rev: 7,
          metadata: {
            task: { status: 'in_progress', dependsOn: ['nested-dep'], specLinked: true },
          },
        },
        { id: '', title: 'Empty ID', status: 'not_started' },
      ],
      stats: { total: 12, completed: 8, inProgress: 3 },
    });
    const result = await f.client.list('ws-a');
    expect(f.request.mock.calls).toEqual([['task.list', { workspaceId: 'ws-a' }]]);
    expect(result).toEqual({
      tasks: [
        {
          id: 'direct',
          title: 'Direct',
          status: 'complete',
          updatedAt: 'current',
          rev: 2,
          dependsOn: ['dep'],
          specLinked: false,
        },
        {
          id: 'nested',
          title: 'Nested',
          status: 'in_progress',
          updatedAt: 'legacy',
          rev: 7,
          dependsOn: ['nested-dep'],
          specLinked: true,
        },
        { id: '', title: 'Empty ID', status: 'not_started', updatedAt: undefined },
      ],
      stats: { total: 12, completed: 8, inProgress: 3 },
    });
    expect(f.remember.mock.calls).toEqual([
      ['direct', 'ws-a'],
      ['nested', 'ws-a'],
    ]);
    await expect(f.discovery.resolveNoteWorkspaceId('nested')).resolves.toBe('ws-a');
    expect(f.enumerate).not.toHaveBeenCalled();
  });

  it('warns on malformed relation lists while retaining valid relation and presence fields', async () => {
    const f = fixture();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    f.request.mockResolvedValueOnce({
      tasks: [
        {
          id: 'task',
          title: 'Task',
          status: 'review_required',
          dependsOn: ['dep', 7],
          conflictsWith: ['conflict'],
          unmetDependsOn: [false],
          specLinked: 'not-a-boolean',
        },
      ],
      stats: { total: 3, completed: 0, inProgress: 2 },
    });
    const result = await f.client.list('ws-a');
    expect(result.tasks).toEqual([
      {
        id: 'task',
        title: 'Task',
        status: 'review_required',
        updatedAt: undefined,
        conflictsWith: ['conflict'],
      },
    ]);
    expect(warn.mock.calls.map(([, data]) => data)).toEqual([
      { value: ['dep', 7] },
      { value: [false] },
    ]);
    expect(f.remember.mock.calls).toEqual([['task', 'ws-a']]);
  });

  it('characterizes missing task and stats envelopes without deriving an aggregate', async () => {
    const f = fixture();
    f.request
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        tasks: 'invalid',
        stats: { total: 4, completed: '2', inProgress: null },
      })
      .mockResolvedValueOnce({ tasks: [{ id: 'one', title: 'One', status: 'complete' }] });
    await expect(f.client.list('ws-a')).resolves.toEqual({
      tasks: [],
      stats: { total: 0, completed: 0, inProgress: 0 },
    });
    await expect(f.client.list('ws-a')).resolves.toEqual({
      tasks: [],
      stats: { total: 4, completed: 0, inProgress: 0 },
    });
    const last = await f.client.list('ws-a');
    expect(last.tasks).toHaveLength(1);
    expect(last.stats).toEqual({ total: 0, completed: 0, inProgress: 0 });
    expect(f.request.mock.calls).toEqual([
      ['task.list', { workspaceId: 'ws-a' }],
      ['task.list', { workspaceId: 'ws-a' }],
      ['task.list', { workspaceId: 'ws-a' }],
    ]);
  });

  it('characterizes inherited numeric checks on non-wire nonfinite statistics', async () => {
    const f = fixture();
    // These values are JavaScript characterization inputs, not JSON daemon payloads.
    f.request.mockResolvedValueOnce({
      tasks: [],
      stats: { total: NaN, completed: Infinity, inProgress: -2 },
    });
    const result = await f.client.list('ws-a');
    expect(result.stats.total).toBeNaN();
    expect(result.stats.completed).toBe(Infinity);
    expect(result.stats.inProgress).toBe(-2);
    expect(f.remember).not.toHaveBeenCalled();
  });

  it('characterizes null-row rejection after retaining discoveries from preceding rows', async () => {
    const f = fixture();
    // Invalid row shape is inherited JS behavior, never a valid wire fixture.
    f.request.mockResolvedValueOnce({
      tasks: [
        { id: 'first', title: 'First', status: 'complete' },
        null,
        { id: 'never', title: 'Never', status: 'not_started' },
      ],
      stats: { total: 2, completed: 1, inProgress: 0 },
    });
    await expect(f.client.list('ws-a')).rejects.toBeInstanceOf(TypeError);
    expect(f.remember.mock.calls).toEqual([['first', 'ws-a']]);
    await expect(f.discovery.resolveNoteWorkspaceId('first')).resolves.toBe('ws-a');
    expect(f.enumerate).not.toHaveBeenCalled();
  });

  it('preserves remember failure identity and stops before later rows or stats access', async () => {
    const f = fixture();
    const failure = new Error('discovery owner rejected the second row');
    const order: string[] = [];
    f.remember.mockImplementation((id, workspaceId) => {
      order.push(id);
      if (id === 'second') throw failure;
      f.discovery.rememberNoteWorkspace(id, workspaceId);
    });
    // The accessor deliberately characterizes evaluation order, not JSON wire shape.
    f.request.mockResolvedValueOnce({
      tasks: [
        { id: 'first', status: 'complete' },
        { id: 'second', status: 'complete' },
        { id: 'third', status: 'complete' },
      ],
      get stats() {
        order.push('stats');
        return { total: 3, completed: 3, inProgress: 0 };
      },
    });
    await expect(f.client.list('ws-a')).rejects.toBe(failure);
    expect(order).toEqual(['first', 'second']);
    expect(f.remember.mock.calls).toEqual([
      ['first', 'ws-a'],
      ['second', 'ws-a'],
    ]);
    await expect(f.discovery.resolveNoteWorkspaceId('first')).resolves.toBe('ws-a');
    expect(f.enumerate).not.toHaveBeenCalled();
  });

  it('remembers duplicate IDs repeatedly and keeps the actual discovery owner last-writer-wins', async () => {
    const f = fixture();
    f.request
      .mockResolvedValueOnce({
        tasks: [
          { id: 'shared', title: 'First', status: 'not_started' },
          { id: 'shared', title: 'Second', status: 'complete' },
        ],
      })
      .mockResolvedValueOnce({ tasks: [{ id: 'shared', status: 'in_progress' }] });
    expect((await f.client.list('ws-a')).tasks.map((task) => task.title)).toEqual([
      'First',
      'Second',
    ]);
    await f.client.list('ws-b');
    expect(f.remember.mock.calls).toEqual([
      ['shared', 'ws-a'],
      ['shared', 'ws-a'],
      ['shared', 'ws-b'],
    ]);
    await expect(f.discovery.resolveNoteWorkspaceId('shared')).resolves.toBe('ws-b');
    expect(f.enumerate).not.toHaveBeenCalled();
  });

  it('does not add request coalescing or a cache and remembers in actual settlement order', async () => {
    const f = fixture();
    const first = deferred();
    const second = deferred();
    f.request.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const a = f.client.list('ws-a');
    const aSettlement = a.then(
      (value) => ({ status: 'fulfilled' as const, value }),
      (reason: unknown) => ({ status: 'rejected' as const, reason }),
    );
    const b = f.client.list('ws-b');
    const bSettlement = b.then(
      (value) => ({ status: 'fulfilled' as const, value }),
      (reason: unknown) => ({ status: 'rejected' as const, reason }),
    );
    const failures: unknown[] = [];
    try {
      expect(f.request.mock.calls).toEqual([
        ['task.list', { workspaceId: 'ws-a' }],
        ['task.list', { workspaceId: 'ws-b' }],
      ]);
      second.resolve({ tasks: [{ id: 'same-note', status: 'in_progress' }] });
      await b;
      first.resolve({ tasks: [{ id: 'same-note', status: 'complete' }] });
      await a;
      expect(f.remember.mock.calls).toEqual([
        ['same-note', 'ws-b'],
        ['same-note', 'ws-a'],
      ]);
      await expect(f.discovery.resolveNoteWorkspaceId('same-note')).resolves.toBe('ws-a');
    } catch (error) {
      failures.push(error);
    } finally {
      attemptCleanup(failures, () => {
        first.resolve({ tasks: [] });
      });
      attemptCleanup(failures, () => {
        second.resolve({ tasks: [] });
      });
      for (const outcome of await Promise.all([aSettlement, bSettlement])) {
        if (outcome.status === 'rejected') failures.push(outcome.reason);
      }
    }
    if (failures.length > 0) throw new AggregateError(failures, 'Task read body or cleanup failed');
  });

  it('preserves transport rejection identity in both reads without remembering anything', async () => {
    const f = fixture();
    const failure = Object.assign(new Error('permission denied'), { rpcCode: -32003 });
    f.request.mockRejectedValue(failure);
    await expect(f.client.list('ws-a')).rejects.toBe(failure);
    await expect(f.client.listAgentLinks('ws-a')).rejects.toBe(failure);
    expect(f.request.mock.calls).toEqual([
      ['task.list', { workspaceId: 'ws-a' }],
      ['task.listAgentLinks', { workspaceId: 'ws-a' }],
    ]);
    expect(f.remember).not.toHaveBeenCalled();
    expect(f.enumerate).not.toHaveBeenCalled();
  });

  it('keeps synchronous request throws inside the original async method rejection', async () => {
    const f = fixture();
    const failure = new Error('transport unavailable');
    f.request.mockImplementation(() => {
      throw failure;
    });
    const list = f.client.list('ws-a');
    const links = f.client.listAgentLinks('ws-a');
    await expect(list).rejects.toBe(failure);
    await expect(links).rejects.toBe(failure);
    expect(f.request).toHaveBeenCalledTimes(2);
    expect(f.remember).not.toHaveBeenCalled();
  });

  it('uses grouped link keys, filters invalid rows and drops daemon-only workspace fields', async () => {
    const f = fixture();
    const valid = {
      noteId: 'row-note',
      taskKey: 'row-key',
      taskText: 'Checkbox',
      agentId: 'agent-a',
      createdAt: 17,
      workspaceId: 'ws-a',
    };
    f.request.mockResolvedValueOnce({
      links: [{ ...valid, noteId: 'ignored-flat' }],
      linksByNoteId: {
        'group-note': { 'group-key': valid, bad: { ...valid, createdAt: '17' }, nil: null },
        empty: {},
        primitive: 7,
        'all-invalid': { key: { ...valid, agentId: null } },
      },
    });
    await expect(f.client.listAgentLinks('ws-a')).resolves.toEqual({
      'group-note': {
        'group-key': {
          noteId: 'row-note',
          taskKey: 'row-key',
          taskText: 'Checkbox',
          agentId: 'agent-a',
          createdAt: 17,
        },
      },
    });
    expect(f.request.mock.calls).toEqual([['task.listAgentLinks', { workspaceId: 'ws-a' }]]);
    expect(f.remember).not.toHaveBeenCalled();
    expect(f.enumerate).not.toHaveBeenCalled();
  });

  it('returns empty grouped links for missing maps without deriving them from the flat array', async () => {
    const f = fixture();
    f.request.mockResolvedValueOnce(undefined).mockResolvedValueOnce({
      links: [
        {
          noteId: 'note-a',
          taskKey: 'key',
          taskText: 'Checkbox',
          agentId: 'agent-a',
          createdAt: 17,
        },
      ],
      linksByNoteId: null,
    });
    await expect(f.client.listAgentLinks('ws-a')).resolves.toEqual({});
    await expect(f.client.listAgentLinks('ws-a')).resolves.toEqual({});
    expect(f.request.mock.calls).toEqual([
      ['task.listAgentLinks', { workspaceId: 'ws-a' }],
      ['task.listAgentLinks', { workspaceId: 'ws-a' }],
    ]);
    expect(f.remember).not.toHaveBeenCalled();
  });

  it('keeps both reads independent of the call receiver', async () => {
    const f = fixture();
    f.request
      .mockResolvedValueOnce({ tasks: [], stats: { total: 5, completed: 1, inProgress: 2 } })
      .mockResolvedValueOnce({ linksByNoteId: {} });
    const { list, listAgentLinks } = f.client;
    await expect(list.call(null, 'ws-a')).resolves.toEqual({
      tasks: [],
      stats: { total: 5, completed: 1, inProgress: 2 },
    });
    await expect(listAgentLinks.call(null, 'ws-a')).resolves.toEqual({});
    expect(f.request.mock.calls).toEqual([
      ['task.list', { workspaceId: 'ws-a' }],
      ['task.listAgentLinks', { workspaceId: 'ws-a' }],
    ]);
  });
});

async function sourceFixture() {
  vi.resetModules();
  let installedRequest: BackendTransport['request'] | undefined;
  const exportReads: string[] = [];
  const request = vi.fn<Request>().mockRejectedValue(new Error('Unexpected source request'));
  const captured: ReturnType<typeof createBackendTasksClient>[] = [];
  // Capture and return the identical actual factory instance synchronously.
  // Its methods, discovery port, responses and errors are not replaced here.
  vi.doMock('./backend-tasks-client', async (importActual) => {
    const actual = await importActual<typeof import('./backend-tasks-client')>();
    return {
      ...actual,
      createBackendTasksClient(...args: Parameters<typeof actual.createBackendTasksClient>) {
        const client = actual.createBackendTasksClient(...args);
        captured.push(client);
        return client;
      },
    };
  });
  vi.doMock('./backend-transport', () => ({
    get backendRequest() {
      exportReads.push('backendRequest');
      if (!installedRequest) throw new Error('Source request read before installation');
      return installedRequest;
    },
    get onBackendNotification() {
      throw new Error('Unexpected notification registration');
    },
    get onBackendReconnected() {
      throw new Error('Unexpected reconnect registration');
    },
  }));
  const [{ LiveTasksClient }, support] = await Promise.all([
    import('./live-tasks-client'),
    import('./live-support'),
  ]);
  const client = new LiveTasksClient();
  const another = new LiveTasksClient();
  expect(exportReads).toEqual([]);
  expect(request).not.toHaveBeenCalled();
  expect(captured).toHaveLength(1);
  const actualReads = captured[0];
  if (!actualReads) throw new Error('Source factory was not captured');
  installedRequest = <T>(...args: Parameters<BackendTransport['request']>): Promise<T> =>
    request(...args) as Promise<T>;
  return {
    client,
    another,
    support,
    actualReads,
    request,
    replaceRequest(next: BackendTransport['request']) {
      installedRequest = next;
    },
  };
}

describe('actual source task facade and shared normalizers', () => {
  it('returns actual factory promises directly and records discoveries in the genuine source owner', async () => {
    const f = await sourceFixture();
    const list = vi.spyOn(f.actualReads, 'list');
    const links = vi.spyOn(f.actualReads, 'listAgentLinks');
    f.request
      .mockResolvedValueOnce({
        tasks: [{ id: 'task-a', title: 'Task', status: 'not_started' }],
        stats: { total: 9, completed: 2, inProgress: 3 },
      })
      .mockResolvedValueOnce({ linksByNoteId: {} });
    // Detached calls retain the original receiver-independent read behavior.
    const listPromise = f.client.list.call(null, 'ws-a');
    expect(listPromise).toBe(list.mock.results[0]?.value);
    await expect(listPromise).resolves.toMatchObject({
      stats: { total: 9, completed: 2, inProgress: 3 },
    });
    const linksPromise = f.another.listAgentLinks.call(null, 'ws-a');
    expect(linksPromise).toBe(links.mock.results[0]?.value);
    await expect(linksPromise).resolves.toEqual({});
    await expect(f.support.resolveNoteWorkspaceId('task-a')).resolves.toBe('ws-a');
    expect(f.request.mock.calls).toEqual([
      ['task.list', { workspaceId: 'ws-a' }],
      ['task.listAgentLinks', { workspaceId: 'ws-a' }],
    ]);
  });

  it('looks up the current source request at call time and preserves async rejection from synchronous throws', async () => {
    const f = await sourceFixture();
    f.request.mockResolvedValueOnce({
      tasks: [],
      stats: { total: 0, completed: 0, inProgress: 0 },
    });
    await f.client.list('ws-before');
    const failure = new Error('replacement transport unavailable');
    const replacement = vi.fn<Request>(() => {
      throw failure;
    });
    f.replaceRequest(
      <T>(...args: Parameters<BackendTransport['request']>): Promise<T> =>
        replacement(...args) as Promise<T>,
    );
    const list = f.client.list('ws-after');
    const links = f.client.listAgentLinks('ws-after');
    await expect(list).rejects.toBe(failure);
    await expect(links).rejects.toBe(failure);
    expect(f.request.mock.calls).toEqual([['task.list', { workspaceId: 'ws-before' }]]);
    expect(replacement.mock.calls).toEqual([
      ['task.list', { workspaceId: 'ws-after' }],
      ['task.listAgentLinks', { workspaceId: 'ws-after' }],
    ]);
  });

  it('preserves narrower get and conflict mapping through actual source reads and mutations', async () => {
    const f = await sourceFixture();
    const direct = {
      id: 'task-a',
      title: 'Task',
      status: 'complete',
      rev: 9,
      updated_at: 'legacy',
      dependsOn: ['dep'],
      specLinked: true,
    };
    f.request
      .mockResolvedValueOnce({ tasks: [direct], stats: { total: 8, completed: 5, inProgress: 1 } })
      .mockResolvedValueOnce({ note: direct })
      .mockResolvedValueOnce({
        note: {
          id: 'task-a',
          title: 'Task',
          rev: 9,
          updated_at: 'legacy',
          metadata: { task: { status: 'complete', dependsOn: ['dep'], specLinked: true } },
        },
      });
    const listed = await f.client.list('ws-a');
    expect(listed.tasks).toEqual([
      {
        id: 'task-a',
        title: 'Task',
        status: 'complete',
        rev: 9,
        updatedAt: 'legacy',
        dependsOn: ['dep'],
        specLinked: true,
      },
    ]);
    // get accepts a task note, not the direct top-level task projection.
    await expect(f.client.get('task-a')).resolves.toBeNull();
    await expect(f.client.get('task-a')).resolves.toEqual({
      id: 'task-a',
      title: 'Task',
      status: 'complete',
      rev: 9,
      updatedAt: 'legacy',
      dependsOn: ['dep'],
      specLinked: true,
    });
    const failure = Object.assign(new Error('revision conflict'), {
      rpcCode: -32005,
      data: { code: 'conflict', current: direct },
    });
    f.request.mockRejectedValueOnce(failure);
    await expect(f.client.updateNoteStatus('task-a', 'in_progress', 3)).resolves.toEqual({
      success: false,
      error: failure.message,
      conflict: { current: { id: 'task-a', title: 'Task', status: 'complete', rev: 9 } },
    });
    expect(f.request.mock.calls).toEqual([
      ['task.list', { workspaceId: 'ws-a' }],
      ['note.get', { workspaceId: 'ws-a', noteId: 'task-a' }],
      ['note.get', { workspaceId: 'ws-a', noteId: 'task-a' }],
      [
        'task.updateNoteStatus',
        { workspaceId: 'ws-a', noteId: 'task-a', status: 'in_progress', expectedVersion: 3 },
      ],
    ]);
  });

  it('keeps the actual link mutation on the same normalizer and retains its input fallback', async () => {
    const f = await sourceFixture();
    const association = {
      noteId: 'input-note',
      taskText: 'Input',
      agentId: 'agent-a',
      createdAt: 10,
    };
    f.request
      .mockResolvedValueOnce({
        link: {
          workspaceId: 'ws-a',
          noteId: 'server-note',
          taskKey: 'server-key',
          taskText: 'Server text',
          agentId: 'agent-b',
          createdAt: 25,
        },
      })
      .mockResolvedValueOnce({ link: { invalid: true } });
    await expect(f.client.linkAgent('ws-a', 'note-a', association)).resolves.toEqual({
      noteId: 'server-note',
      taskKey: 'server-key',
      taskText: 'Server text',
      agentId: 'agent-b',
      createdAt: 25,
    });
    await expect(f.client.linkAgent('ws-a', 'note-a', association)).resolves.toEqual({
      noteId: 'note-a',
      taskText: 'Input',
      agentId: 'agent-a',
      createdAt: 10,
    });
    expect(f.request.mock.calls).toEqual([
      [
        'task.linkAgent',
        { workspaceId: 'ws-a', noteId: 'note-a', taskText: 'Input', agentId: 'agent-a' },
      ],
      [
        'task.linkAgent',
        { workspaceId: 'ws-a', noteId: 'note-a', taskText: 'Input', agentId: 'agent-a' },
      ],
    ]);
  });
});
