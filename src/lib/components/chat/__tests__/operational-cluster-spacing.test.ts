import { describe, expect, it } from 'vitest';
import { getOperationalClusterSpacingClass } from '../operational-disclosure-row';

const blocks = (...types: string[]) => types.map((type) => ({ type }));

describe('operational cluster spacing', () => {
  it('owns 16px outer spacing and no gap between adjacent operational rows', () => {
    const content = blocks('text', 'thinking', 'tool_use', 'tool_use', 'text');

    expect(content.map((_, index) => getOperationalClusterSpacingClass(content, index))).toEqual([
      '',
      'mt-4',
      '',
      'mb-4',
      '',
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
  });
});
