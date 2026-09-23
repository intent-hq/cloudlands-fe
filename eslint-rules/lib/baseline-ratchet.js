import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ESLint } from 'eslint';

/**
 * Ratchet baselines live as one small file per tolerated source file,
 * `eslint-rules/baselines/<rule>/<package-relative source path>.json`, so parallel
 * debt-reduction PRs each delete their own files and never conflict on a shared JSON
 * document. An entry is `{ owner, reason }` for a whole-file exemption or
 * `{ owner, reason, count }` for a per-file violation cap; rules without ownership
 * metadata (the source-literal ratchet) use `{ count }`. A rule with no directory is
 * enforced at zero debt.
 */
export const baselinesDir = 'eslint-rules/baselines';
const legacyDesignSystemBaselinePath = 'eslint-rules/design-system/baseline.json';
const legacySourceLiteralBaselinePath =
  'eslint-rules/no-source-literal-assertions-in-tests.baseline.json';
const rulesIndexPath = 'eslint-rules/design-system/index.js';
const configPath = 'eslint.config.js';

function parseEntry(file, contents) {
  const entry = JSON.parse(contents);
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(`${file}: a baseline entry must be a JSON object`);
  }
  for (const key of ['owner', 'reason']) {
    if (key in entry && (typeof entry[key] !== 'string' || entry[key].trim() === '')) {
      throw new Error(`${file}: "${key}" must be a non-empty string`);
    }
  }
  if ('count' in entry && !(Number.isInteger(entry.count) && entry.count >= 1)) {
    throw new Error(`${file}: "count" must be an integer >= 1`);
  }
  return entry;
}

/**
 * Group `<rule>/<source>.json` entry files into the in-memory baseline shape,
 * `{ [rule]: [{ owner?, reason?, files }, { owner?, reason?, counts }] }`, one group per
 * owner/reason pair in first-seen order; files within a group are sorted.
 */
