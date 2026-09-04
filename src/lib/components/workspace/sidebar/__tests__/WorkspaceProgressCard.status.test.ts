/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, waitFor, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { Note, Workspace } from '$shared/types';
import { WorkspaceStatusEnum } from '$shared/types';
import type { WorkspaceProgressAction } from '$store/renderer/slices/workspace/workspace-types';
import { warmImport } from '../../../../../test/warm-import';

const mocks = vi.hoisted(() => {
  const storeState = {
    panelLayout: {
      byWorkspaceId: {
        'ws-1': { columnCount: 2 },
      },
    },
    workspace: {
      pendingTitleMutations: {} as Record<string, { token: number }>,
    },
  };
  const dispatch = vi.fn((action: { type: string; payload?: unknown[] }) => {
    if (
      action.type === 'workspace/beginWorkspaceTitleMutation' ||
      action.type === 'workspace/completeWorkspaceTitleMutation' ||
      action.type === 'workspace/failWorkspaceTitleMutation'
    ) {
      const [workspaceId, token] = action.payload ?? [];
      if (action.type === 'workspace/beginWorkspaceTitleMutation') {
        storeState.workspace.pendingTitleMutations[workspaceId as string] = {
          token: token as number,
        };
      } else {
        delete storeState.workspace.pendingTitleMutations[workspaceId as string];
      }
    }
    return action;
  });
  const update = vi.fn();
  const clipboardWrite = vi.fn();
  const toastSuccess = vi.fn();
  const toastError = vi.fn();
  const handleLink = vi.fn();
  const progressActions = [] as WorkspaceProgressAction[];
  const notes = [] as Note[];
  const taskState = {
    initialized: true,
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
  const selectorSubscribers = new Set<() => void>();
  const selector = <T>(getter: () => T) =>
    Object.assign(
      () => ({
        subscribe(run: (v: T) => void) {
          const notify = () => run(getter());
          notify();
          selectorSubscribers.add(notify);
          return () => selectorSubscribers.delete(notify);
        },
      }),
      { select: getter },
    );
  const notifySelectors = () => selectorSubscribers.forEach((notify) => notify());
  return {
    dispatch,
    update,
    clipboardWrite,
    toastSuccess,
    toastError,
    handleLink,
    progressActions,
    notes,
    taskState,
    workspaceEntity,
    readable,
    selector,
    notifySelectors,
    storeState,
  };
});

vi.mock('svelte-sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => mocks.storeState,
    dispatch: mocks.dispatch,
  });
});

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceById: mocks.selector(() => mocks.workspaceEntity),
  selectWorkspaceActivePullRequest: mocks.selector(() => null),
  selectWorkspaceProgressHeadline: mocks.selector(() => ({ headline: '', subtext: '' })),
  selectWorkspaceProgressActions: mocks.selector(() => mocks.progressActions),
}));

vi.mock('$store/renderer/slices/workspace-notes/workspace-notes-selectors', () => ({
  selectAllNotes: mocks.selector(() => mocks.notes),
}));

