// @vitest-environment node
// @verify-changed-triggers: scripts/suggested-prompts-fixtures.mjs, tests/fixtures/suggested-prompts/**, tests/fixtures/suggested-prompts.lock.json
/**
 * `parseSuggestedPrompts` checked against the suggested-prompts block cases
 * shared with the daemon and the iOS app (monorepo
 * docs/protocol/suggested-prompts.md). The cases are an exact-byte copy under
 * tests/fixtures/suggested-prompts/; CI verifies the copy against the monorepo
 * commit named in suggested-prompts.lock.json, so an expected value only
 * changes by re-exporting it from the monorepo.
 */
import { describe, expect, it } from 'vitest';
import { loadSuggestedPromptsCases } from '../../../../scripts/suggested-prompts-fixtures.mjs';
import { parseSuggestedPrompts } from '../messageParser';

interface SharedCase {
  id: string;
  origin: string;
  input: string;
  expect: { blockStripped: boolean; prompts: string[]; cleaned: string };
  divergences?: Partial<Record<'cloudlands-fe' | 'intentd' | 'ios', string>>;
}

const { cases } = (await loadSuggestedPromptsCases()) as { cases: SharedCase[] };

/** The contract's comparison form: CRLF as LF, trimmed, runs of 3+ line feeds collapsed to 2. */
function normalize(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .trim()
    .replace(/\n{3,}/g, '\n\n');
}

describe('shared suggested-prompts cases', () => {
  it.each(cases.map((c) => [c.id, c] as const))('%s', (_id, testCase) => {
    const result = parseSuggestedPrompts(testCase.input);
    const actual = {
      // parseSuggestedPrompts returns the input untouched when no block is stripped.
      blockStripped: result.cleanedContent !== testCase.input,
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
