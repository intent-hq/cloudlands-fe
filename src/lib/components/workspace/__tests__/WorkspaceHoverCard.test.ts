/**
 * @vitest-environment jsdom
 */
import {
  render,
  screen,
  waitFor,
} from '@testing-library/svelte';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { AgentSession, Workspace } from '$shared/types';
import {
  PullRequestStatus,
  WorkspaceStatusEnum,
} from '$shared/types';

const mocks = vi.hoisted(() => {
  const dispatch = vi.fn();
  const streamingAgentIds: string[] = [];
  const unreadAgentIds: string[] = [];
  const agentSessionsByWorkspace: Record<string, AgentSession[]> = {};
  const tasksByWorkspace: Record<string, { id: string; title: string; status: string }[]> = {};
  const diffSummaryByWorkspace: Record<string, unknown> = {};
  const gitSummaryByWorkspace: Record<string, unknown> = {};
  const readable = <T>(value: T) => ({
    subscribe(run: (value: T) => void) {
      run(value);
      return () => {};
    },
  });
  const createWorkspaceValueReadable =
    <T>(resolve: (workspaceId: string) => T) =>
    (workspaceIdArg: string | { subscribe: (run: (value: string) => void) => () => void }) => {
      if (workspaceIdArg && typeof workspaceIdArg === 'object' && 'subscribe' in workspaceIdArg) {
        return {
          subscribe(run: (value: T) => void) {
            return workspaceIdArg.subscribe((workspaceId) => run(resolve(workspaceId)));
          },
        };
      }
      return readable(resolve(workspaceIdArg));
    };
  const createWorkspaceSessionReadable = createWorkspaceValueReadable(
    (workspaceId: string) => agentSessionsByWorkspace[workspaceId] ?? [],
  );
  return {
    dispatch,
    streamingAgentIds,
    unreadAgentIds,
    agentSessionsByWorkspace,
    tasksByWorkspace,
    diffSummaryByWorkspace,
    gitSummaryByWorkspace,
    readable,
    createWorkspaceValueReadable,
    createWorkspaceSessionReadable,
  };
});

vi.mock('$features/agent/services/active-streams-tracker', () => ({
  activeStreamsTracker: {
    subscribe: vi.fn(() => () => {}),
    getStreamingAgentIdsForWorkspace: vi.fn(() => mocks.streamingAgentIds),
  },
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import('$store/renderer/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => ({}),
    dispatch: mocks.dispatch,
  });
});

vi.mock('$store/renderer/slices/unread-tracking/unread-tracking-selectors', () => ({
  selectUnreadAgentIds: vi.fn(() => mocks.readable(mocks.unreadAgentIds)),
  selectUnreadAgentIdsForWorkspace: { select: vi.fn(() => mocks.unreadAgentIds) },
}));

vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-selectors', () => ({
  selectAllWorkspaceAgents: vi.fn(mocks.createWorkspaceSessionReadable),
}));

vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-selectors', () => ({
  selectAllWorkspaceAgents: Object.assign(vi.fn(mocks.createWorkspaceSessionReadable), {
    select: vi.fn(
      (_state: unknown, workspaceId: string) => mocks.agentSessionsByWorkspace[workspaceId] ?? [],
    ),
  }),
}));

vi.mock('$store/renderer/slices/workspace-tasks/workspace-tasks-selectors', () => {
  const taskProgress = (workspaceId: string) => {
    const tasks = mocks.tasksByWorkspace[workspaceId] ?? [];
    let total = 0;
    let completed = 0;
    let inProgress = 0;
    for (const task of tasks) {
      if (task.status === 'cancelled') continue;
      total++;
      if (task.status === 'complete') completed++;
      else if (task.status === 'in_progress' || task.status === 'review_required') inProgress++;
    }
    return { total, completed, inProgress };
  };
  return {
    selectWorkspaceTaskProgress: vi.fn(mocks.createWorkspaceValueReadable(taskProgress)),
    selectWorkspaceTaskDisplayList: vi.fn(
      mocks.createWorkspaceValueReadable(
        (workspaceId: string) =>
          (mocks.tasksByWorkspace[workspaceId] ?? []).filter((task) => task.status !== 'cancelled'),
      ),
    ),
  };
});

