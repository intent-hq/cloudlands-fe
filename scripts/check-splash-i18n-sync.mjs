#!/usr/bin/env node
// check-splash-i18n-sync.mjs — splash screen i18n sync gate.
//
// src/app.html embeds a per-locale copy of `splash_gettingReady_label` so the
// splash text can be localized before first paint, without waiting for the
// SvelteKit bundle. The catalogs (messages/*.json) are the source of truth;
// this check fails when the inline map drifts from them:
//   - a locale's inline value differs from its catalog value,
//   - a catalog locale is missing from the inline map,
//   - the inline map has a locale with no catalog file,
//   - a catalog lacks the splash key entirely.
//
// Exits 1 with a diff-style report on any violation. Chained into
// `pnpm run lint` (like check-i18n-completeness.mjs), so it runs in CI.
//
// Usage: node scripts/check-splash-i18n-sync.mjs [rootDir]
//   rootDir defaults to the repo root; overriding it is used by the unit tests.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const SPLASH_KEY = 'splash_gettingReady_label';
const APP_HTML = 'src/app.html';

const MAP_RE = /const messages = \{([\s\S]*?)\};/;
const ENTRY_RE = /(['"])((?:\\.|(?!\1)[^\\])*)\1\s*:\s*(['"])((?:\\.|(?!\3)[^\\])*)\3/g;

function unescapeJs(literal) {
  return literal.replace(/\\(.)/g, '$1');
}

/**
 * Parse the inline `const messages = { ... }` map out of app.html source.
 * Returns `{ map }` on success or `{ error }` when the map cannot be found.
 */
export function parseSplashMap(html) {
  const match = html.match(MAP_RE);
  if (!match) {
    return { error: `no \`const messages = { ... }\` map found in ${APP_HTML}` };
  }
  const map = {};
  for (const entry of match[1].matchAll(ENTRY_RE)) {
    map[unescapeJs(entry[2])] = unescapeJs(entry[4]);
  }
  if (Object.keys(map).length === 0) {
    return { error: `the \`const messages\` map in ${APP_HTML} has no parsable entries` };
  }
  return { map };
}

/**
 * Compare the inline splash map in src/app.html against `splash_gettingReady_label`
 * in each messages/*.json catalog under `rootDir`. Returns a list of
 * human-readable problem lines (empty = pass). Pure apart from filesystem reads.
 */
export function checkSplashSync(rootDir) {
  const problems = [];

  const html = readFileSync(join(rootDir, APP_HTML), 'utf8');
  const parsed = parseSplashMap(html);
  if (parsed.error) {
    return [parsed.error];
  }
  const map = parsed.map;

  const locales = readdirSync(join(rootDir, 'messages'))
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .sort();

  for (const locale of locales) {
    const catalog = JSON.parse(readFileSync(join(rootDir, `messages/${locale}.json`), 'utf8'));
    const want = catalog[SPLASH_KEY];
    if (typeof want !== 'string') {
      problems.push(`${locale}: messages/${locale}.json has no ${SPLASH_KEY} key`);
      continue;
    }
    if (!(locale in map)) {
      problems.push(
        `${locale}: missing from the ${APP_HTML} splash map (catalog value: "${want}")`,
      );
      continue;
    }
    if (map[locale] !== want) {
      problems.push(
        `${locale}: splash map value diverges from messages/${locale}.json ${SPLASH_KEY}:\n` +
          `  catalog:  "${want}"\n` +
          `  app.html: "${map[locale]}"`,
      );
    }
  }

  for (const locale of Object.keys(map)) {
    if (!locales.includes(locale)) {
      problems.push(
        `${locale}: present in the ${APP_HTML} splash map but messages/${locale}.json does not exist`,
      );
    }
  }

  return problems;
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirectRun) {
  const rootDir = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..');
  const problems = checkSplashSync(rootDir);
  if (problems.length > 0) {
    console.error(`splash i18n sync check FAILED (${problems.length} problem(s)):\n`);
    for (const problem of problems) console.error(`✗ ${problem}`);
    console.error(`\nThe inline splash map in ${APP_HTML} must mirror ${SPLASH_KEY}`);
    console.error('in every messages/*.json catalog — the catalogs are the source of truth.');
    process.exit(1);
  }
  console.log('splash i18n sync check passed.');
}
