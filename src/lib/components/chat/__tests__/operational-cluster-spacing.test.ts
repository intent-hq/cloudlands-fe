import { describe, expect, it } from 'vitest';
import {
  getOperationalGroupContentSpacingClass,
  getOperationalClusterSpacingClass,
  isAdjacentOperationalClusterRow,
  isFollowedByOperationalClusterRow,
} from '../operational-disclosure-row';

const blocks = (...types: string[]) => types.map((type) => ({ type }));

describe('operational cluster spacing', () => {
  it('keeps chat tools flush and adds 16px at content boundaries', () => {
    const content = blocks('text', 'thinking', 'tool_use', 'tool_use', 'text');

    expect(content.map((_, index) => getOperationalClusterSpacingClass(content, index))).toEqual([
      '',
      'pt-4',
      '',
      '',
      'pt-4',
    ]);
  });

  it('adds 16px before group prose but keeps operational group children flush', () => {
    expect(getOperationalGroupContentSpacingClass(blocks('text'))).toBe('pt-4');
    expect(getOperationalGroupContentSpacingClass(blocks('tool_result', 'text'))).toBe('pt-4');
    expect(getOperationalGroupContentSpacingClass(blocks('tool_use'))).toBe('');
    expect(getOperationalGroupContentSpacingClass(blocks('thinking'))).toBe('');
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
    expect(content.map((_, index) => isFollowedByOperationalClusterRow(content, index))).toEqual([
      true,
      false,
    ]);
  });

  it.each(['attention_card', 'text', 'message', 'resource', 'proposal', 'image'])(
    'adds 16px before Thinking after %s',
    (previousType) => {
      expect(getOperationalClusterSpacingClass(blocks(previousType, 'thinking'), 1)).toBe('pt-4');
      expect(isAdjacentOperationalClusterRow(blocks(previousType, 'thinking'), 1)).toBe(false);
    },
  );

  it('adds 16px before Thinking after a notice', () => {
    expect(getOperationalClusterSpacingClass(blocks('notice', 'thinking'), 1)).toBe('pt-4');
    expect(isAdjacentOperationalClusterRow(blocks('notice', 'thinking'), 1)).toBe(false);
  });

  it('uses 16px before a tool row after a notice', () => {
    expect(getOperationalClusterSpacingClass(blocks('notice', 'tool_use'), 1)).toBe('pt-4');
  });

  it('does not add synthetic top space to first-child Thinking', () => {
    expect(getOperationalClusterSpacingClass(blocks('thinking'), 0)).toBe('');
  });

  it('keeps consecutive reasoning groups in the same compact operational cluster', () => {
    expect(getOperationalClusterSpacingClass(blocks('thinking', 'thinking'), 1)).toBe('');
    expect(isAdjacentOperationalClusterRow(blocks('thinking', 'thinking'), 1)).toBe(true);
  });

  it('keeps nested operational history compact without a special mode', () => {
    const content = blocks('text', 'thinking', 'thinking', 'tool_use');

    expect(content.map((_, index) => getOperationalClusterSpacingClass(content, index))).toEqual([
      '',
      'pt-4',
      '',
      '',
    ]);
  });

  it.each(['tool_use', 'content_group'])(
    'keeps the operational %s-to-Thinking seam flush',
    (previousType) => {
      const content = blocks(previousType, 'thinking');
      expect(getOperationalClusterSpacingClass(content, 1)).toBe('');
      expect(isAdjacentOperationalClusterRow(content, 1)).toBe(true);
    },
  );

  it('leaves a one-row boundary to its parent stack', () => {
    expect(getOperationalClusterSpacingClass(blocks('tool_use'), 0)).toBe('');
  });

  it('uses one 8px seam between final-answer sections', () => {
    const content = blocks('text', 'image', 'proposal');

    expect(content.map((_, index) => getOperationalClusterSpacingClass(content, index))).toEqual([
      '',
      'pt-2',
      'pt-2',
    ]);
  });

  it('scans past hidden tool results without splitting a visible cluster', () => {
    const content = blocks('text', 'tool_use', 'tool_result', 'thinking', 'text');
    const visible = (block: { type: string }) => block.type !== 'tool_result';

    expect(
      content.map((_, index) => getOperationalClusterSpacingClass(content, index, visible)),
    ).toEqual(['', 'pt-4', '', '', 'pt-4']);
    expect(
      content.map((_, index) => isAdjacentOperationalClusterRow(content, index, visible)),
    ).toEqual([false, false, false, true, false]);
    expect(
      content.map((_, index) => isFollowedByOperationalClusterRow(content, index, visible)),
    ).toEqual([false, true, false, false, false]);
  });
});
