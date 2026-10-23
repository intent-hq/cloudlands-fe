import { CLOCK_CALLEES, dottedName } from './no-wall-clock-assertions-in-tests.js';

// Everything that renders into the component catalog: its renderers and fixtures, every
// discovered `*.preview.{ts,svelte}` (see component-catalog/preview-discovery.ts), and the
// `*.preview-fixture(s).ts` modules those previews build their data from.
export const CATALOG_PREVIEW_FILE_GLOBS = Object.freeze([
  'src/lib/component-catalog/**/*.{js,mjs,ts,tsx,svelte}',
  'src/**/*.preview.{ts,svelte}',
  'src/**/*.preview-fixture.ts',
  'src/**/*.preview-fixtures.ts',
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

// The shared set covers `performance.now` with its `globalThis.` / `window.` spellings and
// a bare `Date.now`; add the prefixed `Date.now` spellings.
const CLOCK_FUNCTIONS = new Set([...CLOCK_CALLEES, 'globalThis.Date.now', 'window.Date.now']);

const DATE_CONSTRUCTORS = new Set(['Date', 'globalThis.Date', 'window.Date']);

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow real-clock reads (Date.now, performance.now, Date(), new Date()) in catalog renderers, fixtures and previews',
    },
    schema: [],
    messages: {
      wallClock: MESSAGE,
    },
  },

  create(context) {
    const report = (node, read) => context.report({ node, messageId: 'wallClock', data: { read } });
    return {
      // Called (`Date.now()`) or handed over uncalled (`{ now: Date.now }`).
      MemberExpression(node) {
        const name = dottedName(node);
        if (!name || !CLOCK_FUNCTIONS.has(name)) return;
        const called = node.parent.type === 'CallExpression' && node.parent.callee === node;
        report(called ? node.parent : node, called ? `${name}()` : name);
      },
      // `Date()` without `new` returns the current time as a string.
      CallExpression(node) {
        const name = dottedName(node.callee);
        if (name && DATE_CONSTRUCTORS.has(name)) report(node, `${name}()`);
      },
      // A no-argument `new Date()`; `new Date('2026-09-01')` is a fixed timestamp.
      NewExpression(node) {
        const name = dottedName(node.callee);
        if (name && DATE_CONSTRUCTORS.has(name) && node.arguments.length === 0) {
          report(node, `new ${name}()`);
        }
      },
    };
  },
};
