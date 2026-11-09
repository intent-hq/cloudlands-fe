// @vitest-environment jsdom
// @verify-changed-triggers: ../WorkspaceProgressCard.svelte

/**
 * Repository and branch actions in WorkspaceProgressCard: copy the workspace
 * path or branch name and load disk usage on demand.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, waitFor, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { Note, Workspace } from '$shared/types';
import { WorkspaceStatusEnum } from '$shared/types';
import type { WorkspaceProgressAction } from '$store/renderer/slices/workspace/workspace-types';
import { warmImport } from '../../../../../test/warm-import';

const mocks = vi.hoisted(() => {
  const dispatch = vi.fn();
  const update = vi.fn();
  const pollDiskUsage = vi.fn();
  const notes = [] as Note[];
  let progressActions: WorkspaceProgressAction[] = [];
  const workspaceEntity = {
    id: 'ws-1',
    title: 'Pill Workspace',
    branch: 'feature/pill',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: 'active',
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:00.000Z',
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
    pollDiskUsage,
    notes,
    workspaceEntity,
    readable,
    selector,
    get progressActions() {
      return progressActions;
    },
    set progressActions(value: WorkspaceProgressAction[]) {
      progressActions = value;
    },
  };
});

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => ({
      panelLayout: {
        byWorkspaceId: {
          'ws-1': { columnCount: 1 },
        },
      },
    }),
    dispatch: mocks.dispatch,
  });
});

vi.mock('$store/renderer/slices/guest-sessions/guest-sessions-selectors', () => ({
  selectCanLeaveWorkspace: mocks.selector(() => false),
  selectIsLeavingWorkspace: mocks.selector(() => false),
  selectWindowGuestSession: mocks.selector(() => null),
}));

vi.mock('$store/renderer/slices/guest-sessions/guest-sessions-slice', () => ({
  guestLeaveConfirmed: vi.fn((confirmation: unknown) => ({
    type: 'guestSessions/leaveConfirmed',
    payload: [confirmation],
  })),
  leaveGuestWorkspaceRequested: vi.fn((id: string, workspaceId: string) => ({
    type: 'guestSessions/leaveWorkspaceRequested',
    payload: [id, workspaceId],
  })),
}));

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectCanSetWorkspacePrimaryClient: mocks.selector(() => true),
  selectCanShareWorkspace: mocks.selector(() => false),
  selectWorkspaceById: mocks.selector(() => mocks.workspaceEntity),
  selectWorkspaceActivePullRequest: mocks.selector(() => null),
  selectWorkspaceProgressHeadline: mocks.selector(() => ({ headline: '', subtext: '' })),
  selectWorkspaceProgressActions: mocks.selector(() => mocks.progressActions),
  selectHidesOwnerWorkspaceActions: mocks.selector(() => false),
  selectHidesAgentLifecycleActions: mocks.selector(() => false),
}));

vi.mock('$store/renderer/slices/workspace-notes/workspace-notes-selectors', () => ({
  selectAllNotes: mocks.selector(() => mocks.notes),
}));

vi.mock('$store/renderer/slices/workspace-tasks/workspace-tasks-selectors', () => ({
  selectWorkspaceTasksInitialized: mocks.selector(() => true),
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

vi.mock('$store/renderer/slices/presence/presence-selectors', () => ({
  selectWorkspacePresencePeople: mocks.selector(() => []),
  selectWorkspacePresenceFocusTargets: mocks.selector(() => ({})),
}));

vi.mock('$store/renderer/slices/git/git-selectors', () => ({
  selectAcceptChangesStatus: mocks.selector(() => null),
  selectAcceptChangesStatusLoading: mocks.selector(() => false),
}));

vi.mock('$store/renderer/slices/workspace/workspace-slice', () => ({
  loadWorkspacesRequested: vi.fn(() => ({ type: 'workspace/loadWorkspacesRequested' })),
  removeWorkspaceEntity: Object.assign(
    vi.fn((id: string) => ({ type: 'workspace/removeWorkspaceEntity', payload: [id] })),
    { type: 'workspace/removeWorkspaceEntity' },
  ),
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
  requestArchiveWorkspace: vi.fn((id: string) => ({
    type: 'workspaceOperations/requestArchiveWorkspace',
    payload: [id],
  })),
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
vi.mock('$lib/components/workspace/shrink-workspace-action', () => ({
  runShrinkWorkspaceAction: vi.fn(),
  SHRINK_WORKSPACE_PROMPT: '',
}));

vi.mock('$lib/components/workspace/disk-usage-poll', () => ({
  pollWorkspaceDiskUsage: mocks.pollDiskUsage,
}));

async function renderProgressCard(overrides: Partial<Workspace> = {}) {
  mocks.workspaceEntity = {
    ...mocks.workspaceEntity,
    status: WorkspaceStatusEnum.Active,
    worktreePath: '/home/dev/worktrees/feature-pill',
    checkoutMode: undefined,
    ...overrides,
  } as Workspace;
  const WorkspaceProgressCard = (await import('../WorkspaceProgressCard.svelte')).default;
  const result = render(WorkspaceProgressCard, {
    props: { workspaceId: mocks.workspaceEntity.id },
  });
  await tick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await tick();
  return result;
}

function hoverTrigger(container: HTMLElement, label: string): HTMLElement {
  return within(container)
    .getAllByTestId('mock-tooltip-trigger')
    .find((trigger) => trigger.textContent?.trim() === label)!;
}

function hoverCard(container: HTMLElement, selector: string): HTMLElement {
  const card = container.querySelector<HTMLElement>(selector);
  expect(card, selector).not.toBeNull();
  return card!;
}

function hoverSurface(card: HTMLElement): HTMLElement {
  const surface = card.closest<HTMLElement>('[data-testid="mock-tooltip-content"]');
  expect(surface).not.toBeNull();
  return surface!;
}

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../../../terminal/__tests__/mocks/MockButton.svelte'));
warmImport(() => import('./mocks/MockSimple.svelte'));
warmImport(() => import('./mocks/MockTooltip.svelte'));
warmImport(() => import('./mocks/MockTooltipRich.svelte'));
warmImport(() => import('./mocks/Fa.svelte'));
warmImport(() => import('../WorkspaceProgressCard.svelte'));

describe('WorkspaceProgressCard repository actions', () => {
  const writeText = vi.fn<(text: string) => Promise<void>>();

  beforeEach(() => {
    mocks.dispatch.mockClear();
    mocks.update.mockReset();
    mocks.notes.length = 0;
    mocks.progressActions = [];
    mocks.update.mockImplementation(async () => ({ ok: true, data: mocks.workspaceEntity }));
    mocks.pollDiskUsage.mockReset();
    mocks.pollDiskUsage.mockResolvedValue({
      diskUsage: { bytes: 4096, breakdown: [] },
      refreshing: false,
    });
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  });

  afterEach(() => {});

  it('copies the workspace path and branch name from their hover triggers', async () => {
    const { container } = await renderProgressCard();
    const repositorySurface = hoverSurface(
      hoverCard(container, '[data-sidebar-repository-hover-card]'),
    );
    const branchSurface = hoverSurface(hoverCard(container, '[data-sidebar-branch-hover-card]'));
    expect(repositorySurface.getAttribute('data-open')).toBe('false');
    expect(branchSurface.getAttribute('data-open')).toBe('false');

    await fireEvent.click(hoverTrigger(container, 'augment/intent'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('/home/dev/worktrees/feature-pill'));
    await waitFor(() =>
      expect(
        within(hoverCard(container, '[data-sidebar-repository-hover-card]')).getByText('Copied'),
      ).toBeTruthy(),
    );
    // The copy handler holds the hover card open (bound `open`) to show the check.
    expect(repositorySurface.getAttribute('data-open')).toBe('true');

    await fireEvent.click(hoverTrigger(container, 'feature/pill'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('feature/pill'));
    await waitFor(() =>
      expect(
        within(hoverCard(container, '[data-sidebar-branch-hover-card]')).getByText('Copied'),
      ).toBeTruthy(),
    );
    expect(branchSurface.getAttribute('data-open')).toBe('true');
  });

  it('starts checkout disk-usage polling when the repository hover card opens', async () => {
    const { container } = await renderProgressCard({ checkoutMode: 'cow' });
    const repositoryCard = hoverCard(container, '[data-sidebar-repository-hover-card]');
    const repositorySurface = hoverSurface(repositoryCard);
    expect(repositoryCard.querySelector('[data-checkout-mode-details]')).not.toBeNull();
    expect(repositorySurface.getAttribute('data-open')).toBe('false');
    expect(mocks.pollDiskUsage).not.toHaveBeenCalled();

    await fireEvent.click(within(repositorySurface).getByTestId('mock-tooltip-hover-open'));

    expect(repositorySurface.getAttribute('data-open')).toBe('true');
    await waitFor(() => expect(mocks.pollDiskUsage).toHaveBeenCalledWith('ws-1'));
  });

  it('renders the hover-card path as a link-styled copy button', async () => {
    const { container } = await renderProgressCard();

    const repositoryCard = hoverCard(container, '[data-sidebar-repository-hover-card]');
    const pathButton = within(repositoryCard).getByRole('button', {
      name: 'Copy workspace path',
    });
    expect(pathButton.hasAttribute('data-sidebar-repository-path-copy')).toBe(true);
    expect(pathButton.getAttribute('variant')).toBe('plain');
    for (const className of ['underline', 'decoration-dotted', 'underline-offset-2']) {
      expect(pathButton.classList.contains(className), className).toBe(true);
    }
    const label = within(pathButton).getByText('/home/dev/worktrees/feature-pill');
    expect(label.classList.contains('truncate')).toBe(true);

    await fireEvent.click(pathButton);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('/home/dev/worktrees/feature-pill'));
  });

  it('omits the path copy button when the workspace has no path', async () => {
    const { container } = await renderProgressCard({
      worktreePath: undefined,
      repositoryPath: undefined,
    });

    expect(container.querySelector('[data-sidebar-repository-path-copy]')).toBeNull();
    expect(hoverCard(container, '[data-sidebar-repository-hover-card]')).toBeTruthy();
  });
});
