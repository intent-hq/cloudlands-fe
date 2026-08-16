/**
 * @vitest-environment jsdom
 */
import { render, screen, fireEvent } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentSession, Note, Workspace } from '$shared/types';
import { WorkspaceStatusEnum } from '$shared/types';
import { warmImport } from '../../../../test/warm-import';

const mocks = vi.hoisted(() => {
  const dispatch = vi.fn();
  const workspaceAgents: AgentSession[] = [];
  const allNotes: Note[] = [];
  const agentsById = new Map<string, AgentSession>();
  const navigateToNote = vi.fn();
  const activeWorkspace = {
    id: 'ws-1',
    title: 'Workspace',
    status: 'Active',
  } as Workspace;

  const readable = <T>(value: T) => ({
    subscribe(run: (value: T) => void) {
      run(value);
      return () => {};
    },
  });

  return {
    dispatch,
    workspaceAgents,
    allNotes,
    agentsById,
    navigateToNote,
    activeWorkspace,
    readable,
  };
});

vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => ({}),
    dispatch: mocks.dispatch,
  });
});

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceById: Object.assign(
    (_workspaceId: string | { subscribe: unknown }) => mocks.readable(mocks.activeWorkspace),
    { select: () => mocks.activeWorkspace },
  ),
}));

vi.mock('$lib/utils/workspace-route-context', () => ({
  getWorkspaceRouteContext: () => ({ workspaceId: 'ws-1' }),
}));

vi.mock('$store/renderer/slices/workspace-notes/workspace-notes-selectors', () => ({
  selectAllNotes: () => mocks.readable(mocks.allNotes),
  selectNotesVersion: () => mocks.readable(0),
  selectNoteById: Object.assign(
    (_workspaceId: unknown, noteIdStore: any) => {
      let noteId = '';
      const unsubscribe = noteIdStore.subscribe((value: string) => (noteId = value));
      unsubscribe();
      return mocks.readable(mocks.allNotes.find((note) => note.id === noteId));
    },
    {
      select: (_state: unknown, _wsId: string, noteId: string) =>
        mocks.allNotes.find((n) => n.id === noteId),
    },
  ),
}));

vi.mock('$lib/utils/workspace-navigation', () => ({
  navigateToNote: mocks.navigateToNote,
  findSourcePanelId: () => undefined,
}));

vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-selectors', () => ({
  selectAllWorkspaceAgents: () => mocks.readable(mocks.workspaceAgents),
}));

vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentSession: {
    select: (_state: unknown, agentId: string) => mocks.agentsById.get(agentId),
  },
}));

vi.mock('$store/renderer/slices/app-layout/app-layout-slice', () => ({
  openAgentTabRequested: vi.fn((workspaceId: string, options: unknown) => ({
    type: 'appLayout/openAgentTabRequested',
    payload: [workspaceId, options],
  })),
}));

vi.mock('$store/renderer/slices/workspace-navigation/workspace-navigation-slice', () => ({
  openWorkspaceChatChanges: vi.fn((...payload: unknown[]) => ({
    type: 'workspaceNavigation/openWorkspaceChatChanges',
    payload,
  })),
}));

vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-slice', () => ({
  ensureAgentSessionLoaded: vi.fn((workspaceId: string, agentId: string) => ({
    type: 'workspaceAgents/ensureAgentSessionLoaded',
    payload: [workspaceId, agentId],
  })),
  restoreAgentSessionRequested: vi.fn((workspaceId: string, agentId: string) => ({
    type: 'workspaceAgents/restoreAgentSessionRequested',
    payload: [workspaceId, agentId],
    promise: Promise.resolve(null),
  })),
  runAgentForNoteRequested: vi.fn((workspaceId: string, noteId: string, title: string) => ({
    type: 'workspaceAgents/runAgentForNoteRequested',
    payload: [workspaceId, noteId, title],
  })),
}));

