// Reduced motion has one source of truth: the `--motion-reduced` token in
// `src/lib/styles/tokens.css` (1 under the OS `prefers-reduced-motion: reduce`
// query OR the battery-saver `:root[data-reduce-motion]` attribute), mirrored
// to script by `src/lib/utils/reduced-motion.ts`. A direct `prefers-reduced-motion`
// query — `matchMedia('(prefers-reduced-motion: reduce)')` in script, or an
// `@media (prefers-reduced-motion: reduce)` block in a component `<style>` —
// sees only the OS preference and silently bypasses battery mode. Script goes
// through the `reduced-motion` helpers; CSS queries
// `@container style(--motion-reduced: 1)` or uses the `motion-reduce:` variant.
export const DIRECT_QUERY = 'prefers-reduced-motion';
// Media features are case-insensitive: `(PREFERS-REDUCED-MOTION: reduce)` is a
// valid query, so the match must be too. No `g` flag: `test()` stays stateless.
export const DIRECT_QUERY_PATTERN = /prefers-reduced-motion/i;

// The only non-test files allowed to spell the query: the token definition, its
// script mirror, the pre-hydration splash in app.html, and the specialist prompt
// text that tells agents to honor it (prose, not a query). Shared by
// eslint.config.js (script/Svelte) and scripts/check-reduced-motion-queries.mjs
// (.css/.html) so the two gates cannot disagree about the allow-list.
export const SOURCE_OF_TRUTH_FILES = Object.freeze([
  'src/lib/styles/tokens.css',
  'src/lib/utils/reduced-motion*.ts',
  'src/app.html',
  'src/lib/constants/specialists.ts',
]);

// Tests, specs and their fixtures/goldens may spell the query to assert the
// behaviour. Nothing else is exempt — in particular not generated, build or
// vendored paths, which ship to users like any other source.
export const TEST_FILE_GLOBS = Object.freeze([
  '**/__tests__/**',
  '**/tests/**',
  '**/*.test.*',
  '**/*.spec.*',
]);

const MESSAGE =
  'Direct `prefers-reduced-motion` queries bypass battery mode. Use the helpers in ' +
  '`$lib/utils/reduced-motion` in script, or `@container style(--motion-reduced: 1)` ' +
  '(the `motion-reduce:` variant) in CSS.';

const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;
const STYLE_ELEMENT = /<style\b[^>]*>[\s\S]*?<\/style>/gi;

const patternRanges = (text, pattern, offset = 0) =>
  Array.from(text.matchAll(pattern), (match) => [
    offset + match.index,
    offset + match.index + match[0].length,
  ]);

/** `/* ... *\/` comment ranges in CSS text; `offset` shifts them into a host document. */
export const cssCommentRanges = (text, offset = 0) => patternRanges(text, BLOCK_COMMENT, offset);

/** `<!-- ... -->` comments plus `/* ... *\/` comments inside `<style>` blocks. */
export const htmlCommentRanges = (text) => [
  ...patternRanges(text, HTML_COMMENT),
  ...Array.from(text.matchAll(STYLE_ELEMENT)).flatMap((match) =>
    cssCommentRanges(match[0], match.index),
  ),
];

/** Blank out `[start, end)` ranges, keeping newlines so line/column positions survive. */
export function maskRanges(text, ranges) {
  let masked = text;
  for (const [start, end] of ranges) {
    masked =
      masked.slice(0, start) + masked.slice(start, end).replace(/[^\n]/g, ' ') + masked.slice(end);
  }
  return masked;
}

/** `[start, end)` of every direct query in `text`, ignoring the given comment ranges. */
export const findDirectQueries = (text, commentRanges = []) =>
  patternRanges(maskRanges(text, commentRanges), new RegExp(DIRECT_QUERY_PATTERN.source, 'gi'));

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow direct prefers-reduced-motion queries outside the reduced-motion source of truth',
    },
    schema: [],
    messages: {
      noDirectQuery: MESSAGE,
    },
  },

  create(context) {
    const { sourceCode } = context;
    // Script comments come from the parser; svelte-eslint-parser exposes HTML
    // comments as nodes and leaves `<style>` content as raw text, so its CSS
    // comments are located inside that text.
    const commentRanges = sourceCode
      .getAllComments()
      .flatMap((comment) => (comment.range ? [comment.range] : []));
    return {
      SvelteHTMLComment(node) {
        commentRanges.push(node.range);
      },
      SvelteStyleElement(node) {
        for (const child of node.children) {
          commentRanges.push(
            ...cssCommentRanges(
              sourceCode.text.slice(child.range[0], child.range[1]),
              child.range[0],
            ),
          );
        }
      },
      'Program:exit'() {
        for (const [start, end] of findDirectQueries(sourceCode.text, commentRanges)) {
          context.report({
            loc: { start: sourceCode.getLocFromIndex(start), end: sourceCode.getLocFromIndex(end) },
            messageId: 'noDirectQuery',
          });
        }
      },
    };
  },
};
