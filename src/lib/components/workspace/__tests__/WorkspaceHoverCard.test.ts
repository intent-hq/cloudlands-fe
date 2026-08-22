/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentSession, Workspace } from '$shared/types';
import { PullRequestStatus, WorkspaceStatusEnum } from '$shared/types';
import type { PrMonitorRow } from '$features/pr-monitor/pr-monitor-service';
import { warmImport } from '../../../../test/warm-import';

const mocks = vi.hoisted(() => {
  const dispatch = vi.fn();
  const streamingAgentIds: string[] = [];
  const agentSessionsByWorkspace: Record<string, AgentSession[]> = {};
  const tasksByWorkspace: Record<string, { id: string; title: string; status: string }[]> = {};
  const diffSummaryByWorkspace: Record<string, unknown> = {};
  const gitSummaryByWorkspace: Record<string, unknown> = {};
  const monitors: PrMonitorRow[] = [];
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
    agentSessionsByWorkspace,
    tasksByWorkspace,
    diffSummaryByWorkspace,
    gitSummaryByWorkspace,
    monitors,
    readable,
    createWorkspaceValueReadable,
    createWorkspaceSessionReadable,
  };
});

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceActivePullRequest: Object.assign(() => mocks.readable(null), {
    select: () => null,
  }),
}));

vi.mock('$store/renderer/slices/pr-monitor/pr-monitor-selectors', () => ({
  selectPrMonitors: vi.fn(() => mocks.readable(mocks.monitors)),
}));

vi.mock('$features/agent/services/active-streams-tracker', () => ({
  activeStreamsTracker: {
    subscribe: vi.fn(() => () => {}),
    getStreamingAgentIdsForWorkspace: vi.fn(() => mocks.streamingAgentIds),
  },
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => ({}),
    dispatch: mocks.dispatch,
  });
});

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

vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-slice', () => ({
  ensureAgentSessionLoaded: vi.fn((workspaceId: string, agentId: string) => ({
    type: 'workspaceAgents/ensureAgentSessionLoaded',
    payload: [workspaceId, agentId],
  })),
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
      mocks.createWorkspaceValueReadable((workspaceId: string) =>
        (mocks.tasksByWorkspace[workspaceId] ?? []).filter((task) => task.status !== 'cancelled'),
      ),
    ),
    selectWorkspaceTasksInitialized: vi.fn(mocks.createWorkspaceValueReadable(() => true)),
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

const baseWorkspace = {
  id: 'ws-1',
  title: 'Hover Card Workspace',
  branch: 'feature/hover-card',
  changesets: [],
  timeline: [],
  conversationInfo: [],
  status: WorkspaceStatusEnum.Active,
  displayStatus: 'idle',
  createdAt: '2026-05-05T00:00:00.000Z',
  updatedAt: '2026-05-05T00:00:00.000Z',
  lastActivity: '2026-05-05T19:00:00.000Z',
  repositoryOwner: 'augment',
  repositoryName: 'intent',
} as Workspace;

const ENSURE_AGENT_SESSION_LOADED = 'workspaceAgents/ensureAgentSessionLoaded';

async function renderHoverCard(
  overrides: Partial<Workspace> = {},
  lineStats?: { additions: number; deletions: number },
  props: {
    activeAgentIds?: string[];
    loadAgentSessions?: boolean;
    loadWorkspaceData?: boolean;
  } = {},
) {
  const WorkspaceHoverCard = (await import('../WorkspaceHoverCard.svelte')).default;
  const workspace = { ...baseWorkspace, ...overrides } as Workspace;
  return render(WorkspaceHoverCard, { props: { workspace, lineStats, ...props } });
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
  expect(summary.className).toContain('type-body');
  expect(summary.className).not.toContain('text-subtle');
}

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../sidebar/__tests__/mocks/MockSimple.svelte'));
warmImport(() => import('../WorkspaceHoverCard.svelte'));

function getEnsureSessionLoadPayloads() {
  return mocks.dispatch.mock.calls.flatMap(([action]) => {
    const dispatchedAction = action as { type?: string; payload?: unknown } | undefined;
    return dispatchedAction?.type === ENSURE_AGENT_SESSION_LOADED ? [dispatchedAction.payload] : [];
  });
}

async function waitForEnsureSessionLoads(expected: unknown[]) {
  await waitFor(() => expect(getEnsureSessionLoadPayloads()).toEqual(expected));
}