vi.mock('$features/agent/components/auggie-avatar/AuggieAvatar.svelte', async () => ({
  default: (await import('../sidebar/__tests__/mocks/MockSimple.svelte')).default,
}));

vi.mock('$lib/components/workspace/TaskStatusIndicator.svelte', async () => ({
  default: (await import('../sidebar/__tests__/mocks/MockSimple.svelte')).default,
}));

vi.mock('svelte-fa', async () => ({
  default: (await import('../sidebar/__tests__/mocks/Fa.svelte')).default,
}));

function makeAgent(id: string, name: string, createdAt: string): AgentSession {
  return {
    id: id as AgentSession['id'],
    backendSessionId: null,
    workspaceId: 'ws-1' as AgentSession['workspaceId'],
    name,
    status: 'idle' as AgentSession['status'],
    messages: [],
    createdAt,
    updatedAt: createdAt,
  };
}

function makeTaskNote(
  assignedAgentIds: string[],
  taskOverrides: Record<string, unknown> = {},
): Note {
  return {
    id: 'note-1' as Note['id'],
    title: 'Task Note',
    content: 'Task body',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    metadata: { task: { status: 'in_progress', assignedAgentIds, ...taskOverrides } },
  } as Note;
}

function makeRelatedNote(
  id: string,
  title: string,
  taskOverrides: Record<string, unknown> = {},
): Note {
  return {
    id: id as Note['id'],
    title,
    content: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    metadata: { task: { status: 'not_started', ...taskOverrides } },
  } as Note;
}

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../sidebar/__tests__/mocks/MockSimple.svelte'));
warmImport(() => import('../sidebar/__tests__/mocks/Fa.svelte'));
warmImport(() => import('../NoteMetadataBar.svelte'));

describe('NoteMetadataBar smoke coverage', () => {
  beforeEach(() => {
    mocks.dispatch.mockClear();
    mocks.workspaceAgents.length = 0;
    mocks.allNotes.length = 0;
    mocks.agentsById.clear();
    mocks.activeWorkspace.id = 'ws-1' as Workspace['id'];
    mocks.activeWorkspace.status = WorkspaceStatusEnum.Active;
  });

  it('renders assigned task agents using selector-backed workspace state', async () => {
    const older = makeAgent('agent-older', 'Older Agent', '2026-01-01T00:00:00.000Z');
    const newer = makeAgent('agent-newer', 'Newer Agent', '2026-01-02T00:00:00.000Z');
    mocks.workspaceAgents.push(newer, older);
    mocks.agentsById.set(older.id, older);
    mocks.agentsById.set(newer.id, newer);

    const NoteMetadataBar = (await import('../NoteMetadataBar.svelte')).default;
    render(NoteMetadataBar, {
      props: { workspaceId: 'ws-1' as Workspace['id'], note: makeTaskNote([newer.id, older.id]) },
    });

    expect(screen.getByText('Assignee')).toBeTruthy();
    const names = screen.getAllByText(/Agent$/).map((node) => node.textContent);
    expect(names).toEqual(['Older Agent', 'Newer Agent']);
  });

  it('dispatches runAgentForNoteRequested from the empty-assignee affordance', async () => {
    const NoteMetadataBar = (await import('../NoteMetadataBar.svelte')).default;
    render(NoteMetadataBar, {
      props: { workspaceId: 'ws-1' as Workspace['id'], note: makeTaskNote([]) },
    });

    await fireEvent.click(screen.getByTitle('Run agent'));

    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'workspaceAgents/runAgentForNoteRequested',
      payload: ['ws-1', 'note-1', 'Task Note'],
    });
  });
});

