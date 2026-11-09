// Pure logic for the knip dead-code gate wrapper (scripts/check-dead-code.mjs).
//
// The wrapper drops two known-unused canary files into the tree, runs knip once with the
// JSON reporter and asserts both are reported. cloudlands-fe#2695 found three independent
// masks that each made knip's Svelte coverage zero while `pnpm lint:dead-code` kept passing
// for months ('.svelte' in vite `resolve.extensions`, an `import.meta.glob` over the
// component tree in a test, an unanchored `*-*-*-*-*/` gitignore rule). The canary turns
// any regression of that kind into an immediate gate failure.
//
// Kept side-effect free so it is unit-testable (scripts/check-dead-code.test.ts).

// Under src/lib/components so a re-introduced catalog glob over that tree masks it.
export const CANARY_DIR = 'src/lib/components/__knip-canary__';
// The tsconfig.json `exclude` entry keeping the canary out of every tsc program, so a
// type-check overlapping the gate never fails with TS6053 when the files vanish mid-run.
// scripts/check-dead-code.test.ts asserts the root tsconfigs honour it.
export const CANARY_TSCONFIG_EXCLUDE = `${CANARY_DIR}/**/*`;
// ≥4 hyphens so a re-introduced unanchored `*-*-*-*-*/` gitignore rule hides it.
const CANARY_STEM = 'knip-canary-unused-a-b';

export const CANARY_FILES = Object.freeze([
  Object.freeze({
    path: `${CANARY_DIR}/${CANARY_STEM}.svelte`,
    content:
      '<script lang="ts">\n  // knip gate canary — must be reported as unused.\n</script>\n\n<span></span>\n',
  }),
  Object.freeze({
    path: `${CANARY_DIR}/${CANARY_STEM}.ts`,
    content: '// knip gate canary — must be reported as unused.\nexport const knipCanary = true;\n',
  }),
]);

export const CANARY_PATHS = Object.freeze(CANARY_FILES.map((file) => file.path));

// The production pass must report a file whose only importer is a test. Old workspace-naming
// code (intent-slug-generator.ts) survived months that way because tests count as entries in
// the default pass (cloudlands-fe#4329). Vitest excludes the canary directory, so the stub
// test is never run.
const TEST_ONLY_STEM = 'knip-canary-test-only-a-b';
export const TEST_ONLY_CANARY_FILES = Object.freeze([
  Object.freeze({
    path: `${CANARY_DIR}/${TEST_ONLY_STEM}.ts`,
    content:
      '// knip gate canary — imported only by a test; the production pass must report it.\nexport const knipTestOnlyCanary = true;\n',
  }),
  Object.freeze({
    path: `${CANARY_DIR}/${TEST_ONLY_STEM}.test.ts`,
    content: `import { knipTestOnlyCanary } from './${TEST_ONLY_STEM}';\n\nvoid knipTestOnlyCanary;\n`,
  }),
]);
export const PRODUCTION_CANARY_PATHS = Object.freeze([TEST_ONLY_CANARY_FILES[0].path]);
export const ALL_CANARY_FILES = Object.freeze([...CANARY_FILES, ...TEST_ONLY_CANARY_FILES]);

// Issue types of the production pass. Dependencies, unresolved imports and duplicates stay
// with the default pass, which already fails on them.
export const PRODUCTION_ISSUE_TYPES = Object.freeze([
  'files',
  'exports',
  'nsExports',
  'types',
  'nsTypes',
  'enumMembers',
  'namespaceMembers',
]);

export const PRODUCTION_BASELINE_PATH = 'scripts/knip-production-baseline.json';
export const PRODUCTION_BASELINE_PRUNE_COMMAND =
  'node scripts/check-dead-code.mjs --prune-baseline';

function symbolName(entry) {
  return entry.namespace ? `${entry.namespace}.${entry.name}` : entry.name;
}

