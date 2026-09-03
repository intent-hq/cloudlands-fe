import type { BackgroundHook } from '$features/hooks/background-hooks-service';
import type { PrMonitorRow, PrMonitorSnapshot } from '$features/pr-monitor/pr-monitor-service';
import type { DelegationGroupStatus } from '$store/renderer/slices/agent-subscription-ui/agent-subscription-ui-types';

export type FixtureState = 'collapsed' | 'expanded';

export interface AgentCardFixture {
  id: string;
  label: string;
  count: number;
  finishedCount: number;
  state: FixtureState;
}

const agentCases: Array<[string, string, number, number]> = [
  ['one-waiting', '1 waiting agent', 1, 0],
  ['three-waiting', '3 waiting agents', 3, 0],
  ['one-finished', '3 agents, 1 finished', 3, 1],
  ['all-finished', 'All agents finished', 3, 3],
  ['avatar-stack', 'Grouped avatar stack (6 agents)', 6, 0],
];

export const agentCardFixtures: AgentCardFixture[] = agentCases.flatMap(
  ([id, label, count, finishedCount]) =>
    (['collapsed', 'expanded'] as const).map((state) => ({
      id: `${id}-${state}`,
      label,
      count,
      finishedCount,
      state,
    })),
);

export interface LiveCardFixture {
  id: string;
  label: string;
  state: FixtureState;
  hooks?: BackgroundHook[];
  prs?: PrMonitorRow[];
  agents?: string[];
  completedAgents?: string[];
  woken?: boolean;
}

const fixtureNow = Date.now();
const relativeFixtureTime = (offsetMs: number) => new Date(fixtureNow + offsetMs).toISOString();

const hook = (id: string, overrides: Partial<BackgroundHook> = {}): BackgroundHook => ({
  hookId: id,
  workspaceId: '',
  agentId: '',
  name: `Hook ${id}`,
  delayMs: 60000,
  state: 'scheduled',
  createdAt: relativeFixtureTime(-5 * 60_000),
  nextRunAt: relativeFixtureTime(10 * 60_000),
  expiresAt: relativeFixtureTime(2 * 60 * 60_000),
  runCount: 4,
  ...overrides,
});

const snapshot = (overrides: Partial<PrMonitorSnapshot> = {}): PrMonitorSnapshot => ({
  state: 'open',
  isDraft: false,
  hasConflicts: false,
  isBehind: false,
  mergeable: true,
  checks: {
    total: 4,
    passed: 4,
    failed: 0,
    pending: 0,
    failingRequired: 0,
    pendingRequired: 0,
    requiredKnown: true,
  },
  approvals: { decision: 'approved', have: 1, needed: 1, changesRequested: 0 },
  threads: { unresolved: 0, resolutionRequired: true },
  rulesKnown: true,
  ...overrides,
});

const pr = (id: string, number: number, overrides: Partial<PrMonitorRow> = {}): PrMonitorRow => ({
  monitorId: id,
  workspaceId: '',
  agentId: '',
  repo: 'intent-hq/cloudlands-fe',
  prNumber: number,
  state: 'active',
  pendingChanges: [],
  hasPendingChanges: false,
  createdAt: '2026-09-01T09:00:00.000Z',
  updatedAt: '2026-09-01T09:04:00.000Z',
  title: `Subscription row fixture ${number}`,
  url: `https://github.com/intent-hq/cloudlands-fe/pull/${number}`,
  lastSnapshot: snapshot(),
  ...overrides,
});

const livePairs = (
  id: string,
  label: string,
  data: Omit<LiveCardFixture, 'id' | 'label' | 'state'>,
): LiveCardFixture[] =>
  (['collapsed', 'expanded'] as const).map((state) => ({
    id: `${id}-${state}`,
    label,
    state,
    ...data,
  }));

