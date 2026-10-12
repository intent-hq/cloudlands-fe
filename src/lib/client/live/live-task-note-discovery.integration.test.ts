import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackendTransport } from './backend-transport-types';

type Request = (...args: Parameters<BackendTransport['request']>) => Promise<unknown>;

// Only the source transport boundary is controlled. Discovery, enumeration,
// mutation folding and all three domain clients remain actual implementations.
async function fixture() {
  let installedRequest: BackendTransport['request'] | undefined;
  const exportReads: string[] = [];
  const request = vi.fn<Request>();
  vi.doMock('./backend-transport', () => ({
    get backendRequest() {
      exportReads.push('backendRequest');
      if (!installedRequest) throw new Error('Request read before capability installation');
      return installedRequest;
    },
    get onBackendNotification() {
      throw new Error('Unexpected notification capability read');
    },
    get onBackendReconnected() {
      throw new Error('Unexpected reconnect capability read');
    },
  }));
  const [support, { LiveTasksClient }, { LiveNotesClient }, { LiveCommentsClient }] =
    await Promise.all([
      import('./live-support'),
      import('./live-tasks-client'),
      import('./live-notes-client'),
      import('./live-comments-client'),
    ]);
  const tasks = new LiveTasksClient();
  const notes = new LiveNotesClient();
  const comments = new LiveCommentsClient();
  expect(exportReads).toEqual([]);
  expect(request).not.toHaveBeenCalled();
  installedRequest = <T>(...args: Parameters<BackendTransport['request']>): Promise<T> =>
    request(...args) as Promise<T>;
  request.mockRejectedValue(new Error('Unexpected request without a scripted response'));
  return { request, support, tasks, notes, comments, LiveTasksClient, LiveNotesClient };
}

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(console, 'debug').mockImplementation(() => {});
});

afterEach(() => {
  vi.doUnmock('./backend-transport');
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.resetModules();
});

