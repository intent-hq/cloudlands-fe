import { describe, expect, it } from 'vitest';
import { harnessMayRecordPromptBreakdown, parsePromptBreakdown } from './prompt-breakdown';

function section(
  id: string,
  owner: 'intent' | 'user',
  chars: number,
  location: 'systemPrompt' | 'toolDescription' | 'provider' = 'systemPrompt',
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
        controlHint: { kind: 'edit-repo-rules', text: 'Includes AGENTS.md' },
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
  it('hides the section when the daemon predates the field', () => {
    expect(parsePromptBreakdown(undefined)).toBeNull();
    expect(parsePromptBreakdown(null)).toBeNull();
  });

  it('hides the section for both unavailable reasons', () => {
    expect(
      parsePromptBreakdown({ available: false, reason: 'harness-predates-breakdown' }),
    ).toBeNull();
    expect(parsePromptBreakdown({ available: false, reason: 'not-recorded' })).toBeNull();
  });

  it('hides the section when a required total or list is missing', () => {
    expect(parsePromptBreakdown(available({ totalChars: undefined }))).toBeNull();
    expect(parsePromptBreakdown(available({ estTokens: undefined }))).toBeNull();
    expect(parsePromptBreakdown(available({ sections: undefined }))).toBeNull();
    expect(parsePromptBreakdown(available({ hiddenSkills: undefined }))).toBeNull();
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
      available({ sections: [section('b', 'intent', 10), section('a', 'intent', 10)] }),
    );
    expect(view?.rows.map((row) => row.id)).toEqual(['b', 'a']);
  });

  it('keeps the owner the daemon sends', () => {
    const view = parsePromptBreakdown(available());
    expect(Object.fromEntries(view!.rows.map((row) => [row.id, row.owner]))).toEqual({
      doctrine: 'intent',
      'repo-rules': 'user',
      'specialist-prompt': 'user',
      'ws-reference': 'intent',
    });
  });

  it('carries the control hint text', () => {
    const view = parsePromptBreakdown(available());
    const counted = view?.rows.find((row) => row.id === 'repo-rules' && row.counted);
    expect(counted?.hint).toBe('Includes AGENTS.md');
    expect(view?.rows.find((row) => row.id === 'doctrine')?.hint).toBeUndefined();
  });

  it('leaves out rows that do not match the contract instead of repairing them', () => {
    const { estTokens: _omitted, ...noEstimate } = section('no-estimate', 'user', 9);
    const view = parsePromptBreakdown(
      available({
        sections: [
          section('doctrine', 'intent', 10),
          noEstimate,
          { ...section('other-owner', 'intent', 8), owner: 'team' },
          { ...section('other-location', 'intent', 7), location: 'elsewhere' },
        ],
      }),
    );
    expect(view?.rows.map((row) => row.id)).toEqual(['doctrine']);
  });

  it('sums counted sections by owner and leaves out provider rows and empty owners', () => {
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
      { owner: 'intent', chars: 600, estTokens: 150, share: 600 / 900 },
      { owner: 'user', chars: 300, estTokens: 75, share: 300 / 900 },
    ]);

    const intentOnly = parsePromptBreakdown(
      available({ sections: [section('doctrine', 'intent', 600)], totalChars: 600 }),
    );
    expect(intentOnly?.owners.map((summary) => summary.owner)).toEqual(['intent']);
  });

  it('keeps complete hidden skills in daemon order', () => {
    const view = parsePromptBreakdown(
      available({
        hiddenSkills: [
          {
            name: 'memory',
            reason: 'mcp-server-missing',
            detail: 'needs mcp__memory__',
            fix: 'Add it',
          },
          { name: 'no-fix', reason: 'compatibility', detail: 'macOS only' },
          { name: 'xcode', reason: 'compatibility', detail: 'macOS only', fix: 'Use a Mac' },
        ],
      }),
    );
    expect(view?.hiddenSkills.map((skill) => skill.name)).toEqual(['memory', 'xcode']);
  });
});

describe('harnessMayRecordPromptBreakdown', () => {
  it('skips the session read for harnesses that never record a breakdown', () => {
    expect(harnessMayRecordPromptBreakdown(undefined)).toBe(false);
    expect(harnessMayRecordPromptBreakdown(null)).toBe(false);
    expect(harnessMayRecordPromptBreakdown('3.9')).toBe(false);
    expect(harnessMayRecordPromptBreakdown('3.11')).toBe(false);
    expect(harnessMayRecordPromptBreakdown('2.14')).toBe(false);
  });

  it('reads the session for 3.10, 3.12 and later, and for versions it cannot parse', () => {
    expect(harnessMayRecordPromptBreakdown('3.10')).toBe(true);
    expect(harnessMayRecordPromptBreakdown('3.12')).toBe(true);
    expect(harnessMayRecordPromptBreakdown('3.13')).toBe(true);
    expect(harnessMayRecordPromptBreakdown('4.0')).toBe(true);
    expect(harnessMayRecordPromptBreakdown('next')).toBe(true);
  });
});
