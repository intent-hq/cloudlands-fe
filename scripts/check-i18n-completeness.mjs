#!/usr/bin/env node
// check-i18n-completeness.mjs — catalog completeness gate for i18n.
//
// Validates every committed locale catalog against the base catalog
// (messages/en.json) and the inlang project registration:
//   - every locale in project.inlang/settings.json has a catalog file,
//   - every messages/*.json catalog is registered in settings.json,
//   - non-base catalogs have exactly the base key set (no missing, no extra),
//   - `{param}` placeholders match the base message per key,
//   - `_one` / `_many` plural key pairs are complete (checked per catalog,
//     including the base),
//   - non-base values that are byte-identical to the base value and contain
//     letters are flagged as untranslated unless allowlisted in
//     scripts/i18n-equal-allowlist.json (letter-free values — placeholders,
//     punctuation, numbers — are auto-exempt).
//
// Allowlist format (scripts/i18n-equal-allowlist.json): a JSON object mapping
// message key → either "*" (identical is intentional in every locale) or an
// array of locale codes (intentional only in those locales). Stale entries —
// a key no longer in the base catalog, or no longer identical in a scoped
// locale — are reported as problems so the allowlist cannot rot.
//
// Exits 1 with a diff-style report on any violation. Chained into
// `pnpm run lint` (like check-hardcoded-strings.mjs), so it runs in CI.
//
// Usage: node scripts/check-i18n-completeness.mjs [rootDir]
//   rootDir defaults to the repo root; overriding it is used by the unit tests.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const PLACEHOLDER_RE = /\{[a-zA-Z_$][\w$]*\}/g;
const LETTER_RE = /\p{L}/u;
const ALLOWLIST_RELPATH = 'scripts/i18n-equal-allowlist.json';

// Cap per-category key listings so a massively incomplete catalog reports a
// readable diff instead of thousands of lines; the total count is always shown.
const MAX_LISTED = 25;

function listCapped(lines) {
  const shown = lines.slice(0, MAX_LISTED);
  const rest = lines.length - shown.length;
  return rest > 0 ? [...shown, `  … and ${rest} more`] : shown;
}

function messageKeys(catalog) {
  return Object.keys(catalog).filter((key) => key !== '$schema');
}

function placeholders(message) {
  return [...new Set(String(message).match(PLACEHOLDER_RE) ?? [])].sort();
}

/** Keys ending `_one` without a `_many` twin in the same catalog, and vice versa. */
function unpairedPlurals(keys) {
  const set = new Set(keys);
  const unpaired = [];
  for (const key of keys) {
    if (key.endsWith('_one') && !set.has(`${key.slice(0, -4)}_many`)) {
      unpaired.push(`${key} has no ${key.slice(0, -4)}_many twin`);
    } else if (key.endsWith('_many') && !set.has(`${key.slice(0, -5)}_one`)) {
      unpaired.push(`${key} has no ${key.slice(0, -5)}_one twin`);
    }
  }
  return unpaired;
}

