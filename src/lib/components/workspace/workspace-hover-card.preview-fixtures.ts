import type {
  AgentMessage,
  AgentSession,
  ContentBlock,
  PullRequestInfo,
  Workspace,
  WorkspaceDiffSummary,
  WorkspaceGitSummary,
  WorkspaceTask,
  WorkspaceTaskStats,
} from '$shared/types';
import { AgentStatus, PullRequestStatus, WorkspaceStatus } from '$shared/types';
import { QUESTION_RESOURCE_MIME_TYPE } from '$shared/types/question-resource';
import { definePreview, type PreviewDefinition } from '$lib/component-catalog/preview-definition';
import {
  definePreviewFixture,
  PREVIEW_FIXTURE_TIMESTAMPS,
} from '$lib/component-catalog/preview-fixtures';
import { store as appStore } from '$store/renderer/store';
import {
  clearWorkspaceTasks,
  loadWorkspaceTasksSucceeded,
} from '$store/renderer/slices/workspace-tasks/workspace-tasks-slice';
import {
  clearWorkspaceSummaries,
  loadWorkspaceSummariesSucceeded,
} from '$store/renderer/slices/workspace-summaries/workspace-summaries-slice';
import {
  removeWorkspaceAgentState,
  setAgents,
} from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import {
  bulkUpsertSessions,
  removeWorkspaceSessions,
} from '$store/renderer/slices/agent-session/agent-session-slice';

interface HoverCardScenario {
  key: string;
  label: string;
  expected: string;
  workspace: Workspace | null;
  isLoading?: boolean;
  activeAgentIds?: string[];
  tasks?: WorkspaceTask[];
  taskStats?: WorkspaceTaskStats;
  diffSummary?: WorkspaceDiffSummary | null;
  gitSummary?: WorkspaceGitSummary | null;
  agents?: AgentSession[];
}

export interface WorkspaceHoverCardPreviewProps {
  family: string;
  expected: string;
  cards: HoverCardScenario[];
  placement?: 'right-edge' | 'bottom-edge';
  layout?: 'standard' | 'narrow';
  theme?: 'light' | 'dark';
  setupData?: boolean;
}

export interface StateMatrixEntry {
  family: string;
  states: string;
  expected: string;
  coverage: string;
  conflicts: string;
}

export const workspaceHoverCardStateMatrix: readonly StateMatrixEntry[] = [
  {
    family: 'Input',
    states: 'loading; null; loaded; null → loaded',
    expected:
      'Loading shows three skeleton rows; null shows only the header skeleton; loaded replaces skeletons without duplicate loads.',
    coverage: 'readiness preview; WorkspaceHoverCard tests',
    conflicts: 'Content rows must not render with loading or null.',
  },
  {
    family: 'Identity',
    states: 'title; untitled; long title; owner/repo; repo only; local fallback',
    expected:
      'Title and repository truncate; empty title becomes Untitled; missing repository name becomes Local repository.',
    coverage: 'identity-lifecycle and long-content previews',
    conflicts: 'owner/repo, repo-only, and local fallback are mutually exclusive.',
  },
  {
    family: 'Lifecycle',
    states: 'active; archived with/without date; inactive; deleted',
    expected:
      'Only archived renders a lifecycle chip; malformed or stale inactive/deleted inputs still render safely.',
    coverage: 'identity-lifecycle preview',
    conflicts: 'Archived chip does not replace semantic status.',
  },
  {
    family: 'Semantic status',
    states: 'all 11 displayStatus values; absent; unknown',
    expected:
      'Each canonical value uses normally cased product language in the right column only; absent and unknown values fall back to Not started.',
    coverage: 'semantic-status preview; status presentation tests',
    conflicts: 'Exactly one semantic status renders.',
  },
  {
    family: 'Overlays',
    states: 'unread; waiting; both; high priority + overlays; review required',
    expected:
      'failed/blocked/needs attention/in progress beat overlays; otherwise unread beats waiting; review-required attention does not create unread.',
    coverage: 'overlays preview; status presentation tests',
    conflicts: 'Unread and waiting never render together as the primary status.',
  },
  {
    family: 'Status message',
    states: 'absent; whitespace; short; multiline; long; unbroken',
    expected:
      'Absent and whitespace render no row; other values use natural height up to three lines, then show an ellipsis while the title preserves the full text.',
    coverage: 'messages and long-content previews; component tests',
    conflicts: 'No placeholder appears for an empty message.',
  },
  {
    family: 'Tasks',
    states: 'uninitialized; empty; zero; mixed; complete; cancelled; aggregate fallback',
    expected:
      'Uninitialized shows a placeholder; initialized states show canonical segments; cancelled is excluded; mismatched detail uses the aggregate.',
    coverage: 'tasks preview; task display tests',
    conflicts: 'Cancelled tasks never contribute to total or segments.',
  },
  {
    family: 'Agents',
    states:
      'none; unloaded; active statuses; three; overflow; blocker; question; discussion; unread; streaming dedupe; delegated/background suppression',
    expected:
      'Cards show at most six top-level rows in the right table, ordered by blocker, question or discussion, unread, active, then waiting; every row ends with a compact activity time.',
    coverage: 'attention and agents previews; component, accessibility, and container tests',
    conflicts:
      'The same live-streaming agent must not also appear as unread; delegated children and background agents never show the unread dot.',
  },
  {
    family: 'Pull requests',
    states:
      'none; active; list; legacy; open; draft; merged; closed; CI; conflicts; reviews; malformed; long; multiple',
    expected:
      'active PR wins, then first list item, then legacy fields; draft overrides open; missing title/number use safe fallbacks; only one PR row renders.',
    coverage: 'pull-requests preview; component tests',
    conflicts: 'Multiple PR candidates never produce multiple rows.',
  },
  {
    family: 'Changes',
    states: 'none; line stats; diff; ahead; behind; diverged; unpushed; clean; combined',
    expected:
      'Absent and clean data render no row; diff and Git text combine once; detailed diff wins over line stats.',
    coverage: 'changes-recency preview; component tests',
    conflicts: 'Line-stat fallback does not render when a detailed diff exists.',
  },
  {
    family: 'Recency',
    states: '<1m; minutes; hours; days; months; absent; invalid',
    expected:
      'Every agent row keeps a compact trailing activity time while accessible text provides the full relative value.',
    coverage: 'changes-recency and identity-lifecycle previews',
    conflicts: 'Invalid timestamps never leak Invalid Date.',
  },
  {
    family: 'Media',
    states: 'absent; present; failed asset',
    expected:
      'The hover card renders no status image in all cases; media stays on the progress card.',
    coverage: 'media preview',
    conflicts: 'A failed or missing image must not add a broken media element.',
  },
  {
    family: 'Layout',
    states: 'light; dark; stacked activity; narrow; dense; right flip; bottom clamp; scroll/resize',
    expected:
      'Theme follows catalog query; activity stays in one stacked flow, remains height-bounded, and clamps to the viewport.',
    coverage: 'dense, narrow, and placement previews; HoverCard tests',
    conflicts: 'The card must not clip beyond collision padding.',
  },
  {
    family: 'Integration',
    states: 'sidebar; tab; stable open/close; unchanged open card',
    expected:
      'Both consumers show the same card; open/close remains stable; unchanged workspace IDs do not repeat data requests.',
    coverage: 'workspace-sidebar preview; integration and component tests',
    conflicts: 'One open card must not trigger duplicate session or workspace-data loads.',
  },
] as const;

