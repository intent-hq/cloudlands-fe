/**
 * @vitest-environment jsdom
 *
 * Checkout-mode pill visibility in WorkspaceProgressCard. The pill
 * renders "CoW" / "Worktree" next to the org/repo subtitle in both the full
 * (sidebar) and compact (homepage card) variants, and renders nothing for
 * direct workspaces (`checkoutMode` absent). It must sit outside the
 * copy-on-click repo button so the copy affordance is preserved.
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  vi,
} from 'vitest';
import { render, screen } from '@testing-library/svelte';
import type { Note, Workspace } from '$shared/types';
import { WorkspaceStatusEnum } from '$shared/types';

const mocks = vi.hoisted(() => {
  const dispatch = vi.fn();
  const update = vi.fn();
  const notes = [] as Note[];
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

async function renderProgressCard(
  overrides: Partial<Workspace> = {},
  props: { compact?: boolean } = {},
) {
  mocks.workspaceEntity = {
    ...mocks.workspaceEntity,
    status: WorkspaceStatusEnum.Active,
    checkoutMode: undefined,
    ...overrides,
  } as Workspace;
  const WorkspaceProgressCard = (await import('../WorkspaceProgressCard.svelte')).default;
  return render(WorkspaceProgressCard, {
    props: { workspaceId: mocks.workspaceEntity.id, ...props },
  });
}

describe('WorkspaceProgressCard checkout-mode pill', () => {
  beforeEach(() => {
    mocks.dispatch.mockClear();
    mocks.update.mockReset();
    mocks.notes.length = 0;
    mocks.update.mockImplementation(async () => ({ ok: true, data: mocks.workspaceEntity }));
  });

  it('renders "CoW" beside the repo text, outside the copy button (full mode)', async () => {
    await renderProgressCard({ checkoutMode: 'cow' });

    const pill = screen.getByText('CoW');
    expect(pill).toBeTruthy();

    const repoButton = screen.getByRole('button', { name: 'augment/intent' });
    expect(repoButton.contains(pill)).toBe(false);
  });

  it('renders "Worktree" when checkoutMode is worktree (full mode)', async () => {
    await renderProgressCard({ checkoutMode: 'worktree' });

    expect(screen.getByText('Worktree')).toBeTruthy();
  });

  it('renders no pill when checkoutMode is undefined (full mode)', async () => {
    await renderProgressCard({ checkoutMode: undefined });

    expect(screen.queryByText('CoW')).toBeNull();
    expect(screen.queryByText('Worktree')).toBeNull();
    expect(screen.getByRole('button', { name: 'augment/intent' })).toBeTruthy();
  });

  it('renders "CoW" beside the repo text, outside the copy button (compact mode)', async () => {
    await renderProgressCard({ checkoutMode: 'cow' }, { compact: true });

    const pill = screen.getByText('CoW');
    expect(pill).toBeTruthy();

    const repoButton = screen.getByRole('button', { name: 'augment/intent' });
    expect(repoButton.contains(pill)).toBe(false);
  });

  it('renders no pill in compact mode for direct workspaces', async () => {
    await renderProgressCard({ checkoutMode: undefined }, { compact: true });

    expect(screen.queryByText('CoW')).toBeNull();
    expect(screen.queryByText('Worktree')).toBeNull();
  });
});
