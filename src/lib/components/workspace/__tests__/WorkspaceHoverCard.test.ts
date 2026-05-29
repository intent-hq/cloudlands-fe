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
  const readable = <T>(value: T) => ({
    subscribe(run: (value: T) => void) {
      run(value);
      return () => {};
    },
  });
  const createWorkspaceSessionReadable = (workspaceIdArg: string | { subscribe: (run: (value: string) => void) => () => void }) => {
    const resolve = (workspaceId: string) => agentSessionsByWorkspace[workspaceId] ?? [];
    if (workspaceIdArg && typeof workspaceIdArg === 'object' && 'subscribe' in workspaceIdArg) {
      return {
        subscribe(run: (value: AgentSession[]) => void) {
          return workspaceIdArg.subscribe((workspaceId) => run(resolve(workspaceId)));
        },
      };
    }
    return readable(resolve(workspaceIdArg));
  };
  return { dispatch, streamingAgentIds, unreadAgentIds, agentSessionsByWorkspace, readable, createWorkspaceSessionReadable };
});

vi.mock('$features/agent/services/active-streams-tracker', () => ({
  activeStreamsTracker: {
    subscribe: vi.fn(() => () => {}),
    getStreamingAgentIdsForWorkspace: vi.fn(() => mocks.streamingAgentIds),
  },
}));

vi.mock('$lib/store/store', async () => {
  const { createAppStoreMockModule } = await import('$lib/store/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => ({}),
    dispatch: mocks.dispatch,
  });
});

vi.mock('$lib/store/slices/unread-tracking/unread-tracking-selectors', () => ({
  selectUnreadAgentIds: vi.fn(() => mocks.readable(mocks.unreadAgentIds)),
  selectUnreadAgentIdsForWorkspace: { select: vi.fn(() => mocks.unreadAgentIds) },
}));

vi.mock('$lib/store/slices/workspace-agents/workspace-agents-selectors', () => ({
  selectAllWorkspaceAgents: vi.fn(mocks.createWorkspaceSessionReadable),
}));

vi.mock('$lib/store/slices/workspace-agents/workspace-agents-selectors', () => ({
  selectAllWorkspaceAgents: Object.assign(vi.fn(mocks.createWorkspaceSessionReadable), {
    select: vi.fn(
      (_state: unknown, workspaceId: string) => mocks.agentSessionsByWorkspace[workspaceId] ?? [],
    ),
  }),
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
    for (const workspaceId of Object.keys(mocks.agentSessionsByWorkspace)) {
      delete mocks.agentSessionsByWorkspace[workspaceId];
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

  it('prefers live session status while preserving summary display metadata', async () => {
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
        count: 2,
        agents: [
          {
            id: 'agent-duplicate',
            name: 'Snapshot Specialist Agent',
            status: 'waiting',
            specialist: 'implementor',
            lastActivity: '2026-05-05T18:00:00.000Z',
          },
          {
            id: 'agent-live-name',
            name: 'Stale Snapshot Agent',
            status: 'waiting',
          },
        ],
      },
    });

    const row = screen.getAllByRole('listitem')[0];
    expect(screen.getByText('Snapshot Specialist Agent')).toBeTruthy();
    expect(screen.getByText('Live Named Agent')).toBeTruthy();
    expect(screen.queryByText('Stale Snapshot Agent')).toBeNull();
    expect(row.getAttribute('aria-label')).toContain('Processing');
    expect(row.getAttribute('aria-label')).not.toContain('Waiting');
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

    await renderHoverCard({
      agentSummary: {
        count: 3,
        agents: [
          { id: 'agent-1', name: 'Planner', status: 'active' },
          { id: 'agent-2', name: 'Implementor', status: 'processing' },
          { id: 'agent-3', name: 'Verifier', status: 'Idle' },
        ],
      },
      taskStats: { total: 5, completed: 2, inProgress: 1 },
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
      gitSummary: { ahead: 2, behind: 1, hasUnpushed: true },
      diffSummary: {
        schemaVersion: 1,
        updatedAt: '2026-05-05T19:00:00.000Z',
        totalFiles: 3,
        totalAdditions: 42,
        totalDeletions: 7,
        files: [],
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
    const { container } = await renderHoverCard({
      gitSummary,
      diffSummary: {
        schemaVersion: 1,
        updatedAt: '2026-05-05T19:00:00.000Z',
        totalFiles: 3,
        totalAdditions: 42,
        totalDeletions: 7,
        files: [],
      },
    });

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
    const { container } = await renderHoverCard({ gitSummary });

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
    await renderHoverCard({
      agentSummary: {
        count: 3,
        agents: [
          { id: 'agent-running', name: 'Running Agent', status: 'running' },
          { id: 'agent-background', name: 'Worker Agent', status: 'background' },
          { id: 'agent-waiting', name: 'Waiting Agent', status: 'waiting' },
        ],
      },
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
