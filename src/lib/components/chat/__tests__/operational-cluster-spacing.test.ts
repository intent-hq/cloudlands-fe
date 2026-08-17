import { describe, expect, it } from 'vitest';
import {
  getOperationalClusterSpacingClass,
  isAdjacentOperationalClusterRow,
} from '../operational-disclosure-row';

const blocks = (...types: string[]) => types.map((type) => ({ type }));

describe('operational cluster spacing', () => {
  it('leaves adjacent spacing to the parent stack and owns 16px cluster boundaries', () => {
    const content = blocks('text', 'thinking', 'tool_use', 'tool_use', 'text');

    expect(content.map((_, index) => getOperationalClusterSpacingClass(content, index))).toEqual([
      '',
      'pt-[var(--chat-operational-text-gap,1rem)]',
      '',
      'pb-[var(--chat-operational-text-gap,1rem)]',
      '',
    ]);
  });

  it.each([
    ['tool to tool', 'tool_use', 'tool_use'],
    ['tool to reasoning', 'tool_use', 'thinking'],
    ['reasoning to tool', 'thinking', 'tool_use'],
    ['reasoning to context', 'thinking', 'tool_use'],
    ['context to tool', 'tool_use', 'tool_use'],
    ['group to tool', 'content_group', 'tool_use'],
    ['tool to group', 'tool_use', 'content_group'],
    ['group to group', 'content_group', 'content_group'],
  ])('marks the second row as adjacent for %s', (_name, firstType, secondType) => {
    const content = blocks(firstType, secondType);

    expect(content.map((_, index) => isAdjacentOperationalClusterRow(content, index))).toEqual([
      false,
      true,
    ]);
  });

  it.each(['attention_card', 'text', 'message', 'resource', 'proposal', 'image'])(
    'puts exactly 16px above Thinking when it follows %s',
    (previousType) => {
      expect(getOperationalClusterSpacingClass(blocks(previousType, 'thinking'), 1)).toBe(
        'pt-[var(--chat-operational-text-gap,1rem)] pb-4',
      );
      expect(isAdjacentOperationalClusterRow(blocks(previousType, 'thinking'), 1)).toBe(false);
    },
  );

  it('combines the notice bottom margin with 8px seam space for one 16px boundary', () => {
    expect(getOperationalClusterSpacingClass(blocks('notice', 'thinking'), 1)).toBe('pt-2 pb-4');
    expect(isAdjacentOperationalClusterRow(blocks('notice', 'thinking'), 1)).toBe(false);
  });

  it('does not apply the Thinking seam adjustment to a tool row after a notice', () => {
    expect(getOperationalClusterSpacingClass(blocks('notice', 'tool_use'), 1)).toBe(
      'pt-[var(--chat-operational-text-gap,1rem)] pb-4',
    );
  });

  it('does not add synthetic top space to first-child Thinking', () => {
    expect(getOperationalClusterSpacingClass(blocks('thinking'), 0)).toBe('pb-4');
  });

  it.each(['thinking', 'content_group'])(
    'leaves %s-to-Thinking adjacency to the shared 4px row contract',
    (previousType) => {
      const content = blocks(previousType, 'thinking');
      expect(getOperationalClusterSpacingClass(content, 1)).toBe('pb-4');
      expect(isAdjacentOperationalClusterRow(content, 1)).toBe(true);
    },
  );

  it('adds 8px to the parent-owned 4px seam from tool to Thinking', () => {
    const content = blocks('tool_use', 'thinking');
    expect(getOperationalClusterSpacingClass(content, 1)).toBe('pt-2 pb-4');
    expect(isAdjacentOperationalClusterRow(content, 1)).toBe(true);
  });

  it('gives a one-row boundary both outer margins', () => {
    expect(getOperationalClusterSpacingClass(blocks('tool_use'), 0)).toBe('pt-4 pb-4');
  });

  it('keeps the generic 10px rhythm between non-operational blocks', () => {
    const content = blocks('text', 'image', 'proposal');

    expect(content.map((_, index) => getOperationalClusterSpacingClass(content, index))).toEqual([
      '',
      'pt-2.5',
      'pt-2.5',
    ]);
  });

  it('scans past hidden tool results without splitting a visible cluster', () => {
    const content = blocks('text', 'tool_use', 'tool_result', 'thinking', 'text');
    const visible = (block: { type: string }) => block.type !== 'tool_result';

    expect(
      content.map((_, index) => getOperationalClusterSpacingClass(content, index, visible)),
    ).toEqual([
      '',
      'pt-[var(--chat-operational-text-gap,1rem)]',
      '',
      'pt-2 pb-[var(--chat-operational-text-gap,1rem)]',
      '',
    ]);
    expect(
      content.map((_, index) => isAdjacentOperationalClusterRow(content, index, visible)),
    ).toEqual([false, false, false, true, false]);
  });
});