describe('source task discovery shared with real note and comment clients', () => {
  it('routes a note mutation and comment read after task discovery replaces a complete miss', async () => {
    vi.useFakeTimers();
    const { request, support, tasks, notes, comments } = await fixture();
    request
      .mockResolvedValueOnce({ workspaces: [{ id: 'ws-a' }] })
      .mockResolvedValueOnce({ notes: [] });
    await expect(support.resolveNoteWorkspaceId('task-note')).resolves.toBeNull();
    await expect(support.resolveNoteWorkspaceId('task-note')).resolves.toBeNull();
    expect(request.mock.calls).toEqual([
      ['workspace.list'],
      ['note.list', { workspaceId: 'ws-a', projection: 'slim' }],
    ]);

    request.mockResolvedValueOnce({
      tasks: [{ id: 'task-note', title: 'Recovered task', status: 'in_progress', rev: 4 }],
      stats: { total: 9, completed: 3, inProgress: 2 },
    });
    const listed = await tasks.list('ws-b');
    expect(listed.tasks).toMatchObject([
      { id: 'task-note', title: 'Recovered task', status: 'in_progress', rev: 4 },
    ]);
    expect(listed.stats).toEqual({ total: 9, completed: 3, inProgress: 2 });

    request.mockResolvedValueOnce({ newContent: 'Merged content', rev: 8 });
    await expect(notes.setContent('task-note', 'Requested content', 4)).resolves.toEqual({
      success: true,
      newContent: 'Merged content',
      noteRev: 8,
    });
    request.mockResolvedValueOnce({
      threads: [
        {
          id: 'thread-a',
          comments: [
            {
              id: 'comment-a',
              threadId: 'thread-a',
              noteId: 'task-note',
              content: 'Review this change',
              author: 'Reviewer',
              authorType: 'user',
              status: 'open',
              type: 'comment',
              createdAt: '2026-10-12T00:00:00Z',
              updatedAt: '2026-10-12T00:00:00Z',
            },
          ],
        },
      ],
    });
    await expect(comments.list('task-note')).resolves.toMatchObject([
      { id: 'comment-a', threadId: 'thread-a', noteId: 'task-note', workspaceId: 'ws-b' },
    ]);
    expect(request.mock.calls).toEqual([
      ['workspace.list'],
      ['note.list', { workspaceId: 'ws-a', projection: 'slim' }],
      ['task.list', { workspaceId: 'ws-b' }],
      [
        'note.setContent',
        {
          workspaceId: 'ws-b',
          noteId: 'task-note',
          content: 'Requested content',
          expectedVersion: 4,
        },
      ],
      ['comment.list', { workspaceId: 'ws-b', noteId: 'task-note', includeComments: true }],
    ]);
    // Positive-first routing is observable; private negative-map deletion is
    // preserved in the extracted source body, not inferred from this outcome.
  });

  it('shares last-writer discoveries across client instances while explicit workspace still wins', async () => {
    const { request, tasks, notes, comments, LiveTasksClient, LiveNotesClient } = await fixture();
    const anotherTasksClient = new LiveTasksClient();
    const anotherNotesClient = new LiveNotesClient();
    const taskResponse = {
      tasks: [{ id: 'spec', title: 'Shared local ID', status: 'not_started' }],
      stats: { total: 1, completed: 0, inProgress: 0 },
    };
    request.mockResolvedValueOnce(taskResponse).mockResolvedValueOnce(taskResponse);
    await tasks.list('ws-a');
    await anotherTasksClient.list('ws-b');
    request.mockResolvedValueOnce({ newContent: 'B', rev: 2 });
    await expect(anotherNotesClient.setContent('spec', 'B')).resolves.toEqual({
      success: true,
      newContent: 'B',
      noteRev: 2,
    });
    request.mockResolvedValueOnce({ newContent: 'A', rev: 3 });
    await expect(notes.setContent('spec', 'A', undefined, 'ws-a')).resolves.toEqual({
      success: true,
      newContent: 'A',
      noteRev: 3,
    });
    request.mockResolvedValueOnce({ threads: [] });
    await expect(comments.list('spec', 'ws-a')).resolves.toEqual([]);
    expect(request.mock.calls).toEqual([
      ['task.list', { workspaceId: 'ws-a' }],
      ['task.list', { workspaceId: 'ws-b' }],
      ['note.setContent', { workspaceId: 'ws-b', noteId: 'spec', content: 'B' }],
      ['note.setContent', { workspaceId: 'ws-a', noteId: 'spec', content: 'A' }],
      ['comment.list', { workspaceId: 'ws-a', noteId: 'spec', includeComments: true }],
    ]);
  });

  it('retains real resolution failure and mutation rejection instead of faking success', async () => {
    const { request, tasks, notes } = await fixture();
    request
      .mockResolvedValueOnce({ workspaces: [{ id: 'ws-a' }] })
      .mockResolvedValueOnce({ notes: [] });
    await expect(notes.setContent('missing', 'content')).resolves.toEqual({
      success: false,
      error: 'Cannot resolve workspace for note missing',
    });
    request.mockResolvedValueOnce({
      tasks: [{ id: 'missing', title: 'Found', status: 'not_started' }],
      stats: { total: 1, completed: 0, inProgress: 0 },
    });
    await tasks.list('ws-b');
    request.mockRejectedValueOnce(new Error('write unavailable'));
    await expect(notes.setContent('missing', 'content')).resolves.toEqual({
      success: false,
      error: 'write unavailable',
    });
    expect(request.mock.calls).toEqual([
      ['workspace.list'],
      ['note.list', { workspaceId: 'ws-a', projection: 'slim' }],
      ['task.list', { workspaceId: 'ws-b' }],
      ['note.setContent', { workspaceId: 'ws-b', noteId: 'missing', content: 'content' }],
    ]);
  });
});
