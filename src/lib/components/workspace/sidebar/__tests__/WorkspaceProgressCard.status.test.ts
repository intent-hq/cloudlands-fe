/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, waitFor, screen } from '@testing-library/svelte';
import type { Note, Workspace } from '$shared/types';
import { WorkspaceStatusEnum } from '$shared/types';
import { warmImport } from '../../../../../test/warm-import';

const mocks = vi.hoisted(() => {
  const dispatch = vi.fn();
  const update = vi.fn();
  const clipboardWrite = vi.fn();
  const toastSuccess = vi.fn();
  const toastError = vi.fn();
  const notes = [] as Note[];
  const taskState = {
    loading: false,
    progress: { total: 0, completed: 0, inProgress: 0 },
  };
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
  return {
    dispatch,
    update,
    clipboardWrite,
    toastSuccess,
    toastError,
    notes,
    taskState,
    workspaceEntity,
    readable,
    selector,
  };
});

vi.mock('svelte-sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
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
  selectWorkspaceById: mocks.selector(() => mocks.workspaceEntity),
  selectWorkspaceActivePullRequest: mocks.selector(() => null),
  selectWorkspaceProgressHeadline: mocks.selector(() => ({ headline: '', subtext: '' })),
  selectWorkspaceProgressActions: mocks.selector(() => []),
}));

vi.mock('$store/renderer/slices/workspace-notes/workspace-notes-selectors', () => ({
  selectAllNotes: mocks.selector(() => mocks.notes),
}));

vi.mock('$store/renderer/slices/workspace-tasks/workspace-tasks-selectors', () => ({
  selectWorkspaceTaskProgress: mocks.selector(() => mocks.taskState.progress),
  selectWorkspaceTasksLoading: mocks.selector(() => mocks.taskState.loading),
}));

vi.mock('$store/renderer/slices/note-read-tracking/note-read-tracking-selectors', () => ({
  selectUnreadNoteIds: mocks.selector(() => []),
}));

vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-selectors', () => ({
  selectAllWorkspaceAgents: mocks.selector(() => []),
}));

