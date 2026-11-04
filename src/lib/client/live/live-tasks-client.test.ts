import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// FAKE transport only: the backend bridge is mocked so no task mutation ever
// reaches the user's real daemon. `resolveNoteWorkspaceId` is stubbed so
// note-scoped task mutations resolve deterministically without extra list calls;
// `runMutation` / `newIdempotencyKey` stay real so the asserted method + params
// and the success/error folding are the genuine code paths. Notification /
// reconnect handlers are captured as LISTS — `subscribe` registers two
// listeners (the delta subscription's and the workspace-id source's) — so the
// typed §6.9 channel tests can drive pushes to both.
let notifyHandlers: Array<(n: { method: string; params?: unknown }) => void> = [];
let reconnectHandlers: Array<() => void> = [];

vi.mock('./backend-transport', () => ({
  backendRequest: vi.fn(),
  onBackendNotification: vi.fn((handler: (n: { method: string; params?: unknown }) => void) => {
    notifyHandlers.push(handler);
    return () => {
      notifyHandlers = notifyHandlers.filter((h) => h !== handler);
    };
  }),
  onBackendReconnected: vi.fn((handler: () => void) => {
    reconnectHandlers.push(handler);
    return () => {
      reconnectHandlers = reconnectHandlers.filter((h) => h !== handler);
    };
  }),
}));

vi.mock('./live-support', async (importActual) => {
  const actual = await importActual<typeof import('./live-support')>();
  return {
    ...actual,
    resolveNoteWorkspaceId: vi.fn(() => Promise.resolve('ws-1')),
    rememberNoteWorkspace: vi.fn(actual.rememberNoteWorkspace),
  };
});

import { backendRequest } from './backend-transport';
import { resolveNoteWorkspaceId, rememberNoteWorkspace } from './live-support';
import { LiveTasksClient } from './live-tasks-client';

const mockedRequest = vi.mocked(backendRequest);
const mockedResolve = vi.mocked(resolveNoteWorkspaceId);

