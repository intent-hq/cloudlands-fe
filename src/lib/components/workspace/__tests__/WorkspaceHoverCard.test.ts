/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { m } from '$shared/paraglide/messages.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrMonitorRow } from '$features/pr-monitor/pr-monitor-service';
import type { AgentMessage, AgentSession, ContentBlock, Workspace } from '$shared/types';
import { PullRequestStatus, WorkspaceStatusEnum } from '$shared/types';
import type { PresencePerson } from '$store/renderer/slices/presence/presence-types';
import { QUESTION_RESOURCE_MIME_TYPE } from '$shared/types/question-resource';
import { warmImport } from '../../../../test/warm-import';

const mocks = vi.hoisted(() => {
  const dispatch = vi.fn();
  const streamingAgentIds: string[] = [];
  const agentSessionsByWorkspace: Record<string, AgentSession[]> = {};
  const agentPreviewsById: Record<string, { kind: string; text?: string }> = {};
  const prMonitors: PrMonitorRow[] = [];
  /** Store-side owner controls per workspace, as the workspace-share selectors would read them. */
  interface RosterFixture {
    canManage: boolean;
    withheld: boolean;
    removingPrincipalId: string | null;
    removeError: string | null;
  }
  const rosters: Record<string, RosterFixture> = {};
  const rosterListeners = new Set<() => void>();
  const presenceMembersByWorkspace: Record<string, PresencePerson[]> = {};
  const createWorkspaceReadable =
    <T>(resolve: (workspaceId: string) => T) =>
    (workspaceIdStore: { subscribe: (run: (value: string) => void) => () => void }) => ({
      subscribe(run: (value: T) => void) {
        let current = '';
        const notify = () => run(resolve(current));
        rosterListeners.add(notify);
        const unsubscribe = workspaceIdStore.subscribe((workspaceId) => {
          current = workspaceId;
          notify();
        });
        return () => {
          rosterListeners.delete(notify);
          unsubscribe();
        };
      },
    });
  /** Simulate a store change: re-run every roster readable against the fixtures. */
  const emitRosters = () => {
    for (const notify of [...rosterListeners]) notify();
  };
  return {
    dispatch,
    streamingAgentIds,
    agentSessionsByWorkspace,
    agentPreviewsById,
    prMonitors,
    rosters,
    emitRosters,
    presenceMembersByWorkspace,
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

vi.mock('$store/renderer/slices/presence/presence-selectors', () => ({
  selectWorkspacePresencePeople: vi.fn(
    mocks.createWorkspaceReadable(
      (workspaceId: string) => mocks.presenceMembersByWorkspace[workspaceId] ?? [],
    ),
  ),
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

vi.mock('$store/renderer/slices/workspace-share/workspace-share-selectors', () => {
  const roster = (workspaceId: string) => mocks.rosters[workspaceId];
  return {
    selectWorkspaceRosterCanManage: vi.fn(
      mocks.createWorkspaceReadable(
        (workspaceId: string) => roster(workspaceId)?.canManage ?? false,
      ),
    ),
    selectWorkspaceRosterWithheld: vi.fn(
      mocks.createWorkspaceReadable(
        (workspaceId: string) => roster(workspaceId)?.withheld ?? false,
      ),
    ),
    selectWorkspaceRosterRemovingPrincipalId: vi.fn(
      mocks.createWorkspaceReadable(
        (workspaceId: string) => roster(workspaceId)?.removingPrincipalId ?? null,
      ),
    ),
    selectWorkspaceRosterRemoveError: vi.fn(
      mocks.createWorkspaceReadable(
        (workspaceId: string) => roster(workspaceId)?.removeError ?? null,
      ),
    ),
  };
});

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
    for (const record of [
      mocks.agentSessionsByWorkspace,
      mocks.agentPreviewsById,
      mocks.rosters,
      mocks.presenceMembersByWorkspace,
    ]) {
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

  it('renders a question row when one agent has both a blocker and an unanswered question', async () => {
    const pending = questionMessage('pending', [
      'Which deployment region should receive the migration first?',
    ]);
    const blockerReason = 'The staging database rejects the migration user.';
    const session = agent('both', 'Maya', 'waiting', {
      attentionRequestKind: 'blocker',
      attentionRequestReason: blockerReason,
      messages: [pending],
      metadata: { pendingQuestionsMessageId: pending.id },
    });
    const { getAvatarStateForSession } =
      await import('$features/agent/components/agent-avatar/avatar-state');
    expect(getAvatarStateForSession(session, { hasQuestion: true })).toBe('question');
    mocks.agentSessionsByWorkspace['ws-1'] = [session];
    const { container } = await renderHoverCard({ agentSummary: { agentIds: ['both'] } });

    const attentionRows = Array.from(
      container.querySelectorAll(
        '[data-workspace-hover-card-agent-row][data-agent-group-row="attention"]',
      ),
    );
    expect(attentionRows).toHaveLength(1);
    expect(attentionRows[0].getAttribute('data-attention-kind')).toBe('question');
    expect(text(attentionRows[0].querySelector('[data-workspace-hover-card-agent-context]')!)).toBe(
      'Which deployment region should receive the migration first?',
    );
    expect(text(attentionRows[0])).not.toContain(blockerReason);
  });

  it('keeps the blocker row when the marked question was already dismissed', async () => {
    const pending = questionMessage('dismissed', [
      'Which deployment region should receive the migration first?',
    ]);
    const blockerReason = 'The staging database rejects the migration user.';
    mocks.agentSessionsByWorkspace['ws-1'] = [
      agent('both', 'Maya', 'waiting', {
        attentionRequestKind: 'blocker',
        attentionRequestReason: blockerReason,
        messages: [pending],
        metadata: {
          pendingQuestionsMessageId: pending.id,
          dismissedQuestionsMessageId: pending.id,
        },
      }),
    ];
    const { container } = await renderHoverCard({ agentSummary: { agentIds: ['both'] } });

    const attentionRows = Array.from(
      container.querySelectorAll(
        '[data-workspace-hover-card-agent-row][data-agent-group-row="attention"]',
      ),
    );
    expect(attentionRows).toHaveLength(1);
    expect(attentionRows[0].getAttribute('data-attention-kind')).toBe('blocker');
    expect(text(attentionRows[0].querySelector('[data-workspace-hover-card-agent-context]')!)).toBe(
      blockerReason,
    );
    expect(text(attentionRows[0])).not.toContain('Which deployment region');
    expect(attentionRows[0].querySelector('[data-workspace-hover-card-question-meta]')).toBeNull();
  });

  it('keeps the blocker row when the question marker was cleared', async () => {
    const stale = questionMessage('stale', [
      'Which deployment region should receive the migration first?',
    ]);
    const blockerReason = 'The staging database rejects the migration user.';
    mocks.agentSessionsByWorkspace['ws-1'] = [
      agent('both', 'Maya', 'waiting', {
        attentionRequestKind: 'blocker',
        attentionRequestReason: blockerReason,
        messages: [stale],
        metadata: { pendingQuestionsMessageId: '' },
      }),
    ];
    const { container } = await renderHoverCard({ agentSummary: { agentIds: ['both'] } });

    const attentionRows = Array.from(
      container.querySelectorAll(
        '[data-workspace-hover-card-agent-row][data-agent-group-row="attention"]',
      ),
    );
    expect(attentionRows).toHaveLength(1);
    expect(attentionRows[0].getAttribute('data-attention-kind')).toBe('blocker');
    expect(text(attentionRows[0].querySelector('[data-workspace-hover-card-agent-context]')!)).toBe(
      blockerReason,
    );
    expect(text(attentionRows[0])).not.toContain('Which deployment region');
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

  describe('presence member rows', () => {
    const member = (
      principalId: string,
      facts: Partial<Pick<PresencePerson, 'owner' | 'online' | 'viewing' | 'self'>>,
      profile: Partial<PresencePerson> = {},
    ): PresencePerson => ({
      principalId,
      login: null,
      displayName: null,
      avatarUrl: null,
      owner: false,
      online: false,
      viewing: false,
      self: false,
      ...facts,
      ...profile,
    });

    function peopleRows(container: HTMLElement) {
      const people = container.querySelector('[data-workspace-hover-card-people]')!;
      return within(people as HTMLElement).getAllByRole('listitem');
    }

    it('renders no people section for a workspace with no membership on display', async () => {
      const { container } = await renderHoverCard();
      expect(container.querySelector('[data-workspace-hover-card-people]')).toBeNull();
    });

    it('lists every member — viewing, then online, then offline — with login, role and state', async () => {
      mocks.presenceMembersByWorkspace['ws-1'] = [
        member('p-away', {}, { login: 'away-login' }),
        member('p-idle', { online: true }, { login: 'idle-login' }),
        member(
          'p-viewing',
          { online: true, viewing: true },
          { login: 'viewer', displayName: 'Viewing Person' },
        ),
        member('p-anon', { online: true }),
      ];
      const { container } = await renderHoverCard();

      const rows = peopleRows(container);
      expect(rows.map((row) => row.getAttribute('data-presence-state'))).toEqual([
        'viewing',
        'online',
        'online',
        'offline',
      ]);
      expect(rows[0].getAttribute('data-presence-viewing')).toBe('true');
      expect(rows[0].getAttribute('aria-label')).toBe(
        'Viewing Person. viewer. Collaborator. Viewing',
      );
      expect(rows[0].querySelector('[data-workspace-hover-card-person-login]')?.textContent).toBe(
        'viewer',
      );
      expect(rows[1].getAttribute('data-presence-viewing')).toBeNull();
      expect(rows[1].getAttribute('aria-label')).toBe('idle-login. Collaborator. Online');
      expect(rows[1].querySelector('[data-workspace-hover-card-person-login]')).toBeNull();
      expect(rows[2].getAttribute('aria-label')).toBe('Someone. Collaborator. Online');
      expect(rows[3].getAttribute('aria-label')).toBe('away-login. Collaborator. Offline');
      expect(
        rows[3].querySelector('[data-presence-avatar]')?.getAttribute('data-presence-ring'),
      ).toBe('offline');
    });

    it('marks the owner and this window itself, ringing the owner blue and a member green', async () => {
      mocks.presenceMembersByWorkspace['ws-1'] = [
        member('p-owner', { owner: true, online: true, self: true }, { login: 'owner-login' }),
        member('p-member', { online: true }, { login: 'member-login' }),
      ];
      const { container } = await renderHoverCard();

      const [owner, collaborator] = peopleRows(container);
      expect(owner.getAttribute('data-presence-role')).toBe('owner');
      expect(owner.getAttribute('data-presence-self')).toBe('true');
      expect(owner.getAttribute('aria-label')).toBe('owner-login (you). Owner. Online');
      expect(
        owner.querySelector('[data-presence-avatar]')?.getAttribute('data-presence-ring'),
      ).toBe('owner');
      expect(collaborator.getAttribute('data-presence-role')).toBe('collaborator');
      expect(collaborator.getAttribute('data-presence-self')).toBeNull();
      expect(
        collaborator.querySelector('[data-presence-avatar]')?.getAttribute('data-presence-ring'),
      ).toBe('member');
    });

    // Owner controls (multiplayer w4 share slice) ride the People rows: Remove
    // is gated by the store, the confirmed removal is
    // dispatched to the share saga, and the in-flight principal and error are
    // rendered back from the selectors. The card issues no roster read itself.
    describe('Remove', () => {
      const removeTargetsOf = (rows: HTMLElement[]) =>
        rows.map(
          (row) =>
            row
              .querySelector('[data-workspace-hover-card-person-remove]')
              ?.getAttribute('data-workspace-hover-card-person-remove') ?? null,
        );
      function seedRoster(
        workspaceId: string,
        overrides: Partial<(typeof mocks.rosters)[string]> = {},
      ) {
        mocks.rosters[workspaceId] = {
          canManage: false,
          withheld: false,
          removingPrincipalId: null,
          removeError: null,
          ...overrides,
        };
      }
      function dispatched(type: string) {
        return mocks.dispatch.mock.calls.flatMap(([action]) => {
          const candidate = action as { type?: string; payload?: unknown };
          return candidate.type === type ? [candidate.payload] : [];
        });
      }

      beforeEach(() => {
        mocks.presenceMembersByWorkspace['ws-1'] = [
          member('p-owner', { owner: true, online: true, self: true }, { login: 'owner-login' }),
          member('p-member', { online: true }, { login: 'member-login' }),
          member('p-away', {}, { login: 'away-login' }),
        ];
      });

      it('lists the people read-only, without a roster read, when this window may not manage sharing', async () => {
        seedRoster('ws-1');
        const { container } = await renderHoverCard({ memberCount: 3, myRole: 'collaborator' });
        await tick();

        expect(peopleRows(container)).toHaveLength(3);
        expect(container.querySelector('[data-workspace-hover-card-person-remove]')).toBeNull();
        expect(dispatched('workspaceShare/rosterRequested')).toEqual([]);
      });

      // Share… lives only in the workspace ⋯ menu (WorkspaceProgressCard); the
      // card never offers it, owner or not.
      it('does not offer a Share entry to the owner', async () => {
        seedRoster('ws-1', { canManage: true });
        const { container } = await renderHoverCard({ statusMessage: '   ', myRole: 'owner' });

        expect(container.querySelector('[data-workspace-hover-card-share]')).toBeNull();
        expect(dispatched('workspaceShare/openDialog')).toEqual([]);
      });

      it('offers Remove on every collaborator row but never the owner row, and dispatches the removal only once confirmed', async () => {
        seedRoster('ws-1', { canManage: true });
        const { container } = await renderHoverCard({ myRole: 'owner' });

        const rows = peopleRows(container);
        expect(removeTargetsOf(rows)).toEqual([null, 'p-member', 'p-away']);
        const away = within(rows[2]);
        const removeName = m.workspace_hoverCard_personRemove_ariaLabel({ name: 'away-login' });
        const confirmName = m.workspace_share_removeMember_confirmAction_ariaLabel({
          name: 'away-login',
        });

        await fireEvent.click(away.getByRole('button', { name: removeName }));
        expect(dispatched('workspaceShare/rosterMemberRemoveRequested')).toEqual([]);
        expect(
          rows[2].querySelector('[data-workspace-hover-card-person-remove-confirm]'),
        ).not.toBeNull();
        expect(removeTargetsOf(rows)).toEqual([null, 'p-member', null]);

        await fireEvent.click(away.getByRole('button', { name: m.workspace_share_cancel_label() }));
        expect(
          rows[2].querySelector('[data-workspace-hover-card-person-remove-confirm]'),
        ).toBeNull();
        expect(dispatched('workspaceShare/rosterMemberRemoveRequested')).toEqual([]);

        await fireEvent.click(away.getByRole('button', { name: removeName }));
        await fireEvent.click(away.getByRole('button', { name: confirmName }));
        expect(dispatched('workspaceShare/rosterMemberRemoveRequested')).toEqual([
          [{ workspaceId: 'ws-1', principalId: 'p-away' }],
        ]);
        expect(
          rows[2].querySelector('[data-workspace-hover-card-person-remove-confirm]'),
        ).toBeNull();

        // While the store reports the removal in flight, every Remove is disabled.
        mocks.rosters['ws-1']!.removingPrincipalId = 'p-away';
        mocks.emitRosters();
        await tick();
        expect(away.getByRole<HTMLButtonElement>('button', { name: removeName }).disabled).toBe(
          true,
        );
        expect(
          within(rows[1]).getByRole<HTMLButtonElement>('button', {
            name: m.workspace_hoverCard_personRemove_ariaLabel({ name: 'member-login' }),
          }).disabled,
        ).toBe(true);
      });

      it('renders the localized removal error the store carries and keeps the rows', async () => {
        seedRoster('ws-1', { canManage: true, removeError: 'Could not remove the member' });
        const { container } = await renderHoverCard({ myRole: 'owner' });

        const error = container.querySelector('[data-workspace-hover-card-people-error]');
        expect(error).not.toBeNull();
        expect(text(error!)).toBe('Could not remove the member');
        expect(peopleRows(container)).toHaveLength(3);
      });

      // Regression (fe#2440 verifier, 6138cb4 round): a daemon `-32003` on an
      // owner-only method withholds every owner control on the card, not just
      // the row that was being removed, and says why.
      it('withholds Remove and shows the owner-only notice once the daemon refused', async () => {
        seedRoster('ws-1', { canManage: false, withheld: true });
        const { container } = await renderHoverCard({ myRole: 'owner' });

        expect(peopleRows(container)).toHaveLength(3);
        expect(
          container.querySelectorAll('[data-workspace-hover-card-person-remove]'),
        ).toHaveLength(0);
        const notice = container.querySelector('[data-workspace-hover-card-people-error]');
        expect(notice).not.toBeNull();
        expect(text(notice!)).toBe('Only the workspace owner can manage sharing.');
      });

      // Regression (fe#2440 verifier, 6138cb4 round): the owner controls are
      // keyed by workspace, so retargeting the card mid-removal shows the new
      // workspace's own rows — a settlement for the previous one cannot touch them.
      it('shows the retargeted workspace people untouched by the previous workspace removal', async () => {
        seedRoster('ws-1', { canManage: true });
        seedRoster('ws-2', { canManage: true });
        mocks.presenceMembersByWorkspace['ws-2'] = [
          member('p-owner', { owner: true, online: true, self: true }, { login: 'owner-login' }),
          member('p-other', { online: true }, { login: 'other-login' }),
        ];
        const WorkspaceHoverCard = (await import('../WorkspaceHoverCard.svelte')).default;
        const shared = { ...baseWorkspace, myRole: 'owner' } as Workspace;
        const { container, rerender } = render(WorkspaceHoverCard, {
          props: { workspace: shared },
        });
        const away = within(peopleRows(container)[2]);
        await fireEvent.click(
          away.getByRole('button', {
            name: m.workspace_hoverCard_personRemove_ariaLabel({ name: 'away-login' }),
          }),
        );
        expect(
          container.querySelector('[data-workspace-hover-card-person-remove-confirm]'),
        ).not.toBeNull();

        await rerender({ workspace: { ...shared, id: 'ws-2', title: 'Other' } as Workspace });
        await tick();
        // ws-1's removal settles (its people now lack away); ws-2 is unaffected.
        mocks.presenceMembersByWorkspace['ws-1'] = mocks.presenceMembersByWorkspace['ws-1'].slice(
          0,
          2,
        );
        mocks.emitRosters();
        await tick();
        const rows = peopleRows(container);
        expect(rows).toHaveLength(2);
        expect(removeTargetsOf(rows)).toEqual([null, 'p-other']);
        expect(
          container.querySelector('[data-workspace-hover-card-person-remove-confirm]'),
        ).toBeNull();
      });

      it('keeps every collaborator of a large roster listed and removable instead of truncating', async () => {
        const guests = Array.from({ length: 7 }, (_, index) =>
          member(`p-guest-${index}`, { online: true }, { login: `guest-${index}` }),
        );
        mocks.presenceMembersByWorkspace['ws-1'] = [
          member('p-owner', { owner: true, online: true, self: true }, { login: 'owner-login' }),
          ...guests,
        ];
        seedRoster('ws-1', { canManage: true });
        const { container } = await renderHoverCard({ myRole: 'owner' });

        const rows = peopleRows(container);
        expect(rows).toHaveLength(8);
        expect(container.querySelector('[data-workspace-hover-card-people-overflow]')).toBeNull();
        const removeTargets = removeTargetsOf(rows);
        expect(removeTargets.filter((target) => target === null)).toHaveLength(1);
        expect(rows[removeTargets.indexOf(null)].getAttribute('data-presence-role')).toBe('owner');
        expect(new Set(removeTargets.filter(Boolean))).toEqual(
          new Set(guests.map((guest) => guest.principalId)),
        );
        const last = within(rows[rows.length - 1]);
        const lastRemove = last.getByRole('button', {
          name: m.workspace_hoverCard_personRemove_ariaLabel({ name: 'guest-6' }),
        });
        lastRemove.focus();
        expect(document.activeElement).toBe(lastRemove);
        await fireEvent.click(lastRemove);
        await fireEvent.click(
          last.getByRole('button', {
            name: m.workspace_share_removeMember_confirmAction_ariaLabel({ name: 'guest-6' }),
          }),
        );
        expect(dispatched('workspaceShare/rosterMemberRemoveRequested')).toEqual([
          [{ workspaceId: 'ws-1', principalId: 'p-guest-6' }],
        ]);
      });
    });
  });
});
