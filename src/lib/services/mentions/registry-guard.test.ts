/**
 * Guard: mention token patterns live only in the mention registry.
 *
 * Readers that kept their own copy of the token grammar drifted apart
 * (cloudlands-fe#3845, cloudlands-fe#3879). Every reader now gets its
 * patterns from registry.ts; this test fails if a source file outside the
 * registry and the per-type token modules writes a mention-token regex or
 * builds one from a token module's body source.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', '..', '..');

/** The registry and the per-type token modules it calls. */
const ALLOWED = new Set([
  'lib/services/mentions/registry.ts',
  'lib/utils/note-mention-token.ts',
  'lib/utils/runtime-mention-token.ts',
  'lib/utils/member-mention-token.ts',
]);

/** Files that match a guard pattern without reading mentions back, with why. */
const EXEMPT: Record<string, string> = {
  // Drops any bracketed attachment-like token (`@file[...]`, `@url[...]`, …)
  // before picking words for a workspace slug; it never renders or opens one.
  'features/workspace/main/local-slug-generator.ts': 'slug words skip bracketed tokens',
};

/**
 * `@`-led escaped token heads as they appear in a regex (`@member\[`,
 * `@note\/`, `@(?:terminal|script)\[`; URL paths like `terminal\/` are not
 * tokens), the unescaped classifier form `@note[/[]`, and
 * the token modules' exported body sources.
 */
const FORBIDDEN: Array<[string, RegExp]> = [
  ['mention token regex', /@\(?(?:\?:)?(?:member|context|note|terminal|script)[|a-z]*\)?\\[[/]/],
  ['mention token regex', /@note\[\/\[\]/],
  ['token body source', /\b[A-Z]+_MENTION_BODY_SOURCE\b/],
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|svelte)$/.test(name) && !/\.(test|spec)\.ts$/.test(name) ? [path] : [];
  });
}

function violations(files: string[]): string[] {
  const found: string[] = [];
  for (const file of files) {
    const rel = relative(SRC, file).split(sep).join('/');
    if (ALLOWED.has(rel) || rel in EXEMPT || rel.includes('/__tests__/')) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const [what, pattern] of FORBIDDEN) {
        if (pattern.test(line)) found.push(`${rel}:${i + 1}: ${what}: ${line.trim()}`);
      }
    });
  }
  return found;
}

describe('mention registry guard', () => {
  it('finds the patterns it is meant to catch', () => {
    const samples = [
      String.raw`const noteRe = /@note\/([A-Za-z0-9_-]+)/g;`,
      String.raw`const re = /@member\[[^\]\s]*\]/g;`,
      String.raw`text.replace(/@context\[[^\]]*\]/g, '')`,
      String.raw`/@(?:terminal|script)\[/`,
      '/@note[/[]/',
      'new RegExp(`@${NOTE_MENTION_BODY_SOURCE}`)',
    ];
    for (const sample of samples) {
      expect(
        FORBIDDEN.some(([, pattern]) => pattern.test(sample)),
        sample,
      ).toBe(true);
    }
    // Prose that names a token, and URL paths, are fine.
    for (const sample of [
      ' * - @note[id:title] — note mentions',
      String.raw`url.match(/^devspace:\/\/terminal\/(.+)$/)`,
      String.raw`/intent:\/\/local\/note\/([a-zA-Z0-9_-]+)/`,
    ]) {
      expect(
        FORBIDDEN.some(([, pattern]) => pattern.test(sample)),
        sample,
      ).toBe(false);
    }
  });

  it('no reader outside the registry defines mention token patterns', () => {
    expect(violations(sourceFiles(SRC))).toEqual([]);
  });
});
