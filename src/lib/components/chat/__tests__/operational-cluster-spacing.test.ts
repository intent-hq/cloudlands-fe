import { describe, expect, it } from 'vitest';
import {
  getOperationalClusterSpacingClass,
  isAdjacentOperationalClusterRow,
} from '../operational-disclosure-row';

const blocks = (...types: string[]) => types.map((type) => ({ type }));

describe('operational cluster spacing', () => {
  it('uses the 4px parent seam and adds 8px only before Thinking after prose or a tool', () => {
    const content = blocks('text', 'thinking', 'tool_use', 'tool_use', 'text');

    expect(content.map((_, index) => getOperationalClusterSpacingClass(content, index))).toEqual([
      '',
      'pt-2',
      '',
      '',
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
    'adds 8px before Thinking after %s for a 12px total seam',
    (previousType) => {
      expect(getOperationalClusterSpacingClass(blocks(previousType, 'thinking'), 1)).toBe('pt-2');
      expect(isAdjacentOperationalClusterRow(blocks(previousType, 'thinking'), 1)).toBe(false);
    },
  );

  it('adds 8px before Thinking after a notice for a 12px total seam', () => {
    expect(getOperationalClusterSpacingClass(blocks('notice', 'thinking'), 1)).toBe('pt-2');
    expect(isAdjacentOperationalClusterRow(blocks('notice', 'thinking'), 1)).toBe(false);
  });

  it('does not apply the Thinking seam adjustment to a tool row after a notice', () => {
    expect(getOperationalClusterSpacingClass(blocks('notice', 'tool_use'), 1)).toBe('');
  });

  it('does not add synthetic top space to first-child Thinking', () => {
    expect(getOperationalClusterSpacingClass(blocks('thinking'), 0)).toBe('');
  });

  it.each(['thinking', 'content_group'])(
    'leaves %s-to-Thinking adjacency to the shared 4px row contract',
    (previousType) => {
      const content = blocks(previousType, 'thinking');
      expect(getOperationalClusterSpacingClass(content, 1)).toBe('');
      expect(isAdjacentOperationalClusterRow(content, 1)).toBe(true);
    },
  );

  it('adds 8px to the parent-owned 4px seam from tool to Thinking', () => {
    const content = blocks('tool_use', 'thinking');
    expect(getOperationalClusterSpacingClass(content, 1)).toBe('pt-2');
    expect(isAdjacentOperationalClusterRow(content, 1)).toBe(true);
  });

  it('leaves a one-row boundary to its parent stack', () => {
    expect(getOperationalClusterSpacingClass(blocks('tool_use'), 0)).toBe('');
  });

  it('leaves non-operational seams to the 4px parent stack', () => {
    const content = blocks('text', 'image', 'proposal');

    expect(content.map((_, index) => getOperationalClusterSpacingClass(content, index))).toEqual([
      '',
      '',
      '',
    ]);
  });

  it('scans past hidden tool results without splitting a visible cluster', () => {
    const content = blocks('text', 'tool_use', 'tool_result', 'thinking', 'text');
    const visible = (block: { type: string }) => block.type !== 'tool_result';

    expect(
      content.map((_, index) => getOperationalClusterSpacingClass(content, index, visible)),
    ).toEqual([
      '',
      '',
      '',
      'pt-2',
      '',
    ]);
    expect(
      content.map((_, index) => isAdjacentOperationalClusterRow(content, index, visible)),
    ).toEqual([false, false, false, true, false]);
  });
});
