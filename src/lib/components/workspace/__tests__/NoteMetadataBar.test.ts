/**
 * @vitest-environment jsdom
 */
import {
  render,
  screen,
  fireEvent,
} from '@testing-library/svelte';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { AgentSession, Note, Workspace } from '$shared/types';
import { WorkspaceStatusEnum } from '$shared/types';

const mocks = vi.hoisted(() => {
  const dispatch = vi.fn();
  const workspaceAgents: AgentSession[] = [];
  const allNotes: Note[] = [];
  const agentsById = new Map<string, AgentSession>();
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

  return { dispatch, workspaceAgents, allNotes, agentsById, activeWorkspace, readable };
});

vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

vi.mock('$lib/store/utils/svelte-context', () => ({
  getDispatch: () => mocks.dispatch,
  readableProp: (getter: () => string) => mocks.readable(getter()),
}));

vi.mock('$lib/store/redux-dispatch-bridge', () => ({
  getReduxStore: () => ({ getState: () => ({}), dispatch: mocks.dispatch }),
}));

vi.mock('$lib/store/slices/workspace/workspace-selectors', () => ({
  selectActiveWorkspace: Object.assign(() => mocks.readable(mocks.activeWorkspace), {
    select: () => mocks.activeWorkspace,
  }),
}));

vi.mock('$lib/store/slices/workspace-notes/workspace-notes-selectors', () => ({
  selectAllNotes: () => mocks.readable(mocks.allNotes),
}));

vi.mock('$lib/store/slices/workspace-agents/workspace-agents-selectors', () => ({
  selectAllWorkspaceAgents: () => mocks.readable(mocks.workspaceAgents),
}));

vi.mock('$lib/store/slices/agent-session/agent-session-selectors', () => ({
  selectAgentSession: { select: (_state: unknown, agentId: string) => mocks.agentsById.get(agentId) },
}));

vi.mock('$lib/store/slices/app-layout/app-layout-slice', () => ({
  openAgentTabRequested: vi.fn((workspaceId: string, options: unknown) => ({
    type: 'appLayout/openAgentTabRequested',
    payload: [workspaceId, options],
  })),
}));

vi.mock('$lib/store/slices/workspace-navigation/workspace-navigation-slice', () => ({
  openWorkspaceChatChanges: vi.fn((...payload: unknown[]) => ({
    type: 'workspaceNavigation/openWorkspaceChatChanges',
    payload,
  })),
}));

vi.mock('$lib/store/slices/workspace-agents/workspace-agents-slice', () => ({
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

vi.mock('$lib/components/ui/auggie-avatar/AuggieAvatar.svelte', async () => ({
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

function makeTaskNote(assignedAgentIds: string[]): Note {
  return {
    id: 'note-1' as Note['id'],
    title: 'Task Note',
    content: 'Task body',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    metadata: { task: { status: 'in_progress', assignedAgentIds } },
  } as Note;
}

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