vi.mock('$store/renderer/slices/workspace-summaries/workspace-summaries-selectors', () => ({
  selectWorkspaceDiffSummary: vi.fn(
    mocks.createWorkspaceValueReadable(
      (workspaceId: string) => mocks.diffSummaryByWorkspace[workspaceId] ?? null,
    ),
  ),
  selectWorkspaceGitSummary: vi.fn(
    mocks.createWorkspaceValueReadable(
      (workspaceId: string) => mocks.gitSummaryByWorkspace[workspaceId] ?? null,
    ),
  ),
}));

vi.mock('$lib/components/ui/auggie-avatar/AugieAvatarWithState.svelte', async () => ({
  default: (await import('../sidebar/__tests__/mocks/MockSimple.svelte')).default,
}));

const baseWorkspace = {
  id: 'ws-1',
  title: 'Hover Card Workspace',
  branch: 'feature/hover-card',
  changesets: [],
  timeline: [],
  conversationInfo: [],
  status: WorkspaceStatusEnum.Active,
  createdAt: '2026-05-05T00:00:00.000Z',
  updatedAt: '2026-05-05T00:00:00.000Z',
  lastActivity: '2026-05-05T19:00:00.000Z',
  repositoryOwner: 'augment',
  repositoryName: 'intent',
} as Workspace;

async function renderHoverCard(
  overrides: Partial<Workspace> = {},
  lineStats?: { additions: number; deletions: number },
) {
  const WorkspaceHoverCard = (await import('../WorkspaceHoverCard.svelte')).default;
  const workspace = { ...baseWorkspace, ...overrides } as Workspace;
  return render(WorkspaceHoverCard, { props: { workspace, lineStats } });
}

function normalizedText(element: Element) {
  return element.textContent?.replace(/\s+/g, ' ').trim();
}

function expectVisibleChangesRow(expected: string) {
  const row = screen.getByLabelText('Workspace changes');
  expect(normalizedText(row)).toBe(expected);
  expect(row.className).toContain('w-full');
  expect(row.className).toContain('py-0.5');

  const summary = screen.getByText(expected);
  expect(summary.className).toContain('text-foreground');
  expect(summary.className).toContain('font-medium');
  expect(summary.className).not.toContain('text-subtle');
}

