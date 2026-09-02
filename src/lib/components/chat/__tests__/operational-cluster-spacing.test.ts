import { describe, expect, it } from 'vitest';
import {
  getOperationalGroupContentSpacingClass,
  getOperationalClusterSpacingClass,
  isAdjacentOperationalClusterRow,
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
    expect(getOperationalGroupContentSpacingClass(blocks('tool_result'))).toBe('pt-4');
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

  it('adds 56px between consecutive reasoning groups', () => {
    expect(getOperationalClusterSpacingClass(blocks('thinking', 'thinking'), 1)).toBe('pt-14');
    expect(isAdjacentOperationalClusterRow(blocks('thinking', 'thinking'), 1)).toBe(true);
  });

  it('keeps only consecutive nested history blocks compact when requested', () => {
    const content = blocks('text', 'thinking', 'thinking', 'tool_use');
    const compact = (index: number) =>
      getOperationalClusterSpacingClass(content, index, () => true, true);

    expect(content.map((_, index) => compact(index))).toEqual(['', 'pt-4', '', '']);
    expect(getOperationalClusterSpacingClass(content, 2)).toBe('pt-14');
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

  it('preserves 4px non-operational seams without a parent gap', () => {
    const content = blocks('text', 'image', 'proposal');

    expect(content.map((_, index) => getOperationalClusterSpacingClass(content, index))).toEqual([
      '',
      'pt-1',
      'pt-1',
    ]);
  });

  it('scans past hidden tool results without splitting a visible cluster', () => {
    const content = blocks('text', 'tool_use', 'tool_result', 'thinking', 'text');
    const visible = (block: { type: string }) => block.type !== 'tool_result';

    expect(
      content.map((_, index) => getOperationalClusterSpacingClass(content, index, visible)),
    ).toEqual(['', 'pt-4', '', '', 'pt-6']);
    expect(
      content.map((_, index) => isAdjacentOperationalClusterRow(content, index, visible)),
    ).toEqual([false, false, false, true, false]);
  });
});
