/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrMonitorRow } from '$features/pr-monitor/pr-monitor-service';
import type { AgentMessage, AgentSession, ContentBlock, Workspace } from '$shared/types';
import { PullRequestStatus, WorkspaceStatusEnum } from '$shared/types';
import { QUESTION_RESOURCE_MIME_TYPE } from '$shared/types/question-resource';
import { warmImport } from '../../../../test/warm-import';

const mocks = vi.hoisted(() => {
  const dispatch = vi.fn();
  const streamingAgentIds: string[] = [];
  const agentSessionsByWorkspace: Record<string, AgentSession[]> = {};
  const agentPreviewsById: Record<string, { kind: string; text?: string }> = {};
  const prMonitors: PrMonitorRow[] = [];
  const createWorkspaceReadable =
    <T>(resolve: (workspaceId: string) => T) =>
    (workspaceIdStore: { subscribe: (run: (value: string) => void) => () => void }) => ({
      subscribe(run: (value: T) => void) {
        return workspaceIdStore.subscribe((workspaceId) => run(resolve(workspaceId)));
      },
    });
  return {
    dispatch,
    streamingAgentIds,
    agentSessionsByWorkspace,
    agentPreviewsById,
    prMonitors,
    createWorkspaceReadable,
  };
});

vi.mock('$features/agent/services/active-streams-tracker', () => ({
  activeStreamsTracker: {
    subscribe: vi.fn(() => () => {}),
    getStreamingAgentIdsForWorkspace: vi.fn(() => mocks.streamingAgentIds),
  },
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => ({}), dispatch: mocks.dispatch });
});

vi.mock('$store/renderer/slices/pr-monitor/pr-monitor-selectors', () => ({
  selectPrMonitors: vi.fn(mocks.createWorkspaceReadable(() => mocks.prMonitors)),
}));

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceActivePullRequest: { select: vi.fn(() => null) },
}));

vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-selectors', () => ({
  selectAllWorkspaceAgents: vi.fn(
    mocks.createWorkspaceReadable(
      (workspaceId: string) => mocks.agentSessionsByWorkspace[workspaceId] ?? [],
    ),
  ),
}));

vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentPreview: {
    select: (_state: unknown, agentId: string) => mocks.agentPreviewsById[agentId] ?? null,
  },
}));

vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-slice', () => ({
  ensureAgentSessionLoaded: vi.fn((workspaceId: string, agentId: string) => ({
    type: 'workspaceAgents/ensureAgentSessionLoaded',
    payload: [workspaceId, agentId],
  })),
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
  statusMessage: 'Preparing the landscape hover card for review.',
  createdAt: '2026-05-05T00:00:00.000Z',
  updatedAt: '2026-05-05T00:00:00.000Z',
  lastActivity: '2026-05-05T19:00:00.000Z',
  repositoryOwner: 'augment',
  repositoryName: 'intent',
} as Workspace;

const ENSURE_AGENT_SESSION_LOADED = 'workspaceAgents/ensureAgentSessionLoaded';

warmImport(() => import('../WorkspaceHoverCard.svelte'));

async function renderHoverCard(
  overrides: Partial<Workspace> = {},
  props: {
    activeAgentIds?: string[];
    loadAgentSessions?: boolean;
    loadWorkspaceData?: boolean;
    isLoading?: boolean;
  } = {},
) {
  const WorkspaceHoverCard = (await import('../WorkspaceHoverCard.svelte')).default;
  return render(WorkspaceHoverCard, {
    props: { workspace: { ...baseWorkspace, ...overrides } as Workspace, ...props },
  });
}

function agent(
  id: string,
  name: string,
  status: AgentSession['status'],
  overrides: Partial<AgentSession> = {},
): AgentSession {
  return {
    id,
    name,
    status,
    workspaceId: 'ws-1',
    createdAt: '2026-05-05T18:00:00.000Z',
    updatedAt: '2026-05-05T19:00:00.000Z',
    lastActivity: '2026-05-05T19:00:00.000Z',
    messages: [],
    ...overrides,
  } as AgentSession;
}