export function parseBaselineTree(files, { rules } = {}) {
  const baseline = {};
  const groups = new Map();
  for (const [relative, contents] of [...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const [rule, ...rest] = relative.split('/');
    const source = rest.join('/');
    if (!source.endsWith('.json') || source === '.json') {
      throw new Error(`${baselinesDir}/${relative}: expected <rule>/<source path>.json`);
    }
    if (rules && !rules.includes(rule)) continue;
    const entry = parseEntry(`${baselinesDir}/${relative}`, contents);
    const file = source.slice(0, -'.json'.length);
    const kind = 'count' in entry ? 'counts' : 'files';
    const key = JSON.stringify([rule, entry.owner ?? null, entry.reason ?? null, kind]);
    let group = groups.get(key);
    if (!group) {
      group = {
        ...(entry.owner !== undefined && { owner: entry.owner }),
        ...(entry.reason !== undefined && { reason: entry.reason }),
        [kind]: kind === 'counts' ? {} : [],
      };
      groups.set(key, group);
      (baseline[rule] ??= []).push(group);
    }
    if (kind === 'counts') group.counts[file] = entry.count;
    else group.files.push(file);
  }
  return baseline;
}

/** The checked-out baseline tree, optionally narrowed to `rules`. */
export function loadBaseline({ cwd, rules } = {}) {
  const dir = path.join(cwd, baselinesDir);
  if (!fs.existsSync(dir)) return {};
  const files = fs
    .readdirSync(dir, { recursive: true })
    .map((relative) => relative.split(path.sep).join('/'))
    .filter((relative) => fs.statSync(path.join(dir, relative)).isFile())
    .map((relative) => [relative, fs.readFileSync(path.join(dir, relative), 'utf8')]);
  return parseBaselineTree(files, { rules });
}

export function baselineFiles(entries = []) {
  if (entries.every((entry) => typeof entry === 'string')) return entries;
  return entries.flatMap((entry) => entry.files ?? Object.keys(entry.counts ?? {}));
}

export function baselineCounts(entries = []) {
  if (!entries.some((entry) => typeof entry === 'object' && entry.counts)) return undefined;
  return Object.assign({}, ...entries.map((entry) => entry.counts ?? {}));
}

/**
 * Per-file exemption for one rule: the allowed violation count, or `'uncounted'` for a
 * file exemption (which also wins when a file appears in both representations).
 */
function exemptionsByFile(entries = []) {
  const exemptions = new Map();
  for (const entry of entries) {
    if (typeof entry === 'string') {
      exemptions.set(entry, 'uncounted');
      continue;
    }
    for (const file of entry.files ?? []) exemptions.set(file, 'uncounted');
    for (const [file, count] of Object.entries(entry.counts ?? {})) {
      if (exemptions.get(file) !== 'uncounted') exemptions.set(file, count);
    }
  }
  return exemptions;
}

function compareFiles([a], [b]) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Rule names registered in a design-system `index.js` source. */
export function parseRegisteredRules(source) {
  return [...source.matchAll(/^\s*'([a-z][a-z0-9-]*)':\s*[A-Za-z_$][\w$]*,?$/gm)].map(
    ([, rule]) => rule,
  );
}

/**
 * Only rules absent from the comparison rule set (`newRules`) may establish an initial
 * baseline; a registered rule with no baseline entry is enforced at zero debt.
 */
export function findBaselineGrowth(base, current, { newRules = [] } = {}) {
  const growth = {};
  for (const [rule, entries] of Object.entries(current)) {
    if (!(rule in base)) {
      if (newRules.includes(rule)) continue;
      const added = [...baselineFiles(entries)].sort();
      if (added.length) growth[rule] = added;
      continue;
    }
    const previousExemptions = exemptionsByFile(base[rule]);
    const currentExemptions = exemptionsByFile(entries);
    const counted = [...previousExemptions.values(), ...currentExemptions.values()].some(
      (exemption) => exemption !== 'uncounted',
    );
    if (!counted) {
      const added = [...currentExemptions.keys()]
        .filter((file) => !previousExemptions.has(file))
        .sort();
      if (added.length) growth[rule] = added;
      continue;
    }
    // Compared per file: a file exemption may convert to a counted one, but dropping a
    // per-file cap (or adding an uncounted file) is growth even while other counts remain.
    const grown = [...currentExemptions]
      .filter(([file, exemption]) => {
        const before = previousExemptions.get(file);
        if (before === 'uncounted') return false;
        if (exemption === 'uncounted') return true;
        return exemption > (before ?? 0);
      })
      .sort(compareFiles)
      .map(([file, exemption]) => ({
        file,
        previous: previousExemptions.get(file) ?? 0,
        current: exemption,
      }));
    if (grown.length) growth[rule] = grown;
  }
  return growth;
}

export function assertBaselineOnlyShrinks(base, current, options) {
  const growth = findBaselineGrowth(base, current, options);
  if (Object.keys(growth).length) {
    throw new Error(
      `Baseline entries and counts may only shrink:\n${JSON.stringify(growth, null, 2)}`,
    );
  }
}

function gitShow(ref, cwd, file) {
  try {
    return execFileSync('git', ['show', `${ref}:${file}`], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return undefined;
  }
}

/** `[path relative to dir, contents]` for every blob under `dir` at `ref`, in one batch. */
function gitReadTree(ref, cwd, dir) {
  const listing = execFileSync('git', ['ls-tree', '-r', '-z', ref, '--', dir], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const blobs = listing
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const [meta, file] = line.split('\t');
      return { sha: meta.split(' ')[2], file: file.slice(dir.length + 1) };
    });
  if (!blobs.length) return [];
  const batch = execFileSync('git', ['cat-file', '--batch'], {
    cwd,
    input: blobs.map(({ sha }) => `${sha}\n`).join(''),
    stdio: ['pipe', 'pipe', 'ignore'],
    maxBuffer: 64 * 1024 * 1024,
  });
  const files = [];
  let offset = 0;
  for (const { file } of blobs) {
    const headerEnd = batch.indexOf(0x0a, offset);
    const size = Number(batch.toString('utf8', offset, headerEnd).split(' ')[2]);
    const start = headerEnd + 1;
    files.push([file, batch.toString('utf8', start, start + size)]);
    offset = start + size + 1;
  }
  return files;
}

// Transitional: a comparison revision that predates the directory layout still carries
// the single-document baselines; read them so the layout migration itself is compared
// against the debt it moved. Remove once `main` carries `eslint-rules/baselines/`.
function readLegacyBaseline(ref, cwd) {
  const baseline = {};
  const designSystem = gitShow(ref, cwd, legacyDesignSystemBaselinePath);
  if (designSystem !== undefined) Object.assign(baseline, JSON.parse(designSystem));
  const sourceLiteral = gitShow(ref, cwd, legacySourceLiteralBaselinePath);
  if (sourceLiteral !== undefined) {
    const counts = JSON.parse(sourceLiteral);
    if (Object.keys(counts).length) {
      baseline['no-source-literal-assertions-in-tests'] = [{ counts }];
    }
  }
  return baseline;
}

/**
 * The baseline tree as committed at the comparison revision — `LINT_BASELINE_BASE_REF`
 * (the PR / merge-queue base on CI) or `HEAD` locally — optionally narrowed to `rules`.
 * A rule with no directory at that revision was enforced at zero debt there, so only
 * rules absent from the returned design-system `rules` registry (`undefined` when the
 * index is unreadable) may establish an initial baseline.
 */
export function readComparisonBaseline({ cwd, env = process.env, rules } = {}) {
  // DESIGN_SYSTEM_BASELINE_BASE_REF is the pre-rename spelling, honored for one release
  // so a workflow pinned to it keeps comparing against the PR base; remove afterwards.
  const configuredBase = env.LINT_BASELINE_BASE_REF || env.DESIGN_SYSTEM_BASELINE_BASE_REF;
  const ref = configuredBase || 'HEAD';
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
      cwd,
      stdio: 'ignore',
    });
  } catch {
    throw new Error(`Could not resolve baseline comparison revision ${ref}`);
  }
  const files = gitReadTree(ref, cwd, baselinesDir);
  let baseline = parseBaselineTree(files, { rules });
  if (!files.length) {
    baseline = readLegacyBaseline(ref, cwd);
    if (rules) {
      baseline = Object.fromEntries(
        Object.entries(baseline).filter(([rule]) => rules.includes(rule)),
      );
    }
  }
  const rulesIndex = gitShow(ref, cwd, rulesIndexPath);
  return {
    ref,
    baseline,
    rules: rulesIndex === undefined ? undefined : parseRegisteredRules(rulesIndex),
  };
}