const workspaceFixture = definePreviewFixture<Workspace>({
  id: 'hover-card-default' as Workspace['id'],
  title: 'Polish workspace hover cards',
  branch: 'feat/workspace-hover-card-polish',
  changesets: [],
  timeline: [],
  conversationInfo: [],
  status: WorkspaceStatus.Active,
  displayStatus: 'idle',
  attention: 'none',
  activity: 'idle',
  repositoryOwner: 'intent-hq',
  repositoryName: 'cloudlands-fe',
  ...PREVIEW_FIXTURE_TIMESTAMPS,
});

function workspace(key: string, overrides: Partial<Workspace> = {}): Workspace {
  return workspaceFixture({ id: `hover-card-${key}` as Workspace['id'], ...overrides });
}

function pr(number: number, overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    id: `preview-pr-${number}`,
    number,
    url: `https://github.com/intent-hq/cloudlands-fe/pull/${number}`,
    title: `Preview pull request ${number}`,
    status: PullRequestStatus.Open,
    ...PREVIEW_FIXTURE_TIMESTAMPS,
    ...overrides,
  };
}

function task(id: string, status: WorkspaceTask['status']): WorkspaceTask {
  return { id, title: `Preview task ${id}`, status };
}

function agent(
  workspaceId: Workspace['id'],
  id: string,
  status: AgentSession['status'],
  overrides: Partial<AgentSession> = {},
): AgentSession {
  return {
    id: id as AgentSession['id'],
    backendSessionId: null,
    workspaceId,
    name: id.replaceAll('-', ' '),
    status,
    messages: [],
    ...PREVIEW_FIXTURE_TIMESTAMPS,
    ...overrides,
  };
}

function activityAgo(milliseconds: number) {
  const timestamp = new Date(Date.now() - milliseconds).toISOString();
  return { lastActivity: timestamp, updatedAt: timestamp };
}

function questionMessage(id: string, question: string | string[]): AgentMessage {
  const questions = Array.isArray(question) ? question : [question];
  const blocks = questions.map(
    (prompt, index) =>
      ({
        type: 'resource',
        resource: {
          uri: `intent-question://hover-card-${id}-${index}`,
          name: `Implementation choice ${index + 1}`,
          mimeType: QUESTION_RESOURCE_MIME_TYPE,
          text: JSON.stringify({
            attachmentId: `hover-card-${id}-${index}`,
            header: `Implementation choice ${index + 1}`,
            question: prompt,
            options: [{ label: 'Keep current behavior' }, { label: 'Use the new behavior' }],
            multiSelect: false,
          }),
        },
      }) as unknown as ContentBlock,
  );
  return {
    id,
    role: 'assistant',
    contentBlocks: blocks,
    timestamp: PREVIEW_FIXTURE_TIMESTAMPS.updatedAt,
  };
}