/** Stable `type\tfile[\tsymbol]` keys for production-pass issues (no line numbers). */
export function productionIssueKeys(issues) {
  const keys = new Set();
  for (const row of issues) {
    for (const type of PRODUCTION_ISSUE_TYPES) {
      for (const entry of row[type] ?? []) {
        keys.add(
          type === 'files' ? `files\t${row.file}` : `${type}\t${row.file}\t${symbolName(entry)}`,
        );
      }
    }
  }
  return keys;
}

/** Baseline JSON → key set. A missing baseline (null) is empty. */
export function parseProductionBaseline(text) {
  if (text === null) return new Set();
  const parsed = JSON.parse(text);
  if (parsed?.version !== 1) throw new Error(`${PRODUCTION_BASELINE_PATH}: expected version 1`);
  const keys = new Set();
  for (const file of parsed.files ?? []) keys.add(`files\t${file}`);
  for (const type of PRODUCTION_ISSUE_TYPES) {
    if (type === 'files') continue;
    for (const [file, symbols] of Object.entries(parsed[type] ?? {})) {
      for (const symbol of symbols) keys.add(`${type}\t${file}\t${symbol}`);
    }
  }
  return keys;
}

/** Key set → deterministic baseline JSON text (sorted, one symbol per line). */
export function serializeProductionBaseline(keys) {
  const out = {
    version: 1,
    note: `Known code used only by tests. Shrink-only: delete entries as the code is removed or gains a production caller (${PRODUCTION_BASELINE_PRUNE_COMMAND}). Never add entries.`,
  };
  const sorted = [...keys].sort();
  const files = sorted.filter((key) => key.startsWith('files\t')).map((key) => key.slice(6));
  if (files.length) out.files = files;
  for (const type of PRODUCTION_ISSUE_TYPES) {
    if (type === 'files') continue;
    const byFile = {};
    for (const key of sorted) {
      const [keyType, file, symbol] = key.split('\t');
      if (keyType === type) (byFile[file] ??= []).push(symbol);
    }
    if (Object.keys(byFile).length) out[type] = byFile;
  }
  return `${JSON.stringify(out, null, 2)}\n`;
}

const fileOf = (key) => key.split('\t')[1];

// A baselined unused file covers every finding inside it: once the file gains a production
// caller, its leftover unused exports are the same debt, not new debt.
function coveredByBaselinedFile(key, baseline) {
  return !key.startsWith('files\t') && baseline.has(`files\t${fileOf(key)}`);
}

/** New findings fail the gate; baselined findings that disappeared must be pruned. */
export function compareToBaseline(current, baseline) {
  return {
    added: [...current]
      .filter((key) => !baseline.has(key) && !coveredByBaselinedFile(key, baseline))
      .sort(),
    stale: [...baseline].filter((key) => !current.has(key)).sort(),
  };
}

const KEY_TYPE_LABEL = Object.freeze({
  files: 'file',
  exports: 'export',
  nsExports: 'namespace export',
  types: 'type',
  nsTypes: 'namespace type',
  enumMembers: 'enum member',
  namespaceMembers: 'namespace member',
});

function describeKey(key) {
  const [type, file, symbol] = key.split('\t');
  return symbol === undefined
    ? `${file}  (${KEY_TYPE_LABEL[type]})`
    : `${file}  ${symbol}  (${KEY_TYPE_LABEL[type] ?? type})`;
}

/** Report for the production pass; empty string when it passes. */
export function renderProductionResult({ added, stale }) {
  const lines = [];
  if (added.length) {
    lines.push(
      `Code used only by tests (${added.length}) — knip --production finds no production caller:`,
      ...added.map((key) => `  ${describeKey(key)}`),
      '',
      'Delete it, or move a test-only helper under __tests__/, src/test/ or a *.fixture.ts /',
      '*Harness.svelte name (see knip.jsonc "project"). Tag a deliberate test seam `/** @internal */`.',
      `Do not add entries to ${PRODUCTION_BASELINE_PATH}; it is shrink-only.`,
      '',
    );
  }
  if (stale.length) {
    lines.push(
      `${PRODUCTION_BASELINE_PATH} lists ${stale.length} finding(s) knip no longer reports:`,
      ...stale.map((key) => `  ${describeKey(key)}`),
      '',
      `Shrink the baseline with: ${PRODUCTION_BASELINE_PRUNE_COMMAND}`,
      '',
    );
  }
  return lines.join('\n');
}

