/**
 * @vitest-environment jsdom
 *
 * Checkout-mode repository metadata in WorkspaceProgressCard. The second
 * line stays limited to repository and branch text; checkout mode and disk
 * usage live in the repository hover card.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { Note, Workspace } from '$shared/types';
import { WorkspaceStatusEnum } from '$shared/types';
import { warmImport } from '../../../../../test/warm-import';
import {
  configuredVisualStates,
  exerciseVisualStates,
} from '$lib/components/__tests__/helpers/visual-state-characterization';

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

vi.mock('$store/renderer/slices/git/git-selectors', () => ({
  selectAcceptChangesStatus: mocks.selector(() => null),
  selectAcceptChangesStatusLoading: mocks.selector(() => false),
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

// The pill labels `cow` checkouts "CoW" only while effective CoW agent
// isolation is active (an async settings read). These tests cover pill
// placement, not label semantics (CheckoutModePill.test.ts does), so pin
// the resolver to the active-isolation outcome.
vi.mock('$lib/components/workspace/initializer/isolation-mode', () => ({
  isolationNoun: vi.fn(() => ''),
  resolveEffectiveIsolationMode: vi.fn().mockResolvedValue('cow'),
}));

async function renderProgressCard(
  overrides: Partial<Workspace> = {},
  props: { compact?: boolean } = {},
) {
  mocks.workspaceEntity = {
    ...mocks.workspaceEntity,
    status: WorkspaceStatusEnum.Active,
    checkoutMode: undefined,
    diskUsage: undefined,
    ...overrides,
  } as Workspace;
  const WorkspaceProgressCard = (await import('../WorkspaceProgressCard.svelte')).default;
  const result = render(WorkspaceProgressCard, {
    props: { workspaceId: mocks.workspaceEntity.id, ...props },
  });
  // Flush the pill's async isolation-mode label resolution + re-render.
  await tick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await tick();
  return result;
}

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../../../terminal/__tests__/mocks/MockButton.svelte'));
warmImport(() => import('./mocks/MockSimple.svelte'));
warmImport(() => import('./mocks/MockTooltip.svelte'));
warmImport(() => import('./mocks/MockTooltipRich.svelte'));
warmImport(() => import('./mocks/Fa.svelte'));
warmImport(() => import('../WorkspaceProgressCard.svelte'));

describe('WorkspaceProgressCard checkout mode in repository hover card', () => {
  beforeEach(() => {
    mocks.dispatch.mockClear();
    mocks.update.mockReset();
    mocks.notes.length = 0;
    mocks.update.mockImplementation(async () => ({ ok: true, data: mocks.workspaceEntity }));
  });

  it('affirms repository pill contrast in every required visual state', async () => {
    const observed = await exerciseVisualStates(async () => {
      const view = await renderProgressCard({ checkoutMode: 'cow' });
      const target = view.getByRole('button', { name: 'augment/intent' });
      return {
        ...view,
        target,
        assertCapability: () => {
          expect(
            view.container.querySelector('[data-checkout-mode-details]')?.textContent,
          ).toContain('Checkout mode: CoW');
          expect(
            view.container.querySelector('[data-sidebar-repository-branch-metadata]'),
          ).toBeTruthy();
        },
      };
    });
    expect(observed).toEqual(configuredVisualStates);
  });

  it.each([
    ['cow', 'cow', 'CoW'],
    ['worktree', 'worktree', 'Worktree'],
    ['direct', 'direct', 'Direct'],
  ] as const)(
    'renders %s mode inside the repository hover card',
    async (checkoutMode, mode, label) => {
      const { container } = await renderProgressCard({ checkoutMode });

      const metadata = container.querySelector('[data-sidebar-repository-branch-metadata]');
      const repositoryCard = container.querySelector('[data-sidebar-repository-hover-card]');
      const modeDetails = repositoryCard?.querySelector('[data-checkout-mode-details]');
      const modeIcon = repositoryCard?.querySelector('[data-checkout-mode-icon]');

      expect(modeDetails?.textContent).toContain(`Checkout mode: ${label}`);
      expect(modeIcon?.getAttribute('data-checkout-mode-icon')).toBe(mode);
      expect(metadata?.querySelector('[data-checkout-mode]')).toBeNull();
      expect(metadata?.querySelector('[data-sidebar-branch-icon]')).toBeNull();
      expect(
        screen.getByRole('button', { name: 'augment/intent' }).contains(modeDetails ?? null),
      ).toBe(false);
    },
  );

  it('omits checkout details when checkoutMode is missing', async () => {
    const { container } = await renderProgressCard({ checkoutMode: undefined });

    expect(container.querySelector('[data-checkout-mode-details]')).toBeNull();
    expect(screen.getByRole('button', { name: 'augment/intent' })).toBeTruthy();
  });
});

describe('WorkspaceProgressCard disk usage in repository hover flow', () => {
  const diskUsage = {
    bytes: 2_330_000_000,
    fileCount: 10,
    computedAt: '2026-08-01T12:00:00Z',
    breakdown: [{ name: 'repo', bytes: 2_330_000_000, fileCount: 10 }],
  };

  beforeEach(() => {
    mocks.dispatch.mockClear();
    mocks.update.mockReset();
    mocks.notes.length = 0;
    mocks.update.mockImplementation(async () => ({ ok: true, data: mocks.workspaceEntity }));
  });

  it('keeps size out of the second line and mode details in the repository card', async () => {
    const { container } = await renderProgressCard({ checkoutMode: 'cow', diskUsage });

    const metadata = container.querySelector('[data-sidebar-repository-branch-metadata]');
    const repositoryCard = container.querySelector('[data-sidebar-repository-hover-card]');
    expect(metadata?.querySelector('[data-checkout-mode]')).toBeNull();
    expect(repositoryCard?.textContent).toContain('Checkout mode: CoW');
    expect(screen.queryByText('2.17Gi')).toBeNull();
  });
});