function scenario(
  key: string,
  label: string,
  expected: string,
  overrides: Partial<HoverCardScenario> = {},
): HoverCardScenario {
  return { key, label, expected, workspace: workspace(key), ...overrides };
}

function questionAttentionScenario(
  key: string,
  label: string,
  prompts: string[] | null,
  recentResponse?: string,
): HoverCardScenario {
  const agentId = `${key}-agent`;
  const messageId = `${key}-message`;
  const message = prompts ? questionMessage(messageId, prompts) : null;
  const ws = workspace(key, {
    displayStatus: 'needs_attention',
    statusMessage: 'A teammate needs an answer before implementation can continue.',
    agentSummary: {
      agentIds: [agentId],
      agents: [{ id: agentId, name: 'Leah', status: 'waiting', parentAgentId: null }],
    } as Workspace['agentSummary'],
  });
  return scenario(
    key,
    label,
    prompts
      ? 'The first unresolved prompt and compact question count share the descriptive second row.'
      : 'The question label appears without generic awaiting-answer copy when the marked message body is unavailable.',
    {
      workspace: ws,
      agents: [
        agent(ws.id, agentId, AgentStatus.Waiting, {
          name: 'Leah',
          messages: message ? [message] : [],
          metadata: { pendingQuestionsMessageId: message?.id ?? messageId },
          lastAgentResponse: recentResponse,
          ...activityAgo(90 * 24 * 60 * 60_000),
        }),
      ],
    },
  );
}

const statuses = [
  'failed',
  'blocked',
  'needs_attention',
  'in_progress',
  'not_started',
  'idle',
  'complete',
  'pr_queued',
  'pr_ready',
  'pr_open',
  'pr_merged',
] as const;
const mixedTasks = [
  task('complete', 'complete'),
  task('progress', 'in_progress'),
  task('review', 'review_required'),
  task('waiting', 'waiting'),
  task('todo', 'not_started'),
  task('cancelled', 'cancelled'),
];