/**
 * Baseline after pruning: entries still reported, plus the findings inside a baselined file
 * that is now used (they replace its file entry). Never admits a finding from another file.
 */
export function pruneBaseline(current, baseline) {
  return new Set(
    [...current].filter((key) => baseline.has(key) || coveredByBaselinedFile(key, baseline)),
  );
}

export const MASK_REFERENCE = 'https://github.com/intent-hq/cloudlands-fe/pull/2695';

// Mirrors knip's ISSUE_TYPE_TITLE, in its report order.
export const ISSUE_TYPE_TITLE = Object.freeze({
  files: 'Unused files',
  dependencies: 'Unused dependencies',
  devDependencies: 'Unused devDependencies',
  optionalPeerDependencies: 'Referenced optional peerDependencies',
  unlisted: 'Unlisted dependencies',
  binaries: 'Unlisted binaries',
  unresolved: 'Unresolved imports',
  exports: 'Unused exports',
  nsExports: 'Exports in used namespace',
  types: 'Unused exported types',
  nsTypes: 'Exported types in used namespace',
  enumMembers: 'Unused exported enum members',
  namespaceMembers: 'Unused exported namespace members',
  duplicates: 'Duplicate exports',
  catalog: 'Unused catalog entries',
  catalogReferences: 'Unresolved catalog references',
  cycles: 'Circular dependencies',
});

// Mirrors knip's `defaultRules` (knip 6.33, dist/util/issue-initializers.js): every issue
// type is "error" except `cycles`, which knip defaults to "warn". Replicated rather than
// imported because knip's package exports do not expose that module.
export const DEFAULT_RULES = Object.freeze(
  Object.fromEntries(
    Object.keys(ISSUE_TYPE_TITLE).map((type) => [type, type === 'cycles' ? 'warn' : 'error']),
  ),
);

// Strip line and block comments and trailing commas from JSONC so JSON.parse accepts it.
// String literals are preserved verbatim.
export function stripJsonc(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') {
        if (text[j] === '\\') j += 1;
        j += 1;
      }
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (ch === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i);
      i = end === -1 ? text.length : end;
    } else if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

/** The `rules` map from knip.jsonc text; unlisted types take knip's defaults (DEFAULT_RULES). */
export function parseKnipRules(jsoncText) {
  const config = JSON.parse(stripJsonc(jsoncText));
  const rules = config?.rules;
  return rules && typeof rules === 'object' ? { ...rules } : {};
}

/** knip's effective severity: `{ ...defaultRules, ...config.rules }[type]`. */
export function severityOf(type, rules) {
  return rules[type] ?? DEFAULT_RULES[type] ?? 'error';
}

/**
 * Parse `knip --reporter json` stdout. knip 6 emits `{ issues: [{ file, <type>: [...] }] }`;
 * an unused file is a row whose `files` array holds `{ name: <path> }`.
 */
export function parseKnipJson(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new Error(
      `knip --reporter json produced no parseable JSON (${error.message}); stdout was ${JSON.stringify(stdout.slice(0, 200))}`,
      { cause: error },
    );
  }
  if (!parsed || !Array.isArray(parsed.issues)) {
    throw new Error('knip --reporter json output has no `issues` array — reporter format changed?');
  }
  return parsed.issues;
}

function reportedUnusedFiles(issues) {
  const files = new Set();
  for (const row of issues) {
    for (const entry of row.files ?? []) {
      if (entry?.name) files.add(entry.name);
    }
    if (row.files?.length && row.file) files.add(row.file);
  }
  return files;
}

/** Canary paths knip did NOT report as unused files (empty when the gate is healthy). */
export function findMissingCanaries(issues, canaryPaths = CANARY_PATHS) {
  const reported = reportedUnusedFiles(issues);
  return canaryPaths.filter((path) => !reported.has(path));
}

/** Drop every issue row under the canary directory. */
export function stripCanaryIssues(issues, canaryDir = CANARY_DIR) {
  const prefix = `${canaryDir}/`;
  return issues.filter((row) => !row.file?.startsWith(prefix));
}