/** Load scripts/i18n-equal-allowlist.json under `rootDir` (missing file = empty). */
function loadEqualAllowlist(rootDir) {
  const path = join(rootDir, ALLOWLIST_RELPATH);
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** True when the allowlist entry (`"*"` or a locale array) covers `locale`. */
function allowlistCovers(scope, locale) {
  return scope === '*' || (Array.isArray(scope) && scope.includes(locale));
}

/**
 * Check all catalogs under `rootDir`. Returns a list of human-readable
 * problem lines (empty = pass). Pure apart from filesystem reads.
 */
export function checkCompleteness(rootDir) {
  const problems = [];

  const settingsPath = join(rootDir, 'project.inlang/settings.json');
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  const baseLocale = settings.baseLocale;
  const registered = settings.locales ?? [];

  const basePath = join(rootDir, `messages/${baseLocale}.json`);
  const baseCatalog = JSON.parse(readFileSync(basePath, 'utf8'));
  const baseKeys = messageKeys(baseCatalog);

  const allowlist = loadEqualAllowlist(rootDir);
  // key → Set of locales whose value is byte-identical to the base value
  // (letter-free or not); feeds the stale-allowlist-entry check below.
  const identicalLocales = new Map();

  // Registration ↔ file cross-check.
  const onDisk = readdirSync(join(rootDir, 'messages'))
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length));
  for (const locale of registered) {
    if (!onDisk.includes(locale)) {
      problems.push(
        `${locale}: registered in project.inlang/settings.json but messages/${locale}.json does not exist`,
      );
    }
  }
  for (const locale of onDisk) {
    if (!registered.includes(locale)) {
      problems.push(
        `${locale}: messages/${locale}.json exists but is not registered in project.inlang/settings.json`,
      );
    }
  }

  // Base catalog: plural pairing.
  const baseUnpaired = unpairedPlurals(baseKeys);
  if (baseUnpaired.length > 0) {
    problems.push(
      `${baseLocale}: ${baseUnpaired.length} unpaired plural(s):\n` +
        listCapped(baseUnpaired.map((line) => `  ! ${line}`)).join('\n'),
    );
  }

  // Non-base catalogs: exact key parity + placeholder parity + plural pairing.
  for (const locale of registered) {
    if (locale === baseLocale) continue;
    const catalogPath = join(rootDir, `messages/${locale}.json`);
    if (!existsSync(catalogPath)) continue; // already reported above
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
    const keys = messageKeys(catalog);
    const keySet = new Set(keys);
    const baseKeySet = new Set(baseKeys);

    const missing = baseKeys.filter((key) => !keySet.has(key));
    if (missing.length > 0) {
      problems.push(
        `${locale}: ${missing.length} missing key(s) present in ${baseLocale}.json:\n` +
          listCapped(missing.map((key) => `  - ${key}`)).join('\n'),
      );
    }
    const extra = keys.filter((key) => !baseKeySet.has(key));
    if (extra.length > 0) {
      problems.push(
        `${locale}: ${extra.length} extra key(s) not in ${baseLocale}.json:\n` +
          listCapped(extra.map((key) => `  + ${key}`)).join('\n'),
      );
    }
    const mismatched = [];
    for (const key of baseKeys) {
      if (!keySet.has(key)) continue;
      const want = placeholders(baseCatalog[key]);
      const got = placeholders(catalog[key]);
      if (want.join(',') !== got.join(',')) {
        mismatched.push(
          `  ~ ${key}: ${baseLocale} has [${want.join(' ') || 'none'}], ${locale} has [${got.join(' ') || 'none'}]`,
        );
      }
    }
    if (mismatched.length > 0) {
      problems.push(
        `${locale}: ${mismatched.length} placeholder mismatch(es):\n` +
          listCapped(mismatched).join('\n'),
      );
    }
    const unpaired = unpairedPlurals(keys);
    if (unpaired.length > 0) {
      problems.push(
        `${locale}: ${unpaired.length} unpaired plural(s):\n` +
          listCapped(unpaired.map((line) => `  ! ${line}`)).join('\n'),
      );
    }

    // Values byte-identical to the base value. Letter-free values (pure
    // placeholders, punctuation, numbers) are auto-exempt; anything with
    // letters must be allowlisted or is reported as untranslated.
    const untranslated = [];
    for (const key of baseKeys) {
      if (!keySet.has(key)) continue;
      if (catalog[key] !== baseCatalog[key]) continue;
      if (!identicalLocales.has(key)) identicalLocales.set(key, new Set());
      identicalLocales.get(key).add(locale);
      if (!LETTER_RE.test(String(baseCatalog[key]))) continue;
      if (allowlistCovers(allowlist[key], locale)) continue;
      untranslated.push(`  = ${key}`);
    }
    if (untranslated.length > 0) {
      problems.push(
        `${locale}: ${untranslated.length} value(s) identical to ${baseLocale}.json (translate, or allowlist in ${ALLOWLIST_RELPATH} if intentionally invariant):\n` +
          listCapped(untranslated).join('\n'),
      );
    }
  }

  // Stale allowlist entries: a key that left the base catalog, or a scoped
  // locale whose value is no longer identical, must be removed from the file.
  const baseKeySet = new Set(baseKeys);
  const stale = [];
  for (const [key, scope] of Object.entries(allowlist)) {
    if (scope !== '*' && !Array.isArray(scope)) {
      stale.push(`  ? ${key}: invalid entry (expected "*" or an array of locales)`);
      continue;
    }
    if (!baseKeySet.has(key)) {
      stale.push(`  ? ${key}: key no longer exists in ${baseLocale}.json`);
      continue;
    }
    const identical = identicalLocales.get(key) ?? new Set();
    if (scope === '*') {
      if (identical.size === 0) {
        stale.push(`  ? ${key}: no locale is identical to ${baseLocale}.json anymore`);
      }
      continue;
    }
    for (const locale of scope) {
      if (!identical.has(locale)) {
        stale.push(`  ? ${key} [${locale}]: no longer identical to ${baseLocale}.json`);
      }
    }
  }
  if (stale.length > 0) {
    problems.push(
      `${ALLOWLIST_RELPATH}: ${stale.length} stale entr${stale.length === 1 ? 'y' : 'ies'} (remove or rescope):\n` +
        listCapped(stale).join('\n'),
    );
  }

  return problems;
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirectRun) {
  const rootDir = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..');
  const problems = checkCompleteness(rootDir);
  if (problems.length > 0) {
    console.error(`i18n catalog completeness check FAILED (${problems.length} problem(s)):\n`);
    for (const problem of problems) console.error(`✗ ${problem}`);
    console.error('\nEvery locale catalog must have exactly the key set of messages/en.json,');
    console.error('matching {param} placeholders per key, and complete _one/_many plural pairs.');
    console.error('Values identical to en.json that contain letters must be translated or');
    console.error(`allowlisted in ${ALLOWLIST_RELPATH} (per key, "*" or a locale array).`);
    process.exit(1);
  }
  console.log('i18n catalog completeness check passed.');
}