function isEnabled(setting) {
  const severity = Array.isArray(setting) ? setting[0] : setting;
  return severity !== undefined && severity !== 'off' && severity !== 0;
}

/**
 * The config entries that enable `ruleIds`, reduced to their `files` / `ignores` scope
 * and the rule's own setting. A `baseline` option is reset to `{}` (other options and
 * any further option items survive); a setting without one is copied verbatim, since
 * rules with `schema: []` reject any options object. Appended to the repo config these
 * win over later per-file
 * `'off'` entries, so every file the rule applies to is linted at zero debt — the scope
 * comes from the config only.
 */
export function ruleScopeOverrides(config, ruleIds) {
  const ids = [ruleIds].flat();
  return config.flatMap((entry) => {
    const rules = {};
    for (const ruleId of ids) {
      const setting = entry.rules?.[ruleId];
      if (!isEnabled(setting)) continue;
      const [severity, options, ...rest] = Array.isArray(setting) ? setting : [setting];
      rules[ruleId] =
        options !== null && typeof options === 'object' && 'baseline' in options
          ? [severity, { ...options, baseline: {} }, ...rest]
          : setting;
    }
    if (!Object.keys(rules).length) return [];
    return [
      {
        ...(entry.files !== undefined && { files: entry.files }),
        ...(entry.ignores !== undefined && { ignores: entry.ignores }),
        rules,
      },
    ];
  });
}

/**
 * The `lintFiles` patterns for a set of scope overrides: the union of their `files`
 * globs, so ESLint walks only the files the rule(s) can apply to (the config's global
 * ignores still apply to glob matches). Falls back to the whole tree when an entry is
 * unscoped or uses a nested AND-glob array, which has no single-pattern equivalent.
 */
export function lintPatterns(overrides) {
  const patterns = new Set();
  for (const { files } of overrides) {
    if (files === undefined) return ['.'];
    for (const pattern of files) {
      if (typeof pattern !== 'string') return ['.'];
      patterns.add(pattern);
    }
  }
  return patterns.size ? [...patterns] : ['.'];
}

/**
 * Lint `ruleIds` over the repo's real flat config: file resolution and global ignores
 * (incl. `.gitignore`) come from `eslint.config.js`, only the rule(s) under ratchet run,
 * and the result maps each rule id to `{ [packageRelativeFile]: violationCount }`.
 * A config-derived glob that a global ignore covers entirely (or that matches nothing)
 * contributes no files rather than failing the run, as `lintFiles(['.'])` would.
 * `eslintClass` is injectable for tests.
 */
export async function lintRuleFromRepoConfig({ cwd, ruleIds, eslintClass = ESLint }) {
  const ids = [ruleIds].flat();
  const { default: config } = await import(pathToFileURL(path.join(cwd, configPath)).href);
  const overrides = ruleScopeOverrides(config, ids);
  const eslint = new eslintClass({
    cwd,
    overrideConfig: overrides,
    ruleFilter: ({ ruleId }) => ids.includes(ruleId),
    cache: false,
    errorOnUnmatchedPattern: false,
  });
  const results = await eslint.lintFiles(lintPatterns(overrides));
  const counts = Object.fromEntries(ids.map((ruleId) => [ruleId, {}]));
  for (const result of results) {
    const file = path.relative(cwd, result.filePath).split(path.sep).join('/');
    for (const message of result.messages) {
      const perFile = counts[message.ruleId];
      if (perFile) perFile[file] = (perFile[file] ?? 0) + 1;
    }
  }
  return counts;
}
