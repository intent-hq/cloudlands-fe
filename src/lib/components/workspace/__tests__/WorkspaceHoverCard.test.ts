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
import workspaceCardSource from '../WorkspaceCard.svelte?raw';

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

  it('keeps loading and null inputs mutually exclusive with loaded content', async () => {
    const WorkspaceHoverCard = (await import('../WorkspaceHoverCard.svelte')).default;
    const view = render(WorkspaceHoverCard, {
      props: { workspace: null, isLoading: true, loadWorkspaceData: false },
    });

    expect(view.container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(3);
    expect(view.container.querySelector('[data-workspace-hover-card-status-row]')).toBeNull();

    await view.rerender({ workspace: null, isLoading: false, loadWorkspaceData: false });
    expect(view.container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(1);

    await view.rerender({ workspace: baseWorkspace, isLoading: false, loadWorkspaceData: false });
    expect(view.container.querySelector('[data-slot="skeleton"]')).toBeNull();
    expect(view.container.querySelector('[data-workspace-hover-card-status-row]')).toBeTruthy();
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
    expect(rows[0].getAttribute('aria-label')).toContain('In progress');
    expect(rows[0].getAttribute('aria-label')).not.toContain('Waiting');
  });

  it('clamps long workspace descriptions to three lines without forcing short copy taller', async () => {
    const description =
      'Reviewing the richer workspace hover card before wiring it into wide and narrow layouts without allowing the description to overflow.';
    await renderHoverCard({
      statusMessage: description,
    });

    const status = screen.getByText(description);
    expect(status.className).toContain('type-body');
    expect(status.className).toContain('min-w-0');
    expect(status.className).toContain('w-full');
    expect(status.className).toContain('line-clamp-3');
    expect(status.className).not.toContain('truncate');
    expect(status.className).not.toMatch(/(?:^|\s)(?:h|min-h|max-h)-/);
    expect(status.className).toContain('leading-snug');
    expect(status.className).toContain('bg-transparent');
    expect(status.className).toContain('text-subtle');
    expect(status.className).not.toContain('overflow-y-auto');
    expect(status.getAttribute('title')).toBe(description);
  });

  it('renders identity on the left and the normally cased semantic status only on the right', async () => {
    const { container } = await renderHoverCard({ displayStatus: 'in_progress' });
    const header = container.querySelector('[data-workspace-hover-card-header]');
    const rows = header?.querySelectorAll(
      '[data-workspace-hover-card-title-row], [data-workspace-hover-card-repo-row]',
    );
    const identity = container.querySelector('[data-workspace-hover-card-identity]');
    const activity = container.querySelector('[data-workspace-hover-card-activity]');
    const statusRow = container.querySelector('[data-workspace-hover-card-status-row]');

    expect(rows).toHaveLength(2);
    expect([...rows!].map((row) => normalizedText(row))).toEqual([
      'Hover Card Workspace',
      'augment/intent',
    ]);
    expect(identity?.querySelector('[data-workspace-hover-card-status-row]')).toBeNull();
    expect(activity?.querySelector('[data-workspace-hover-card-status-row]')).toBe(statusRow);
    expect(normalizedText(statusRow!)).toBe('In progress');
    expect(statusRow?.lastElementChild?.className).toContain('normal-case');
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
    expect(workspaceIcon?.className).toContain('text-foreground');
    expect(workspaceIcon?.className).not.toMatch(/text-(?:destructive|muted-foreground|subtle)/);
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

  it('marks only top-level members as unread when the summary carries delegation parents', async () => {
    const { container } = await renderHoverCard({
      attention: 'unread',
      agentSummary: {
        agentIds: ['agent-root', 'agent-child'],
        agents: [
          { id: 'agent-root', name: 'Coordinator', status: 'idle' },
          { id: 'agent-child', name: 'Implementor', status: 'idle', parentAgentId: 'agent-root' },
        ],
      } as Workspace['agentSummary'],
    });

    const stack = container.querySelector('[data-workspace-hover-card-agent-stack]');
    const items = stack?.querySelectorAll('[data-agent-avatar-stack-item]') ?? [];
    expect(items).toHaveLength(1);
    expect(items[0]?.getAttribute('data-agent-avatar-stack-agent-id')).toBe('agent-root');
    expect(
      items[0]?.querySelector('[data-agent-avatar-with-state]')?.getAttribute('data-avatar-state'),
    ).toBe('unread');
  });

  it('prefers loaded session unread state and suppresses background and delegated sessions', async () => {
    mocks.agentSessionsByWorkspace['ws-1'] = [
      {
        id: 'agent-seen-root',
        name: 'Seen Root',
        status: 'idle',
        hasUnread: false,
        messages: [],
      } as AgentSession,
      {
        id: 'agent-background',
        name: 'Background Agent',
        status: 'idle',
        isBackground: true,
        messages: [],
      } as AgentSession,
      {
        id: 'agent-delegated',
        name: 'Delegated Agent',
        status: 'idle',
        metadata: { createdByAgentId: 'agent-seen-root' },
        messages: [],
      } as AgentSession,
    ];

    const { container } = await renderHoverCard({
      attention: 'unread',
      agentSummary: {
        agentIds: ['agent-seen-root', 'agent-background', 'agent-delegated', 'agent-unloaded'],
      },
    });

    const stack = container.querySelector('[data-workspace-hover-card-agent-stack]');
    const items = stack?.querySelectorAll('[data-agent-avatar-stack-item]') ?? [];
    expect(items).toHaveLength(1);
    expect(items[0]?.getAttribute('data-agent-avatar-stack-agent-id')).toBe('agent-unloaded');
  });

  it('does not repeat a streaming agent in the unread stack', async () => {
    mocks.streamingAgentIds.push('agent-streaming');
    const { container } = await renderHoverCard({
      attention: 'unread',
      agentSummary: { agentIds: ['agent-streaming', 'agent-unread'] },
    });

    const stack = container.querySelector('[data-workspace-hover-card-agent-stack]');
    const avatars = stack?.querySelectorAll('[data-agent-avatar-with-state]') ?? [];
    expect(avatars).toHaveLength(1);
    expect(avatars[0]?.getAttribute('data-avatar-state')).toBe('unread');
    expect(
      stack
        ?.querySelector('[data-agent-avatar-stack-item]')
        ?.getAttribute('data-agent-avatar-stack-agent-id'),
    ).toBe('agent-unread');
  });

  it('does not render status placeholder text when the workspace status message is empty', async () => {
    const { container } = await renderHoverCard({ statusMessage: '   ' });

    expect(container.textContent).not.toContain('Add status');
    expect(container.textContent).not.toContain('Add workspace status');
  });

  it('uses a neutral rounded elevated two-column shell', async () => {
    const { container } = await renderHoverCard();

    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute('data-workspace-hover-card-layout')).toBe('two-column');
    expect(root.className).toContain('shrink-0');
    expect(root.className).toContain('overflow-hidden');
    expect(root.className.split(/\s+/)).not.toContain('border');
    expect(root.className.split(/\s+/)).not.toContain('border-border');
    expect(root.className.split(/\s+/)).toContain('bg-background');
    expect(root.className.split(/\s+/)).not.toContain('bg-card');
    expect(root.className.split(/\s+/)).not.toContain('dark:bg-popover');
    expect(root.className).toContain('rounded-lg');
    expect(root.className).toContain('shadow-(--elevation-overlay)');
    expect(root.className).toContain('ring-1');
    expect(root.className).toContain('ring-border/70');

    const columns = container.querySelector('[data-workspace-hover-card-columns]');
    const identity = container.querySelector('[data-workspace-hover-card-identity]');
    const activity = container.querySelector('[data-workspace-hover-card-activity]');
    expect(columns?.children[0]).toBe(identity);
    expect(columns?.children[1]).toBe(activity);
    expect(identity?.className).not.toMatch(/(?:^|\s)bg-/);
    expect(activity?.className).not.toMatch(/(?:^|\s)bg-/);
    expect(identity?.querySelector('[data-workspace-hover-card-recency]')).toBeTruthy();
    expect(activity?.className.split(/\s+/)).toContain('border-solid');
    expect(activity?.className.split(/\s+/)).not.toContain('border-t');
    expect(activity?.querySelector('[data-workspace-hover-card-agent-summary]')).toBeTruthy();
    expect(activity?.querySelectorAll('.border-t.border-border')).toHaveLength(0);
    expect(activity?.querySelector('[data-workspace-hover-card-divider]')).toBeNull();
    expect(activity?.querySelector('[data-workspace-hover-card-pr-divider]')).toBeNull();
  });

  it('keeps the sidebar wrapper from clipping or repainting the rounded surface', () => {
    expect(workspaceCardSource).toContain(
      'class="w-auto overflow-visible! rounded-lg border-0! bg-background! shadow-none!"',
    );
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
    expect(document.querySelector('[data-workspace-hover-card-agent-count]')).toBeNull();
    expect(screen.getByText('Planner')).toBeTruthy();
    expect(screen.getByText('Implementor')).toBeTruthy();
    expect(screen.queryByText('3 agents · 2 active · 1 running · 1 unread')).toBeNull();
    const prList = screen.getByRole('list', { name: 'Pull request' });
    expect(prList.className).toContain('gap-1');
    expect(prList.className).toContain('py-0.5');
    const agentRow = document.querySelector('[data-workspace-hover-card-agent-row]');
    const prRow = document.querySelector('[data-workspace-hover-card-pr-row]');
    const agentRowContent = agentRow?.firstElementChild;
    const agentIcon = document.querySelector('[data-workspace-hover-card-agent-icon]');
    const prIcon = document.querySelector('[data-workspace-hover-card-pr-icon]');
    for (const rowClass of ['min-h-8', 'py-0.5']) {
      expect(agentRow?.className).toContain(rowClass);
      expect(prRow?.className).toContain(rowClass);
    }
    expect(agentRowContent?.className).toContain('workspace-hover-card__detail-row');
    expect(prRow?.className).toContain('workspace-hover-card__detail-row');
    expect(agentRowContent?.className).not.toContain('gap-2');
    expect(prRow?.className).not.toContain('gap-2');
    for (const iconClass of ['h-6', 'w-6', 'shrink-0', 'place-items-center']) {
      expect(agentIcon?.className).toContain(iconClass);
      expect(prIcon?.className).toContain(iconClass);
    }
    expect(document.querySelector('[data-workspace-hover-card-pr-divider]')).toBeNull();
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
    const icons = rows.map((row) => row.querySelector('[data-workspace-hover-card-pr-icon]'));
    expect(icons.every((icon) => icon?.querySelector('svg'))).toBe(true);
    expect(icons.every((icon) => icon?.getAttribute('aria-hidden') === 'true')).toBe(true);
    expect(
      icons.every((icon) => icon?.className.includes('h-6') && icon.className.includes('w-6')),
    ).toBe(true);
    expect(rows.every((row) => row.className.includes('min-h-8'))).toBe(true);
    expect(rows.every((row) => row.className.includes('workspace-hover-card__detail-row'))).toBe(
      true,
    );
    expect(rows.every((row) => !row.className.includes('gap-2'))).toBe(true);
    expect(rows.every((row) => row.className.includes('py-0.5'))).toBe(true);
    expect(screen.getByText('Open workspace PR').className).toContain('truncate');
    expect(rows[0].querySelector('[data-workspace-hover-card-pr-status]')?.className).toContain(
      'text-success',
    );
    expect(rows[2].querySelector('[data-workspace-hover-card-pr-status]')?.className).toContain(
      'text-purple-500',
    );
    expect(screen.getByText('other-org/tooling')).toBeTruthy();
    expect(screen.getByText('Cross-repo monitor')).toBeTruthy();
    expect(rows.every((row) => row.getAttribute('aria-label')?.includes('#'))).toBe(true);
  });

  it('renders no right-column horizontal rules when a waiting workspace only has PR content', async () => {
    const { container } = await renderHoverCard({
      displayStatus: 'waiting',
      activePullRequest: {
        id: 'pr-14',
        number: 14,
        url: 'https://github.com/augment/intent/pull/14',
        title: 'Review divider-free density',
        status: PullRequestStatus.Open,
        createdAt: '2026-05-05T00:00:00.000Z',
        updatedAt: '2026-05-05T00:00:00.000Z',
      },
    });

    const activity = container.querySelector('[data-workspace-hover-card-activity]');
    expect(activity?.querySelectorAll('.border-t.border-border')).toHaveLength(0);
    expect(activity?.querySelector('[data-workspace-hover-card-divider]')).toBeNull();
    expect(activity?.querySelector('[data-workspace-hover-card-pr-divider]')).toBeNull();
    expect(screen.getByText('Review divider-free density')).toBeTruthy();
  });

  it('keeps hover-card task progress static while preserving its data and proportions', async () => {
    mocks.tasksByWorkspace['ws-1'] = [
      { id: 't-1', title: 'Complete', status: 'complete' },
      { id: 't-2', title: 'Running', status: 'in_progress' },
      { id: 't-3', title: 'Pending', status: 'not_started' },
    ];

    const { container } = await renderHoverCard();
    const progressbar = screen.getByRole('progressbar', { name: 'Workspace task progress' });
    const segments = container.querySelectorAll<HTMLElement>('[data-task-progress-style]');

    expect(progressbar.getAttribute('data-task-status-motion')).toBe('static');
    expect(progressbar.getAttribute('aria-valuenow')).toBe('33');
    expect(progressbar.getAttribute('aria-valuetext')).toContain('1 complete');
    expect(progressbar.className).not.toContain('flame-progress-enter');
    expect(Array.from(segments, (segment) => segment.style.flexGrow)).toEqual(['1', '1', '1']);
    expect(
      [...segments].every((segment) => !segment.classList.contains('flame-status-segment')),
    ).toBe(true);
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

  it('keeps agent state accessible without rendering visible state labels', async () => {
    mocks.agentSessionsByWorkspace['ws-1'] = [
      {
        id: 'agent-running',
        name: 'Planner',
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
        name: 'Reviewer',
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
    expect(screen.getByText('Planner')).toBeTruthy();
    expect(screen.getByText('Worker Agent')).toBeTruthy();
    expect(screen.getByText('Reviewer')).toBeTruthy();
    expect(agentRows[0].getAttribute('aria-label')).toBe('Planner Running');
    expect(agentRows[1].getAttribute('aria-label')).toBe('Worker Agent Running');
    expect(agentRows[2].getAttribute('aria-label')).toBe('Reviewer Waiting');
    expect(screen.queryByText('Running')).toBeNull();
    expect(screen.queryByText('Waiting')).toBeNull();
    expect(screen.queryByText('Background')).toBeNull();
    expect(screen.queryByText('3 agents · 3 active')).toBeNull();
    expect(screen.queryByText('Active')).toBeNull();
  });

  it('bounds dense active work at three rows with numeric overflow', async () => {
    mocks.agentSessionsByWorkspace['ws-1'] = Array.from({ length: 5 }, (_, index) => ({
      id: `agent-${index + 1}`,
      name: `Agent ${index + 1}`,
      status: 'running',
      messages: [],
    })) as AgentSession[];

    const { container } = await renderHoverCard({
      agentSummary: { agentIds: ['agent-1', 'agent-2', 'agent-3', 'agent-4', 'agent-5'] },
    });

    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText('+2 more')).toBeTruthy();
    expect(container.querySelector('[data-workspace-hover-card-overflow]')).toBeTruthy();
    expect(container.querySelector('[data-workspace-hover-card-agent-count]')).toBeNull();
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
