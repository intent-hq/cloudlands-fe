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

describe('conversation turn indexing', () => {
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
    expect(turns[1].noticeMessages.map(({ id }) => id)).toEqual(['notice-1']);
    expect(turns[2].userMessage?.id).toBe('user-2');
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
    const current = { userMessage: null, assistantMessages: [tool('a')], noticeMessages: [] };
    const next = { userMessage: null, assistantMessages: [tool('b')], noticeMessages: [] };

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
    const turn = (assistant: AgentMessage) => ({
      userMessage: null,
      assistantMessages: [assistant],
      noticeMessages: [],
    });

    expect(isOperationalOnlyAssistantMessage(tool)).toBe(true);
    expect(isOperationalOnlyAssistantMessage(reasoning)).toBe(true);
    expect(isOperationalOnlyAssistantMessage(prose)).toBe(false);
    expect(hasOperationalAssistantMessageBoundary(tool, reasoning)).toBe(true);
    expect(hasOperationalAssistantMessageBoundary(reasoning, tool)).toBe(true);
    expect(hasOperationalAssistantMessageBoundary(tool, prose)).toBe(false);
    expect(hasOperationalAssistantTurnBoundary(turn(tool), turn(reasoning))).toBe(true);
    expect(hasOperationalAssistantTurnBoundary(turn(reasoning), turn(tool))).toBe(true);
    expect(hasOperationalAssistantTurnBoundary(turn(tool), turn(prose))).toBe(false);
  });
});
