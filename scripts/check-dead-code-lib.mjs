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

/** The `rules` map from knip.jsonc text; unlisted types default to "error" in knip. */
export function parseKnipRules(jsoncText) {
  const config = JSON.parse(stripJsonc(jsoncText));
  const rules = config?.rules;
  return rules && typeof rules === 'object' ? { ...rules } : {};
}

export function severityOf(type, rules) {
  return rules[type] ?? 'error';
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
