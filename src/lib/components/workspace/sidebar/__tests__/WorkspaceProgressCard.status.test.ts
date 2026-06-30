/**
 * @vitest-environment jsdom
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  vi,
} from 'vitest';
import {
  render,
  fireEvent,
  waitFor,
  screen,
} from '@testing-library/svelte';
import type { Note, Workspace } from '$shared/types';
import { WorkspaceStatusEnum } from '$shared/types';

const mocks = vi.hoisted(() => {
  const dispatch = vi.fn();
  const update = vi.fn();
  const notes = [] as Note[];
  const workspaceEntity = {
    id: 'ws-1',
    title: 'Active Workspace',
    branch: 'feature/status',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: 'active',
    createdAt: '2026-05-05T00:00:00.000Z',
    updatedAt: '2026-05-05T00:00:00.000Z',
    repositoryOwner: 'augment',
    repositoryName: 'intent',
  } as Workspace;
  const readable = <T>(value: T) => ({
    subscribe(run: (v: T) => void) {
      run(value);
      return () => {};
    },
  });
  const selector = <T>(getter: () => T) =>
    Object.assign(() => readable(getter()), { select: getter });
  return { dispatch, update, notes, workspaceEntity, readable, selector };
});

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import('$store/renderer/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => ({}),
    dispatch: mocks.dispatch,
  });
});

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceById: mocks.selector(() => mocks.workspaceEntity),
  selectWorkspaceActivePullRequest: mocks.selector(() => null),
  selectWorkspaceProgressHeadline: mocks.selector(() => ({ headline: '', subtext: '' })),
  selectWorkspaceProgressActions: mocks.selector(() => []),
}));

vi.mock('$store/renderer/slices/workspace-notes/workspace-notes-selectors', () => ({
  selectAllNotes: mocks.selector(() => mocks.notes),
}));

vi.mock('$store/renderer/slices/workspace-tasks/workspace-tasks-selectors', () => ({
  selectWorkspaceTaskProgress: mocks.selector(() => ({
    total: 0,
    completed: 0,
    inProgress: 0,
  })),
}));

vi.mock('$store/renderer/slices/note-read-tracking/note-read-tracking-selectors', () => ({
  selectUnreadNoteIds: mocks.selector(() => []),
}));

vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-selectors', () => ({
  selectAllWorkspaceAgents: mocks.selector(() => []),
}));

vi.mock('$store/renderer/slices/workspace/workspace-slice', () => ({
  loadWorkspacesRequested: vi.fn(() => ({ type: 'workspace/loadWorkspacesRequested' })),
  setWorkspaceEntity: vi.fn((workspace: Workspace) => ({
    type: 'workspace/setWorkspaceEntity',
    payload: [workspace],
  })),
}));

vi.mock('$store/renderer/slices/workspace-notes/workspace-notes-slice', () => ({
  fetchReadyTasks: vi.fn((...args: unknown[]) => ({
    type: 'workspaceNotes/fetchReadyTasks',
    payload: args,
  })),
  applyReadyTasks: vi.fn((...args: unknown[]) => ({
    type: 'workspaceNotes/applyReadyTasks',
    payload: args,
  })),
}));

vi.mock('$store/renderer/slices/ui-layout/ui-layout-selectors', () => ({
  selectSidebarSide: mocks.selector(() => 'left'),
}));

vi.mock('$store/renderer/slices/ui-layout/ui-layout-slice', () => ({
  toggleSidebarSide: vi.fn(() => ({ type: 'uiLayout/toggleSidebarSide' })),
}));

vi.mock('$store/renderer/slices/workspace-operations/workspace-operations-slice', () => ({
  requestDeleteWorkspace: vi.fn((id: string) => ({
    type: 'workspaceOperations/delete',
    payload: [id],
  })),
}));

vi.mock('$store/renderer/slices/workspace/utils/workspace.client', () => ({
  workspaceClient: { update: mocks.update, archive: vi.fn(), unarchive: vi.fn() },
}));

vi.mock('$features/accept-changes/accept-changes.client', () => ({
  AcceptChangesClient: { getStatus: vi.fn().mockResolvedValue({}) },
}));

vi.mock('$lib/electron-bridge', () => ({
  listenSync: vi.fn(() => () => {}),
}));

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$features/navigation/link-handler', () => ({ handleLink: vi.fn() }));
vi.mock('$lib/utils/client-logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));
vi.mock('$lib/utils/delete-warning-utils', () => ({
  hasRunningAgents: vi.fn(() => false),
  getRunningAgentNames: vi.fn(() => []),
}));
vi.mock('$lib/components/ui/button/button.svelte', async () => ({
  default: (await import('../../../terminal/__tests__/mocks/MockButton.svelte')).default,
}));
vi.mock('$lib/components/ui/dropdown-menu.svelte', async () => ({
  default: (await import('./mocks/MockSimple.svelte')).default,
}));
vi.mock('$lib/components/ui/WorkspaceActionsMenu.svelte', async () => ({
  default: (await import('./mocks/MockSimple.svelte')).default,
}));
vi.mock('$lib/components/ui/tooltip/Tooltip.svelte', async () => ({
  default: (await import('./mocks/MockTooltip.svelte')).default,
}));
vi.mock('$lib/components/icons/SidebarIcon.svelte', async () => ({
  default: (await import('./mocks/MockSimple.svelte')).default,
}));
vi.mock('$lib/components/modals/DeleteWarningDialog.svelte', async () => ({
  default: (await import('./mocks/MockSimple.svelte')).default,
}));
vi.mock('$lib/components/ui/HoverCard.svelte', async () => ({
  default: (await import('./mocks/MockTooltip.svelte')).default,
}));
vi.mock('$lib/components/workspace/TaskStatusIndicator.svelte', async () => ({
  default: (await import('./mocks/MockSimple.svelte')).default,
}));
vi.mock('$lib/components/tiptap/TaskAgentStatus.svelte', async () => ({
  default: (await import('./mocks/MockSimple.svelte')).default,
}));
vi.mock('../FlameGraph.svelte', async () => ({
  default: (await import('./mocks/MockSimple.svelte')).default,
}));
vi.mock('svelte-fa', async () => ({
  default: (await import('./mocks/Fa.svelte')).default,
}));

async function renderProgressCard(overrides: Partial<Workspace> = {}) {
  mocks.workspaceEntity = {
    ...mocks.workspaceEntity,
    status: WorkspaceStatusEnum.Active,
    statusMessage: undefined,
    ...overrides,
  } as Workspace;
  const WorkspaceProgressCard = (await import('../WorkspaceProgressCard.svelte')).default;
  return render(WorkspaceProgressCard, { props: { workspaceId: mocks.workspaceEntity.id } });
}

function makeNote(overrides: Partial<Note>): Note {
  return {
    id: 'note-1' as Note['id'],
    workspaceId: 'ws-1' as Note['workspaceId'],
    title: 'Note',
    content: '',
    contentType: 'markdown' as Note['contentType'],
    tags: [],
    isPinned: false,
    isArchived: false,
    visibility: 'private' as Note['visibility'],
    createdAt: '2026-05-05T00:00:00.000Z',
    updatedAt: '2026-05-05T00:00:00.000Z',
    ...overrides,
  };
}

describe('WorkspaceProgressCard status message', () => {
  beforeEach(() => {
    mocks.dispatch.mockClear();
    mocks.update.mockReset();
    mocks.notes.length = 0;
    mocks.update.mockResolvedValue({ ok: true, data: mocks.workspaceEntity });
  });

  it('renders the workspace status message below the active sidebar flame graph', async () => {
    mocks.notes.push(
      makeNote({
        id: 'spec' as Note['id'],
        title: 'Spec',
        content: '- [ ] [Task](intent://local/task/task-1)',
        isDefault: true,
      }),
      makeNote({
        id: 'task-1' as Note['id'],
        title: 'Task',
        parentId: 'spec' as Note['id'],
        metadata: { task: { status: 'in_progress' } },
      }),
    );
    await renderProgressCard({ statusMessage: 'Implementing the active sidebar fix.' });

    const repoButton = screen.getByRole('button', { name: 'augment/intent' });
    const flameGraph = screen
      .getAllByTestId('mock-component')
      .find((node) => repoButton.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING);
    const statusButton = screen.getByRole('button', { name: 'Edit workspace status' });

    expect(statusButton.textContent).toContain('Implementing the active sidebar fix.');
    expect(
      repoButton.compareDocumentPosition(flameGraph!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      flameGraph!.compareDocumentPosition(statusButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('does not clamp or truncate the visible workspace status message', async () => {
    await renderProgressCard({
      statusMessage:
        'This is a longer workspace status that should remain fully visible to the user. It can wrap across lines without being clamped or truncated.',
    });

    const statusButton = screen.getByRole('button', { name: 'Edit workspace status' });

    expect(statusButton.textContent).toContain('It can wrap across lines');
    expect(statusButton.className).not.toMatch(
      /line-clamp|truncate|overflow-hidden|whitespace-nowrap|text-ellipsis/,
    );
    expect(statusButton.className).toContain('whitespace-pre-wrap');
    expect(statusButton.className).toContain('leading-snug');
  });

  it('does not render a placeholder status row when the active sidebar status is empty', async () => {
    await renderProgressCard({ statusMessage: undefined });

    expect(screen.queryByRole('button', { name: 'Add workspace status' })).toBeNull();
    expect(screen.queryByText('Add status…')).toBeNull();
    expect(screen.queryByText('Add workspace status')).toBeNull();
  });

  it('does not render a placeholder status row when the active sidebar status is whitespace', async () => {
    await renderProgressCard({ statusMessage: '   ' });

    expect(screen.queryByRole('button', { name: 'Add workspace status' })).toBeNull();
    expect(screen.queryByText('Add status…')).toBeNull();
    expect(screen.queryByText('Add workspace status')).toBeNull();
  });

  it('saves status edits on Enter and dispatches the updated workspace', async () => {
    const updatedWorkspace = { ...mocks.workspaceEntity, statusMessage: 'Ready for review.' };
    mocks.update.mockResolvedValue({ ok: true, data: updatedWorkspace });

    await renderProgressCard({ statusMessage: 'Drafting status.' });
    await fireEvent.click(screen.getByRole('button', { name: 'Edit workspace status' }));
    const input = await screen.findByLabelText('Workspace status');

    await fireEvent.input(input, { target: { value: 'Ready for review.' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith({ id: 'ws-1', statusMessage: 'Ready for review.' }),
    );
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'workspace/setWorkspaceEntity' }),
    );
  });

  it('cancels status edits on Escape without saving', async () => {
    await renderProgressCard({ statusMessage: 'Keep this status.' });
    await fireEvent.click(screen.getByRole('button', { name: 'Edit workspace status' }));
    const input = await screen.findByLabelText('Workspace status');

    await fireEvent.input(input, { target: { value: 'Do not save this.' } });
    await fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByLabelText('Workspace status')).toBeNull());
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('does not render generated workflow copy below the progress bar', async () => {
    mocks.notes.push(
      makeNote({
        id: 'spec' as Note['id'],
        title: 'Spec',
        content:
          '- [x] [Done](intent://local/task/task-1)\n- [ ] [Remaining](intent://local/task/task-2)',
        isDefault: true,
      }),
      makeNote({
        id: 'task-1' as Note['id'],
        title: 'Done',
        parentId: 'spec' as Note['id'],
        metadata: { task: { status: 'complete' } },
      }),
      makeNote({
        id: 'task-2' as Note['id'],
        title: 'Remaining',
        parentId: 'spec' as Note['id'],
        metadata: { task: { status: 'not_started' } },
      }),
    );

    await renderProgressCard({ statusMessage: 'Focused on active sidebar polish.' });

    expect(screen.queryByText(/Things are progressing nicely/)).toBeNull();
    expect(screen.queryByText(/We're 50% through the work/)).toBeNull();
  });
});
