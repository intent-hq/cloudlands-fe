import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note, WorkspaceId } from '../../../../shared/types';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
}));

// `getWorkspaceTasks` routes through the daemon (PROTOCOL.md §5.4 `note.list`).
vi.mock('../../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: mocks.request }),
}));

import { getWorkspaceTasks } from '../workspace-summaries';

const WORKSPACE_ID = 'amber-forest' as WorkspaceId;

const makeTaskNote = (id: string, overrides: Partial<Note> = {}): Note =>
  ({
    id,
    workspaceId: WORKSPACE_ID,
    title: `Task ${id}`,
    content: '',
    contentType: 'markdown',
    tags: [],
    isPinned: false,
    isArchived: false,
    visibility: 'public',
    parentId: 'spec',
    metadata: { task: { status: 'not_started' } },
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-02T00:00:00.000Z',
    ...overrides,
  }) as unknown as Note;

describe('getWorkspaceTasks', () => {
  beforeEach(() => {
    mocks.request.mockReset();
  });

  it('maps spec task notes to WorkspaceTask facts', async () => {
    const notes = [
      makeTaskNote('task-1', {
        metadata: { task: { status: 'in_progress' } },
      } as Partial<Note>),
      makeTaskNote('task-2', {
        metadata: { task: { status: 'complete' } },
      } as Partial<Note>),
      // Non-task note is excluded
      makeTaskNote('plain-note', { metadata: {} } as Partial<Note>),
    ];
    mocks.request.mockImplementation((method: string) =>
      method === 'note.list'
        ? Promise.resolve({ notes })
        : Promise.resolve({ note: makeTaskNote('spec', { metadata: {} } as Partial<Note>) }),
    );

    const tasks = await getWorkspaceTasks(WORKSPACE_ID);

    expect(mocks.request).toHaveBeenCalledWith('note.list', {
      workspaceId: WORKSPACE_ID,
      projection: 'slim',
    });
    expect(mocks.request).toHaveBeenCalledWith('note.get', {
      workspaceId: WORKSPACE_ID,
      noteId: 'spec',
    });
    expect(tasks).toEqual([
      {
        id: 'task-1',
        title: 'Task task-1',
        status: 'in_progress',
        updatedAt: '2026-06-02T00:00:00.000Z',
      },
      {
        id: 'task-2',
        title: 'Task task-2',
        status: 'complete',
        updatedAt: '2026-06-02T00:00:00.000Z',
      },
    ]);
  });

  it('includes cancelled tasks and defaults missing title/status', async () => {
    const notes = [
      makeTaskNote('task-1', {
        title: '',
        metadata: { task: {} },
      } as Partial<Note>),
      makeTaskNote('task-2', {
        metadata: { task: { status: 'cancelled' } },
      } as Partial<Note>),
    ];
    mocks.request.mockResolvedValue({ notes });

    const tasks = await getWorkspaceTasks(WORKSPACE_ID);

    expect(tasks).toEqual([
      {
        id: 'task-1',
        title: 'Untitled task',
        status: 'not_started',
        updatedAt: '2026-06-02T00:00:00.000Z',
      },
      {
        id: 'task-2',
        title: 'Task task-2',
        status: 'cancelled',
        updatedAt: '2026-06-02T00:00:00.000Z',
      },
    ]);
  });

  it('propagates daemon errors', async () => {
    mocks.request.mockRejectedValue(new Error('notes unavailable'));

    await expect(getWorkspaceTasks(WORKSPACE_ID)).rejects.toThrow('notes unavailable');
  });
});

it('uses bounded task links for capable daemons without a whole-spec get', async () => {
  mocks.request.mockReset();
  const notes = ['first', 'second', 'unlinked'].map((id) =>
    makeTaskNote(id, { metadata: { task: { status: 'not_started' } } } as Partial<Note>),
  );
  mocks.request.mockImplementation(async (method: string, params: any) => {
    if (method === 'client.hello')
      return { server: { capabilities: { notePaging: 1, notePagingBackendId: 'db' } } };
    if (method === 'note.list') return { notes };
    if (method === 'note.get' && params.page?.kind === 'taskIds')
      return {
        kind: 'noteTaskIdsPage',
        scope: {
          backendId: 'db',
          workspaceId: WORKSPACE_ID,
          noteId: 'spec',
          noteInstanceId: 'inc',
        },
        sourceRevision: 'r1',
        snapshotId: 's1',
        expiresAt: '2099-01-01T00:00:00Z',
        startIndex: 0,
        totalItems: 2,
        items: [
          {
            index: 0,
            sourceRange: { start: 0, end: 6 },
            taskNoteIdLength: 6,
            taskNoteId: 'second',
          },
          {
            index: 1,
            sourceRange: { start: 10, end: 15 },
            taskNoteIdLength: 5,
            taskNoteId: 'first',
          },
        ],
        nextCursor: null,
      };
    throw new Error('Unexpected full read');
  });
  const tasks = await getWorkspaceTasks(WORKSPACE_ID);
  expect(tasks.map((t) => t.id)).toEqual(['first', 'second']);
  expect(mocks.request.mock.calls.filter(([m, p]) => m === 'note.get' && !p.page)).toHaveLength(0);
});