const scenes: Record<string, WorkspaceHoverCardPreviewProps> = {
  working: {
    family: 'Working',
    expected: 'Identity stays primary while active work and the selected PR remain scannable.',
    cards: [
      (() => {
        const ws = workspace('working', {
          displayStatus: 'in_progress',
          statusMessage: 'Implementing the approved stacked hover-card polish.',
          agentSummary: { agentIds: ['working-implementor', 'working-verifier'] },
          activePullRequest: pr(73, {
            title: 'Polish workspace hover cards',
            ciStatus: { total: 5, passed: 4, failed: 0, pending: 1 },
          }),
        });
        return scenario('working', 'Working', 'Two active rows, mixed progress, and open PR.', {
          workspace: ws,
          tasks: mixedTasks,
          taskStats: { total: 5, completed: 1, inProgress: 3 },
          agents: [
            agent(ws.id, 'working-implementor', AgentStatus.Active, activityAgo(4 * 60_000)),
            agent(
              ws.id,
              'working-verifier',
              'responding' as AgentSession['status'],
              activityAgo(2 * 60 * 60_000),
            ),
          ],
        });
      })(),
    ],
  },
  attention: {
    family: 'Agent attention',
    expected:
      'The wide activity column shows real agent names, localized state labels, and concise existing context without exposing internal IDs.',
    cards: [
      questionAttentionScenario(
        'attention-one-question',
        'One pending question',
        ['Should the migration preserve the existing cache keys?'],
        'I checked the cache callers and need your compatibility decision.',
      ),
      questionAttentionScenario(
        'attention-four-questions',
        'Four pending questions',
        [
          'Which deployment region should receive the migration first?',
          'Should the old cache keys remain readable?',
          'How long should the compatibility window remain open?',
          'Who should approve the final rollout?',
        ],
        'The deployment plan is ready after these decisions, with rollout safeguards queued for the selected region and compatibility window.',
      ),
      questionAttentionScenario(
        'attention-missing-body',
        'Pending question body unavailable',
        null,
      ),
      (() => {
        const blockerId = 'attention-maya';
        const questionId = 'attention-jules';
        const unreadId = 'attention-rowan';
        const pendingQuestion = questionMessage(
          'attention-question',
          'Should the migration preserve the existing cache keys?',
        );
        const ws = workspace('attention-priority', {
          displayStatus: 'needs_attention',
          attention: 'unread',
          statusMessage: 'Two teammates need a decision before the migration can continue.',
          agentSummary: {
            agentIds: [blockerId, questionId, unreadId],
            agents: [
              { id: blockerId, name: 'Maya', status: 'waiting', parentAgentId: null },
              { id: questionId, name: 'Jules', status: 'waiting', parentAgentId: null },
              { id: unreadId, name: 'Rowan', status: 'completed', parentAgentId: null },
            ],
          } as Workspace['agentSummary'],
        });
        return scenario(
          'attention-priority',
          'Blocker and question',
          'Blocker wins; question follows; the third unread agent remains in the activity table.',
          {
            workspace: ws,
            agents: [
              agent(ws.id, blockerId, AgentStatus.Waiting, {
                name: 'Maya',
                attentionRequestKind: 'blocker',
                attentionRequestReason: 'The staging database rejects the migration user.',
              }),
              agent(ws.id, questionId, AgentStatus.Waiting, {
                name: 'Jules',
                messages: [pendingQuestion],
                metadata: { pendingQuestionsMessageId: pendingQuestion.id },
              }),
              agent(ws.id, unreadId, AgentStatus.Completed, {
                name: 'Rowan',
                hasUnread: true,
                lastAgentResponse: 'The accessibility audit is ready for review.',
              }),
            ],
          },
        );
      })(),
      (() => {
        const discussionId = 'attention-nora';
        const unreadId = 'attention-owen';
        const ws = workspace('attention-secondary', {
          displayStatus: 'needs_attention',
          statusMessage: 'The team has a product decision and a completed review to inspect.',
          agentSummary: {
            agentIds: [discussionId, unreadId],
            agents: [
              { id: discussionId, name: 'Nora', status: 'waiting', parentAgentId: null },
              { id: unreadId, name: 'Owen', status: 'completed', parentAgentId: null },
            ],
          } as Workspace['agentSummary'],
        });
        return scenario(
          'attention-secondary',
          'Discussion and unread',
          'Both rows use existing reason and response previews with localized labels.',
          {
            workspace: ws,
            agents: [
              agent(ws.id, discussionId, AgentStatus.Waiting, {
                name: 'Nora',
                attentionRequestKind: 'discussion',
                attentionRequestReason:
                  'The empty state needs a product decision before implementation.',
              }),
              agent(ws.id, unreadId, AgentStatus.Completed, {
                name: 'Owen',
                hasUnread: true,
                lastAgentResponse: 'Keyboard and screen-reader checks now pass.',
              }),
            ],
          },
        );
      })(),
    ],
  },
  'attention-narrow': {
    family: 'Agent attention',
    expected:
      'The existing single-column container layout stays compact and hides the new attention detail.',
    layout: 'narrow',
    cards: [
      questionAttentionScenario('attention-narrow-question', 'Narrow pending question', [
        'Should the migration preserve the existing cache keys?',
      ]),
    ],
  },
  'stopped-blocked': {
    family: 'Stopped or blocked',
    expected: 'Failure semantics stay clear without a colored frame.',
    cards: [
      scenario('stopped', 'Stopped', 'Failure uses semantic text and dot color only.', {
        workspace: workspace('stopped', {
          displayStatus: 'failed',
          statusMessage: 'The active implementation agent stopped unexpectedly.',
        }),
      }),
      scenario('blocked', 'Blocked', 'Blocked copy remains visible with optional data absent.', {
        workspace: workspace('blocked', {
          displayStatus: 'blocked',
          statusMessage: 'Waiting for access to the required repository.',
        }),
      }),
    ],
  },
  'idle-complete': {
    family: 'Idle or complete',
    expected: 'Resolved and quiet states retain the same hierarchy without a numeric header count.',
    cards: [
      scenario('idle', 'Idle', 'No optional activity rows; recency stays pinned.', {
        tasks: [],
        taskStats: { total: 0, completed: 0, inProgress: 0 },
      }),
      scenario('complete', 'Complete', 'Complete progress and merged PR remain compact.', {
        workspace: workspace('complete', {
          displayStatus: 'complete',
          statusMessage: 'Implementation and focused verification are complete.',
          activePullRequest: pr(74, {
            title: 'Polish workspace hover cards',
            status: PullRequestStatus.Merged,
          }),
        }),
        tasks: [task('complete-one', 'complete'), task('complete-two', 'complete')],
        taskStats: { total: 2, completed: 2, inProgress: 0 },
      }),
    ],
  },
  dense: {
    family: 'Dense',
    expected: 'Long optional content stays bounded; no more than six active rows render.',
    cards: [
      (() => {
        const agentIds = ['dense-one', 'dense-two', 'dense-three', 'dense-four', 'dense-five'];
        const ws = workspace('dense', {
          displayStatus: 'needs_attention',
          title: 'A dense workspace title that confirms the identity column remains stable',
          statusMessage:
            'This longer status message verifies that dense cards stay bounded while meaningful workspace context remains readable and available inside the identity column.',
          agentSummary: { agentIds },
          activePullRequest: pr(75, {
            title: 'A long pull request title that must not displace its number or terminal status',
            reviewDecision: 'CHANGES_REQUESTED',
          }),
        });
        return scenario(
          'dense',
          'Dense',
          'Three active rows, +2 overflow, selected PR, and changes.',
          {
            workspace: ws,
            tasks: mixedTasks,
            taskStats: { total: 5, completed: 1, inProgress: 3 },
            agents: agentIds.map((id, index) =>
              agent(
                ws.id,
                id,
                AgentStatus.Active,
                activityAgo(
                  [30_000, 4 * 60_000, 2 * 60 * 60_000, 24 * 60 * 60_000, 90 * 24 * 60 * 60_000][
                    index
                  ] ?? 0,
                ),
              ),
            ),
            diffSummary: {
              schemaVersion: 1,
              updatedAt: PREVIEW_FIXTURE_TIMESTAMPS.updatedAt,
              totalFiles: 12,
              totalAdditions: 144,
              totalDeletions: 55,
              files: [],
            },
            gitSummary: { ahead: 4, behind: 1, hasUnpushed: true },
          },
        );
      })(),
    ],
  },
  narrow: {
    family: 'Narrow',
    expected:
      'The activity column stacks below identity; long descriptions truncate without overflow.',
    layout: 'narrow',
    cards: [
      (() => {
        const ws = workspace('narrow', {
          displayStatus: 'in_progress',
          statusMessage:
            'This long workspace description confirms that the narrow stacked card shows an ellipsis instead of overflowing its available width.',
          agentSummary: { agentIds: ['narrow-agent'] },
          activePullRequest: pr(76, { title: 'Keep narrow hover cards readable' }),
        });
        return scenario(
          'narrow',
          'Narrow stack',
          'Identity appears before activity and PR details.',
          {
            workspace: ws,
            tasks: [task('narrow-progress', 'in_progress'), task('narrow-todo', 'not_started')],
            taskStats: { total: 2, completed: 0, inProgress: 1 },
            agents: [
              agent(ws.id, 'narrow-agent', AgentStatus.Active, activityAgo(24 * 60 * 60_000)),
            ],
          },
        );
      })(),
    ],
  },
  readiness: {
    family: 'Input readiness',
    expected: 'Skeleton precedence and loaded replacement.',
    cards: [
      scenario('loading', 'Loading', 'Header and metadata skeletons.', { isLoading: true }),
      scenario('null', 'Null workspace', 'Header skeleton only.', { workspace: null }),
      scenario('loaded', 'Loaded', 'Complete card content.'),
    ],
  },
  'identity-lifecycle': {
    family: 'Identity and lifecycle',
    expected: 'Fallbacks are safe and archived metadata is additive.',
    cards: [
      scenario('untitled', 'Untitled + local', 'Untitled and Local repository fallbacks.', {
        workspace: workspace('untitled', {
          title: '',
          repositoryOwner: undefined,
          repositoryName: undefined,
        }),
      }),
      scenario('repo-only', 'Repository name only', 'Repository name without an owner.', {
        workspace: workspace('repo-only', { repositoryOwner: undefined }),
      }),
      scenario('archived', 'Archived with date', 'Archived chip includes relative time.', {
        workspace: workspace('archived', {
          status: WorkspaceStatus.Archived,
          archived: true,
          archivedAt: PREVIEW_FIXTURE_TIMESTAMPS.updatedAt,
        }),
      }),
      scenario('archived-no-date', 'Archived without date', 'Archived chip has no time.', {
        workspace: workspace('archived-no-date', {
          status: WorkspaceStatus.Archived,
          archived: true,
        }),
      }),
      scenario('deleted', 'Stale deleted input', 'Renders safely without an archived chip.', {
        workspace: workspace('deleted', { status: WorkspaceStatus.Deleted }),
      }),
    ],
  },
  'semantic-status': {
    family: 'Semantic status',
    expected:
      'Every normally cased canonical status appears only in the right column, plus both fallback inputs.',
    cards: [
      ...statuses.map((status) =>
        scenario(`status-${status.replaceAll('_', '-')}`, status, `Renders ${status}.`, {
          workspace: workspace(`status-${status.replaceAll('_', '-')}`, {
            displayStatus: status,
          }),
        }),
      ),
      scenario('status-absent', 'Absent status', 'Falls back to Not started.', {
        workspace: workspace('status-absent', { displayStatus: undefined }),
      }),
      scenario('status-unknown', 'Unknown status', 'Falls back to Not started.', {
        workspace: workspace('status-unknown', { displayStatus: 'future_status' as never }),
      }),
    ],
  },
  overlays: {
    family: 'Overlay precedence',
    expected: 'High-priority status > unread > waiting > base status.',
    cards: [
      scenario('unread', 'Unread', 'Unread replaces idle.', {
        workspace: workspace('unread', { displayStatus: 'idle', attention: 'unread' }),
      }),
      scenario('waiting', 'Waiting', 'Waiting replaces idle.', {
        workspace: workspace('waiting', { displayStatus: 'idle', waiting: true }),
      }),
      scenario('both-overlays', 'Unread + waiting', 'Unread wins.', {
        workspace: workspace('both-overlays', {
          displayStatus: 'idle',
          attention: 'unread',
          waiting: true,
        }),
      }),
      scenario('blocked-overlays', 'Blocked + overlays', 'Blocked wins.', {
        workspace: workspace('blocked-overlays', {
          displayStatus: 'blocked',
          attention: 'unread',
          waiting: true,
        }),
      }),
      scenario('progress-overlays', 'In progress + overlays', 'In progress wins.', {
        workspace: workspace('progress-overlays', {
          displayStatus: 'in_progress',
          attention: 'unread',
          waiting: true,
        }),
      }),
      scenario(
        'review-attention',
        'Review required attention',
        'Keeps idle; does not become unread.',
        {
          workspace: workspace('review-attention', {
            displayStatus: 'idle',
            attention: 'review_required',
          }),
        },
      ),
    ],
  },
  messages: {
    family: 'Status message',
    expected: 'Empty values stay absent; meaningful values truncate with an ellipsis.',
    cards: [
      scenario('message-absent', 'Absent', 'No message row.', {
        workspace: workspace('message-absent', { statusMessage: undefined }),
      }),
      scenario('message-space', 'Whitespace', 'No message row.', {
        workspace: workspace('message-space', { statusMessage: '   ' }),
      }),
      scenario('message-short', 'Short', 'One readable line.', {
        workspace: workspace('message-short', {
          statusMessage: 'Ready for focused visual review.',
        }),
      }),
      scenario(
        'message-multiline',
        'Multiline',
        'Visible text truncates; title preserves full text.',
        {
          workspace: workspace('message-multiline', {
            statusMessage: 'Implementation complete.\nVerification is in progress.',
          }),
        },
      ),
      scenario('message-unbroken', 'Long unbroken', 'Ellipsis stays within card width.', {
        workspace: workspace('message-unbroken', {
          statusMessage: 'averylongunbrokenstatusmessage'.repeat(8),
        }),
      }),
    ],
  },
  tasks: {
    family: 'Task progress',
    expected: 'Loading, empty, detailed, excluded, complete, and aggregate states.',
    cards: [
      scenario('tasks-loading', 'Not initialized', 'Progress placeholder.'),
      scenario('tasks-empty', 'No tasks', 'Initialized empty track.', {
        tasks: [],
        taskStats: { total: 0, completed: 0, inProgress: 0 },
      }),
      scenario('tasks-zero', 'Zero progress', 'All not-started segment.', {
        tasks: [task('z1', 'not_started'), task('z2', 'not_started')],
        taskStats: { total: 2, completed: 0, inProgress: 0 },
      }),
      scenario('tasks-mixed', 'Mixed + cancelled', 'Three treatments; cancelled excluded.', {
        tasks: mixedTasks,
        taskStats: { total: 5, completed: 1, inProgress: 3 },
      }),
      scenario('tasks-complete', 'Complete', 'Full completed segment.', {
        tasks: [task('c1', 'complete'), task('c2', 'complete')],
        taskStats: { total: 2, completed: 2, inProgress: 0 },
      }),
      scenario(
        'tasks-aggregate',
        'Aggregate fallback',
        'Aggregate wins when detail count differs.',
        {
          tasks: [task('known', 'complete')],
          taskStats: { total: 4, completed: 2, inProgress: 1 },
        },
      ),
    ],
  },
  agents: {
    family: 'Agent activity',
    expected: 'Top-level agent activity appears only in the table and caps at six rows.',
    cards: [
      scenario('agents-none', 'No agents', 'No agent section.'),
      scenario(
        'agents-unloaded',
        'Unloaded member',
        'Idle placeholder does not render as active.',
        {
          workspace: workspace('agents-unloaded', {
            agentSummary: { agentIds: ['agent-unloaded'] },
          }),
        },
      ),
      (() => {
        const ws = workspace('agents-active', {
          agentSummary: {
            agentIds: [
              'running-agent',
              'responding-agent',
              'waiting-agent',
              'background-agent',
              'processing-agent',
            ],
          },
        });
        return scenario('agents-active', 'Active overflow', 'Three rows plus +2 more.', {
          workspace: ws,
          agents: [
            agent(ws.id, 'running-agent', AgentStatus.Active),
            agent(ws.id, 'responding-agent', 'responding' as AgentSession['status']),
            agent(ws.id, 'waiting-agent', 'waiting' as AgentSession['status']),
            agent(ws.id, 'background-agent', AgentStatus.Active, { isBackground: true }),
            agent(ws.id, 'processing-agent', AgentStatus.Active, { isProcessing: true }),
          ],
        });
      })(),
      scenario('agents-unread', 'Unread members', 'Unloaded unread members add no identity row.', {
        workspace: workspace('agents-unread', {
          attention: 'unread',
          agentSummary: { agentIds: ['unread-one', 'unread-two'] },
        }),
      }),
      scenario(
        'agents-unread-top-level',
        'Unread top-level only',
        'Delegated children stay out of the activity table.',
        {
          workspace: workspace('agents-unread-top-level', {
            attention: 'unread',
            agentSummary: {
              agentIds: ['unread-root', 'unread-delegated'],
              agents: [
                { id: 'unread-root', name: 'Coordinator', status: 'idle' },
                {
                  id: 'unread-delegated',
                  name: 'Implementor',
                  status: 'idle',
                  parentAgentId: 'unread-root',
                },
              ],
            } as Workspace['agentSummary'],
          }),
        },
      ),
    ],
  },
  'pull-requests': {
    family: 'Pull requests',
    expected: 'One selected PR row with safe metadata fallbacks.',
    cards: [
      scenario('pr-none', 'No PR', 'No PR row.'),
      scenario('pr-open', 'Open + pending CI', 'Number and pending CI.', {
        workspace: workspace('pr-open', {
          activePullRequest: pr(41, { ciStatus: { total: 4, passed: 3, failed: 0, pending: 1 } }),
        }),
      }),
      scenario('pr-draft', 'Draft', 'Draft overrides open.', {
        workspace: workspace('pr-draft', { activePullRequest: pr(42, { isDraft: true }) }),
      }),
      scenario('pr-merged', 'Merged + approved', 'Merged and approved.', {
        workspace: workspace('pr-merged', {
          activePullRequest: pr(43, {
            status: PullRequestStatus.Merged,
            reviewDecision: 'APPROVED',
          }),
        }),
      }),
      scenario(
        'pr-failed',
        'Closed + conflicts',
        'Conflict, failed CI, and review request use danger treatment.',
        {
          workspace: workspace('pr-failed', {
            activePullRequest: pr(44, {
              status: PullRequestStatus.Closed,
              mergeConflicts: true,
              ciStatus: { total: 3, passed: 1, failed: 2, pending: 0 },
              reviewDecision: 'CHANGES_REQUESTED',
            }),
          }),
        },
      ),
      scenario('pr-list', 'List fallback + multiple', 'Only first list item renders.', {
        workspace: workspace('pr-list', {
          pullRequests: [pr(45), pr(46, { status: PullRequestStatus.Merged })],
        }),
      }),
      scenario('pr-legacy', 'Legacy fields', 'Legacy row renders when no PR object exists.', {
        workspace: workspace('pr-legacy', {
          prNumber: 47,
          prStatus: PullRequestStatus.Open,
          prUrl: 'https://github.com/intent-hq/cloudlands-fe/pull/47',
        }),
      }),
      scenario('pr-malformed', 'Missing title and number', 'Generic title; number is omitted.', {
        workspace: workspace('pr-malformed', { activePullRequest: pr(0, { title: '' }) }),
      }),
      scenario('pr-long', 'Long title', 'Title truncates.', {
        workspace: workspace('pr-long', {
          activePullRequest: pr(48, {
            title:
              'A very long pull request title that must truncate without displacing status metadata'.repeat(
                2,
              ),
          }),
        }),
      }),
    ],
  },
  'changes-recency': {
    family: 'Changes and recency',
    expected: 'Optional metadata stays absent and fallback order is deterministic.',
    cards: [
      scenario('changes-none', 'Clean + no activity', 'No changes; no recent activity.', {
        workspace: workspace('changes-none', { lastActivity: undefined, updatedAt: 'invalid' }),
        gitSummary: { ahead: 0, behind: 0, hasUnpushed: false },
      }),
      scenario('changes-lines', 'Line stats', 'Local line-stat fallback.'),
      scenario('changes-diff', 'Detailed diff wins', 'Detailed diff replaces line stats.', {
        diffSummary: {
          schemaVersion: 1,
          updatedAt: PREVIEW_FIXTURE_TIMESTAMPS.updatedAt,
          totalFiles: 2,
          totalAdditions: 13,
          totalDeletions: 5,
          files: [],
        },
      }),
      scenario('changes-ahead', 'Ahead', 'Commit count ahead remote.', {
        gitSummary: { ahead: 2, behind: 0, hasUnpushed: true },
      }),
      scenario('changes-behind', 'Behind', 'Commit count behind remote.', {
        gitSummary: { ahead: 0, behind: 2, hasUnpushed: false },
      }),
      scenario('changes-diverged', 'Diverged + diff', 'Diff and +ahead/-behind combine once.', {
        diffSummary: {
          schemaVersion: 1,
          updatedAt: PREVIEW_FIXTURE_TIMESTAMPS.updatedAt,
          totalFiles: 3,
          totalAdditions: 21,
          totalDeletions: 7,
          files: [],
        },
        gitSummary: { ahead: 3, behind: 1, hasUnpushed: true },
      }),
      scenario('changes-unpushed', 'Unpushed only', 'Local commits not pushed.', {
        gitSummary: { ahead: 0, behind: 0, hasUnpushed: true },
      }),
    ],
  },
  media: {
    family: 'Status media',
    expected: 'Hover cards intentionally omit status images.',
    cards: [
      scenario('media-none', 'No status image', 'No media row.'),
      scenario('media-present', 'Status image present', 'Still no media row.', {
        workspace: workspace('media-present', { statusImageAssetId: 'preview-status-image' }),
      }),
      scenario('media-failed', 'Failed image reference', 'No broken image element.', {
        workspace: workspace('media-failed', { statusImageAssetId: 'missing-preview-image' }),
      }),
    ],
  },
  'long-content': {
    family: 'Responsive and long content',
    expected: 'Use theme and width query controls; content stays within the card.',
    cards: [
      scenario(
        'long-content',
        'Long vertical content',
        'Title/repo/description/PR truncate; agent and task density stays bounded.',
        {
          workspace: workspace('long-content', {
            title:
              'An intentionally long workspace title that confirms safe truncation in the hover card header',
            repositoryOwner: 'very-long-preview-organization',
            repositoryName: 'very-long-repository-name-for-responsive-clamping',
            statusMessage:
              'This deterministic workspace description is long enough to require a visible ellipsis while all optional rows remain readable below it.',
            activePullRequest: pr(99, {
              title:
                'A long pull request title that must truncate without moving the number or metadata',
            }),
            agentSummary: {
              agentIds: ['long-agent-1', 'long-agent-2', 'long-agent-3', 'long-agent-4'],
            },
          }),
          activeAgentIds: ['long-agent-1', 'long-agent-2', 'long-agent-3', 'long-agent-4'],
          tasks: mixedTasks,
          taskStats: { total: 5, completed: 1, inProgress: 3 },
          diffSummary: {
            schemaVersion: 1,
            updatedAt: PREVIEW_FIXTURE_TIMESTAMPS.updatedAt,
            totalFiles: 12,
            totalAdditions: 144,
            totalDeletions: 55,
            files: [],
          },
          gitSummary: { ahead: 12, behind: 4, hasUnpushed: true },
        },
      ),
    ],
  },
  placement: {
    family: 'Viewport placement',
    expected: 'Production HoverCard flips or clamps and responds to scroll/resize.',
    placement: 'right-edge',
    cards: [
      scenario('placement', 'Right-edge trigger', 'Card uses the production placement wrapper.', {
        workspace: workspace('placement', {
          statusMessage: 'Placement fixture with enough height to exercise collision handling.',
        }),
      }),
    ],
  },
};

