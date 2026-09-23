import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '$shared/types';
import {
  groupIntoTurns,
  hasOperationalAssistantMessageBoundary,
  hasOperationalAssistantTurnBoundary,
  hasToolOnlyAssistantMessageBoundary,
  hasToolOnlyAssistantTurnBoundary,
  indexConversationTurns,
  isOperationalOnlyAssistantMessage,
  isToolOnlyAssistantMessage,
} from '../conversation-turns';

const message = (id: string, role: AgentMessage['role'], type?: string): AgentMessage =>
  ({ id, role, contentBlocks: [], metadata: type ? { type } : undefined }) as AgentMessage;

const systemNotice = (id: string, kind: string): AgentMessage => ({
  ...message(id, 'system'),
  contentBlocks: [{ type: 'text', text: 'A persisted notice', meta: { kind } }],
});

describe('conversation turn indexing', () => {
  it.each(['blocker-report', 'discussion-request', 'turn-failure', 'interruption'])(
    'keeps %s in transcript order without counting it as assistant output',
    (kind) => {
      const indexed = indexConversationTurns([
        {
          messages: [
            message('user', 'user'),
            message('before', 'assistant'),
            systemNotice('notice', kind),
            message('after', 'assistant'),
            message('next-user', 'user'),
          ],
        },
      ]);
      const turns = indexed.groups[0].turns;
      expect(turns).toHaveLength(2);
      expect(turns[0].bodyMessages?.map(({ id, role }) => [id, role])).toEqual([
        ['before', 'assistant'],
        ['notice', 'system'],
        ['after', 'assistant'],
      ]);
      expect(turns[0].assistantMessages.map(({ id }) => id)).toEqual(['before', 'after']);
      expect(turns[0].noticeMessages).toEqual([]);
      expect(indexed.turnKeyByMessageId.get('notice')).toBe('user');
      expect(indexed.globalIndexByTurnKey.get('next-user')).toBe(1);
    },
  );

  it.each(['blocker-report', 'discussion-request', 'turn-failure', 'interruption'])(
    'indexes an orphan %s notice in a standalone history group',
    (kind) => {
      const indexed = indexConversationTurns([
        { groupKey: 'older', messages: [systemNotice('notice', kind)] },
        { groupKey: 'tail', messages: [message('user', 'user')] },
      ]);
      expect(indexed.groups[0].turns[0]?.bodyMessages?.map(({ id }) => id)).toEqual(['notice']);
      expect(indexed.groups[0].turns[0]?.assistantMessages).toEqual([]);
      expect(indexed.turnKeyByMessageId.get('notice')).toBe('group-older-turn-0');
      expect(indexed.globalIndexByTurnKey.get('user')).toBe(1);
    },
  );

  it('groups orphan responses, user turns, assistants, and model notices once', () => {
    const messages = [
      message('orphan', 'assistant'),
      message('user-1', 'user'),
      message('assistant-1', 'assistant'),
      message('notice-1', 'system', 'model_changed'),
      message('ignored-system', 'system'),
      message('user-2', 'user'),
    ];

    const turns = groupIntoTurns(messages);
    expect(turns).toHaveLength(3);
    expect(turns[0].assistantMessages.map(({ id }) => id)).toEqual(['orphan']);
    expect(turns[1].userMessage?.id).toBe('user-1');
    expect(turns[1].assistantMessages.map(({ id }) => id)).toEqual(['assistant-1']);
    expect(turns[1].bodyMessages.map(({ id }) => id)).toEqual(['assistant-1']);
    expect(turns[1].noticeMessages.map(({ id }) => id)).toEqual(['notice-1']);
    expect(turns[2].userMessage?.id).toBe('user-2');
  });

  it('keeps the provider re-home notice before the turn body and indexes it (intent#5737)', () => {
    const rehome = {
      ...message('rehome', 'system', 'provider_rehomed'),
      contentBlocks: [{ type: 'text', text: 'gpt-5-codex (OpenAI Codex) is no longer available' }],
    } as AgentMessage;
    const indexed = indexConversationTurns([
      { messages: [message('user', 'user'), rehome, message('reply', 'assistant')] },
    ]);
    const [turn] = indexed.groups[0].turns;
    expect(turn.noticeMessages.map(({ id }) => id)).toEqual(['rehome']);
    expect(turn.bodyMessages.map(({ id }) => id)).toEqual(['reply']);
    expect(turn.assistantMessages.map(({ id }) => id)).toEqual(['reply']);
    expect(indexed.turnKeyByMessageId.get('rehome')).toBe('user');
  });

  it('indexes an orphan provider re-home notice in a standalone history group', () => {
    const indexed = indexConversationTurns([
      { groupKey: 'older', messages: [message('rehome', 'system', 'provider_rehomed')] },
      { groupKey: 'tail', messages: [message('user', 'user')] },
    ]);
    expect(indexed.groups[0].turns[0]?.noticeMessages.map(({ id }) => id)).toEqual(['rehome']);
    expect(indexed.groups[0].turns[0]?.userMessage).toBeNull();
    expect(indexed.turnKeyByMessageId.get('rehome')).toBe('group-older-turn-0');
    expect(indexed.globalIndexByTurnKey.get('user')).toBe(1);
  });

  it('builds stable global and per-message indexes from the grouped turns', () => {
    const first = {
      label: 'Today',
      messages: [message('user-1', 'user'), message('assistant-1', 'assistant')],
    };
    const second = { label: 'Yesterday', messages: [message('orphan-2', 'assistant')] };

    const indexed = indexConversationTurns([first, second]);
    expect(indexed.groups.map(({ turns }) => turns.length)).toEqual([1, 1]);
    expect(indexed.globalIndexByTurnKey.get('user-1')).toBe(0);
    expect(indexed.globalIndexByTurnKey.get('group-1-turn-0')).toBe(1);
    expect(indexed.turnKeyByMessageId.get('assistant-1')).toBe('user-1');
    expect(indexed.turnKeyByMessageId.get('orphan-2')).toBe('group-1-turn-0');
  });

  it('classifies only visible tool-only assistant boundaries', () => {
    const toolMessage = (id: string) =>
      ({
        ...message(id, 'assistant'),
        contentBlocks: [
          { type: 'tool_use', id: `${id}-tool`, name: 'view', input: { path: 'src/a.ts' } },
          { type: 'tool_result', id: `${id}-result`, tool_use_id: `${id}-tool`, output: 'ok' },
          { type: 'text', text: '   ' },
        ],
      }) as AgentMessage;
    const first = toolMessage('tool-a');
    const second = toolMessage('tool-b');
    const prose = {
      ...message('prose', 'assistant'),
      contentBlocks: [{ type: 'text', text: 'Visible prose' }],
    } as AgentMessage;

    expect(isToolOnlyAssistantMessage(first)).toBe(true);
    expect(hasToolOnlyAssistantMessageBoundary(first, second)).toBe(true);
    expect(hasToolOnlyAssistantMessageBoundary(first, prose)).toBe(false);
    expect(hasToolOnlyAssistantMessageBoundary(message('user', 'user'), second)).toBe(false);
  });

  it('compacts assistant-only turn boundaries but not user or notice boundaries', () => {
    const tool = (id: string) =>
      ({
        ...message(id, 'assistant'),
        contentBlocks: [{ type: 'tool_use', id, name: 'view', input: { path: 'src/a.ts' } }],
      }) as AgentMessage;
    const [current, next] = groupIntoTurns([tool('a'), tool('b')]);

    expect(hasToolOnlyAssistantTurnBoundary(current, next)).toBe(true);
    expect(
      hasToolOnlyAssistantTurnBoundary(current, { ...next, userMessage: message('u', 'user') }),
    ).toBe(false);
    expect(
      hasToolOnlyAssistantTurnBoundary(current, {
        ...next,
        noticeMessages: [message('n', 'system', 'model_changed')],
      }),
    ).toBe(false);
    const [withNotice] = groupIntoTurns([
      message('user', 'user'),
      tool('a'),
      systemNotice('notice', 'blocker-report'),
    ]);
    expect(hasToolOnlyAssistantTurnBoundary(withNotice, next)).toBe(false);
  });

  it('compacts operational-only tool and reasoning turn boundaries without compacting prose', () => {
    const tool = {
      ...message('tool', 'assistant'),
      contentBlocks: [
        { type: 'tool_use', id: 'tool-call', name: 'view', input: { path: 'src/a.ts' } },
        { type: 'tool_result', id: 'result', tool_use_id: 'tool-call', output: 'ok' },
      ],
    } as AgentMessage;
    const reasoning = {
      ...message('reasoning', 'assistant'),
      contentBlocks: [{ type: 'thinking', id: 'thinking', text: 'Inspect the result' }],
    } as AgentMessage;
    const prose = {
      ...message('prose', 'assistant'),
      contentBlocks: [{ type: 'text', text: 'Visible prose' }],
    } as AgentMessage;
    const turn = (assistant: AgentMessage) => groupIntoTurns([assistant])[0];

    expect(isOperationalOnlyAssistantMessage(tool)).toBe(true);
    expect(isOperationalOnlyAssistantMessage(reasoning)).toBe(true);
    expect(isOperationalOnlyAssistantMessage(prose)).toBe(false);
    expect(hasOperationalAssistantMessageBoundary(tool, reasoning)).toBe(true);
    expect(hasOperationalAssistantMessageBoundary(reasoning, tool)).toBe(true);
    expect(hasOperationalAssistantMessageBoundary(tool, prose)).toBe(false);
    expect(hasOperationalAssistantTurnBoundary(turn(tool), turn(reasoning))).toBe(true);
    expect(hasOperationalAssistantTurnBoundary(turn(reasoning), turn(tool))).toBe(true);
    expect(hasOperationalAssistantTurnBoundary(turn(tool), turn(prose))).toBe(false);
    expect(
      hasOperationalAssistantTurnBoundary(turn(tool), turn(systemNotice('notice', 'interruption'))),
    ).toBe(false);
  });

  it('keeps consecutive notices while excluding unknown and non-system notice lookalikes', () => {
    const turns = groupIntoTurns([
      message('user', 'user'),
      systemNotice('first', 'blocker-report'),
      systemNotice('second', 'discussion-request'),
      systemNotice('unknown', 'unrecognized-kind'),
      { ...systemNotice('error', 'turn-failure'), role: 'error' },
      message('assistant', 'assistant'),
    ]);
    expect(turns[0].bodyMessages.map(({ id }) => id)).toEqual(['first', 'second', 'assistant']);
    expect(turns[0].assistantMessages.map(({ id }) => id)).toEqual(['assistant']);
  });
});