describe('LiveTasksClient mutations (fake transport)', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockedResolve.mockResolvedValue('ws-1');
  });

  it('updateStatus resolves the workspace and forwards task.updateStatus', async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true });
    const client = new LiveTasksClient();

    expect(await client.updateStatus('note-1', 'Do the thing', 'done')).toEqual({ success: true });
    expect(mockedRequest).toHaveBeenCalledWith('task.updateStatus', {
      workspaceId: 'ws-1',
      noteId: 'note-1',
      taskText: 'Do the thing',
      status: 'done',
    });
  });

  it('update forwards task.update with line and only the provided patch fields', async () => {
    mockedRequest.mockResolvedValue({ ok: true });
    const client = new LiveTasksClient();

    await client.update('note-1', 3, { status: 'in-progress' });
    expect(mockedRequest).toHaveBeenLastCalledWith('task.update', {
      workspaceId: 'ws-1',
      noteId: 'note-1',
      line: 3,
      status: 'in-progress',
    });

    await client.update('note-1', 4, { text: 'new text', expected: 'old text' });
    expect(mockedRequest).toHaveBeenLastCalledWith('task.update', {
      workspaceId: 'ws-1',
      noteId: 'note-1',
      line: 4,
      text: 'new text',
      expected: 'old text',
    });
  });

  it('updateNoteStatus forwards task.updateNoteStatus with the TaskStatus enum', async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true });
    const client = new LiveTasksClient();

    expect(await client.updateNoteStatus('note-1', 'in_progress')).toEqual({ success: true });
    expect(mockedRequest).toHaveBeenCalledWith('task.updateNoteStatus', {
      workspaceId: 'ws-1',
      noteId: 'note-1',
      status: 'in_progress',
    });
  });

  it('markAsTask forwards task.markAsTask with acceptanceCriteria/effort only when provided', async () => {
    mockedRequest.mockResolvedValue({ ok: true });
    const client = new LiveTasksClient();

    await client.markAsTask('note-1', 'not_started', {
      acceptanceCriteria: ['a', 'b'],
      effort: 'M',
    });
    expect(mockedRequest).toHaveBeenLastCalledWith('task.markAsTask', {
      workspaceId: 'ws-1',
      noteId: 'note-1',
      status: 'not_started',
      acceptanceCriteria: ['a', 'b'],
      effort: 'M',
    });

    await client.markAsTask('note-1', 'not_started');
    expect(mockedRequest).toHaveBeenLastCalledWith('task.markAsTask', {
      workspaceId: 'ws-1',
      noteId: 'note-1',
      status: 'not_started',
    });
  });

  it('markAsTask forwards dependsOn/conflictsWith relation seeds when provided (task relations)', async () => {
    mockedRequest.mockResolvedValue({ ok: true });
    const client = new LiveTasksClient();

    await client.markAsTask('note-1', 'not_started', {
      dependsOn: ['dep-a'],
      conflictsWith: ['con-b'],
    });
    expect(mockedRequest).toHaveBeenLastCalledWith('task.markAsTask', {
      workspaceId: 'ws-1',
      noteId: 'note-1',
      status: 'not_started',
      dependsOn: ['dep-a'],
      conflictsWith: ['con-b'],
    });
  });

  it('setRelations forwards task.setRelations with only the provided lists (replace semantics)', async () => {
    mockedRequest.mockResolvedValue({ ok: true });
    const client = new LiveTasksClient();

    expect(await client.setRelations('note-1', { dependsOn: ['dep-a', 'dep-b'] })).toEqual({
      success: true,
    });
    expect(mockedRequest).toHaveBeenLastCalledWith('task.setRelations', {
      workspaceId: 'ws-1',
      noteId: 'note-1',
      dependsOn: ['dep-a', 'dep-b'],
    });

    await client.setRelations('note-1', { conflictsWith: [] });
    expect(mockedRequest).toHaveBeenLastCalledWith('task.setRelations', {
      workspaceId: 'ws-1',
      noteId: 'note-1',
      conflictsWith: [],
    });
  });

  it('setRelations maps a daemon validation error (e.g. cycle) to a failed MutationResult', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('dependsOn would create a cycle: a -> b -> a'));
    const client = new LiveTasksClient();

    expect(await client.setRelations('note-1', { dependsOn: ['dep-a'] })).toEqual({
      success: false,
      error: 'dependsOn would create a cycle: a -> b -> a',
    });
  });

  it('assignAgent forwards task.assignAgent with the agentId', async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true });
    const client = new LiveTasksClient();

    await client.assignAgent('note-1', 'agent-123');
    expect(mockedRequest).toHaveBeenCalledWith('task.assignAgent', {
      workspaceId: 'ws-1',
      noteId: 'note-1',
      agentId: 'agent-123',
    });
  });

  it('createPrerequisite forwards task.createPrerequisite with an idempotencyKey', async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true });
    const client = new LiveTasksClient();

    const result = await client.createPrerequisite('dep-1', 'Prereq title', {
      content: 'body',
      status: 'not_started',
    });

    expect(result).toEqual({ success: true });
    expect(mockedRequest).toHaveBeenCalledWith(
      'task.createPrerequisite',
      expect.objectContaining({
        workspaceId: 'ws-1',
        dependentNoteId: 'dep-1',
        title: 'Prereq title',
        content: 'body',
        status: 'not_started',
        idempotencyKey: expect.any(String),
      }),
    );
  });

  it('createPrerequisite generates a distinct idempotencyKey per call', async () => {
    mockedRequest.mockResolvedValue({ ok: true });
    const client = new LiveTasksClient();

    await client.createPrerequisite('dep-1', 'A');
    await client.createPrerequisite('dep-1', 'B');

    const first = (mockedRequest.mock.calls[0][1] as { idempotencyKey: string }).idempotencyKey;
    const second = (mockedRequest.mock.calls[1][1] as { idempotencyKey: string }).idempotencyKey;
    expect(first).not.toEqual(second);
  });

  it('createPrerequisite surfaces the WorkspaceTask id from the daemon response', async () => {
    mockedRequest.mockResolvedValueOnce({ id: 'task-77', title: 'Prereq', status: 'not_started' });
    const client = new LiveTasksClient();

    expect(await client.createPrerequisite('dep-1', 'Prereq')).toEqual({
      success: true,
      id: 'task-77',
    });
  });

  it('note-scoped mutations surface the returned WorkspaceTask id', async () => {
    mockedRequest.mockResolvedValueOnce({ id: 'note-1', title: 'T', status: 'not_started' });
    const client = new LiveTasksClient();

    expect(await client.markAsTask('note-1', 'not_started')).toEqual({
      success: true,
      id: 'note-1',
    });
  });

  it('fails a task mutation when the workspace cannot be resolved', async () => {
    mockedResolve.mockResolvedValueOnce(null);
    const client = new LiveTasksClient();

    const result = await client.updateNoteStatus('ghost', 'complete');
    expect(result.success).toBe(false);
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('maps a daemon error to a failed MutationResult without throwing', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('boom'));
    const client = new LiveTasksClient();

    expect(await client.updateNoteStatus('note-1', 'complete')).toEqual({
      success: false,
      error: 'boom',
    });
  });

  // ---- PROTOCOL §5.4: task.list wire contract ------------------------------

  it('list issues a `task.list` request with the workspaceId param (no client task derivation)', async () => {
    mockedRequest.mockResolvedValueOnce({
      tasks: [],
      stats: { total: 0, completed: 0, inProgress: 0 },
    });
    const client = new LiveTasksClient();

    await client.list('ws-1');

    expect(mockedRequest).toHaveBeenCalledWith('task.list', { workspaceId: 'ws-1' });
  });

  it('list returns the BE-provided `stats` aggregate verbatim from the wire', async () => {
    mockedRequest.mockResolvedValueOnce({
      tasks: [{ id: 't1', title: 'T1', status: 'complete' }],
      // PROTOCOL §5.4 shape — `total` excludes cancelled, `complete` counts as
      // completed, `in_progress` + `review_required` count as inProgress.
      stats: { total: 4, completed: 1, inProgress: 2 },
    });
    const client = new LiveTasksClient();

    const { tasks, stats } = await client.list('ws-1');

    expect(tasks).toEqual([{ id: 't1', title: 'T1', status: 'complete' }]);
    expect(stats).toEqual({ total: 4, completed: 1, inProgress: 2 });
  });

  it('list defaults to the zero aggregate when the daemon omits `stats`', async () => {
    mockedRequest.mockResolvedValueOnce({ tasks: [] });
    const client = new LiveTasksClient();

    const { stats } = await client.list('ws-1');
    expect(stats).toEqual({ total: 0, completed: 0, inProgress: 0 });
  });

  // ---- §11.4-D: rev normalization (inert; read-only carry-through) ----------

  it('list carries a numeric rev from the daemon task entity onto the WorkspaceTask', async () => {
    mockedRequest.mockResolvedValueOnce({
      tasks: [{ id: 'note-1', title: 'T', status: 'not_started', rev: 3 }],
      stats: { total: 0, completed: 0, inProgress: 0 },
    });
    const client = new LiveTasksClient();

    const { tasks } = await client.list('ws-1');
    expect(tasks[0].rev).toBe(3);
  });

  it('list leaves rev undefined when the daemon omits it', async () => {
    mockedRequest.mockResolvedValueOnce({
      tasks: [{ id: 'note-1', title: 'T', status: 'not_started' }],
      stats: { total: 0, completed: 0, inProgress: 0 },
    });
    const client = new LiveTasksClient();

    const { tasks } = await client.list('ws-1');
    expect(tasks[0].rev).toBeUndefined();
  });

  // ---- task relation fields (dependsOn / conflictsWith / unmetDependsOn) ----

  it('list carries dependsOn/conflictsWith/unmetDependsOn from the wire row (task relations)', async () => {
    mockedRequest.mockResolvedValueOnce({
      tasks: [
        {
          id: 'note-1',
          title: 'T',
          status: 'not_started',
          dependsOn: ['dep-a', 'dep-b'],
          conflictsWith: ['con-c'],
          unmetDependsOn: ['dep-a'],
        },
      ],
      stats: { total: 0, completed: 0, inProgress: 0 },
    });
    const client = new LiveTasksClient();

    const { tasks } = await client.list('ws-1');
    expect(tasks[0].dependsOn).toEqual(['dep-a', 'dep-b']);
    expect(tasks[0].conflictsWith).toEqual(['con-c']);
    expect(tasks[0].unmetDependsOn).toEqual(['dep-a']);
  });

  it('list omits relation fields when the daemon omits them (presence-detected)', async () => {
    mockedRequest.mockResolvedValueOnce({
      tasks: [{ id: 'note-1', title: 'T', status: 'not_started' }],
      stats: { total: 0, completed: 0, inProgress: 0 },
    });
    const client = new LiveTasksClient();

    const { tasks } = await client.list('ws-1');
    expect(tasks[0].dependsOn).toBeUndefined();
    expect(tasks[0].conflictsWith).toBeUndefined();
    expect(tasks[0].unmetDependsOn).toBeUndefined();
  });

  it('list discards a malformed relation list (non-string member) with a warn', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockedRequest.mockResolvedValueOnce({
      tasks: [
        {
          id: 'note-1',
          title: 'T',
          status: 'not_started',
          dependsOn: ['dep-a', 42],
        },
      ],
      stats: { total: 0, completed: 0, inProgress: 0 },
    });
    const client = new LiveTasksClient();

    const { tasks } = await client.list('ws-1');
    expect(tasks[0].dependsOn).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('discarding malformed dependsOn'),
      expect.anything(),
    );
    warnSpy.mockRestore();
  });

  // ---- specLinked (additive §5.4; presence-detected like the relations) -----

  it('list carries the boolean specLinked from the wire row', async () => {
    mockedRequest.mockResolvedValueOnce({
      tasks: [
        { id: 't1', title: 'Linked', status: 'not_started', specLinked: true },
        { id: 't2', title: 'Unlinked', status: 'not_started', specLinked: false },
      ],
      stats: { total: 0, completed: 0, inProgress: 0 },
    });
    const client = new LiveTasksClient();

    const { tasks } = await client.list('ws-1');
    expect(tasks[0].specLinked).toBe(true);
    expect(tasks[1].specLinked).toBe(false);
  });

  it('list leaves specLinked undefined when the daemon omits it (older daemon)', async () => {
    mockedRequest.mockResolvedValueOnce({
      tasks: [{ id: 't1', title: 'T', status: 'not_started' }],
      stats: { total: 0, completed: 0, inProgress: 0 },
    });
    const client = new LiveTasksClient();

    const { tasks } = await client.list('ws-1');
    expect(tasks[0].specLinked).toBeUndefined();
    expect('specLinked' in tasks[0]).toBe(false);
  });

  it('list discards a non-boolean specLinked instead of coercing it', async () => {
    mockedRequest.mockResolvedValueOnce({
      tasks: [{ id: 't1', title: 'T', status: 'not_started', specLinked: 'yes' }],
      stats: { total: 0, completed: 0, inProgress: 0 },
    });
    const client = new LiveTasksClient();

    const { tasks } = await client.list('ws-1');
    expect(tasks[0].specLinked).toBeUndefined();
  });

  it('note-shaped entities carry relations (incl. unmetDependsOn) from metadata.task', async () => {
    mockedRequest.mockResolvedValueOnce({
      tasks: [
        {
          id: 'note-1',
          title: 'T',
          metadata: {
            task: {
              status: 'not_started',
              dependsOn: ['dep-a'],
              conflictsWith: ['con-b'],
              unmetDependsOn: ['dep-a'],
            },
          },
        },
      ],
      stats: { total: 0, completed: 0, inProgress: 0 },
    });
    const client = new LiveTasksClient();

    const { tasks } = await client.list('ws-1');
    expect(tasks[0].dependsOn).toEqual(['dep-a']);
    expect(tasks[0].conflictsWith).toEqual(['con-b']);
    expect(tasks[0].unmetDependsOn).toEqual(['dep-a']);
  });

  // ---- §11.4-D: expectedVersion forwarding (only when defined) --------------

  it('updateStatus forwards expectedVersion when provided', async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true });
    const client = new LiveTasksClient();

    await client.updateStatus('note-1', 'Do the thing', 'done', 6);
    expect(mockedRequest).toHaveBeenCalledWith('task.updateStatus', {
      workspaceId: 'ws-1',
      noteId: 'note-1',
      taskText: 'Do the thing',
      status: 'done',
      expectedVersion: 6,
    });
  });

  it('updateNoteStatus forwards expectedVersion when provided', async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true });
    const client = new LiveTasksClient();

    await client.updateNoteStatus('note-1', 'in_progress', 2);
    expect(mockedRequest).toHaveBeenCalledWith('task.updateNoteStatus', {
      workspaceId: 'ws-1',
      noteId: 'note-1',
      status: 'in_progress',
      expectedVersion: 2,
    });
  });

  it('updateNoteStatus omits expectedVersion when undefined (unchanged behavior)', async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true });
    const client = new LiveTasksClient();

    await client.updateNoteStatus('note-1', 'in_progress');
    const params = mockedRequest.mock.calls[0][1] as Record<string, unknown>;
    expect('expectedVersion' in params).toBe(false);
  });

  // ---- §11.4-D: optimistic-concurrency conflict mapping --------------------

  function rejectWith(extra: Record<string, unknown>, message = 'conflict'): void {
    mockedRequest.mockRejectedValueOnce(Object.assign(new Error(message), extra));
  }

  it('maps a -32005 conflict to a structured outcome with the current task (note shape)', async () => {
    rejectWith({
      rpcCode: -32005,
      data: {
        code: 'conflict',
        current: { id: 'note-1', title: 'T', metadata: { task: { status: 'complete' } }, rev: 9 },
      },
    });
    const client = new LiveTasksClient();

    const result = await client.updateNoteStatus('note-1', 'in_progress', 3);
    expect(result.success).toBe(false);
    expect(result.error).toBe('conflict');
    expect(result.conflict?.current).toMatchObject({ id: 'note-1', status: 'complete', rev: 9 });
  });

  it('maps a -32005 conflict whose current is already a WorkspaceTask shape', async () => {
    rejectWith({
      rpcCode: -32005,
      data: { code: 'conflict', current: { id: 'note-1', title: 'T', status: 'complete', rev: 4 } },
    });
    const client = new LiveTasksClient();

    const result = await client.updateNoteStatus('note-1', 'in_progress', 1);
    expect(result.conflict?.current).toMatchObject({ id: 'note-1', status: 'complete', rev: 4 });
  });

  it('does NOT set conflict for a generic (non -32005) daemon error', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('boom'));
    const client = new LiveTasksClient();

    expect(await client.updateNoteStatus('note-1', 'complete')).toEqual({
      success: false,
      error: 'boom',
    });
  });
});

