import { describe, expect, it } from 'vitest';
import type { AgentMessage, AgentSession, WorkspaceTask } from '$shared/types';
import {
  deriveTaskProgress,
  deriveWorkspaceTaskFallback,
  hasNativeExecutionPlan,
} from '../workspace-task-fallback';

const tasks: WorkspaceTask[] = [
  { id: 'root-1', title: 'First root task', status: 'not_started', specLinked: true },
  { id: 'nested', title: 'Nested task', status: 'waiting', specLinked: false },
  { id: 'root-2', title: 'Second root task', status: 'in_progress', specLinked: true },
  { id: 'cancelled', title: 'Cancelled root task', status: 'cancelled', specLinked: true },
];

const legacyTasks: WorkspaceTask[] = [
  { id: 'legacy-root', title: 'Legacy root task', status: 'not_started' },
  { id: 'legacy-running', title: 'Legacy running task', status: 'in_progress' },
  { id: 'legacy-cancelled', title: 'Legacy cancelled task', status: 'cancelled' },
];

function session(taskNoteId?: string): AgentSession {
  return {
    id: 'agent-1',
    backendSessionId: null,
    workspaceId: 'ws-1',
    name: taskNoteId ? 'Implementor' : 'Coordinator',
    status: 'idle',
    messages: [],
    createdAt: '2026-08-22T00:00:00Z',
    updatedAt: '2026-08-22T00:00:00Z',
    metadata: taskNoteId ? { taskNoteId } : undefined,
  } as AgentSession;
}

const nativePlanMessage = {
  id: 'message-1',
  role: 'assistant',
  contentBlocks: [
    {
      type: 'plan',
      entries: [{ content: 'Use the native plan', priority: 'high', status: 'in_progress' }],
    },
  ],
} as AgentMessage;

const emptyNativePlanMessage = {
  ...nativePlanMessage,
  id: 'message-empty',
  contentBlocks: [{ type: 'plan', id: 'message-empty:plan', entries: [] }],
} as AgentMessage;

