import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '$shared/types';
import type { ConversationTurn } from './conversation-turns';
import { planAutomatedActivityRuns } from './automated-activity-runs';

function message(
  id: string,
  role: AgentMessage['role'],
  text: string,
  metadata?: Record<string, unknown>,
): AgentMessage {
  return {
    id,
    role,
    content: text,
    contentBlocks: [{ type: 'text', text }],
    timestamp: '2026-11-14T00:00:00.000Z',
    ...(metadata ? { metadata } : {}),
  } as unknown as AgentMessage;
}

function turn(user: AgentMessage | null, ...assistant: AgentMessage[]): ConversationTurn {
  return {
    userMessage: user,
    bodyMessages: assistant,
    assistantMessages: assistant,
    noticeMessages: [],
  };
}

const human = (id: string) =>
  turn(message(id, 'user', 'Please fix it'), message(`${id}-r`, 'assistant', 'Done'));
const hook = (id: string, source: string) =>
  turn(
    message(id, 'user', 'CI finished', { type: 'hook_wake', source: 'system', label: source }),
    message(`${id}-r`, 'assistant', 'Handled'),
  );
const orphan = (id: string) => turn(null, message(id, 'assistant', 'continued'));

const sourceLabel = (m: AgentMessage) =>
  typeof m.metadata?.label === 'string' ? (m.metadata.label as string) : null;

function plan(turns: Array<[string, ConversationTurn]>) {
  return planAutomatedActivityRuns(
    turns.map(([key, t]) => ({ key, turn: t })),
    { sourceLabel },
  );
}

describe('planAutomatedActivityRuns', () => {
  it('finds no runs in a transcript of human turns', () => {
    const result = plan([
      ['u1', human('u1')],
      ['u2', human('u2')],
    ]);
    expect(result.runs).toEqual([]);
    expect(result.runByTurnKey.size).toBe(0);
  });

  it('merges consecutive automated turns into one run with unique ordered sources', () => {
    const result = plan([
      ['u1', human('u1')],
      ['a1', hook('a1', 'CI watcher')],
      ['a2', hook('a2', 'Reviewer')],
      ['a3', hook('a3', 'CI watcher')],
      ['u2', human('u2')],
    ]);
    expect(result.runs).toHaveLength(1);
    const [run] = result.runs;
    expect(run).toMatchObject({
      id: 'a1',
      turnKeys: ['a1', 'a2', 'a3'],
      firstTurnKey: 'a1',
      lastTurnKey: 'a3',
      updateCount: 3,
      sources: ['CI watcher', 'Reviewer'],
    });
    expect(result.runByTurnKey.get('a2')).toBe(run);
    expect(result.runByTurnKey.has('u1')).toBe(false);
    expect(result.runByTurnKey.has('u2')).toBe(false);
  });

  it('starts a new run after a human turn', () => {
    const result = plan([
      ['a1', hook('a1', 'CI watcher')],
      ['u1', human('u1')],
      ['a2', hook('a2', 'Reviewer')],
    ]);
    expect(result.runs.map((run) => run.turnKeys)).toEqual([['a1'], ['a2']]);
  });

  it('keeps an assistant-only continuation inside the open run but not outside one', () => {
    const result = plan([
      ['o0', orphan('o0')],
      ['a1', hook('a1', 'CI watcher')],
      ['o1', orphan('o1')],
      ['u1', human('u1')],
    ]);
    expect(result.runByTurnKey.has('o0')).toBe(false);
    expect(result.runs[0].turnKeys).toEqual(['a1', 'o1']);
    expect(result.runs[0].updateCount).toBe(1);
  });

  it('treats Q&A answers as human and legacy prefixed rows as automated', () => {
    const answers = turn(
      message('qa', 'user', 'Yes, all three', { type: 'question_answers' }),
      message('qa-r', 'assistant', 'On it'),
    );
    const legacy = turn(
      message('lg', 'user', '[TASK WAKE] task done'),
      message('lg-r', 'assistant', 'ok'),
    );
    const result = plan([
      ['a1', hook('a1', 'CI watcher')],
      ['qa', answers],
      ['lg', legacy],
    ]);
    expect(result.runs.map((run) => run.turnKeys)).toEqual([['a1'], ['lg']]);
    expect(result.runs[1].sources).toEqual([]);
  });
});
