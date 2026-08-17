import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '$shared/types';
import { collectSearchRanges, findChatSearchMatches } from '../chat-search';

const assistant = (id: string, contentBlocks: AgentMessage['contentBlocks']): AgentMessage =>
  ({ id, role: 'assistant', contentBlocks }) as AgentMessage;

describe('chat search utilities', () => {
  it('indexes rendered text and excludes collapsed earlier response groups', () => {
    const message = assistant('assistant-1', [
      { type: 'text', text: '<group:Earlier>hidden match</group>' },
      { type: 'text', text: '<group:Latest>visible match</group>' },
    ]);

    expect(findChatSearchMatches([message], 'hidden', new Map())).toEqual([]);
    expect(findChatSearchMatches([message], 'match', new Map([['assistant-1', 'turn-1']]))).toEqual(
      [{ messageId: 'assistant-1', matchIndexInMessage: 0, turnKey: 'turn-1' }],
    );
  });

  it('does not index exact delivery notes on user messages', () => {
    const note =
      '[SYSTEM NOTE] This message was queued at 2026-01-01T00:00:00Z and waited 8s before delivery.';
    const message = {
      id: 'user-queued',
      role: 'user',
      contentBlocks: [{ type: 'text', text: `Visible prompt\n\n${note}` }],
      metadata: { queueInfo: { queuedAt: '2026-01-01T00:00:00Z', waitedMs: 8_000 } },
    } as AgentMessage;

    expect(findChatSearchMatches([message], 'Visible', new Map())).toHaveLength(1);
    expect(findChatSearchMatches([message], 'queued at', new Map())).toEqual([]);
  });

  it('creates a range for a match spanning multiple text nodes', () => {
    const element = document.createElement('div');
    element.innerHTML = '<span>cross</span><span>node</span><input value="ignored" />';
    const ranges = collectSearchRanges(element, 'crossnode');

    expect(ranges).toHaveLength(1);
    expect(ranges[0].toString()).toBe('crossnode');
  });
});