describe('workspace task fallback routing', () => {
  it('preserves native plan precedence after transcript hydration or reload', () => {
    expect(hasNativeExecutionPlan([nativePlanMessage])).toBe(true);
    expect(
      deriveWorkspaceTaskFallback({
        initialized: true,
        tasks,
        session: session(),
        messages: [nativePlanMessage],
      }),
    ).toEqual([]);
  });

  it('treats an empty-only native plan as present and suppresses workspace fallback', () => {
    expect(hasNativeExecutionPlan([emptyNativePlanMessage])).toBe(true);
    expect(
      deriveWorkspaceTaskFallback({
        initialized: true,
        tasks,
        session: session(),
        messages: [emptyNativePlanMessage],
      }),
    ).toEqual([]);
    expect(
      deriveTaskProgress({
        initialized: true,
        tasks,
        session: session(),
        messages: [emptyNativePlanMessage],
      }),
    ).toEqual([]);
  });

  it('lets a later empty native plan clear an older non-empty snapshot', () => {
    expect(
      deriveTaskProgress({
        initialized: true,
        tasks,
        session: session(),
        messages: [nativePlanMessage, emptyNativePlanMessage],
      }),
    ).toEqual([]);
  });

  it('uses workspace fallback only when no valid native plan is present', () => {
    const malformedPlanMessage = {
      ...nativePlanMessage,
      contentBlocks: [{ type: 'plan', entries: [{ content: 'Missing status' }] }],
    } as AgentMessage;

    expect(hasNativeExecutionPlan([malformedPlanMessage])).toBe(false);
    expect(
      deriveTaskProgress({
        initialized: true,
        tasks,
        session: session(),
        messages: [malformedPlanMessage],
      }),
    ).toEqual([
      { id: 'workspace:root-1', title: 'First root task', status: 'pending' },
      { id: 'workspace:root-2', title: 'Second root task', status: 'running' },
    ]);
  });

  it('ignores hostile in-memory message and block shapes without rendering undefined plan data', () => {
    const hostileMessages = [
      {
        id: 'array-like-blocks',
        contentBlocks: {
          length: 1,
          0: {
            type: 'plan',
            entries: [{ content: 'Must not render', priority: 'high', status: 'in_progress' }],
          },
        },
      },
      {
        id: 'malformed-plans',
        contentBlocks: [
          null,
          { type: 'plan', entries: { length: 1 } },
          { type: 'plan', entries: [{}] },
        ],
      },
      { id: 'null-blocks', contentBlocks: null },
      null,
    ] as unknown as AgentMessage[];

    const progress = deriveTaskProgress({
      initialized: true,
      tasks,
      session: session(),
      messages: hostileMessages,
    });

    expect(progress).toEqual([
      { id: 'workspace:root-1', title: 'First root task', status: 'pending' },
      { id: 'workspace:root-2', title: 'Second root task', status: 'running' },
    ]);
    expect(progress.every((item) => item.title !== undefined && item.status !== undefined)).toBe(
      true,
    );
  });

  it('shows spec-linked root tasks in canonical source order for a no-plan Coordinator', () => {
    expect(
      deriveWorkspaceTaskFallback({ initialized: true, tasks, session: session(), messages: [] }),
    ).toEqual([tasks[0], tasks[2]]);
  });

  it('preserves the legacy non-cancelled fallback when every task omits specLinked', () => {
    expect(
      deriveWorkspaceTaskFallback({
        initialized: true,
        tasks: legacyTasks,
        session: session(),
        messages: [],
      }),
    ).toEqual([legacyTasks[0], legacyTasks[1]]);
  });

  it('treats a mixed payload as modern and selects only explicitly spec-linked tasks', () => {
    const mixedTasks: WorkspaceTask[] = [
      legacyTasks[0],
      { id: 'modern-linked', title: 'Modern linked task', status: 'waiting', specLinked: true },
      {
        id: 'modern-unlinked',
        title: 'Modern unlinked task',
        status: 'in_progress',
        specLinked: false,
      },
      legacyTasks[2],
    ];

    expect(
      deriveWorkspaceTaskFallback({
        initialized: true,
        tasks: mixedTasks,
        session: session(),
        messages: [],
      }),
    ).toEqual([mixedTasks[1]]);
  });

  it('shows only the linked task for a delegated agent', () => {
    expect(
      deriveWorkspaceTaskFallback({
        initialized: true,
        tasks,
        session: session('nested'),
        messages: [],
      }),
    ).toEqual([tasks[1]]);
  });

  it('keeps loading, cancelled, missing-link, and empty states hidden', () => {
    expect(
      deriveWorkspaceTaskFallback({ initialized: false, tasks, session: session(), messages: [] }),
    ).toEqual([]);
    expect(
      deriveWorkspaceTaskFallback({
        initialized: true,
        tasks,
        session: session('cancelled'),
        messages: [],
      }),
    ).toEqual([]);
    expect(
      deriveWorkspaceTaskFallback({
        initialized: true,
        tasks,
        session: session('missing'),
        messages: [],
      }),
    ).toEqual([]);
    expect(
      deriveWorkspaceTaskFallback({
        initialized: true,
        tasks: [],
        session: session(),
        messages: [],
      }),
    ).toEqual([]);
  });

  it('uses the latest canonical task status without a separate cache', () => {
    const updatedTasks = tasks.map((task) =>
      task.id === 'root-2' ? { ...task, status: 'review_required' as const } : task,
    );
    const [first, second] = deriveWorkspaceTaskFallback({
      initialized: true,
      tasks: updatedTasks,
      session: session(),
      messages: [],
    });
    expect(first.status).toBe('not_started');
    expect(second.status).toBe('review_required');
  });

  it('maps the latest of repeated native plan snapshots in stable entry order', () => {
    const newerPlan = {
      ...nativePlanMessage,
      id: 'message-2',
      contentBlocks: [
        {
          type: 'plan',
          id: 'message-2:plan',
          entries: [
            { content: 'Done natively', priority: 'high', status: 'completed' },
            { content: 'Running natively', priority: 'medium', status: 'in_progress' },
            { content: 'Pending natively', priority: 'low', status: 'pending' },
          ],
        },
      ],
    } as AgentMessage;

    expect(
      deriveTaskProgress({
        initialized: true,
        tasks,
        session: session(),
        messages: [nativePlanMessage, newerPlan],
      }),
    ).toEqual([
      { id: 'plan:message-2:plan:0', title: 'Done natively', status: 'completed' },
      { id: 'plan:message-2:plan:1', title: 'Running natively', status: 'running' },
      { id: 'plan:message-2:plan:2', title: 'Pending natively', status: 'pending' },
    ]);
  });

  it('maps the unchanged root and delegated fallback scope into progress rows', () => {
    expect(
      deriveTaskProgress({ initialized: true, tasks, session: session(), messages: [] }),
    ).toEqual([
      { id: 'workspace:root-1', title: 'First root task', status: 'pending' },
      { id: 'workspace:root-2', title: 'Second root task', status: 'running' },
    ]);
    expect(
      deriveTaskProgress({
        initialized: true,
        tasks,
        session: session('nested'),
        messages: [],
      }),
    ).toEqual([{ id: 'workspace:nested', title: 'Nested task', status: 'waiting' }]);
  });
});
