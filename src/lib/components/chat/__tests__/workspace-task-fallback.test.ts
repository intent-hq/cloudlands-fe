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

  it('shows spec-linked root tasks in canonical source order for a no-plan Coordinator', () => {
    expect(
      deriveWorkspaceTaskFallback({ initialized: true, tasks, session: session(), messages: [] }),
    ).toEqual([tasks[0], tasks[2]]);
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

  it('maps the newest native plan into stable progress rows before workspace tasks', () => {
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
