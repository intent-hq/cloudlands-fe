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

const MESSAGE =
  'Direct `prefers-reduced-motion` queries bypass battery mode. Use the helpers in ' +
  '`$lib/utils/reduced-motion` in script, or `@container style(--motion-reduced: 1)` ' +
  '(the `motion-reduce:` variant) in CSS.';

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
    return {
      Program() {
        const text = sourceCode.text;
        const comments = sourceCode.getAllComments();
        const inComment = (index) =>
          comments.some(({ range }) => range && index >= range[0] && index < range[1]);
        let index = text.indexOf(DIRECT_QUERY);
        while (index !== -1) {
          if (!inComment(index)) {
            context.report({
              loc: {
                start: sourceCode.getLocFromIndex(index),
                end: sourceCode.getLocFromIndex(index + DIRECT_QUERY.length),
              },
              messageId: 'noDirectQuery',
            });
          }
          index = text.indexOf(DIRECT_QUERY, index + DIRECT_QUERY.length);
        }
      },
    };
  },
};
