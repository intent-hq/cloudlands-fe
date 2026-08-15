import { describe, expect, it } from 'vitest';
import type { ContentBlock } from '$shared/types/content-block';
import { getResponseGroupBlockKey } from '../response-group-blocks';

describe('response group block identity', () => {
  it('uses each canonical block id before a shared tool owner id', () => {
    const first = {
      type: 'tool_result',
      id: 'message-1:2',
      toolUseId: 'tool-1',
      content: 'first',
    } as unknown as ContentBlock;
    const second = {
      type: 'tool_result',
      id: 'message-1:3',
      toolUseId: 'tool-1',
      content: 'second',
    } as unknown as ContentBlock;
    expect(getResponseGroupBlockKey(first, 0)).toBe('tool_result:message-1:2');
    expect(getResponseGroupBlockKey(second, 1)).toBe('tool_result:message-1:3');
  });
});