describe('LiveTasksClient task↔agent linkage (PROTOCOL §5.4, fake transport)', () => {
  afterEach(() => vi.clearAllMocks());

  it('listAgentLinks forwards workspaceId and normalizes linksByNoteId rows', async () => {
    const raw = {
      'note-1': {
        'agent:a1': {
          workspaceId: 'ws-1',
          noteId: 'note-1',
          taskKey: 'agent:a1',
          taskText: 'task text',
          agentId: 'a1',
          createdAt: 1700000000000,
        },
      },
    };
    mockedRequest.mockResolvedValueOnce({ linksByNoteId: raw });
    const client = new LiveTasksClient();

    // `workspaceId` is stripped from each renderer row (slice is already
    // workspace-scoped) but every required field round-trips.
    expect(await client.listAgentLinks('ws-1')).toEqual({
      'note-1': {
        'agent:a1': {
          noteId: 'note-1',
          taskKey: 'agent:a1',
          taskText: 'task text',
          agentId: 'a1',
          createdAt: 1700000000000,
        },
      },
    });
    expect(mockedRequest).toHaveBeenCalledWith('task.listAgentLinks', {
      workspaceId: 'ws-1',
    });
  });

  it('listAgentLinks returns an empty map when the wire result is missing', async () => {
    mockedRequest.mockResolvedValueOnce({});
    const client = new LiveTasksClient();
    expect(await client.listAgentLinks('ws-1')).toEqual({});
  });

  it('linkAgent forwards the association and normalizes the daemon-echoed link', async () => {
    const link = {
      workspaceId: 'ws-1',
      noteId: 'note-1',
      taskKey: 'agent:a1',
      taskText: 'task text',
      agentId: 'a1',
      createdAt: 1700000000000,
    };
    mockedRequest.mockResolvedValueOnce({ link });
    const client = new LiveTasksClient();

    const result = await client.linkAgent('ws-1', 'note-1', {
      noteId: 'note-1',
      taskText: 'task text',
      agentId: 'a1',
      createdAt: 1700000000000,
      taskKey: 'agent:a1',
    });
    expect(result).toEqual({
      noteId: 'note-1',
      taskKey: 'agent:a1',
      taskText: 'task text',
      agentId: 'a1',
      createdAt: 1700000000000,
    });
    expect(mockedRequest).toHaveBeenCalledWith('task.linkAgent', {
      workspaceId: 'ws-1',
      noteId: 'note-1',
      taskText: 'task text',
      agentId: 'a1',
      taskKey: 'agent:a1',
    });
  });

  it('linkAgent omits taskKey from the wire payload when the association has none', async () => {
    mockedRequest.mockResolvedValueOnce({ link: null });
    const client = new LiveTasksClient();

    await client.linkAgent('ws-1', 'note-1', {
      noteId: 'note-1',
      taskText: 'task text',
      agentId: 'a1',
      createdAt: 1700000000000,
    });
    expect(mockedRequest).toHaveBeenCalledWith('task.linkAgent', {
      workspaceId: 'ws-1',
      noteId: 'note-1',
      taskText: 'task text',
      agentId: 'a1',
    });
  });

  it("unlinkAgent returns the daemon's `removed` boolean", async () => {
    mockedRequest.mockResolvedValueOnce({ removed: true });
    const client = new LiveTasksClient();
    expect(await client.unlinkAgent('ws-1', 'note-1', 'agent:a1')).toBe(true);
    expect(mockedRequest).toHaveBeenCalledWith('task.unlinkAgent', {
      workspaceId: 'ws-1',
      noteId: 'note-1',
      taskKey: 'agent:a1',
    });
  });

  it('unlinkAgent returns false when the daemon reports no removal', async () => {
    mockedRequest.mockResolvedValueOnce({ removed: false });
    const client = new LiveTasksClient();
    expect(await client.unlinkAgent('ws-1', 'note-1', 'agent:a1')).toBe(false);
  });
});

