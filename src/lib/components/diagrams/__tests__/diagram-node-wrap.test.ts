import { describe, expect, it } from 'vitest';
import { countEmergencyWrappedLines, nodeLabelGraphemes } from '../diagram-label-wrap';

describe('node emergency wrapping', () => {
  it('preserves combining marks, variation selectors, ZWJ, modifiers and flags', () => {
    const clusters = ['e\u0301', '👨‍👩‍👧‍👦', '🇯🇵', '👍🏽', '✈️', '可'];
    expect(nodeLabelGraphemes(clusters.join(''))).toEqual(clusters);
  });

  it('counts proportional graphemes rather than dividing total width', () => {
    const measure = (text: string) => [...text].reduce((n, c) => n + (c === 'W' ? 6 : 2), 0);
    expect(countEmergencyWrappedLines(['WWWW'], 10, measure)).toBe(4);
    expect(countEmergencyWrappedLines(['iiWW'], 10, measure)).toBe(2);
  });

  it('keeps the last emergency line occupied when the next semantic unit arrives', () => {
    expect(countEmergencyWrappedLines(['aaaaaaa', '.ts'], 5, (s) => s.length)).toBe(2);
    expect(countEmergencyWrappedLines(['aaaaaaa', '.html'], 5, (s) => s.length)).toBe(3);
    expect(countEmergencyWrappedLines(['aaaaaaa', '.ts'], 5, (s) => s.length, true)).toBe(3);
  });

  it('respects real spaces and wbr boundaries without inserting spaces', () => {
    expect(countEmergencyWrappedLines(['path/', 'to/', 'file'], 8, (s) => s.length)).toBe(2);
    expect(countEmergencyWrappedLines(['one   ', 'two'], 7, (s) => s.length)).toBe(1);
    expect(countEmergencyWrappedLines(['one ', 'two'], 6, (s) => s.length)).toBe(2);
    expect(countEmergencyWrappedLines([], 6, (s) => s.length)).toBe(1);
  });

  it('never measures a partial grapheme while breaking an oversized unit', () => {
    const allowed = ['e\u0301', '👨‍👩‍👧‍👦', '🇯🇵'];
    const measure = (s: string) => {
      let rest = s;
      let count = 0;
      for (const cluster of allowed) {
        if (rest.startsWith(cluster)) {
          rest = rest.slice(cluster.length);
          count += 1;
        }
      }
      expect(rest).toBe('');
      return count * 10;
    };
    expect(countEmergencyWrappedLines([allowed.join('')], 10, measure)).toBe(3);
  });
});
