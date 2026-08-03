import { describe, expect, it } from 'vitest';
import {
  clampPromptPickerLimit,
  COUNT_RESCALE_THRESHOLD,
  DEFAULT_PROMPT_PICKER_LIMIT,
  MAX_PROMPT_PICKER_LIMIT,
  MAX_TRACKED_PROMPT_LENGTH,
  MAX_TRACKED_PROMPTS,
  parsePromptUsage,
  promptKey,
  rankPromptUsage,
  recordPromptUsage,
  topPromptTexts,
  type PromptUsageEntry,
} from '../curation';

const at = (i: number): string => new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString();

function entry(text: string, count: number, lastUsedAt = at(0)): PromptUsageEntry {
  return { text, count, lastUsedAt };
}

describe('promptKey', () => {
  it('collapses whitespace so reflowed copies share one identity', () => {
    expect(promptKey('  fix\n  the   tests ')).toBe('fix the tests');
  });
});

describe('clampPromptPickerLimit', () => {
  it('defaults non-numbers and clamps into [1, 12]', () => {
    expect(clampPromptPickerLimit(undefined)).toBe(DEFAULT_PROMPT_PICKER_LIMIT);
    expect(clampPromptPickerLimit('9')).toBe(DEFAULT_PROMPT_PICKER_LIMIT);
    expect(clampPromptPickerLimit(NaN)).toBe(DEFAULT_PROMPT_PICKER_LIMIT);
    expect(clampPromptPickerLimit(0)).toBe(1);
    expect(clampPromptPickerLimit(5.7)).toBe(5);
    expect(clampPromptPickerLimit(99)).toBe(MAX_PROMPT_PICKER_LIMIT);
  });
});

describe('rankPromptUsage / topPromptTexts', () => {
  it('ranks by count desc, then recency, then text', () => {
    const entries = [
      entry('b', 2, at(1)),
      entry('a', 2, at(1)),
      entry('newer', 2, at(5)),
      entry('top', 9, at(0)),
    ];
    expect(rankPromptUsage(entries).map((e) => e.text)).toEqual(['top', 'newer', 'a', 'b']);
  });

  it('slices the top-N texts with a clamped limit', () => {
    const entries = [entry('a', 3), entry('b', 2), entry('c', 1)];
    expect(topPromptTexts(entries, 2)).toEqual(['a', 'b']);
    expect(topPromptTexts(entries, 0)).toEqual(['a']);
  });
});

describe('recordPromptUsage', () => {
  it('adds a new entry with count 1', () => {
    expect(recordPromptUsage([], ' Hello world ', at(3))).toEqual([
      { text: 'Hello world', count: 1, lastUsedAt: at(3) },
    ]);
  });

  it('increments an existing entry matched by normalized key and refreshes text', () => {
    const next = recordPromptUsage([entry('fix the tests', 4, at(0))], 'fix\nthe  tests', at(7));
    expect(next).toEqual([{ text: 'fix\nthe  tests', count: 5, lastUsedAt: at(7) }]);
  });

  it('returns null for blank or oversized text', () => {
    expect(recordPromptUsage([], '   ', at(0))).toBeNull();
    expect(recordPromptUsage([], 'x'.repeat(MAX_TRACKED_PROMPT_LENGTH + 1), at(0))).toBeNull();
  });

  it('halves all counts at the rescale threshold and drops decayed entries', () => {
    const next = recordPromptUsage(
      [entry('hot', COUNT_RESCALE_THRESHOLD - 1), entry('cold', 1)],
      'hot',
      at(1),
    );
    expect(next).toEqual([
      { text: 'hot', count: COUNT_RESCALE_THRESHOLD / 2, lastUsedAt: at(1) },
    ]);
  });

  it('caps the tracked set by rank', () => {
    const entries = Array.from({ length: MAX_TRACKED_PROMPTS }, (_, i) =>
      entry(`p${i}`, i + 2, at(0)),
    );
    const next = recordPromptUsage(entries, 'newcomer', at(1));
    expect(next).toHaveLength(MAX_TRACKED_PROMPTS);
    // The lowest-ranked entry (count 1 newcomer loses to count >= 2) is dropped.
    expect(next?.some((e) => e.text === 'newcomer')).toBe(false);
  });
});

describe('parsePromptUsage', () => {
  it('parses well-formed entries and drops malformed ones', () => {
    const parsed = parsePromptUsage([
      { text: 'keep', count: 3.9, lastUsedAt: at(2) },
      { text: '  ', count: 1, lastUsedAt: at(0) },
      { text: 'no-count', count: 0 },
      { text: 'bad-count', count: 'x' },
      null,
      'nope',
      { text: 'no-timestamp', count: 2 },
    ]);
    expect(parsed).toEqual([
      { text: 'keep', count: 3, lastUsedAt: at(2) },
      { text: 'no-timestamp', count: 2, lastUsedAt: '' },
    ]);
  });

  it('yields an empty tracker for non-arrays', () => {
    expect(parsePromptUsage(undefined)).toEqual([]);
    expect(parsePromptUsage({})).toEqual([]);
  });
});
