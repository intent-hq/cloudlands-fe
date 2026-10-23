import { CLOCK_CALLEES, dottedName, isNewDate } from './no-wall-clock-assertions-in-tests.js';

// Everything that renders into the component catalog: its renderers and fixtures, plus
// every discovered `*.preview.{ts,svelte}` (see component-catalog/preview-discovery.ts).
export const CATALOG_PREVIEW_FILE_GLOBS = Object.freeze([
  'src/lib/component-catalog/**/*.{js,mjs,ts,tsx,svelte}',
  'src/**/*.preview.{ts,svelte}',
]);

// The catalog clock is the one place a preview may read the time. Tests and specs are
// covered by the test-side clock rules (no-wall-clock-assertions-in-tests,
// no-fake-clock-reset-before-assertion) and may pin or read the clock to assert on it.
export const CATALOG_CLOCK_EXEMPT_GLOBS = Object.freeze([
  'src/lib/component-catalog/catalog-clock.ts',
  '**/__tests__/**',
  '**/*.test.*',
  '**/*.spec.*',
]);

const MESSAGE =
  'Catalog previews must not read the real clock ({{read}}): a timestamp built from it renders ' +
  'differently depending on when, and how slowly, the preview runs. The toast catalog stamped ' +
  'its attention toast `Date.now() - 18_000` and the catalog-contract snapshot showed "20s" ' +
  'instead of "18s" on a busy machine (2026-10-23). Use a fixed ISO date (catalogTime() from ' +
  '$lib/component-catalog/catalog-clock), catalogNow() where the component measures against ' +
  'its own live clock, or catalogStopwatch() to time a render.';

// `Date.now` spellings beyond the assertion rule's set, which also covers `performance.now`.
const CATALOG_CLOCK_CALLEES = new Set([
  ...CLOCK_CALLEES,
  'globalThis.Date.now',
  'window.Date.now',
  'globalThis.performance.now',
]);

// `Date()` called without `new` returns the current time as a string.
function isDateCall(node) {
  return node.callee.type === 'Identifier' && node.callee.name === 'Date';
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow real-clock reads (Date.now(), performance.now(), new Date()) in catalog renderers, fixtures and previews',
    },
    schema: [],
    messages: {
      wallClock: MESSAGE,
    },
  },

  create(context) {
    const report = (node, read) => context.report({ node, messageId: 'wallClock', data: { read } });
    return {
      CallExpression(node) {
        const name = dottedName(node.callee);
        if (name && CATALOG_CLOCK_CALLEES.has(name)) report(node, `${name}()`);
        else if (isDateCall(node)) report(node, 'Date()');
      },
      NewExpression(node) {
        // `new Date()` with no arguments; `new Date('2026-09-01')` is a fixed timestamp.
        if (isNewDate(node)) report(node, 'new Date()');
      },
    };
  },
};
