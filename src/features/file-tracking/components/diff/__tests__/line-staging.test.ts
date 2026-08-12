import { describe, expect, it } from 'vitest';
import { generateLinePatchFromContent, getChangedLineNumbersFromContent } from '../line-staging';

describe('line staging helpers', () => {
  it('reports changed lines in displayed real-file coordinates for partial diffs', () => {
    const changed = getChangedLineNumbersFromContent(
      'file.txt',
      ['line10', 'line12'].join('\n'),
      ['line10', 'inserted', 'line12'].join('\n'),
      10,
    );

    expect(changed.additions.has(11)).toBe(true);
    expect(changed.additions.has(2)).toBe(false);
  });

  it('generates a real-line-number patch from a selected partial-diff addition', () => {
    const patch = generateLinePatchFromContent({
      filePath: 'file.txt',
      oldContent: ['line10', 'line12'].join('\n'),
      newContent: ['line10', 'inserted', 'line12'].join('\n'),
      stage: 'unstaged',
      startLine: 11,
      endLine: 11,
      side: 'additions',
      lineOffset: 10,
    });

    expect(patch).toContain('@@ -10,2 +10,3 @@');
    expect(patch).toContain(' line10\n+inserted\n line12');
  });

  it('generates a real-line-number patch from a selected partial-diff deletion', () => {
    const patch = generateLinePatchFromContent({
      filePath: 'file.txt',
      oldContent: ['line10', 'deleted', 'line12'].join('\n'),
      newContent: ['line10', 'line12'].join('\n'),
      stage: 'staged',
      startLine: 11,
      endLine: 11,
      side: 'deletions',
      lineOffset: 10,
    });

    expect(patch).toContain('@@ -10,3 +10,2 @@');
    expect(patch).toContain(' line10\n-deleted\n line12');
  });

  it('keeps line-one diffs in their original coordinate system', () => {
    const patch = generateLinePatchFromContent({
      filePath: 'file.txt',
      oldContent: ['line1', 'line3'].join('\n'),
      newContent: ['line1', 'line2', 'line3'].join('\n'),
      stage: 'unstaged',
      startLine: 2,
      endLine: 2,
      side: 'additions',
      lineOffset: 1,
    });

    expect(patch).toContain('@@ -1,2 +1,3 @@');
    expect(patch).toContain(' line1\n+line2\n line3');
  });
});
