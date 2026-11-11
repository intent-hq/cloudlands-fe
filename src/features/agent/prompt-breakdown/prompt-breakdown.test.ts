import { describe, expect, it } from 'vitest';
import { harnessMayRecordPromptBreakdown, parsePromptBreakdown } from './prompt-breakdown';

function section(
  id: string,
  owner: string,
  chars: number,
  location = 'systemPrompt',
  extra: Record<string, unknown> = {},
) {
  return { id, label: id, owner, location, chars, estTokens: Math.ceil(chars / 4), ...extra };
}

function available(overrides: Record<string, unknown> = {}) {
  return {
    available: true,
    harnessVersion: '3.12',
    recordedAt: '2026-11-10T12:00:00Z',
    systemPromptChars: 9_000,
    toolDescriptionChars: 3_000,
    totalChars: 12_000,
    estTokens: 3_000,
    sections: [
      section('doctrine', 'intent', 4_000),
      section('repo-rules', 'user', 3_000, 'systemPrompt', {
        controlHint: { kind: 'edit-repo-rules', text: 'Edit AGENTS.md' },
      }),
      section('specialist-prompt', 'user', 2_000),
      section('ws-reference', 'intent', 3_000, 'toolDescription'),
      section('repo-rules', 'user', 6_000, 'provider', {
        label: 'Repo rules: loaded natively by Claude Code',
      }),
    ],
    hiddenSkills: [],
    ...overrides,
  };
}

describe('parsePromptBreakdown', () => {
  it('hides the indicator when the daemon predates the field', () => {
    expect(parsePromptBreakdown(undefined)).toBeNull();
    expect(parsePromptBreakdown(null)).toBeNull();
    expect(parsePromptBreakdown('available')).toBeNull();
  });

  it('hides the indicator for both unavailable reasons', () => {
    expect(
      parsePromptBreakdown({ available: false, reason: 'harness-predates-breakdown' }),
    ).toBeNull();
    expect(parsePromptBreakdown({ available: false, reason: 'not-recorded' })).toBeNull();
  });

  it('hides the indicator when the totals are malformed', () => {
    expect(parsePromptBreakdown(available({ totalChars: 'lots' }))).toBeNull();
    expect(parsePromptBreakdown(available({ sections: 'none' }))).toBeNull();
  });

  it('lists sections largest first, provider rows included but not counted', () => {
    const view = parsePromptBreakdown(available());
    expect(view?.estTokens).toBe(3_000);
    expect(view?.rows.map((row) => [row.id, row.chars, row.counted])).toEqual([
      ['repo-rules', 6_000, false],
      ['doctrine', 4_000, true],
      ['repo-rules', 3_000, true],
      ['ws-reference', 3_000, true],
      ['specialist-prompt', 2_000, true],
    ]);
  });

  it('keeps the wire order for equal sizes', () => {
    const view = parsePromptBreakdown(
      available({
        sections: [section('b', 'intent', 10), section('a', 'intent', 10)],
        totalChars: 20,
      }),
    );
    expect(view?.rows.map((row) => row.id)).toEqual(['b', 'a']);
  });

  it('separates repo-owned user text from other user text', () => {
    const view = parsePromptBreakdown(
      available({
        sections: [
          section('doctrine', 'intent', 1),
          section('repo-rules', 'user', 2),
          section('repo-config', 'user', 3),
          section('skills', 'user', 4),
          section('future', 'repo', 5),
        ],
      }),
    );
    expect(Object.fromEntries(view!.rows.map((row) => [row.id, row.group]))).toEqual({
      doctrine: 'intent',
      'repo-rules': 'repo',
      'repo-config': 'repo',
      skills: 'user',
      future: 'repo',
    });
  });

  it('carries the control hint text', () => {
    const view = parsePromptBreakdown(available());
    const counted = view?.rows.find((row) => row.id === 'repo-rules' && row.counted);
    expect(counted?.hint).toBe('Edit AGENTS.md');
    expect(view?.rows.find((row) => row.id === 'doctrine')?.hint).toBeUndefined();
  });

  it('drops malformed section rows and fills a missing token estimate', () => {
    const view = parsePromptBreakdown(
      available({
        sections: [
          section('doctrine', 'intent', 10),
          { id: 'broken', label: 'Broken', owner: 'intent', location: 'systemPrompt' },
          { id: 'no-estimate', label: 'No estimate', owner: 'user', location: 'x', chars: 9 },
        ],
      }),
    );
    expect(view?.rows.map((row) => [row.id, row.estTokens])).toEqual([
      ['doctrine', 3],
      ['no-estimate', 3],
    ]);
  });

  it('summarizes counted chars by owner in a fixed order and omits empty owners', () => {
    const view = parsePromptBreakdown(
      available({
        sections: [
          section('skills', 'user', 300),
          section('doctrine', 'intent', 600),
          section('repo-rules', 'user', 900, 'provider'),
        ],
        totalChars: 900,
      }),
    );
    expect(view?.owners).toEqual([
      { group: 'intent', chars: 600, estTokens: 150, share: 600 / 900 },
      { group: 'user', chars: 300, estTokens: 75, share: 300 / 900 },
    ]);
  });

  it('keeps valid hidden skills in daemon order', () => {
    const view = parsePromptBreakdown(
      available({
        hiddenSkills: [
          {
            name: 'memory',
            reason: 'mcp-server-missing',
            detail: 'needs mcp__memory__',
            fix: 'Add it',
          },
          { name: 42 },
          { name: 'xcode', reason: 'compatibility', detail: 'macOS only', fix: 'Use a Mac' },
        ],
      }),
    );
    expect(view?.hiddenSkills.map((skill) => skill.name)).toEqual(['memory', 'xcode']);
  });
});

describe('harnessMayRecordPromptBreakdown', () => {
  it('skips the session read for harnesses that cannot carry a breakdown', () => {
    expect(harnessMayRecordPromptBreakdown(undefined)).toBe(false);
    expect(harnessMayRecordPromptBreakdown(null)).toBe(false);
    expect(harnessMayRecordPromptBreakdown('3.9')).toBe(false);
    expect(harnessMayRecordPromptBreakdown('2.14')).toBe(false);
  });

  it('reads the session for 3.10 and later, and for versions it cannot parse', () => {
    expect(harnessMayRecordPromptBreakdown('3.10')).toBe(true);
    expect(harnessMayRecordPromptBreakdown('3.12')).toBe(true);
    expect(harnessMayRecordPromptBreakdown('4.0')).toBe(true);
    expect(harnessMayRecordPromptBreakdown('next')).toBe(true);
  });
});
