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

  it('creates a range for a match spanning multiple text nodes', () => {
    const element = document.createElement('div');
    element.innerHTML = '<span>cross</span><span>node</span><input value="ignored" />';
    const ranges = collectSearchRanges(element, 'crossnode');

    expect(ranges).toHaveLength(1);
    expect(ranges[0].toString()).toBe('crossnode');
  });
});