function issueTypes(issues) {
  const seen = new Set(Object.keys(ISSUE_TYPE_TITLE));
  for (const row of issues) {
    for (const [key, value] of Object.entries(row)) {
      if (key !== 'file' && key !== 'owners' && Array.isArray(value)) seen.add(key);
    }
  }
  return [...seen];
}

/**
 * Issue counts per type, split by knip.jsonc rule severity. A `duplicates`/`cycles` entry
 * is one group (knip counts groups, not members), matching knip's own exit-code counter.
 */
export function countIssues(issues, rules) {
  const counts = { error: 0, warn: 0, byType: {} };
  for (const type of issueTypes(issues)) {
    let count = 0;
    for (const row of issues) count += row[type]?.length ?? 0;
    if (count === 0) continue;
    counts.byType[type] = count;
    const severity = severityOf(type, rules);
    if (severity === 'error') counts.error += count;
    else if (severity === 'warn') counts.warn += count;
  }
  return counts;
}

/** knip's exit semantics: non-zero only when an error-level issue remains. */
export function decideExitCode(issues, rules) {
  return countIssues(issues, rules).error > 0 ? 1 : 0;
}

function describeEntry(type, entry) {
  if (type === 'duplicates' || type === 'cycles') {
    const joiner = type === 'cycles' ? ' → ' : '|';
    return entry.map((symbol) => symbol.name).join(joiner);
  }
  const pos =
    entry.line === undefined
      ? ''
      : `:${entry.line}${entry.col === undefined ? '' : `:${entry.col}`}`;
  const parent = entry.namespace ? ` (${entry.namespace})` : '';
  return `${entry.name}${pos}${parent}`;
}

/** Compact human-readable report of the remaining (non-canary) issues, grouped by type. */
export function renderIssues(issues, rules) {
  const counts = countIssues(issues, rules);
  const lines = [];
  for (const type of issueTypes(issues)) {
    const count = counts.byType[type];
    if (!count) continue;
    const severity = severityOf(type, rules);
    const title = ISSUE_TYPE_TITLE[type] ?? type;
    lines.push(`${title} (${count})${severity === 'error' ? '' : ` [${severity}]`}`);
    for (const row of issues) {
      const entries = row[type];
      if (!entries?.length) continue;
      if (type === 'files') {
        lines.push(`  ${row.file}`);
        continue;
      }
      for (const entry of entries) lines.push(`  ${row.file}  ${describeEntry(type, entry)}`);
    }
    lines.push('');
  }
  if (lines.length === 0) return 'knip: no unused files, exports or dependencies.';
  const summary =
    counts.error > 0
      ? `knip found ${counts.error} error-level issue(s); fix or triage them (knip.jsonc).`
      : `knip found no error-level issues (${counts.warn} warning(s) reported).`;
  lines.push(summary);
  return lines.join('\n');
}

export function formatCanaryFailure(missing) {
  return [
    'lint:dead-code canary FAILED — knip no longer reports a known-unused file:',
    ...missing.map((path) => `  - ${path}`),
    '',
    'The dead-code gate is blind to (some) unused files. Check the three known masks:',
    "  1. vite.config.mjs resolve.extensions must not list '.svelte' (knip turns extra extensions into src/**/*.<ext> entries)",
    '  2. no import.meta.glob over src/**/*.svelte (or src/lib/components/**) in tests/entries',
    '  3. .gitignore patterns must not match source files (e.g. an unanchored *-*-*-*-*/ rule; knip honours .gitignore)',
    `See ${MASK_REFERENCE} for how each mask hid ~100 dead files.`,
  ].join('\n');
}

export function formatProductionCanaryFailure(missing) {
  return [
    'lint:dead-code production canary FAILED — knip --production no longer reports a file only a test imports:',
    ...missing.map((path) => `  - ${path}`),
    '',
    'Production entries must carry the `!` suffix in knip.jsonc and test files must not; a',
    'test pattern marked `!`, or src/** losing its `!` in "project", hides test-only code.',
  ].join('\n');
}