describe('WorkspaceHoverCard', () => {
  beforeEach(() => {
    mocks.dispatch.mockClear();
    mocks.streamingAgentIds.length = 0;
    mocks.unreadAgentIds.length = 0;
    for (const record of [
      mocks.agentSessionsByWorkspace,
      mocks.tasksByWorkspace,
      mocks.diffSummaryByWorkspace,
      mocks.gitSummaryByWorkspace,
    ]) {
      for (const workspaceId of Object.keys(record)) {
        delete record[workspaceId];
      }
    }
  });

  it('updates loaded agent sessions when the workspace id changes after initial null', async () => {
    mocks.agentSessionsByWorkspace['ws-2'] = [
      {
        id: 'agent-ws-2',
        name: 'Loaded Workspace Agent',
        status: 'running',
        updatedAt: '2026-05-05T19:00:00.000Z',
        messages: [],
      } as AgentSession,
    ];

    const WorkspaceHoverCard = (await import('../WorkspaceHoverCard.svelte')).default;
    const { rerender } = render(WorkspaceHoverCard, { props: { workspace: null } });

    expect(screen.queryByText('Loaded Workspace Agent')).toBeNull();

    await rerender({ workspace: { ...baseWorkspace, id: 'ws-2' } });

    await waitFor(() => expect(screen.getByText('Loaded Workspace Agent')).toBeTruthy());
  });

  it('renders live session names and statuses for member agent IDs', async () => {
    mocks.agentSessionsByWorkspace['ws-1'] = [
      {
        id: 'agent-duplicate',
        status: 'processing',
        messages: [],
      } as AgentSession,
      {
        id: 'agent-live-name',
        name: 'Live Named Agent',
        status: 'processing',
        messages: [],
      } as AgentSession,
    ];

    await renderHoverCard({
      agentSummary: {
        agentIds: ['agent-duplicate', 'agent-live-name', 'agent-unloaded'],
      },
    });

    // Loaded sessions provide names/statuses; the unloaded member renders as
    // an idle placeholder and is excluded from the running agent list.
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(screen.getByText('Live Named Agent')).toBeTruthy();
    expect(rows[0].getAttribute('aria-label')).toContain('Processing');
    expect(rows[0].getAttribute('aria-label')).not.toContain('Waiting');
  });

  it('renders the workspace status message prominently without truncation classes', async () => {
    await renderHoverCard({
      statusMessage: 'Reviewing the richer workspace hover card before wiring it into lists.',
    });

    const status = screen.getByText(
      'Reviewing the richer workspace hover card before wiring it into lists.',
    );
    expect(status.className).toContain('whitespace-pre-wrap');
    expect(status.className).toContain('leading-snug');
    expect(status.className).toContain('bg-transparent');
    expect(status.className).toContain('text-subtle');
    expect(status.className).not.toMatch(/line-clamp|truncate|text-ellipsis/);
  });

  it('does not render status placeholder text when the workspace status message is empty', async () => {
    const { container } = await renderHoverCard({ statusMessage: '   ' });

    expect(container.textContent).not.toContain('Add status');
    expect(container.textContent).not.toContain('Add workspace status');
  });

  it('uses unbordered square elevated styling', async () => {
    const { container } = await renderHoverCard();

    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('w-[320px]');
    expect(root.className).toContain('shrink-0');
    expect(root.className).toContain('max-w-[calc(100vw-1rem)]');
    expect(root.className).not.toMatch(/min-w-\[/);
    expect(root.className.split(/\s+/)).not.toContain('border');
    expect(root.className.split(/\s+/)).not.toContain('border-border');
    expect(root.className).not.toMatch(/rounded/);
    expect(root.className).toContain('shadow-2xl');
    expect(root.className).toContain('ring-1');
  });

  it('summarizes available repo, task, PR, and combined change metadata without branch', async () => {
    mocks.streamingAgentIds.push('agent-2');
    mocks.unreadAgentIds.push('agent-3');
    mocks.agentSessionsByWorkspace['ws-1'] = [
      { id: 'agent-1', name: 'Planner', status: 'active', messages: [] } as AgentSession,
      { id: 'agent-2', name: 'Implementor', status: 'processing', messages: [] } as AgentSession,
      { id: 'agent-3', name: 'Verifier', status: 'idle', messages: [] } as AgentSession,
    ];
    mocks.tasksByWorkspace['ws-1'] = [
      { id: 't-1', title: 'Task 1', status: 'complete' },
      { id: 't-2', title: 'Task 2', status: 'complete' },
      { id: 't-3', title: 'Task 3', status: 'in_progress' },
      { id: 't-4', title: 'Task 4', status: 'not_started' },
      { id: 't-5', title: 'Task 5', status: 'not_started' },
    ];
    mocks.gitSummaryByWorkspace['ws-1'] = { ahead: 2, behind: 1, hasUnpushed: true };
    mocks.diffSummaryByWorkspace['ws-1'] = {
      schemaVersion: 1,
      updatedAt: '2026-05-05T19:00:00.000Z',
      totalFiles: 3,
      totalAdditions: 42,
      totalDeletions: 7,
      files: [],
    };

    await renderHoverCard({
      agentSummary: { agentIds: ['agent-1', 'agent-2', 'agent-3'] },
      activePullRequest: {
        id: 'pr-12',
        number: 12,
        url: 'https://github.com/augment/intent/pull/12',
        title: 'Add hover card',
        status: PullRequestStatus.Open,
        createdAt: '2026-05-05T00:00:00.000Z',
        updatedAt: '2026-05-05T00:00:00.000Z',
        ciStatus: { total: 4, passed: 3, failed: 0, pending: 1 },
      },
    });

    expect(screen.getByText('Hover Card Workspace')).toBeTruthy();
    expect(screen.getByText('augment/intent')).toBeTruthy();
    expect(screen.queryByText('feature/hover-card')).toBeNull();
    expect(screen.queryByText('Active')).toBeNull();
    expect(screen.getByLabelText('Workspace task progress')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Running agents' })).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Planner')).toBeTruthy();
    expect(screen.getByText('Implementor')).toBeTruthy();
    expect(screen.queryByText('3 agents · 2 active · 1 running · 1 unread')).toBeNull();
    const prRow = screen.getByLabelText('Pull request');
    expect(prRow.className).toContain('gap-2');
    expect(prRow.className).toContain('py-0.5');
    expect(screen.getByText('Add hover card')).toBeTruthy();
    expect(screen.getByText('#12')).toBeTruthy();
    expect(screen.getByText('CI pending').className).toContain('text-amber-500');
    expect(screen.queryByText('Git')).toBeNull();
    expectVisibleChangesRow('3 files +42 -7, +2 -1');
  });

  it.each([
    [{ ahead: 2, behind: 0, hasUnpushed: true }, '3 files +42 -7, 2 commits ahead remote'],
    [{ ahead: 0, behind: 1, hasUnpushed: false }, '3 files +42 -7, 1 commit behind remote'],
    [{ ahead: 0, behind: 0, hasUnpushed: true }, '3 files +42 -7, Local commits not pushed'],
  ])('combines local changes with git summary copy', async (gitSummary, expected) => {
    mocks.gitSummaryByWorkspace['ws-1'] = gitSummary;
    mocks.diffSummaryByWorkspace['ws-1'] = {
      schemaVersion: 1,
      updatedAt: '2026-05-05T19:00:00.000Z',
      totalFiles: 3,
      totalAdditions: 42,
      totalDeletions: 7,
      files: [],
    };

    const { container } = await renderHoverCard();

    expect(screen.queryByText('Git')).toBeNull();
    expectVisibleChangesRow(expected);
    expect(container.textContent).not.toContain(' · ');
  });

  it.each([
    [{ ahead: 1, behind: 0, hasUnpushed: true }, '1 commit ahead remote'],
    [{ ahead: 2, behind: 0, hasUnpushed: true }, '2 commits ahead remote'],
    [{ ahead: 0, behind: 1, hasUnpushed: false }, '1 commit behind remote'],
    [{ ahead: 0, behind: 2, hasUnpushed: false }, '2 commits behind remote'],
    [{ ahead: 3, behind: 1, hasUnpushed: true }, '+3 -1'],
    [{ ahead: 0, behind: 0, hasUnpushed: true }, 'Local commits not pushed'],
  ])('formats git-only summary copy without labels or middle dots', async (gitSummary, expected) => {
    mocks.gitSummaryByWorkspace['ws-1'] = gitSummary;

    const { container } = await renderHoverCard();

    expect(screen.queryByText('Git')).toBeNull();
    expectVisibleChangesRow(expected);
    expect(container.textContent).not.toContain(' · ');
  });

  it('renders line-stat-only local changes as a visible summary row', async () => {
    const { container } = await renderHoverCard({}, { additions: 2, deletions: 1 });

    expectVisibleChangesRow('Local changes +2 -1');
    expect(screen.queryByText('Git')).toBeNull();
    expect(container.textContent).not.toContain(' · ');
  });

  it('renders running and background agent statuses as compact rows', async () => {
    mocks.agentSessionsByWorkspace['ws-1'] = [
      { id: 'agent-running', name: 'Running Agent', status: 'running', messages: [] } as AgentSession,
      { id: 'agent-background', name: 'Worker Agent', status: 'background', messages: [] } as AgentSession,
      { id: 'agent-waiting', name: 'Waiting Agent', status: 'waiting', messages: [] } as AgentSession,
    ];

    await renderHoverCard({
      agentSummary: { agentIds: ['agent-running', 'agent-background', 'agent-waiting'] },
    });

    expect(screen.getByRole('list', { name: 'Running agents' })).toBeTruthy();
    const agentRows = screen.getAllByRole('listitem');
    expect(agentRows).toHaveLength(3);
    expect(screen.getByText('Running Agent')).toBeTruthy();
    expect(screen.getByText('Worker Agent')).toBeTruthy();
    expect(screen.getByText('Waiting Agent')).toBeTruthy();
    expect(agentRows[1].getAttribute('aria-label')).toBe('Worker Agent Running');
    expect(screen.queryByText('Background')).toBeNull();
    expect(screen.queryByText('3 agents · 3 active')).toBeNull();
    expect(screen.queryByText('Active')).toBeNull();
  });

  it('degrades cleanly when optional metadata is absent', async () => {
    const { container } = await renderHoverCard({
      repositoryOwner: undefined,
      repositoryName: undefined,
      statusMessage: undefined,
    });

    expect(screen.getByText('Hover Card Workspace')).toBeTruthy();
    expect(screen.getByText('Local repository')).toBeTruthy();
    expect(container.textContent).not.toContain('undefined');
    expect(container.textContent).not.toContain('null');
    expect(screen.queryByText('Agents')).toBeNull();
    expect(screen.queryByText('Tasks')).toBeNull();
    expect(screen.queryByText('PR')).toBeNull();
    expect(screen.queryByText('Git')).toBeNull();
  });
});