describe('WorkspaceHoverCard', () => {
  beforeEach(() => {
    mocks.dispatch.mockClear();
    mocks.streamingAgentIds.length = 0;
    mocks.monitors.length = 0;
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

  it('does not request unchanged member and running agent sessions again', async () => {
    const { rerender } = await renderHoverCard(
      { agentSummary: { agentIds: ['agent-member'] } },
      undefined,
      { activeAgentIds: ['agent-running'], loadWorkspaceData: false },
    );

    await waitForEnsureSessionLoads([
      ['ws-1', 'agent-member'],
      ['ws-1', 'agent-running'],
    ]);

    await rerender({
      workspace: { ...baseWorkspace, agentSummary: { agentIds: ['agent-member'] } },
      activeAgentIds: ['agent-running'],
      loadWorkspaceData: false,
    });
    await tick();

    expect(getEnsureSessionLoadPayloads()).toEqual([
      ['ws-1', 'agent-member'],
      ['ws-1', 'agent-running'],
    ]);
  });

  it('requests added agent IDs once and requests removed IDs when they become relevant again', async () => {
    const { rerender } = await renderHoverCard(
      { agentSummary: { agentIds: ['agent-a'] } },
      undefined,
      { loadWorkspaceData: false },
    );

    await waitForEnsureSessionLoads([['ws-1', 'agent-a']]);

    await rerender({
      workspace: { ...baseWorkspace, agentSummary: { agentIds: ['agent-a', 'agent-b'] } },
      loadWorkspaceData: false,
    });
    await waitForEnsureSessionLoads([
      ['ws-1', 'agent-a'],
      ['ws-1', 'agent-b'],
    ]);

    await rerender({
      workspace: { ...baseWorkspace, agentSummary: { agentIds: ['agent-b'] } },
      loadWorkspaceData: false,
    });
    await tick();
    expect(getEnsureSessionLoadPayloads()).toEqual([
      ['ws-1', 'agent-a'],
      ['ws-1', 'agent-b'],
    ]);

    await rerender({
      workspace: { ...baseWorkspace, agentSummary: { agentIds: ['agent-a', 'agent-b'] } },
      loadWorkspaceData: false,
    });
    await waitForEnsureSessionLoads([
      ['ws-1', 'agent-a'],
      ['ws-1', 'agent-b'],
      ['ws-1', 'agent-a'],
    ]);
  });

  it('requests relevant agent sessions again after a workspace change', async () => {
    const { rerender } = await renderHoverCard(
      { agentSummary: { agentIds: ['agent-shared'] } },
      undefined,
      { loadWorkspaceData: false },
    );

    await waitForEnsureSessionLoads([['ws-1', 'agent-shared']]);

    await rerender({
      workspace: { ...baseWorkspace, id: 'ws-2', agentSummary: { agentIds: ['agent-shared'] } },
      loadWorkspaceData: false,
    });

    await waitForEnsureSessionLoads([
      ['ws-1', 'agent-shared'],
      ['ws-2', 'agent-shared'],
    ]);
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
    expect(status.className).toContain('type-body');
    expect(status.className).toContain('whitespace-pre-wrap');
    expect(status.className).toContain('bg-transparent');
    expect(status.className).toContain('text-muted-foreground');
    expect(status.className).not.toMatch(/line-clamp|truncate|text-ellipsis/);
  });

  it('renders title, repository, and named semantic status as three ordered rows', async () => {
    const { container } = await renderHoverCard({ displayStatus: 'in_progress' });
    const header = container.querySelector('[data-workspace-hover-card-header]');
    const rows = header?.querySelectorAll(
      '[data-workspace-hover-card-title-row], [data-workspace-hover-card-repo-row], [data-workspace-hover-card-status-row]',
    );
    const statusRow = container.querySelector('[data-workspace-hover-card-status-row]');

    expect(rows).toHaveLength(3);
    expect([...rows!].map((row) => normalizedText(row))).toEqual([
      'Hover Card Workspace',
      'augment/intent',
      'In progress',
    ]);
    expect(statusRow?.querySelector('[data-workspace-status="in_progress"]')).toBeTruthy();
    expect(statusRow?.querySelector('[data-workspace-status]')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
  });

  it('keeps one shared workspace icon and named agent surfaces through live state changes', async () => {
    mocks.agentSessionsByWorkspace['ws-1'] = [
      {
        id: 'agent-running',
        name: 'Running Agent',
        status: 'running',
        messages: [],
      } as AgentSession,
      {
        id: 'agent-waiting',
        name: 'Waiting Agent',
        status: 'waiting',
        messages: [],
      } as AgentSession,
    ];

    const view = await renderHoverCard({
      displayStatus: 'in_progress',
      agentSummary: { agentIds: ['agent-running', 'agent-waiting'] },
    });
    const workspaceIcon = view.container.querySelector('[data-workspace-status]');
    const agentIcons = view.container.querySelectorAll('[data-agent-avatar-with-state]');

    expect(view.container.querySelectorAll('[data-workspace-status]')).toHaveLength(1);
    expect(workspaceIcon?.getAttribute('data-workspace-status')).toBe('in_progress');
    expect(workspaceIcon?.getAttribute('data-workspace-status-visual')).toBe('dot');
    expect(workspaceIcon?.getAttribute('data-workspace-status-icon')).toBeNull();
    expect(agentIcons).toHaveLength(2);
    expect([...agentIcons].map((icon) => icon.getAttribute('data-avatar-variant'))).toEqual([
      'standard',
      'standard',
    ]);
    expect([...agentIcons].map((icon) => icon.getAttribute('data-avatar-state'))).toEqual([
      'running',
      'waiting',
    ]);

    await view.rerender({
      workspace: { ...baseWorkspace, displayStatus: 'blocked' } as Workspace,
    });
    expect(view.container.querySelector('[data-workspace-status]')).toBe(workspaceIcon);
    expect(workspaceIcon?.getAttribute('data-workspace-status')).toBe('blocked');
    expect(workspaceIcon?.getAttribute('data-workspace-status-icon')).toBe('xmark');
  });

  it('uses named card-stack agent indicators for unread cover-card summaries', async () => {
    const { container } = await renderHoverCard({
      attention: 'unread',
      agentSummary: { agentIds: ['agent-unread-1', 'agent-unread-2'] },
    });

    const stack = container.querySelector('[data-workspace-hover-card-agent-stack]');
    const avatars = stack?.querySelectorAll('[data-agent-avatar-with-state]') ?? [];
    expect(avatars).toHaveLength(2);
    expect(
      [...avatars].every((avatar) => avatar.getAttribute('data-avatar-variant') === 'card-stack'),
    ).toBe(true);
    expect(
      [...avatars].every((avatar) => avatar.getAttribute('data-avatar-state') === 'unread'),
    ).toBe(true);
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
    expect(root.className.split(/\s+/)).toContain('bg-card');
    expect(root.className.split(/\s+/)).toContain('dark:bg-popover');
    expect(root.className).toContain('shadow-(--elevation-overlay)');
    expect(root.className).toContain('ring-1');
  });

  it('uses shared type roles for a clear content hierarchy', async () => {
    const { container } = await renderHoverCard({
      displayStatus: 'in_progress',
      statusMessage: 'Implementing the hover-card refinement.',
      activePullRequest: {
        id: 'pr-12',
        number: 12,
        url: 'https://github.com/augment/intent/pull/12',
        title: 'Refine hover-card hierarchy',
        status: PullRequestStatus.Open,
        createdAt: '2026-05-05T00:00:00.000Z',
        updatedAt: '2026-05-05T00:00:00.000Z',
      },
    });

    expect(screen.getByText('Hover Card Workspace').className).toContain('type-title');
    expect(screen.getByText('augment/intent').className).toContain('type-body');
    expect(container.querySelector('[data-workspace-hover-card-status-row]')?.className).toContain(
      'type-caption',
    );
    expect(
      container.querySelector('[data-workspace-hover-card-status-message]')?.className,
    ).toContain('type-body');
    expect(screen.getByText('Refine hover-card hierarchy').className).toContain('type-body');
    expect(screen.getByText('#12').className).toContain('type-caption');
    expect(container.querySelector('[data-workspace-hover-card-pr-status]')?.className).toContain(
      'type-caption',
    );
    expect(container.querySelector('[data-workspace-hover-card-timestamp]')?.className).toContain(
      'type-caption',
    );
  });

  it('summarizes available repo, task, PR, and combined change metadata without branch', async () => {
    mocks.streamingAgentIds.push('agent-2');
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
      attention: 'unread',
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
    const runningAgentList = screen.getByRole('list', { name: 'Running agents' });
    expect(runningAgentList.querySelectorAll('[role="listitem"]')).toHaveLength(2);
    expect(screen.getByText('Planner')).toBeTruthy();
    expect(screen.getByText('Implementor')).toBeTruthy();
    expect(screen.queryByText('3 agents · 2 active · 1 running · 1 unread')).toBeNull();
    const prList = screen.getByRole('list', { name: 'Pull request' });
    expect(prList.className).toContain('gap-1');
    expect(prList.className).toContain('py-0.5');
    expect(screen.getByText('Add hover card')).toBeTruthy();
    expect(screen.getByText('#12')).toBeTruthy();
    expect(screen.getByText(/checks running/).className).toContain('text-success');
    expect(screen.queryByText('Git')).toBeNull();
    expectVisibleChangesRow('3 files +42 -7, +2 -1');
  });

  it('lists every unique PR with shared state colors and cross-repo context', async () => {
    mocks.monitors.push(
      {
        monitorId: 'duplicate',
        workspaceId: 'ws-1',
        agentId: 'agent-1',
        repo: 'augment/intent',
        prNumber: 12,
        state: 'active',
        title: 'Duplicate monitor',
        url: 'https://github.com/augment/intent/pull/12',
        pendingChanges: [],
        hasPendingChanges: false,
        createdAt: '2026-05-05T00:00:00.000Z',
        updatedAt: '2026-05-05T00:00:00.000Z',
      },
      {
        monitorId: 'cross-repo',
        workspaceId: 'ws-1',
        agentId: 'agent-2',
        repo: 'other-org/tooling',
        prNumber: 12,
        state: 'active',
        title: 'Cross-repo monitor',
        url: 'https://github.com/other-org/tooling/pull/12',
        pendingChanges: [],
        hasPendingChanges: false,
        createdAt: '2026-05-06T00:00:00.000Z',
        updatedAt: '2026-05-06T00:00:00.000Z',
      },
    );

    const { container } = await renderHoverCard({
      pullRequests: [
        {
          id: 'pr-12',
          number: 12,
          url: 'https://github.com/augment/intent/pull/12',
          title: 'Open workspace PR',
          status: PullRequestStatus.Open,
          createdAt: '2026-05-05T00:00:00.000Z',
          updatedAt: '2026-05-05T00:00:00.000Z',
        },
        {
          id: 'pr-13',
          number: 13,
          url: 'https://github.com/augment/intent/pull/13',
          title: 'Merged workspace PR',
          status: PullRequestStatus.Merged,
          createdAt: '2026-05-04T00:00:00.000Z',
          updatedAt: '2026-05-07T00:00:00.000Z',
        },
      ],
    });

    const rows = [...container.querySelectorAll('[data-workspace-hover-card-pr-row]')];
    expect(rows.map((row) => row.getAttribute('data-pr-identity'))).toEqual([
      'other-org/tooling#12',
      'augment/intent#12',
      'augment/intent#13',
    ]);
    expect(rows.every((row) => row.querySelector('svg') === null)).toBe(true);
    expect(rows.every((row) => row.querySelector('[aria-hidden="true"]') === null)).toBe(true);
    expect(rows[0].querySelector('[data-workspace-hover-card-pr-status]')?.className).toContain(
      'text-success',
    );
    expect(rows[2].querySelector('[data-workspace-hover-card-pr-status]')?.className).toContain(
      'text-primary',
    );
    expect(screen.getByText('other-org/tooling')).toBeTruthy();
    expect(screen.getByText('Cross-repo monitor')).toBeTruthy();
    expect(rows.every((row) => row.getAttribute('aria-label')?.includes('#'))).toBe(true);
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
  ])(
    'formats git-only summary copy without labels or middle dots',
    async (gitSummary, expected) => {
      mocks.gitSummaryByWorkspace['ws-1'] = gitSummary;

      const { container } = await renderHoverCard();

      expect(screen.queryByText('Git')).toBeNull();
      expectVisibleChangesRow(expected);
      expect(container.textContent).not.toContain(' · ');
    },
  );

  it('renders line-stat-only local changes as a visible summary row', async () => {
    const { container } = await renderHoverCard({}, { additions: 2, deletions: 1 });

    expectVisibleChangesRow('Local changes +2 -1');
    expect(screen.queryByText('Git')).toBeNull();
    expect(container.textContent).not.toContain(' · ');
  });

  it('renders running and background agent statuses as compact rows', async () => {
    mocks.agentSessionsByWorkspace['ws-1'] = [
      {
        id: 'agent-running',
        name: 'Running Agent',
        status: 'running',
        messages: [],
      } as AgentSession,
      {
        id: 'agent-background',
        name: 'Worker Agent',
        status: 'background',
        messages: [],
      } as AgentSession,
      {
        id: 'agent-waiting',
        name: 'Waiting Agent',
        status: 'waiting',
        messages: [],
      } as AgentSession,
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