describe('NoteMetadataBar relations section (monorepo#1974)', () => {
  beforeEach(() => {
    mocks.dispatch.mockClear();
    mocks.navigateToNote.mockClear();
    mocks.workspaceAgents.length = 0;
    mocks.allNotes.length = 0;
    mocks.agentsById.clear();
    mocks.activeWorkspace.id = 'ws-1' as Workspace['id'];
    mocks.activeWorkspace.status = WorkspaceStatusEnum.Active;
  });

  async function renderBar(note: Note) {
    const NoteMetadataBar = (await import('../NoteMetadataBar.svelte')).default;
    return render(NoteMetadataBar, {
      props: { workspaceId: 'ws-1' as Workspace['id'], note },
    });
  }

  it('hides all relation rows when the task has no relations', async () => {
    await renderBar(makeTaskNote([]));

    expect(screen.queryByText('Depends on')).toBeNull();
    expect(screen.queryByText('Depended on by')).toBeNull();
    expect(screen.queryByText('Conflicts with')).toBeNull();
  });

  it('renders dependsOn links with titles and marks daemon-reported unmet deps', async () => {
    mocks.allNotes.push(
      makeRelatedNote('dep-a', 'Dep A', { status: 'complete' }),
      makeRelatedNote('dep-b', 'Dep B'),
    );

    const { container } = await renderBar(
      makeTaskNote([], { dependsOn: ['dep-a', 'dep-b'], unmetDependsOn: ['dep-b'] }),
    );

    expect(screen.getByText('Depends on')).toBeTruthy();
    expect(screen.getByText('Dep A')).toBeTruthy();
    expect(screen.getByText('Dep B')).toBeTruthy();
    // Only the unmet dep carries the hourglass marker.
    const unmetMarkers = container.querySelectorAll('[title="Waiting on this dependency"]');
    expect(unmetMarkers.length).toBe(1);
  });

  it('suppresses unmet highlighting once the task itself is complete', async () => {
    mocks.allNotes.push(makeRelatedNote('dep-a', 'Dep A'));

    const { container } = await renderBar(
      makeTaskNote([], {
        status: 'complete',
        dependsOn: ['dep-a'],
        unmetDependsOn: ['dep-a'],
      }),
    );

    expect(screen.getByText('Dep A')).toBeTruthy();
    expect(container.querySelectorAll('[title="Waiting on this dependency"]').length).toBe(0);
  });

  it('computes "Depended on by" reverse edges from the notes slice', async () => {
    mocks.allNotes.push(
      makeRelatedNote('dependent-1', 'Dependent One', { dependsOn: ['note-1'] }),
      makeRelatedNote('unrelated-1', 'Unrelated', { dependsOn: ['other'] }),
      makeRelatedNote('dependent-2', 'Dependent Two', { dependsOn: ['x', 'note-1'] }),
    );

    await renderBar(makeTaskNote([]));

    expect(screen.getByText('Depended on by')).toBeTruthy();
    expect(screen.getByText('Dependent One')).toBeTruthy();
    expect(screen.getByText('Dependent Two')).toBeTruthy();
    expect(screen.queryByText('Unrelated')).toBeNull();
  });

  it('renders conflictsWith links', async () => {
    mocks.allNotes.push(makeRelatedNote('conflict-1', 'Conflicting Task'));

    await renderBar(makeTaskNote([], { conflictsWith: ['conflict-1'] }));

    expect(screen.getByText('Conflicts with')).toBeTruthy();
    expect(screen.getByText('Conflicting Task')).toBeTruthy();
  });

  it('navigates to the related note when a relation link is clicked', async () => {
    mocks.allNotes.push(makeRelatedNote('dep-a', 'Dep A'));

    await renderBar(makeTaskNote([], { dependsOn: ['dep-a'] }));

    await fireEvent.click(screen.getByText('Dep A'));

    expect(mocks.navigateToNote).toHaveBeenCalledWith(
      'dep-a',
      expect.objectContaining({ workspaceId: 'ws-1', openInAdjacentPanel: false }),
    );
  });

  it('falls back to a not-found label for relations pointing at missing notes', async () => {
    await renderBar(makeTaskNote([], { dependsOn: ['ghost-note'] }));

    expect(screen.getByText('Depends on')).toBeTruthy();
    expect(screen.getByText(/ghost-note/)).toBeTruthy();
  });
});