function firstSceneCard(name: string) {
  const card = scenes[name]?.cards[0];
  if (!card) throw new Error(`Missing workspace hover-card scene: ${name}`);
  return card;
}

function dockTailSurfaceCards(): HoverCardScenario[] {
  const sourceCards = [
    firstSceneCard('working'),
    scenes.attention?.cards.find(({ key }) => key === 'attention-four-questions'),
    firstSceneCard('idle-complete'),
  ];
  return sourceCards.map((card, index) => {
    if (!card) throw new Error('Missing workspace hover-card dock-tail surface scene');
    const position = index === 0 ? 'third-last' : index === 1 ? 'second-last' : 'last';
    return {
      ...card,
      key: `surface-${position}`,
      label: `${position.replace('-', ' ')} dock item`,
      expected: 'The opaque elevated surface remains distinct from the dock plate.',
    };
  });
}

scenes['landscape-wide'] = {
  ...scenes.working,
  family: 'Landscape wide',
};
scenes['landscape-light'] = {
  ...scenes.working,
  family: 'Landscape light',
  theme: 'light',
  cards: dockTailSurfaceCards(),
};
scenes['landscape-dark'] = {
  ...scenes.working,
  family: 'Landscape dark',
  theme: 'dark',
  cards: dockTailSurfaceCards(),
};
scenes['landscape-narrow'] = {
  ...scenes.narrow,
  family: 'Landscape narrow',
  theme: 'light',
};
scenes['landscape-loading'] = {
  family: 'Landscape loading',
  expected: 'The loading shell keeps the landscape footprint without exposing loaded content.',
  theme: 'light',
  cards: [firstSceneCard('readiness')],
};
scenes['landscape-question'] = {
  family: 'Landscape question',
  expected: 'The first real question and its count remain readable in the activity column.',
  theme: 'light',
  cards: [scenes.attention?.cards[1] ?? firstSceneCard('attention')],
};