vi.mock('$store/renderer/slices/workspace-tasks/workspace-tasks-selectors', () => ({
  selectWorkspaceTaskProgress: mocks.selector(() => mocks.taskState.progress),
  selectWorkspaceTasksInitialized: mocks.selector(() => mocks.taskState.initialized),
  // Kept so the refetch regression test also fails under a loading-gated
  // implementation: flipping this must not affect the mounted progress bar.
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
  beginWorkspaceTitleMutation: vi.fn(
    (id: string, token: number, optimisticTitle: string, previousTitle: string) => ({
      type: 'workspace/beginWorkspaceTitleMutation',
      payload: [id, token, optimisticTitle, previousTitle],
    }),
  ),
  completeWorkspaceTitleMutation: vi.fn((id: string, token: number, workspace: Workspace) => ({
    type: 'workspace/completeWorkspaceTitleMutation',
    payload: [id, token, workspace],
  })),
  failWorkspaceTitleMutation: vi.fn((id: string, token: number) => ({
    type: 'workspace/failWorkspaceTitleMutation',
    payload: [id, token],
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
  toggleSidebar: vi.fn(() => ({ type: 'uiLayout/toggleSidebar' })),
  toggleSidebarSide: vi.fn(() => ({ type: 'uiLayout/toggleSidebarSide' })),
}));

vi.mock('$store/renderer/slices/workspace-transfer/workspace-transfer-slice', () => ({
  openTransferModal: vi.fn((payload: { workspaceId: string; workspaceTitle: string }) => ({
    type: 'workspaceTransfer/openTransferModal',
    payload,
  })),
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
vi.mock('$features/navigation/link-handler', () => ({ handleLink: mocks.handleLink }));
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
  default: (await import('../../../ui/__tests__/mocks/dropdown-menu.svelte')).default,
}));
vi.mock('$features/workspace/components/WorkspaceActionsMenu.svelte', async () => ({
  default: (await import('./mocks/MockWorkspaceActionsMenu.svelte')).default,
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
  default: (await import('./mocks/MockFlameGraph.svelte')).default,
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
warmImport(() => import('./mocks/MockWorkspaceActionsMenu.svelte'));
warmImport(() => import('../../../ui/__tests__/mocks/dropdown-menu.svelte'));
warmImport(() => import('./mocks/MockFlameGraph.svelte'));
warmImport(() => import('./mocks/MockTooltip.svelte'));
warmImport(() => import('./mocks/Fa.svelte'));
warmImport(() => import('../WorkspaceProgressCard.svelte'));

describe('WorkspaceProgressCard status message', () => {
  beforeEach(() => {
    mocks.dispatch.mockClear();
    mocks.update.mockReset();
    mocks.notes.length = 0;
    mocks.taskState.initialized = true;
    mocks.taskState.loading = false;
    mocks.taskState.progress = { total: 0, completed: 0, inProgress: 0 };
    mocks.update.mockResolvedValue({ ok: true, data: mocks.workspaceEntity });
    mocks.clipboardWrite.mockReset();
    mocks.toastSuccess.mockReset();
    mocks.toastError.mockReset();
    mocks.handleLink.mockReset();
    mocks.progressActions.length = 0;
    mocks.storeState.workspace.pendingTitleMutations = {};
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: mocks.clipboardWrite },
      configurable: true,
    });
  });

  it('places a divider between the move and transfer actions while keeping transfer before archive', async () => {
    const { container } = await renderProgressCard();
    await fireEvent.click(container.querySelector('[data-workspace-actions-trigger]')!);

    const moveSidebar = screen.getByRole('button', { name: 'Move sidebar to right' });
    const transfer = screen.getByRole('button', { name: 'Transfer/Download…' });
    const archive = screen.getByRole('button', { name: 'Archive Workspace' });
    const menuItems = Array.from(transfer.parentElement!.children);
    const moveSidebarIndex = menuItems.indexOf(moveSidebar);
    const dividerIndex = moveSidebarIndex + 1;
    const transferIndex = menuItems.indexOf(transfer);
    const archiveIndex = menuItems.indexOf(archive);

    expect(transfer.dataset.iconName).toBe('right-left');
    expect(menuItems[dividerIndex]?.getAttribute('data-testid')).toBe('menu-divider');
    expect(transferIndex).toBe(dividerIndex + 1);
    expect(archiveIndex).toBe(transferIndex + 1);
  });

  it('dispatches the transfer payload and dismisses the menu', async () => {
    const { container } = await renderProgressCard();
    await fireEvent.click(container.querySelector('[data-workspace-actions-trigger]')!);
    const transfer = screen.getByRole('button', { name: 'Transfer/Download…' });

    await fireEvent.click(transfer);

    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'workspaceTransfer/openTransferModal',
      payload: { workspaceId: 'ws-1', workspaceTitle: 'Active Workspace' },
    });
    expect(
      container.querySelector('[data-workspace-actions-trigger]')?.getAttribute('aria-expanded'),
    ).toBe('false');
  });

  it('omits the transfer action when workspace data becomes unavailable', async () => {
    const { container } = await renderProgressCard();
    const loadedWorkspace = mocks.workspaceEntity;

    try {
      mocks.workspaceEntity = null as unknown as Workspace;
      mocks.notifySelectors();
      await tick();
      await fireEvent.click(container.querySelector('[data-workspace-actions-trigger]')!);

      expect(screen.queryByRole('button', { name: 'Transfer/Download…' })).toBeNull();
    } finally {
      mocks.workspaceEntity = loadedWorkspace;
      mocks.notifySelectors();
    }
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
    const flameGraph = screen.getByTestId('mock-flame-graph');
    const statusButton = screen.getByRole('button', { name: 'Edit workspace status' });

    expect(statusButton.textContent).toContain('Implementing the active sidebar fix.');
    expect(
      titleButton.compareDocumentPosition(repoButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      repoButton.compareDocumentPosition(flameGraph) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      flameGraph.compareDocumentPosition(statusButton) & Node.DOCUMENT_POSITION_FOLLOWING,
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

  it('renders the title editor full-width without JS auto-resize', async () => {
    await renderProgressCard();
    await fireEvent.click(screen.getByRole('button', { name: 'Active Workspace' }));
    const titleInput = screen.getByRole('textbox') as HTMLInputElement;

    expect(titleInput.className.split(/\s+/)).toContain('w-full');
    expect(titleInput.style.width).toBe('');

    await fireEvent.input(titleInput, { target: { value: 'A much longer workspace title' } });
    expect(titleInput.style.width).toBe('');
  });

  it('applies the sidebar title decoration classes in display and edit modes', async () => {
    await renderProgressCard();
    const titleButton = screen.getByRole('button', { name: 'Active Workspace' });
    const decoration = titleButton.parentElement?.querySelector<HTMLElement>(
      ':scope > [aria-hidden="true"]',
    );

    expect(decoration).toBeTruthy();
    expect(decoration!.className.split(/\s+/)).toEqual(
      expect.arrayContaining([
        '-inset-x-1',
        '-inset-y-0.5',
        'border-transparent',
        'bg-transparent',
        'motion-reduce:transition-none',
        'transition-[inset,border-color,background-color]',
      ]),
    );

    await fireEvent.click(titleButton);

    expect(decoration!.className.split(/\s+/)).toEqual(
      expect.arrayContaining([
        '-inset-x-2',
        '-inset-y-1.5',
        'border-ring/60',
        'bg-sidebar',
        'motion-reduce:transition-none',
        'transition-[inset,border-color,background-color]',
      ]),
    );
  });

  it('aligns the branch control, explains its context, and copies on click', async () => {
    const { container } = await renderProgressCard({
      branch: 'feature/status',
      baseRef: 'main',
      skipWorktree: false,
    });
    const branch = screen.getByRole('button', { name: 'feature/status' });
    const hoverCard = container.querySelector('[data-sidebar-branch-hover-card]');

    expect(branch.className).toContain('h-5');
    expect(branch.className.split(/\s+/)).not.toContain('gap-0.5');
    expect(branch.className.split(/\s+/)).not.toContain('gap-1.5');
    expect(container.querySelector('[data-sidebar-branch-icon]')).toBeNull();
    expect(hoverCard?.textContent).toContain('feature/status');
    expect(hoverCard?.textContent).toContain('Base main');
    expect(hoverCard?.textContent).toContain('main');
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

  it('applies the sidebar status decoration classes in display and edit modes', async () => {
    await renderProgressCard({ statusMessage: 'Ready for review.' });
    const statusButton = screen.getByRole('button', { name: 'Edit workspace status' });
    const decoration = statusButton.parentElement?.querySelector<HTMLElement>(
      ':scope > [aria-hidden="true"]',
    );

    expect(decoration).toBeTruthy();
    expect(decoration!.className.split(/\s+/)).toEqual(
      expect.arrayContaining([
        '-inset-x-1',
        '-inset-y-0.5',
        'border-transparent',
        'bg-transparent',
        'motion-reduce:transition-none',
        'transition-[inset,border-color,background-color]',
      ]),
    );

    await fireEvent.click(statusButton);

    expect(decoration!.className.split(/\s+/)).toEqual(
      expect.arrayContaining([
        '-inset-x-2',
        '-inset-y-1.5',
        'border-ring/60',
        'bg-sidebar',
        'motion-reduce:transition-none',
        'transition-[inset,border-color,background-color]',
      ]),
    );
  });

  it('hides the status row when the active sidebar status is empty', async () => {
    await renderProgressCard({ statusMessage: undefined });

    expect(screen.queryByRole('button', { name: 'Add workspace status' })).toBeNull();
  });

  it('hides the status row when the active sidebar status is whitespace', async () => {
    await renderProgressCard({ statusMessage: '   ' });

    expect(screen.queryByRole('button', { name: 'Add workspace status' })).toBeNull();
  });

  it('does not render the View PR action under the status (the Changes launcher owns PR access)', async () => {
    mocks.progressActions.push({
      id: 'view-pr',
      label: 'View PR',
      iconKey: 'code-branch',
      tooltip: 'Open the pull request.',
      url: 'https://github.com/intent-hq/monorepo/pull/42',
    });
    const { container } = await renderProgressCard({
      statusMessage: 'A workspace description that used to be followed by the pull request action.',
    });

    expect(screen.getByRole('button', { name: 'Edit workspace status' })).toBeTruthy();
    expect(container.querySelector('[data-workspace-view-pr]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'View PR' })).toBeNull();
    expect(mocks.handleLink).not.toHaveBeenCalled();
  });

  it('hides empty task progress once canonical tasks are initialized', async () => {
    const { container } = await renderProgressCard();

    expect(container.querySelector('[data-workspace-task-progress]')).toBeNull();
  });

  it('reserves task progress as loading before canonical tasks initialize', async () => {
    mocks.taskState.initialized = false;
    const { container } = await renderProgressCard();

    expect(container.querySelector('[data-workspace-task-progress]')).toBeTruthy();
    expect(screen.getByTestId('mock-flame-graph').dataset.loading).toBe('true');
  });

  it('keeps the progress bar mounted across task refetches after initialization', async () => {
    mocks.taskState.progress = { total: 2, completed: 1, inProgress: 1 };
    const { container } = await renderProgressCard();

    const flameGraph = screen.getByTestId('mock-flame-graph');
    const progressBar = screen.getByTestId('mock-flame-progress');
    expect(flameGraph.dataset.loading).toBe('false');

    // Simulate an event-driven refetch after initialization: the slice's
    // loading flag flips false -> true (fetch in flight) -> false (settled).
    // The bar must never swap to its loading placeholder mid-refetch — that
    // remount is what replayed the entrance wipe.
    mocks.taskState.loading = true;
    mocks.notifySelectors();
    await tick();
    expect(screen.getByTestId('mock-flame-graph').dataset.loading).toBe('false');
    expect(container.querySelector('[data-testid="mock-flame-placeholder"]')).toBeNull();
    expect(screen.getByTestId('mock-flame-progress')).toBe(progressBar);

    // The refetch settles with an updated rollup; same elements, new data.
    mocks.taskState.loading = false;
    mocks.taskState.progress = { total: 2, completed: 2, inProgress: 0 };
    mocks.notifySelectors();
    await waitFor(() => {
      expect(screen.getByTestId('mock-flame-progress').dataset.progress).toBe('1');
    });
    expect(screen.getByTestId('mock-flame-graph')).toBe(flameGraph);
    expect(screen.getByTestId('mock-flame-progress')).toBe(progressBar);
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
    mocks.storeState.workspace.pendingTitleMutations = {};
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