vi.mock('$store/renderer/slices/workspace/workspace-slice', () => ({
  loadWorkspacesRequested: vi.fn(() => ({ type: 'workspace/loadWorkspacesRequested' })),
  updateWorkspaceEntity: vi.fn((id: string, changes: Partial<Workspace>) => ({
    type: 'workspace/updateWorkspaceEntity',
    payload: [id, changes],
  })),
  bulkUpdateWorkspaceEntities: vi.fn((actions: unknown[]) => ({
    type: 'workspace/bulkUpdateWorkspaceEntities',
    payload: [actions],
  })),
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
vi.mock('$features/workspace/components/WorkspaceActionsMenu.svelte', async () => ({
  default: (await import('./mocks/MockSimple.svelte')).default,
}));
vi.mock('$lib/components/ui/tooltip/Tooltip.svelte', async () => ({
  default: (await import('./mocks/MockTooltip.svelte')).default,
}));
vi.mock('$lib/components/ui/tooltip', async () => ({
  TooltipRich: (await import('./mocks/MockTooltipRich.svelte')).default,
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
    statusImageAssetId: undefined,
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

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../../../terminal/__tests__/mocks/MockButton.svelte'));
warmImport(() => import('./mocks/MockSimple.svelte'));
warmImport(() => import('./mocks/MockTooltip.svelte'));
warmImport(() => import('./mocks/Fa.svelte'));
warmImport(() => import('../WorkspaceProgressCard.svelte'));

describe('WorkspaceProgressCard status message', () => {
  beforeEach(() => {
    mocks.dispatch.mockClear();
    mocks.update.mockReset();
    mocks.notes.length = 0;
    mocks.taskState.loading = false;
    mocks.taskState.progress = { total: 0, completed: 0, inProgress: 0 };
    mocks.update.mockResolvedValue({ ok: true, data: mocks.workspaceEntity });
    mocks.clipboardWrite.mockReset();
    mocks.toastSuccess.mockReset();
    mocks.toastError.mockReset();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: mocks.clipboardWrite },
      configurable: true,
    });
  });

  it('renders title, metadata, progress, then status like the sidebar reference', async () => {
    mocks.taskState.progress = { total: 1, completed: 0, inProgress: 1 };
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
    const titleButton = screen.getByRole('button', { name: 'Active Workspace' });
    const flameGraph = screen
      .getAllByTestId('mock-component')
      .find((node) => repoButton.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING);
    const statusButton = screen.getByRole('button', { name: 'Edit workspace status' });

    expect(statusButton.textContent).toContain('Implementing the active sidebar fix.');
    expect(
      titleButton.compareDocumentPosition(repoButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      repoButton.compareDocumentPosition(flameGraph!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      flameGraph!.compareDocumentPosition(statusButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('keeps repository and branch together as secondary metadata', async () => {
    const { container } = await renderProgressCard({
      repositoryOwner: 'editorial-team',
      repositoryName: 'long-running-navigation-redesign',
      repositoryPath: '/repo/editorial-navigation',
      branch: 'feature/simplify-workspace-navigation-and-sidebar',
    });

    const repoButton = screen.getByRole('button', {
      name: 'editorial-team/long-running-navigation-redesign',
    });
    const metadata = repoButton.closest('[data-sidebar-repository-branch-metadata]');
    const repoLabel = repoButton.querySelector('[data-sidebar-repository-label]');
    const branchButton = screen.getByRole('button', {
      name: 'feature/simplify-workspace-navigation-and-sidebar',
    });
    const branchLabel = branchButton.querySelector('[data-sidebar-branch-label]');

    expect(metadata?.textContent).toContain('feature/simplify-workspace-navigation-and-sidebar');
    expect(metadata?.className).toContain('type-caption');
    expect(metadata?.className).toContain('min-w-0');
    expect(metadata?.className.split(/\s+/)).toContain('gap-2.5');
    expect(repoButton.className).toContain('shrink');
    expect(repoButton.className).not.toContain('max-w-[45%]');
    expect(repoButton.className).not.toContain('shrink-0');
    expect(repoButton.className).toContain('overflow-hidden');
    expect(repoLabel?.className).toContain('truncate');
    expect(branchButton.className).toContain('shrink');
    expect(branchButton.className).not.toContain('flex-1');
    expect(branchButton.className).toContain('justify-start');
    expect(branchButton.className).toContain('font-medium');
    expect(repoButton.className.split(/\s+/)).toContain('text-muted-foreground');
    expect(branchButton.className.split(/\s+/)).toContain('text-muted-foreground');
    expect(branchButton.className).toContain('overflow-hidden');
    expect(branchLabel?.className).toContain('truncate');

    await fireEvent.click(repoButton);

    await waitFor(() =>
      expect(mocks.clipboardWrite).toHaveBeenCalledWith('/repo/editorial-navigation'),
    );
    expect(container.textContent).toContain('Copied');
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it('surfaces a rejected title rename and exits title editing', async () => {
    mocks.update.mockResolvedValue({ ok: false, error: 'Rename rejected' });
    await renderProgressCard();
    await fireEvent.click(screen.getByRole('button', { name: 'Active Workspace' }));
    const titleInput = screen.getByRole('textbox');
    await fireEvent.input(titleInput, { target: { value: 'Rejected title' } });
    await fireEvent.keyDown(titleInput, { key: 'Enter' });

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('Rename rejected'));
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('aligns the branch control, explains its context, and copies on click', async () => {
    const { container } = await renderProgressCard({
      branch: 'feature/status',
      baseRef: 'main',
      skipWorktree: false,
    });
    const branch = screen.getByRole('button', { name: 'feature/status' });
    const icon = container.querySelector('[data-sidebar-branch-icon]');
    const hoverCard = container.querySelector('[data-sidebar-branch-hover-card]');

    expect(branch.className).toContain('h-5');
    expect(branch.className.split(/\s+/)).toContain('gap-0.5');
    expect(branch.className.split(/\s+/)).not.toContain('gap-1.5');
    expect(icon?.className).toContain('size-4');
    expect(icon?.className).toContain('place-items-center');
    expect(icon?.className).toContain('text-muted-foreground');
    expect(hoverCard?.textContent).toContain('feature/status');
    expect(hoverCard?.textContent).toContain('Base main');
    expect(hoverCard?.textContent).toContain('main');
    expect(hoverCard?.textContent).toContain('Worktree');
    expect(hoverCard?.textContent).not.toContain('Click to copy branch name');

    await fireEvent.click(branch);

    await waitFor(() => expect(mocks.clipboardWrite).toHaveBeenCalledWith('feature/status'));
    await waitFor(() => expect(hoverCard?.textContent).toContain('Copied'));
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
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

  it('keeps the workspace status wrapping while it is being edited', async () => {
    await renderProgressCard({
      statusMessage: 'This longer workspace status wraps across multiple lines while editing.',
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Edit workspace status' }));
    const editor = await screen.findByLabelText('Workspace status');

    expect(editor.tagName).toBe('TEXTAREA');
    expect(editor.getAttribute('rows')).toBe('1');
    expect(editor.className).toContain('whitespace-pre-wrap');
    expect(editor.className).toContain('break-words');
    expect(editor.className).toContain('resize-none');
    expect(editor.className).toContain('min-h-0');
  });

  it('hides the status row when the active sidebar status is empty', async () => {
    await renderProgressCard({ statusMessage: undefined });

    expect(screen.queryByRole('button', { name: 'Add workspace status' })).toBeNull();
  });

  it('hides the status row when the active sidebar status is whitespace', async () => {
    await renderProgressCard({ statusMessage: '   ' });

    expect(screen.queryByRole('button', { name: 'Add workspace status' })).toBeNull();
  });

  it('hides empty task progress after canonical tasks finish loading', async () => {
    const { container } = await renderProgressCard();

    expect(container.querySelector('[data-workspace-task-progress]')).toBeNull();
  });

  it('keeps task progress visible while canonical tasks are loading', async () => {
    mocks.taskState.loading = true;
    const { container } = await renderProgressCard();

    expect(container.querySelector('[data-workspace-task-progress]')).toBeTruthy();
  });

  it('saves status edits on Enter and dispatches the updated workspace', async () => {
    const updatedWorkspace = { ...mocks.workspaceEntity, statusMessage: 'Ready for review.' };
    mocks.update.mockResolvedValue({ ok: true, data: updatedWorkspace });

    await renderProgressCard({ statusMessage: 'Drafting status.' });
    await fireEvent.click(screen.getByRole('button', { name: 'Edit workspace status' }));
    const input = await screen.findByLabelText('Workspace status');

    await fireEvent.input(input, { target: { value: 'Ready for review.' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    // Enter saves without inserting a newline.
    expect((input as HTMLTextAreaElement).value).toBe('Ready for review.');
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith({ id: 'ws-1', statusMessage: 'Ready for review.' }),
    );
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'workspace/setWorkspaceEntity' }),
    );
  });

  it('renders the status editor as a wrapping textarea', async () => {
    await renderProgressCard({ statusMessage: 'Drafting status.' });
    await fireEvent.click(screen.getByRole('button', { name: 'Edit workspace status' }));
    const input = await screen.findByLabelText('Workspace status');

    expect(input.tagName).toBe('TEXTAREA');
    expect(input.className).toContain('resize-none');
    expect(input.className).toContain('whitespace-pre-wrap');
  });

  it('does not save and allows a newline on Shift+Enter', async () => {
    await renderProgressCard({ statusMessage: 'First line.' });
    await fireEvent.click(screen.getByRole('button', { name: 'Edit workspace status' }));
    const input = (await screen.findByLabelText('Workspace status')) as HTMLTextAreaElement;

    const notPrevented = await fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    // Shift+Enter is left to the textarea's default newline insertion.
    expect(notPrevented).toBe(true);
    await fireEvent.input(input, { target: { value: 'First line.\nSecond line.' } });

    expect(mocks.update).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Workspace status')).toBeTruthy();
    expect(input.value).toBe('First line.\nSecond line.');
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

describe('WorkspaceProgressCard status screenshot (intent-hq/monorepo#997)', () => {
  beforeEach(() => {
    mocks.dispatch.mockClear();
    mocks.update.mockReset();
    mocks.notes.length = 0;
    mocks.update.mockResolvedValue({ ok: true, data: mocks.workspaceEntity });
  });

  it('renders the status screenshot beneath the status message via the workspace-asset URL', async () => {
    await renderProgressCard({
      statusMessage: 'Implementing dark mode.',
      statusImageAssetId: 'asset-abc123',
    });

    const image = screen.getByAltText('Workspace status screenshot') as HTMLImageElement;
    expect(image.getAttribute('src')).toBe('workspace-asset://ws-1/asset-abc123');
    // Bounded dimensions + rounded border per the acceptance criteria.
    expect(image.className).toContain('max-h-48');
    expect(image.className).toContain('rounded-md');
    expect(image.className.split(/\s+/)).toContain('border');

    const statusButton = screen.getByRole('button', { name: 'Edit workspace status' });
    expect(
      statusButton.compareDocumentPosition(image) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('renders the screenshot even when the workspace has no status message', async () => {
    await renderProgressCard({ statusMessage: undefined, statusImageAssetId: 'asset-abc123' });

    expect(screen.getByAltText('Workspace status screenshot')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit workspace status' })).toBeNull();
  });

  it('does not render an image for text-only workspaces (absence / cleared reference)', async () => {
    await renderProgressCard({ statusMessage: 'Text-only workspace status.' });

    expect(screen.queryByAltText('Workspace status screenshot')).toBeNull();
    expect(screen.queryByRole('button', { name: 'View workspace status screenshot' })).toBeNull();
    // The text status row is unchanged.
    const statusButton = screen.getByRole('button', { name: 'Edit workspace status' });
    expect(statusButton.textContent).toContain('Text-only workspace status.');
  });

  it('hides the image when the asset fails to load', async () => {
    await renderProgressCard({
      statusMessage: 'Screenshot attached.',
      statusImageAssetId: 'asset-missing',
    });

    const image = screen.getByAltText('Workspace status screenshot');
    await fireEvent.error(image);

    await waitFor(() => expect(screen.queryByAltText('Workspace status screenshot')).toBeNull());
    // The text status row survives the failed image load.
    expect(screen.getByRole('button', { name: 'Edit workspace status' })).toBeTruthy();
  });

  it('opens the full-size lightbox when the screenshot is clicked', async () => {
    await renderProgressCard({
      statusMessage: 'Screenshot attached.',
      statusImageAssetId: 'asset-abc123',
    });

    await fireEvent.click(screen.getByRole('button', { name: 'View workspace status screenshot' }));

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /image preview/i })).toBeTruthy();
    });
  });
});
