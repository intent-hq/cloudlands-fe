// @vitest-environment node
// @verify-changed-triggers: tests/fixtures/suggested-prompts/**, tests/fixtures/suggested-prompts.lock.json
/**
 * `parseSuggestedPrompts` checked against the suggested-prompts block cases
 * shared with the daemon and the iOS app (monorepo
 * docs/protocol/suggested-prompts.md). The cases are an exact-byte copy under
 * tests/fixtures/suggested-prompts/; CI verifies the copy against the monorepo
 * commit named in suggested-prompts.lock.json, so an expected value only
 * changes by re-exporting it from the monorepo.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hasSuggestedPrompts, parseSuggestedPrompts } from '../messageParser';

interface SharedCase {
  id: string;
  origin: string;
  input: string;
  expect: { blockStripped: boolean; prompts: string[]; cleaned: string };
  divergences?: Partial<Record<'cloudlands-fe' | 'intentd' | 'ios', string>>;
}

const fixtures = new URL('../../../../tests/fixtures/', import.meta.url);
const casesBytes = readFileSync(
  fileURLToPath(new URL('suggested-prompts/v1/cases.json', fixtures)),
);
const lock = JSON.parse(
  readFileSync(fileURLToPath(new URL('suggested-prompts.lock.json', fixtures)), 'utf8'),
) as { sourceRepository: string; sourcePath: string; casesSha256: string };
const doc = JSON.parse(casesBytes.toString('utf8')) as {
  fixtureFormatVersion: number;
  cases: SharedCase[];
};

/** The contract's comparison form: CRLF as LF, trimmed, runs of 3+ line feeds collapsed to 2. */
function normalize(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .trim()
    .replace(/\n{3,}/g, '\n\n');
}

describe('shared suggested-prompts cases', () => {
  it('uses a copy that matches its lock', () => {
    expect(doc.fixtureFormatVersion).toBe(1);
    expect(lock.sourceRepository).toBe('intent-hq/intent');
    expect(lock.sourcePath).toBe('docs/protocol/fixtures/suggested-prompts/v1');
    expect(createHash('sha256').update(casesBytes).digest('hex')).toBe(lock.casesSha256);
    expect(doc.cases.length).toBeGreaterThanOrEqual(40);
  });

  it.each(doc.cases.map((c) => [c.id, c] as const))('%s', (_id, testCase) => {
    const result = parseSuggestedPrompts(testCase.input);
    const actual = {
      blockStripped: hasSuggestedPrompts(testCase.input),
      prompts: result.prompts,
      cleaned: normalize(result.cleanedContent),
    };
    const reason = testCase.divergences?.['cloudlands-fe'];
    if (reason) {
      // A listed divergence must still diverge, so a stale entry fails.
      expect(
        actual,
        `listed as a cloudlands-fe divergence (${reason}); remove the entry`,
      ).not.toEqual(testCase.expect);
      return;
    }
    expect(actual).toEqual(testCase.expect);
  });
});