// ---- Typed per-workspace task channel (PROTOCOL §6.9, monorepo#1697) -------
// `subscribe` registers ONE `task.subscribe` per workspace id
// (`{ workspaceId }`), sourced from the same `workspace.list` enumeration —
// the sole data path; there is no legacy `task:*`/`note:*` events-driven
// refetch. The channel carries task-filtered note entities; the BE emits
// `removedIds` when a note is deleted OR demoted (task metadata removed).
// Snapshots/deltas reconcile per channel and merge; workspace add/delete
// re-reconciles the channel set, each channel emitting independently.
describe('LiveTasksClient.subscribe typed per-workspace task channel (PROTOCOL §6.9)', () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const requestsFor = (method: string) =>
    mockedRequest.mock.calls.filter((c) => c[0] === method).map((c) => c[1]);

  // §6.9-shaped wire entity as carried by the task channel: a full Note
  // (camelCase serde, `workspaceId` always present) filtered to those with
  // `metadata.task` — the shape `channel_snapshot`/`task_delta` serialize.
  const wireTaskNote = (
    id: string,
    workspaceId: string,
    title: string,
    status = 'not_started',
  ) => ({
    id,
    workspaceId,
    title,
    content: `${title} body`,
    contentType: 'markdown',
    tags: [],
    isPinned: false,
    isArchived: false,
    isDefault: false,
    parentId: null,
    visibility: 'workspace',
    metadata: { task: { status } },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    rev: 1,
  });

  const wireListedTask = (
    id: string,
    workspaceId: string,
    title: string,
    status = 'not_started',
  ) => ({
    id,
    workspaceId,
    title,
    status,
    updatedAt: '2026-01-01T00:00:00Z',
    specLinked: false,
  });

  const notify = (n: { method: string; params?: unknown }) => {
    for (const handler of [...notifyHandlers]) handler(n);
  };
  const pushSnapshot = (
    subscriptionId: string,
    seq: number,
    snapshot: unknown[],
    nextToken?: string,
  ) =>
    notify({
      method: 'subscription.push',
      params: {
        subscriptionId,
        kind: 'snapshot',
        seq,
        snapshot,
        ...(nextToken ? { nextToken } : {}),
      },
    });
  const pushDelta = (subscriptionId: string, seq: number, delta: Record<string, unknown>) =>
    notify({ method: 'subscription.push', params: { subscriptionId, kind: 'delta', seq, delta } });
  const fireWorkspaceSetEvent = (type: string) =>
    notify({ method: 'events.event', params: { event: { type } } });

  // Mutable daemon fixture the mock serves: the workspace set driving the
  // dynamic channel-per-id scope.
  let workspaceIds: string[] = [];
  let chanSeq = 0;
  const taskPages = new Map<string, unknown>();
  const pageKey = (workspaceId: string, token: string) => JSON.stringify([workspaceId, token]);
  const servePage = (workspaceId: string, token: string, reply: unknown) =>
    taskPages.set(pageKey(workspaceId, token), reply);
  const holdPage = (workspaceId: string, token: string) => {
    let release: ((reply: unknown) => void) | undefined;
    servePage(
      workspaceId,
      token,
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    return (reply: unknown) => {
      if (!release) throw new Error('Page was not held');
      release(reply);
    };
  };
  const latestTasks = (handler: ReturnType<typeof vi.fn>) =>
    handler.mock.calls.at(-1)?.[0] as Array<{
      id: string;
      title: string;
      status: string;
      rev?: number;
    }>;

  beforeEach(() => {
    chanSeq = 0;
    workspaceIds = ['ws-1', 'ws-2'];
    taskPages.clear();
    mockedRequest.mockImplementation((method: string, params?: unknown) => {
      if (method === 'workspace.list') {
        return Promise.resolve({ workspaces: workspaceIds.map((id) => ({ id })) });
      }
      if (method === 'task.subscribe') {
        chanSeq += 1;
        return Promise.resolve({ subscriptionId: `chan-${chanSeq}` });
      }
      if (method === 'task.unsubscribe') return Promise.resolve({ success: true });
      if (method === 'task.list') {
        const { workspaceId, nextToken } = params as { workspaceId: string; nextToken: string };
        const key = pageKey(workspaceId, nextToken);
        if (!taskPages.has(key)) return Promise.reject(new Error(`Unexpected task page: ${key}`));
        return Promise.resolve(taskPages.get(key));
      }
      return Promise.resolve({ success: true });
    });
  });

  afterEach(() => {
    notifyHandlers = [];
    reconnectHandlers = [];
    mockedRequest.mockReset();
    vi.clearAllMocks();
    mockedResolve.mockResolvedValue('ws-1');
  });

  it('registers one task.subscribe per workspace with { workspaceId } params', async () => {
    const client = new LiveTasksClient();
    const unsubscribe = client.subscribe(() => {});

    await vi.waitFor(() => {
      expect(requestsFor('task.subscribe')).toEqual([
        { workspaceId: 'ws-1' },
        { workspaceId: 'ws-2' },
      ]);
    });
    unsubscribe();
  });

  it('each channel emits independently, merging into the cross-workspace collection', async () => {
    const handler = vi.fn();
    const client = new LiveTasksClient();
    const unsubscribe = client.subscribe(handler);
    await vi.waitFor(() => expect(requestsFor('task.subscribe')).toHaveLength(2));
    await flush();

    // chan-1 (ws-1) confirms: emits immediately with just its tasks.
    pushSnapshot('chan-1', 0, [wireTaskNote('a', 'ws-1', 'A')]);
    const afterFirst = handler.mock.calls.at(-1)?.[0] as Array<{ id: string }>;
    expect(afterFirst.map((t) => t.id)).toEqual(['a']);

    // chan-2 (ws-2) confirms: merged cross-workspace collection.
    pushSnapshot('chan-2', 0, [wireTaskNote('b', 'ws-2', 'B')]);
    const merged = handler.mock.calls.at(-1)?.[0] as Array<Record<string, unknown>>;
    expect(merged.map((t) => t.id).sort()).toEqual(['a', 'b']);
    expect(merged.find((t) => t.id === 'a')).toMatchObject({ status: 'not_started', rev: 1 });

    // A task:status-changed-driven `updated` delta reconciles the projection.
    pushDelta('chan-2', 1, { updated: [wireTaskNote('b', 'ws-2', 'B', 'in_progress')] });
    const afterDelta = handler.mock.calls.at(-1)?.[0] as Array<Record<string, unknown>>;
    expect(afterDelta.find((t) => t.id === 'b')).toMatchObject({ status: 'in_progress' });
    unsubscribe();
  });

  // Task demotion: a note stops being a task (task metadata removed on
  // note:updated) — the BE re-read finds no `metadata.task` and emits
  // `removedIds` instead of `updated` (`task_delta`); the reconciler drops it.
  it('drops a demoted task when the delta carries its id in removedIds', async () => {
    const handler = vi.fn();
    const client = new LiveTasksClient();
    const unsubscribe = client.subscribe(handler);
    await vi.waitFor(() => expect(requestsFor('task.subscribe')).toHaveLength(2));
    await flush();
    pushSnapshot('chan-1', 0, [wireTaskNote('a', 'ws-1', 'A'), wireTaskNote('b', 'ws-1', 'B')]);
    pushSnapshot('chan-2', 0, []);

    pushDelta('chan-1', 1, { removedIds: ['a'] });
    const afterDemotion = handler.mock.calls.at(-1)?.[0] as Array<{ id: string }>;
    expect(afterDemotion.map((t) => t.id)).toEqual(['b']);
    unsubscribe();
  });

  // §6.9 paged snapshots: a snapshot with `nextToken` is completed through
  // the paged `task.list` (`WorkspaceTask` rows plus `workspaceId`); a delta
  // that lands before the page wins over the page's older row.
  it('fills a paged snapshot from task.list pages, deltas taking precedence', async () => {
    let releaseFirstPage: () => void = () => {};
    const firstPageGate = new Promise<void>((resolve) => {
      releaseFirstPage = resolve;
    });
    mockedRequest.mockImplementation((method: string, params?: unknown) => {
      if (method === 'workspace.list') {
        return Promise.resolve({ workspaces: [{ id: 'ws-1' }] });
      }
      if (method === 'task.subscribe') return Promise.resolve({ subscriptionId: 'chan-1' });
      if (method === 'task.list') {
        const token = (params as { nextToken?: string }).nextToken;
        if (token === 'p2') {
          return firstPageGate.then(() => ({
            tasks: [
              { id: 'b', workspaceId: 'ws-1', title: 'B', status: 'not_started', specLinked: true },
              {
                id: 'c',
                workspaceId: 'ws-1',
                title: 'C',
                status: 'not_started',
                specLinked: false,
              },
            ],
            stats: { total: 3, completed: 0, inProgress: 0 },
            nextToken: 'p3',
          }));
        }
        return Promise.resolve({
          tasks: [
            { id: 'd', workspaceId: 'ws-1', title: 'D', status: 'waiting', specLinked: false },
          ],
          stats: { total: 3, completed: 0, inProgress: 0 },
          nextToken: null,
        });
      }
      return Promise.resolve({ success: true });
    });
    const handler = vi.fn();
    const client = new LiveTasksClient();
    const unsubscribe = client.subscribe(handler);
    await vi.waitFor(() => expect(requestsFor('task.subscribe')).toHaveLength(1));
    await flush();

    notify({
      method: 'subscription.push',
      params: {
        subscriptionId: 'chan-1',
        kind: 'snapshot',
        seq: 0,
        snapshot: [wireTaskNote('a', 'ws-1', 'A')],
        nextToken: 'p2',
      },
    });
    await vi.waitFor(() =>
      expect(requestsFor('task.list')).toEqual([{ workspaceId: 'ws-1', nextToken: 'p2' }]),
    );
    pushDelta('chan-1', 1, { updated: [wireTaskNote('c', 'ws-1', 'C', 'in_progress')] });
    releaseFirstPage();

    await vi.waitFor(() => {
      const tasks = handler.mock.calls.at(-1)?.[0] as Array<Record<string, unknown>>;
      expect(tasks.map((t) => t.id).sort()).toEqual(['a', 'b', 'c', 'd']);
    });
    expect(requestsFor('task.list')).toEqual([
      { workspaceId: 'ws-1', nextToken: 'p2' },
      { workspaceId: 'ws-1', nextToken: 'p3' },
    ]);
    const tasks = handler.mock.calls.at(-1)?.[0] as Array<Record<string, unknown>>;
    expect(tasks.find((t) => t.id === 'b')).toMatchObject({
      status: 'not_started',
      specLinked: true,
    });
    expect(tasks.find((t) => t.id === 'c')).toMatchObject({ status: 'in_progress' });
    expect(tasks.find((t) => t.id === 'd')).toMatchObject({ status: 'waiting' });
    unsubscribe();
  });

  it('a created workspace registers a new channel and merges its snapshot', async () => {
    workspaceIds = ['ws-1'];
    const handler = vi.fn();
    const client = new LiveTasksClient();
    const unsubscribe = client.subscribe(handler);
    await vi.waitFor(() =>
      expect(requestsFor('task.subscribe')).toEqual([{ workspaceId: 'ws-1' }]),
    );
    await flush();
    pushSnapshot('chan-1', 0, [wireTaskNote('a', 'ws-1', 'A')]);

    workspaceIds = ['ws-1', 'ws-2'];
    fireWorkspaceSetEvent('workspace:created');
    await vi.waitFor(() => {
      expect(requestsFor('task.subscribe')).toEqual([
        { workspaceId: 'ws-1' },
        { workspaceId: 'ws-2' },
      ]);
    });
    await flush();

    pushSnapshot('chan-2', 0, [wireTaskNote('b', 'ws-2', 'B')]);
    const merged = handler.mock.calls.at(-1)?.[0] as Array<{ id: string }>;
    expect(merged.map((t) => t.id).sort()).toEqual(['a', 'b']);
    unsubscribe();
  });

  it('a deleted workspace unsubscribes its channel and evicts its tasks', async () => {
    const handler = vi.fn();
    const client = new LiveTasksClient();
    const unsubscribe = client.subscribe(handler);
    await vi.waitFor(() => expect(requestsFor('task.subscribe')).toHaveLength(2));
    await flush();
    pushSnapshot('chan-1', 0, [wireTaskNote('a', 'ws-1', 'A')]);
    pushSnapshot('chan-2', 0, [wireTaskNote('b', 'ws-2', 'B')]);

    workspaceIds = ['ws-1'];
    fireWorkspaceSetEvent('workspace:deleted');
    await vi.waitFor(() => {
      expect(requestsFor('task.unsubscribe')).toEqual([
        { subscriptionId: 'chan-2', workspaceId: 'ws-2' },
      ]);
    });
    const evicted = handler.mock.calls.at(-1)?.[0] as Array<{ id: string }>;
    expect(evicted.map((t) => t.id)).toEqual(['a']);
    unsubscribe();
  });

  it('retries a failed channel registration with backoff until it succeeds', async () => {
    vi.useFakeTimers();
    try {
      let ws2Attempts = 0;
      mockedRequest.mockImplementation((method: string, params?: unknown) => {
        if (method === 'workspace.list') {
          return Promise.resolve({ workspaces: workspaceIds.map((id) => ({ id })) });
        }
        if (method === 'task.subscribe') {
          const wsId = (params as { workspaceId?: string })?.workspaceId;
          if (wsId === 'ws-2') {
            ws2Attempts += 1;
            if (ws2Attempts < 2) return Promise.reject(new Error('boom'));
          }
          chanSeq += 1;
          return Promise.resolve({ subscriptionId: `chan-${chanSeq}` });
        }
        if (method === 'task.unsubscribe') return Promise.resolve({ success: true });
        return Promise.resolve({ success: true });
      });
      const client = new LiveTasksClient();
      const unsubscribe = client.subscribe(() => {});
      await vi.advanceTimersByTimeAsync(0);
      expect(requestsFor('task.subscribe')).toEqual([
        { workspaceId: 'ws-1' },
        { workspaceId: 'ws-2' },
      ]);
      expect(ws2Attempts).toBe(1);

      await vi.advanceTimersByTimeAsync(1000);
      expect(ws2Attempts).toBe(2);
      expect(requestsFor('task.subscribe')).toHaveLength(3);
      unsubscribe();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reconnect re-enumerates workspaces and re-registers only the surviving channels', async () => {
    const handler = vi.fn();
    const client = new LiveTasksClient();
    const unsubscribe = client.subscribe(handler);
    await vi.waitFor(() => expect(requestsFor('task.subscribe')).toHaveLength(2));
    await flush();
    pushSnapshot('chan-1', 0, [wireTaskNote('a', 'ws-1', 'A')]);
    pushSnapshot('chan-2', 0, [wireTaskNote('b', 'ws-2', 'B')]);

    // ws-2 disappeared during the outage. The reconnect handler re-registers
    // both surviving channel states synchronously (ws-1 → chan-3, ws-2 →
    // chan-4); the id source's reconnect refresh then re-enumerates and
    // reconciles ws-2 away — its dead channel is unsubscribed.
    workspaceIds = ['ws-1'];
    for (const handler of [...reconnectHandlers]) handler();
    await vi.waitFor(() => {
      expect(requestsFor('task.subscribe').slice(2)).toEqual([
        { workspaceId: 'ws-1' },
        { workspaceId: 'ws-2' },
      ]);
      expect(requestsFor('task.unsubscribe')).toEqual([
        { subscriptionId: 'chan-4', workspaceId: 'ws-2' },
      ]);
    });

    // The surviving ws-1 channel's recovery snapshot re-populates with only
    // ws-1's tasks.
    pushSnapshot('chan-3', 0, [wireTaskNote('a', 'ws-1', 'A')]);
    await flush();
    const recovered = handler.mock.calls.at(-1)?.[0] as Array<{ id: string }>;
    expect(recovered.map((t) => t.id)).toEqual(['a']);
    unsubscribe();
  });

  it('loads all offered task pages in their own workspace and preserves Note and direct-task fields', async () => {
    const handler = vi.fn();
    const unsubscribe = new LiveTasksClient().subscribe(handler);
    await vi.waitFor(() => expect(requestsFor('task.subscribe')).toHaveLength(2));
    servePage('ws-1', 'next', {
      tasks: [
        {
          id: 'list-a',
          workspaceId: 'ws-1',
          title: 'List A',
          status: 'in_progress',
          updatedAt: '2026-01-02T00:00:00Z',
          specLinked: true,
          dependsOn: ['seed'],
          conflictsWith: ['other'],
          unmetDependsOn: ['seed'],
        },
      ],
      nextToken: 'last',
    });
    servePage('ws-1', 'last', {
      tasks: [wireListedTask('list-b', 'ws-1', 'List B', 'complete')],
      nextToken: null,
    });
    servePage('ws-2', 'next', {
      tasks: [wireListedTask('list-c', 'ws-2', 'List C')],
      nextToken: null,
    });
    const note = {
      ...wireTaskNote('seed', 'ws-1', 'Seed'),
      specLinked: false,
      rev: 7,
      metadata: {
        task: {
          status: 'review_required',
          specLinked: true,
          dependsOn: ['dependency'],
          conflictsWith: ['conflict'],
          unmetDependsOn: ['dependency'],
        },
      },
    };
    pushSnapshot('chan-1', 0, [note], 'next');
    pushSnapshot(
      'chan-2',
      0,
      [{ ...wireTaskNote('linked', 'ws-2', 'Linked'), specLinked: true }],
      'next',
    );
    await vi.waitFor(() => expect(latestTasks(handler)).toHaveLength(5));
    expect(requestsFor('task.list')).toEqual(
      expect.arrayContaining([
        { workspaceId: 'ws-1', limit: 200, nextToken: 'next' },
        { workspaceId: 'ws-1', limit: 200, nextToken: 'last' },
        { workspaceId: 'ws-2', limit: 200, nextToken: 'next' },
      ]),
    );
    expect(requestsFor('task.list')).toHaveLength(3);
    expect(latestTasks(handler)).toEqual(
      expect.arrayContaining([
        {
          id: 'seed',
          title: 'Seed',
          status: 'review_required',
          updatedAt: note.updatedAt,
          rev: 7,
          specLinked: false,
          dependsOn: ['dependency'],
          conflictsWith: ['conflict'],
          unmetDependsOn: ['dependency'],
        },
        {
          id: 'list-a',
          title: 'List A',
          status: 'in_progress',
          updatedAt: '2026-01-02T00:00:00Z',
          specLinked: true,
          dependsOn: ['seed'],
          conflictsWith: ['other'],
          unmetDependsOn: ['seed'],
        },
        expect.objectContaining({ id: 'linked', specLinked: true, rev: 1 }),
        expect.objectContaining({ id: 'list-b', specLinked: false }),
        expect.objectContaining({ id: 'list-c', specLinked: false }),
      ]),
    );
    expect(rememberNoteWorkspace).toHaveBeenCalledWith('seed', 'ws-1');
    expect(rememberNoteWorkspace).toHaveBeenCalledWith('linked', 'ws-2');
    expect(rememberNoteWorkspace).toHaveBeenCalledWith('list-a', 'ws-1');
    expect(rememberNoteWorkspace).toHaveBeenCalledWith('list-b', 'ws-1');
    expect(rememberNoteWorkspace).toHaveBeenCalledWith('list-c', 'ws-2');
    // Paged task_list_page JSON stamps workspaceId, but does not carry Note rev.
    expect(latestTasks(handler).find((task) => task.id === 'list-a')).not.toHaveProperty('rev');
    unsubscribe();
  });

  it('keeps legacy complete snapshots unpaged and supports nested specLinked only when the top-level field is absent', async () => {
    workspaceIds = ['ws-1'];
    const handler = vi.fn();
    const unsubscribe = new LiveTasksClient().subscribe(handler);
    await vi.waitFor(() => expect(requestsFor('task.subscribe')).toHaveLength(1));
    pushSnapshot('chan-1', 0, [
      wireTaskNote('absent', 'ws-1', 'Absent'),
      {
        ...wireTaskNote('nested', 'ws-1', 'Nested'),
        metadata: { task: { status: 'not_started', specLinked: true } },
      },
    ]);
    await flush();
    expect(requestsFor('task.list')).toEqual([]);
    expect(latestTasks(handler)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'nested', specLinked: true })]),
    );
    expect(latestTasks(handler).find((task) => task.id === 'absent')).not.toHaveProperty(
      'specLinked',
    );
    unsubscribe();
  });

  it('does not overwrite newer task updates or resurrect removals with a delayed page', async () => {
    workspaceIds = ['ws-1'];
    const release = holdPage('ws-1', 'next');
    const handler = vi.fn();
    const unsubscribe = new LiveTasksClient().subscribe(handler);
    await vi.waitFor(() => expect(requestsFor('task.subscribe')).toHaveLength(1));
    pushSnapshot('chan-1', 0, [wireTaskNote('seed', 'ws-1', 'Seed')], 'next');
    await vi.waitFor(() => expect(requestsFor('task.list')).toHaveLength(1));
    pushDelta('chan-1', 1, {
      updated: [
        { ...wireTaskNote('changed', 'ws-1', 'New title', 'complete'), rev: 9, specLinked: true },
      ],
      removedIds: ['removed'],
    });
    release({
      tasks: [
        wireListedTask('changed', 'ws-1', 'Stale title'),
        wireListedTask('removed', 'ws-1', 'Removed'),
        wireListedTask('rest', 'ws-1', 'Rest'),
      ],
      nextToken: null,
    });
    await vi.waitFor(() =>
      expect(
        latestTasks(handler)
          .map((task) => task.id)
          .sort(),
      ).toEqual(['changed', 'rest', 'seed']),
    );
    expect(latestTasks(handler).find((task) => task.id === 'changed')).toMatchObject({
      title: 'New title',
      status: 'complete',
      rev: 9,
      specLinked: true,
    });
    unsubscribe();
  });

  for (const boundary of ['workspace removal', 'unsubscribe', 'reconnect'] as const) {
    it(`ignores a late task page after ${boundary} without disturbing another workspace`, async () => {
      const release = holdPage('ws-1', 'next');
      const handler = vi.fn();
      const unsubscribe = new LiveTasksClient().subscribe(handler);
      await vi.waitFor(() => expect(requestsFor('task.subscribe')).toHaveLength(2));
      pushSnapshot('chan-1', 0, [wireTaskNote('seed', 'ws-1', 'Seed')], 'next');
      pushSnapshot('chan-2', 0, [wireTaskNote('sibling', 'ws-2', 'Sibling')]);
      await vi.waitFor(() => expect(requestsFor('task.list')).toHaveLength(1));
      if (boundary === 'workspace removal') {
        workspaceIds = ['ws-2'];
        fireWorkspaceSetEvent('workspace:deleted');
        await vi.waitFor(() =>
          expect(requestsFor('task.unsubscribe')).toContainEqual({
            subscriptionId: 'chan-1',
            workspaceId: 'ws-1',
          }),
        );
      } else if (boundary === 'unsubscribe') {
        unsubscribe();
      } else {
        for (const reconnect of [...reconnectHandlers]) reconnect();
        await vi.waitFor(() => expect(requestsFor('task.subscribe')).toHaveLength(4));
        pushSnapshot('chan-3', 0, [wireTaskNote('fresh', 'ws-1', 'Fresh')]);
        pushSnapshot('chan-4', 0, [wireTaskNote('sibling', 'ws-2', 'Sibling')]);
      }
      const callsBeforeLatePage = handler.mock.calls.length;
      release({
        tasks: [wireListedTask('stale', 'ws-1', 'Stale')],
        nextToken: 'must-not-fetch',
      });
      await flush();
      await flush();
      expect(requestsFor('task.list')).toHaveLength(1);
      expect(handler).toHaveBeenCalledTimes(callsBeforeLatePage);
      expect(latestTasks(handler).some((task) => task.id === 'stale')).toBe(false);
      expect(latestTasks(handler).some((task) => task.id === 'sibling')).toBe(true);
      if (boundary === 'workspace removal')
        expect(latestTasks(handler).map((task) => task.id)).toEqual(['sibling']);
      unsubscribe();
    });
  }

  it('unsubscribes every workspace channel on dispose', async () => {
    const client = new LiveTasksClient();
    const unsubscribe = client.subscribe(() => {});
    await vi.waitFor(() => expect(requestsFor('task.subscribe')).toHaveLength(2));
    await flush();

    unsubscribe();
    expect(requestsFor('task.unsubscribe')).toEqual([
      { subscriptionId: 'chan-1', workspaceId: 'ws-1' },
      { subscriptionId: 'chan-2', workspaceId: 'ws-2' },
    ]);
  });
});