function questionMessage(id: string, questions: string[]): AgentMessage {
  return {
    id,
    role: 'assistant',
    timestamp: '2026-05-05T19:00:00.000Z',
    contentBlocks: questions.map(
      (question, index) =>
        ({
          type: 'resource',
          resource: {
            uri: `intent-question://${id}-${index}`,
            name: `Question ${index + 1}`,
            mimeType: QUESTION_RESOURCE_MIME_TYPE,
            text: JSON.stringify({
              attachmentId: `${id}-${index}`,
              header: `Question ${index + 1}`,
              question,
              options: [{ label: 'Yes' }, { label: 'No' }],
              multiSelect: false,
            }),
          },
        }) as unknown as ContentBlock,
    ),
  };
}

function sessionLoads() {
  return mocks.dispatch.mock.calls.flatMap(([action]) => {
    const candidate = action as { type?: string; payload?: unknown };
    return candidate.type === ENSURE_AGENT_SESSION_LOADED ? [candidate.payload] : [];
  });
}

function text(element: Element) {
  return element.textContent?.replace(/\s+/g, ' ').trim();
}

describe('WorkspaceHoverCard', () => {
  beforeEach(() => {
    mocks.dispatch.mockClear();
    mocks.streamingAgentIds.length = 0;
    mocks.prMonitors.length = 0;
    for (const record of [mocks.agentSessionsByWorkspace, mocks.agentPreviewsById]) {
      for (const key of Object.keys(record)) delete record[key];
    }
  });

  it('keeps pull request numbers and status visible in the pull request column', async () => {
    const { container } = await renderHoverCard({
      activePullRequest: {
        id: 'pr-42',
        number: 42,
        url: 'https://github.com/augment/intent/pull/42',
        title: 'Refine hover card',
        status: PullRequestStatus.Open,
        createdAt: baseWorkspace.createdAt,
        updatedAt: baseWorkspace.updatedAt,
      },
    });

    const row = screen.getByRole('listitem', { name: /augment\/intent #42/i });
    expect(row.textContent).toContain('Refine hover card');
    expect(row.textContent).toContain('#42');
    expect(row.textContent).toContain('Open');
    expect(row.getAttribute('data-pr-status')).toBe('open');
    expect(Array.from(row.children).map(text)).toEqual(['', 'Refine hover card', 'Open', '#42']);
    expect(container.querySelector('[data-workspace-hover-card-activity]')).toBeNull();
    expect(
      container.querySelector('[data-workspace-hover-card-pr-column]')?.getAttribute('aria-label'),
    ).toBe('Pull requests');
  });

  it('labels an open pull request Queued when its monitor reports it in the merge queue', async () => {
    mocks.prMonitors.push({
      monitorId: 'mon-42',
      workspaceId: 'ws-1',
      agentId: 'agent-1',
      repo: 'augment/intent',
      prNumber: 42,
      state: 'active',
      pendingChanges: [],
      hasPendingChanges: false,
      createdAt: baseWorkspace.createdAt,
      updatedAt: baseWorkspace.updatedAt,
      title: 'Refine hover card',
      url: 'https://github.com/augment/intent/pull/42',
      lastSnapshot: {
        state: 'open',
        isDraft: false,
        hasConflicts: false,
        isBehind: false,
        checks: {
          total: 0,
          passed: 0,
          failed: 0,
          pending: 0,
          failingRequired: 0,
          pendingRequired: 0,
          requiredKnown: false,
        },
        approvals: { decision: '', have: 0, changesRequested: 0 },
        threads: { unresolved: 0 },
        isInMergeQueue: true,
        rulesKnown: false,
      },
    });
    await renderHoverCard({
      activePullRequest: {
        id: 'pr-42',
        number: 42,
        url: 'https://github.com/augment/intent/pull/42',
        title: 'Refine hover card',
        status: PullRequestStatus.Open,
        createdAt: baseWorkspace.createdAt,
        updatedAt: baseWorkspace.updatedAt,
      },
    });

    const row = screen.getByRole('listitem', { name: /augment\/intent #42/i });
    expect(row.getAttribute('data-pr-status')).toBe('open');
    expect(text(row.querySelector('[data-workspace-hover-card-pr-status]')!)).toBe('Queued');
  });

  it('preserves the public loading and data-loading behavior', async () => {
    const { rerender, container } = await renderHoverCard(
      { agentSummary: { agentIds: ['member'] } },
      { activeAgentIds: ['running'], loadWorkspaceData: false },
    );
    await waitFor(() =>
      expect(sessionLoads()).toEqual([
        ['ws-1', 'member'],
        ['ws-1', 'running'],
      ]),
    );

    await rerender({
      workspace: { ...baseWorkspace, agentSummary: { agentIds: ['member'] } },
      activeAgentIds: ['running'],
      loadWorkspaceData: false,
    });
    await tick();
    expect(sessionLoads()).toHaveLength(2);

    await rerender({ workspace: null, isLoading: true, loadWorkspaceData: false });
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(6);
    expect(container.querySelector('[data-workspace-hover-card-title]')).toBeNull();
  });

  it('resets guarded session loads when the workspace changes', async () => {
    const { rerender } = await renderHoverCard(
      { agentSummary: { agentIds: ['shared'] } },
      { loadWorkspaceData: false },
    );
    await waitFor(() => expect(sessionLoads()).toEqual([['ws-1', 'shared']]));

    await rerender({
      workspace: { ...baseWorkspace, id: 'ws-2', agentSummary: { agentIds: ['shared'] } },
      loadWorkspaceData: false,
    });
    await waitFor(() =>
      expect(sessionLoads()).toEqual([
        ['ws-1', 'shared'],
        ['ws-2', 'shared'],
      ]),
    );
  });

  it('keeps identity in the header above two accessible non-empty activity sections', async () => {
    mocks.agentSessionsByWorkspace['ws-1'] = [agent('active', 'Noah', 'running')];
    const { container } = await renderHoverCard({
      agentSummary: { agentIds: ['active'] },
      activePullRequest: {
        id: 'pr-42',
        number: 42,
        url: 'https://github.com/augment/intent/pull/42',
        title: 'Refine hover card',
        status: PullRequestStatus.Open,
        createdAt: baseWorkspace.createdAt,
        updatedAt: baseWorkspace.updatedAt,
      },
    });
    const root = container.querySelector('[data-workspace-hover-card]')!;
    const header = container.querySelector('[data-workspace-hover-card-header]')!;
    const columns = container.querySelector('[data-workspace-hover-card-columns]')!;
    const identity = container.querySelector('[data-workspace-hover-card-identity]')!;
    const activity = container.querySelector('[data-workspace-hover-card-activity]')!;
    const pullRequests = container.querySelector('[data-workspace-hover-card-pr-column]')!;
    const summary = container.querySelector('[data-workspace-hover-card-summary]')!;

    expect(root.getAttribute('data-workspace-hover-card-layout')).toBe('landscape');
    expect(header.parentElement).toBe(root);
    expect(identity.parentElement).toBe(header);
    expect(summary.parentElement).toBe(identity);
    expect(columns.parentElement).toBe(root);
    expect(columns.children[0]).toBe(activity);
    expect(columns.children[1]).toBe(pullRequests);
    expect(header.querySelector('[data-workspace-hover-card-title]')).toBeTruthy();
    const status = header.querySelector('[data-workspace-hover-card-status]')!;
    expect(status).toBeTruthy();
    expect(status.querySelector('[data-workspace-status]')?.getAttribute('style')).toContain(
      'width: 16px',
    );
    expect(header.querySelector('[data-workspace-hover-card-timestamp]')).toBeNull();
    expect(text(header.querySelector('[data-workspace-hover-card-repo]')!)).toBe(
      'augment / intent',
    );
    expect(identity.querySelector('[data-workspace-hover-card-branch]')).toBeNull();
    expect(text(summary)).toBe('Preparing the landscape hover card for review.');
    expect(activity.getAttribute('aria-label')).toBe('Agents');
    expect(pullRequests.getAttribute('aria-label')).toBe('Pull requests');
    expect(container.querySelector('h3')).toBeNull();
    expect(identity.querySelector('[data-workspace-hover-card-agent-stack]')).toBeNull();
    expect(identity.querySelector('[data-workspace-hover-card-agent-count]')).toBeNull();
    expect(container.querySelector('.font-mono')).toBeNull();
  });

  it('omits the description and bottom section when the workspace has no message or rows', async () => {
    const { container } = await renderHoverCard({ statusMessage: '   ' });

    expect(container.querySelector('[data-workspace-hover-card-summary]')).toBeNull();
    expect(container.querySelector('[data-workspace-hover-card-divider]')).toBeNull();
    expect(container.querySelector('[data-workspace-hover-card-columns]')).toBeNull();
    expect(text(container.querySelector('[data-workspace-hover-card-status]')!)).toBe('Idle');
  });

  it('renders an agents-only body without a pull request section', async () => {
    mocks.agentSessionsByWorkspace['ws-1'] = [agent('active', 'Noah', 'running')];
    const { container } = await renderHoverCard({ agentSummary: { agentIds: ['active'] } });

    const columns = container.querySelector('[data-workspace-hover-card-columns]')!;
    const activity = container.querySelector('[data-workspace-hover-card-activity]')!;
    expect(container.querySelector('[data-workspace-hover-card-divider]')).toBeTruthy();
    expect(columns.children).toHaveLength(1);
    expect(columns.children[0]).toBe(activity);
    expect(activity.getAttribute('aria-label')).toBe('Agents');
    expect(container.querySelector('[data-workspace-hover-card-pr-column]')).toBeNull();
  });

  it('orders blocker, real question, active, and waiting rows without group headings', async () => {
    const pending = questionMessage('pending', [
      'Which deployment region should receive the migration first?',
      'Should the old cache keys remain readable?',
      'Who should approve the rollout?',
      'When should the migration start?',
    ]);
    mocks.agentSessionsByWorkspace['ws-1'] = [
      agent('blocker', 'Maya', 'waiting', {
        attentionRequestKind: 'blocker',
        attentionRequestReason: 'The staging database rejects the migration user.',
      }),
      agent('question', 'Leah', 'waiting', {
        messages: [pending],
        metadata: { pendingQuestionsMessageId: pending.id },
      }),
      agent('active', 'Noah', 'running'),
      agent('waiting', 'Ari', 'waiting'),
    ];
    mocks.agentPreviewsById.question = {
      kind: 'last-agent',
      text: 'I reviewed the rollout options and need one decision.',
    };
    mocks.agentPreviewsById.active = {
      kind: 'last-agent',
      text: 'Implementing the approved migration plan.',
    };
    const summary = {
      agentIds: ['blocker', 'question', 'active', 'waiting'],
      agents: ['blocker', 'question', 'active', 'waiting'].map((id) => ({
        id,
        name: id,
        status: 'active',
        parentAgentId: null,
      })),
    } as Workspace['agentSummary'];
    const { container } = await renderHoverCard({ agentSummary: summary });

    const attentionRows = Array.from(
      container.querySelectorAll(
        '[data-workspace-hover-card-agent-row][data-agent-group-row="attention"]',
      ),
    );
    expect(attentionRows).toHaveLength(2);
    expect(attentionRows[0].getAttribute('data-attention-kind')).toBe('blocker');
    expect(text(attentionRows[0])).toContain('The staging database rejects the migration user.');
    expect(text(attentionRows[1])).toContain(
      'Which deployment region should receive the migration first?',
    );
    expect(text(attentionRows[1])).not.toContain('Q: awaiting your answer');
    const questionMeta = attentionRows[1].querySelector(
      '[data-workspace-hover-card-question-meta]',
    )!;
    expect(text(questionMeta.querySelector('[aria-hidden="true"]')!)).toBe('1/4');
    expect(questionMeta.getAttribute('aria-label')).toBe('Question 1 of 4');
    expect(attentionRows[1].getAttribute('aria-label')).toContain('Question 1 of 4');
    const question = attentionRows[1].querySelector('[data-workspace-hover-card-agent-context]')!;
    expect(text(question)).toBe('Which deployment region should receive the migration first?');
    expect(attentionRows[1].querySelector('[data-workspace-hover-card-agent-preview]')).toBeNull();
    const active = container.querySelector(
      '[data-workspace-hover-card-agent-row][data-agent-group-row="active"]',
    )!;
    expect(within(active).getByText('Noah')).toBeTruthy();
    expect(text(active.querySelector('[data-workspace-hover-card-agent-context]')!)).toBe(
      'Implementing the approved migration plan.',
    );
    expect(active.querySelector('[data-workspace-hover-card-agent-preview]')).toBeTruthy();
    const waiting = container.querySelector(
      '[data-workspace-hover-card-agent-row][data-agent-group-row="waiting"]',
    )!;
    expect(within(waiting as HTMLElement).getByText('Ari')).toBeTruthy();
    expect(container.querySelector('[data-agent-group]')).toBeNull();
    const rows = Array.from(container.querySelectorAll('[data-workspace-hover-card-agent-row]'));
    const times = rows.map((row) => row.querySelector('[data-workspace-hover-card-agent-time]'));
    expect(times.every((time) => time instanceof HTMLTimeElement)).toBe(true);
    expect(times.every((time) => Boolean(time?.getAttribute('aria-label')))).toBe(true);
  });

  it('does not use generic awaiting-answer copy when marked question content is unavailable', async () => {
    mocks.agentSessionsByWorkspace['ws-1'] = [
      agent('question', 'Leah', 'waiting', {
        metadata: { pendingQuestionsMessageId: 'missing-message' },
      }),
    ];
    await renderHoverCard({ agentSummary: { agentIds: ['question'] } });

    const row = screen.getByRole('listitem');
    expect(text(row.querySelector('[data-workspace-hover-card-agent-context]')!)).toBe('Question');
    expect(text(row)).not.toContain('awaiting your answer');
    expect(row.querySelector('[data-workspace-hover-card-question-meta]')).toBeNull();
    expect(row.querySelector('[data-workspace-hover-card-agent-preview]')).toBeNull();
    expect(row.querySelector('[data-workspace-hover-card-agent-time]')).toBeTruthy();
  });

  it('uses unread preview text and excludes delegated, background, and retired sessions', async () => {
    mocks.agentSessionsByWorkspace['ws-1'] = [
      agent('unread', 'Rowan', 'completed', { hasUnread: true }),
      agent('background', 'Background', 'running', { isBackground: true }),
      agent('delegated', 'Delegated', 'running', { metadata: { createdByAgentId: 'parent' } }),
      agent('retired', 'Retired', 'completed', {
        hasUnread: true,
        retiredAt: '2026-05-05T19:00:00.000Z',
      }),
    ];
    mocks.agentPreviewsById.unread = {
      kind: 'last-agent',
      text: 'The accessibility audit is ready for review.',
    };
    await renderHoverCard({ agentSummary: { agentIds: ['unread'] } });

    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(1);
    expect(text(rows[0])).toContain('The accessibility audit is ready for review.');
    expect(screen.queryByText('Background')).toBeNull();
    expect(screen.queryByText('Delegated')).toBeNull();
    expect(screen.queryByText('Retired')).toBeNull();
  });

  it('caps visible activity at six rows without an internal scrollbar class', async () => {
    mocks.agentSessionsByWorkspace['ws-1'] = Array.from({ length: 8 }, (_, index) =>
      agent(`agent-${index + 1}`, `Agent ${index + 1}`, 'running'),
    );
    const { container } = await renderHoverCard({
      agentSummary: { agentIds: Array.from({ length: 8 }, (_, index) => `agent-${index + 1}`) },
    });

    expect(screen.getAllByRole('listitem')).toHaveLength(6);
    expect(screen.getByText('+2 more')).toBeTruthy();
    const activity = container.querySelector('[data-workspace-hover-card-activity]')!;
    expect(activity.className).not.toContain('overflow-y-auto');
    expect(activity.className).not.toContain('overflow-y-scroll');
  });

  it('degrades safely when optional identity metadata is absent', async () => {
    const { container } = await renderHoverCard({
      repositoryOwner: undefined,
      repositoryName: undefined,
      branch: undefined,
      statusMessage: '   ',
    });

    expect(screen.getByText('Local repository')).toBeTruthy();
    expect(container.querySelector('[data-workspace-hover-card-branch]')).toBeNull();
    expect(container.textContent).not.toContain('undefined');
    expect(container.textContent).not.toContain('null');
  });
});
