import { describe, expect, it } from 'vitest';
import {
  getOperationalClusterSpacingClass,
  isAdjacentOperationalClusterRow,
} from '../operational-disclosure-row';

const blocks = (...types: string[]) => types.map((type) => ({ type }));

describe('operational cluster spacing', () => {
  it('leaves adjacent spacing to ChatOperationalRow and owns 16px cluster boundaries', () => {
    const content = blocks('text', 'thinking', 'tool_use', 'tool_use', 'text');

    expect(content.map((_, index) => getOperationalClusterSpacingClass(content, index))).toEqual([
      '',
      'mt-4',
      '',
      'mb-4',
      '',
    ]);
  });

  it.each([
    ['tool to tool', 'tool_use', 'tool_use'],
    ['tool to reasoning', 'tool_use', 'thinking'],
    ['reasoning to tool', 'thinking', 'tool_use'],
    ['reasoning to context', 'thinking', 'tool_use'],
    ['context to tool', 'tool_use', 'tool_use'],
  ])('marks the second row as adjacent for %s', (_name, firstType, secondType) => {
    const content = blocks(firstType, secondType);

    expect(content.map((_, index) => isAdjacentOperationalClusterRow(content, index))).toEqual([
      false,
      true,
    ]);
  });

  it('puts exactly 16px above Thinking when it follows prose', () => {
    expect(getOperationalClusterSpacingClass(blocks('text', 'thinking'), 1)).toBe('mt-4 mb-4');
  });

  it('gives a one-row boundary both outer margins', () => {
    expect(getOperationalClusterSpacingClass(blocks('tool_use'), 0)).toBe('mt-4 mb-4');
  });

  it('keeps the generic 10px rhythm between non-operational blocks', () => {
    const content = blocks('text', 'content_group', 'image');

    expect(content.map((_, index) => getOperationalClusterSpacingClass(content, index))).toEqual([
      '',
      'mt-2.5',
      'mt-2.5',
    ]);
  });

  it('scans past hidden tool results without splitting a visible cluster', () => {
    const content = blocks('text', 'tool_use', 'tool_result', 'thinking', 'text');
    const visible = (block: { type: string }) => block.type !== 'tool_result';

    expect(
      content.map((_, index) => getOperationalClusterSpacingClass(content, index, visible)),
    ).toEqual(['', 'mt-4', '', 'mb-4', '']);
    expect(
      content.map((_, index) => isAdjacentOperationalClusterRow(content, index, visible)),
    ).toEqual([false, false, false, true, false]);
  });
});
