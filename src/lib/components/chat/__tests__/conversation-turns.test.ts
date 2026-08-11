import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '$shared/types';
import { groupIntoTurns, indexConversationTurns } from '../conversation-turns';

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
});