export const liveCardFixtures: LiveCardFixture[] = [
  {
    id: 'agents-only-collapsed',
    label: 'Agents only from store',
    state: 'collapsed',
    agents: ['agent-one', 'agent-two'],
  },
  ...livePairs('agent-one', '1 waiting agent from store', { agents: ['agent-one'] }),
  ...livePairs('hook-one', '1 scheduled hook', { hooks: [hook('scheduled')] }),
  ...livePairs('hook-running', 'Running hook', { hooks: [hook('running', { state: 'running' })] }),
  ...livePairs('hook-error', 'Scheduled hook with last error', {
    hooks: [hook('error', { lastError: 'Last run failed' })],
  }),
  ...livePairs('hook-three', '3 hooks', { hooks: [hook('one'), hook('two'), hook('three')] }),
  ...livePairs('hook-perpetual', 'Perpetual hook', {
    hooks: [hook('perpetual', { delayMs: 300000, runCount: 28 })],
  }),
  ...livePairs('pr-mergeable', 'Mergeable PR', { prs: [pr('mergeable', 2101)] }),
  ...livePairs('pr-blocked', 'Blocked PR with failing checks', {
    prs: [
      pr('blocked', 2102, {
        lastSnapshot: snapshot({
          mergeable: false,
          mergeBlockedReason: 'Required checks failed',
          checks: {
            total: 4,
            passed: 2,
            failed: 2,
            pending: 0,
            failingRequired: 2,
            pendingRequired: 0,
            requiredKnown: true,
          },
        }),
      }),
    ],
  }),
  ...livePairs('pr-pending', 'PR with pending checks', {
    prs: [
      pr('pending', 2103, {
        lastSnapshot: snapshot({
          checks: {
            total: 4,
            passed: 2,
            failed: 0,
            pending: 2,
            failingRequired: 0,
            pendingRequired: 2,
            requiredKnown: true,
          },
        }),
      }),
    ],
  }),
  ...livePairs('pr-draft', 'Draft PR', {
    prs: [pr('draft', 2104, { lastSnapshot: snapshot({ isDraft: true, mergeable: false }) })],
  }),
  ...livePairs('pr-changes', 'PR details with checks, approvals, threads, and changes', {
    prs: [
      pr('changes', 2105, {
        hasPendingChanges: true,
        pendingChanges: ['checks', 'review'],
        pendingSince: '2026-09-01T09:03:00.000Z',
        lastChangeAt: '2026-09-01T09:02:00.000Z',
        lastSnapshot: snapshot({
          mergeable: false,
          checks: {
            total: 4,
            passed: 2,
            failed: 0,
            pending: 2,
            failingRequired: 0,
            pendingRequired: 2,
            requiredKnown: true,
          },
          approvals: { decision: 'review_required', have: 0, needed: 1, changesRequested: 0 },
          threads: { unresolved: 2, resolutionRequired: true },
        }),
      }),
    ],
  }),
  ...livePairs('mixed', 'Agents, hooks, and PRs', {
    agents: ['mixed-one', 'mixed-two'],
    hooks: [hook('mixed')],
    prs: [pr('mixed', 2106)],
  }),
  ...livePairs('completed-woken', 'Completed agents with woken-up pill', {
    agents: ['done-one', 'done-two'],
    completedAgents: ['done-one', 'done-two'],
    woken: true,
  }),
];

export const delegationGroups: Array<{ id: string; label: string; group: DelegationGroupStatus }> =
  [
    {
      id: 'waiting',
      label: 'Waiting delegation group',
      group: {
        groupId: 'waiting',
        awaitMode: 'all',
        expectedAgentIds: ['delegate-a', 'delegate-b'],
        completedAgentIds: [],
        deletedAgentIds: [],
        agentStatuses: { 'delegate-a': 'responding', 'delegate-b': 'idle' },
        delivered: false,
      },
    },
    {
      id: 'warning',
      label: 'Delegation warning state',
      group: {
        groupId: 'warning',
        awaitMode: 'all',
        expectedAgentIds: ['delegate-c', 'delegate-d'],
        completedAgentIds: ['delegate-c', 'delegate-d'],
        deletedAgentIds: [],
        agentStatuses: { 'delegate-c': 'completed', 'delegate-d': 'completed' },
        delivered: false,
      },
    },
    {
      id: 'finished',
      label: 'Finished delegation group',
      group: {
        groupId: 'finished',
        awaitMode: 'all',
        expectedAgentIds: ['delegate-e', 'delegate-f'],
        completedAgentIds: ['delegate-e', 'delegate-f'],
        deletedAgentIds: [],
        agentStatuses: { 'delegate-e': 'completed', 'delegate-f': 'completed' },
        delivered: true,
      },
    },
  ];