function clearCards(cards: readonly HoverCardScenario[]) {
  for (const card of cards) {
    const workspaceId = card.workspace?.id;
    if (!workspaceId) continue;
    appStore.dispatch(clearWorkspaceTasks(String(workspaceId)));
    appStore.dispatch(clearWorkspaceSummaries(String(workspaceId)));
    appStore.dispatch(removeWorkspaceSessions(String(workspaceId)));
    appStore.dispatch(removeWorkspaceAgentState(String(workspaceId)));
  }
}

export function setupWorkspaceHoverCardPreviewCards(cards: readonly HoverCardScenario[]) {
  clearCards(cards);
  for (const card of cards) {
    const workspaceId = card.workspace?.id;
    if (!workspaceId) continue;
    const id = String(workspaceId);
    if (card.tasks || card.taskStats)
      appStore.dispatch(
        loadWorkspaceTasksSucceeded(
          id,
          card.tasks ?? [],
          card.taskStats ?? { total: 0, completed: 0, inProgress: 0 },
        ),
      );
    if (card.diffSummary !== undefined || card.gitSummary !== undefined)
      appStore.dispatch(
        loadWorkspaceSummariesSucceeded(id, card.diffSummary ?? null, card.gitSummary ?? null),
      );
    if (card.agents) {
      appStore.dispatch(bulkUpsertSessions(card.agents));
      appStore.dispatch(setAgents(id, card.agents));
    }
  }
  return () => clearCards(cards);
}

export const workspaceHoverCardPreview: PreviewDefinition<WorkspaceHoverCardPreviewProps> =
  definePreview({
    id: 'workspace-hover-card',
    title: 'Workspace hover card',
    defaultState: 'working',
    states: Object.fromEntries(
      Object.entries(scenes).map(([name, props]) => [
        name,
        { props, setup: () => setupWorkspaceHoverCardPreviewCards(props.cards) },
      ]),
    ),
  });
