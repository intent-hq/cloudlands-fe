import { describe, expect, it, vi } from 'vitest';
import type { AgentMessage, AgentSession, WorkspaceTask } from '$shared/types';
import {
  createAgentTaskProgressDeriver,
  deriveAgentTaskProgress,
  type AgentTaskProgressInput,
} from '../agent-task-progress-derivation';
import { deriveTaskProgress, hasNativeExecutionPlan } from '../workspace-task-fallback';

const tasks: WorkspaceTask[] = [
  { id: 'task-1', title: 'Fallback task', status: 'in_progress', specLinked: false },
];

function session(agentId: string, messages: AgentMessage[] = []): AgentSession {
  return {
    id: agentId,
    backendSessionId: null,
    workspaceId: 'workspace-1',
    name: agentId,
    status: 'idle',
    messages,
    metadata: { taskNoteId: 'task-1' },
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  } as AgentSession;
}

function textMessage(id: string): AgentMessage {
  return { id, role: 'assistant', contentBlocks: [{ type: 'text', text: id }] } as AgentMessage;
}

function planMessage(id: string, title: string): AgentMessage {
  return {
    id,
    role: 'assistant',
    contentBlocks: [
      {
        type: 'plan',
        id: `${id}:plan`,
        entries: [{ content: title, priority: 'high', status: 'in_progress' }],
      },
    ],
  } as AgentMessage;
}

function input(
  agentId: string,
  overrides: Partial<AgentTaskProgressInput> = {},
): AgentTaskProgressInput {
  const liveMessages: AgentMessage[] = [];
  return {
    agentId,
    initialized: true,
    tasks,
    session: session(agentId, liveMessages),
    historyMessages: [],
    liveMessages,
    snapshotMeta: { truncated: false, totalMessages: 0, seq: 1 },
    ...overrides,
  };
}

function reference(value: AgentTaskProgressInput) {
  const messages = [...value.historyMessages, ...value.liveMessages];
  if (!hasNativeExecutionPlan(messages) && !value.snapshotMeta) return undefined;
  return deriveTaskProgress({
    initialized: value.initialized,
    tasks: value.tasks,
    session: value.session,
    messages,
  });
}

describe('incremental agent task progress derivation', () => {
  it('does not rederive many unchanged long transcripts after unrelated state replacement', () => {
    const measuredDerive = vi.fn(deriveAgentTaskProgress);
    const derive = createAgentTaskProgressDeriver(measuredDerive);
    const longHistory = Array.from({ length: 500 }, (_, index) => textMessage(`message-${index}`));
    const inputs = Array.from({ length: 32 }, (_, index) =>
      input(`agent-${index}`, { historyMessages: longHistory }),
    );

    expect(Object.keys(derive(inputs))).toHaveLength(32);
    expect(measuredDerive).toHaveBeenCalledTimes(32);

    expect(Object.keys(derive(inputs.map((value) => ({ ...value }))))).toHaveLength(32);
    expect(measuredDerive).toHaveBeenCalledTimes(32);

    const changed = inputs.map((value, index) => {
      if (index !== 7) return { ...value };
      const liveMessages = [...value.liveMessages, textMessage('new-live-message')];
      return { ...value, session: { ...value.session, messages: liveMessages }, liveMessages };
    });
    derive(changed);
    expect(measuredDerive).toHaveBeenCalledTimes(33);
  });

  it('rederives on every relevant reference change and matches reference behavior', () => {
    const measuredDerive = vi.fn(deriveAgentTaskProgress);
    const derive = createAgentTaskProgressDeriver(measuredDerive);
    let current = input('agent-1');

    const assertStep = (next: AgentTaskProgressInput, expectedCalls: number) => {
      current = next;
      expect(derive([current])[current.agentId]).toEqual(reference(current));
      expect(measuredDerive).toHaveBeenCalledTimes(expectedCalls);
    };

    assertStep(current, 1);
    assertStep({ ...current, historyMessages: [textMessage('history')] }, 2);
    assertStep({ ...current, liveMessages: [textMessage('live')] }, 3);
    assertStep({ ...current, snapshotMeta: { ...current.snapshotMeta!, seq: 2 } }, 4);
    assertStep({ ...current, tasks: [{ ...tasks[0], status: 'complete' }] }, 5);
    assertStep({ ...current, initialized: false }, 6);
    assertStep({ ...current, session: { ...current.session, metadata: {} } }, 7);
  });

  it('evicts removed agents and recomputes them when they are watched again', () => {
    const measuredDerive = vi.fn(deriveAgentTaskProgress);
    const derive = createAgentTaskProgressDeriver(measuredDerive);
    const first = input('agent-1');
    const second = input('agent-2');

    derive([first, second]);
    derive([first]);
    derive([first, second]);

    expect(measuredDerive).toHaveBeenCalledTimes(3);
  });

  it('matches reference output across readiness, reconnect, fallback, and native transitions', () => {
    const derive = createAgentTaskProgressDeriver();
    const steps: AgentTaskProgressInput[] = [];
    const initial = input('agent-1', { snapshotMeta: undefined });
    steps.push(initial);
    steps.push({ ...initial, snapshotMeta: { truncated: false, totalMessages: 0, seq: 1 } });
    const nativeLive = [planMessage('live-plan', 'Live native task')];
    steps.push({ ...steps.at(-1)!, liveMessages: nativeLive });
    steps.push({ ...steps.at(-1)!, snapshotMeta: undefined });
    steps.push({ ...steps.at(-1)!, liveMessages: [] });
    steps.push({ ...steps.at(-1)!, snapshotMeta: { truncated: false, totalMessages: 0, seq: 2 } });
    const nativeHistory = [planMessage('history-plan', 'Hydrated native task')];
    steps.push({ ...steps.at(-1)!, historyMessages: nativeHistory });

    for (const step of steps) {
      expect(derive([step])[step.agentId]).toEqual(reference(step));
    }
  });
});
