import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ESLint } from 'eslint';

const baselinePath = 'eslint-rules/design-system/baseline.json';
const rulesIndexPath = 'eslint-rules/design-system/index.js';
const configPath = 'eslint.config.js';

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

function gitShow(ref, cwd, file = baselinePath) {
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

/**
 * The baseline as committed at the comparison revision — `LINT_BASELINE_BASE_REF`
 * (the PR / merge-queue base on CI) or `HEAD` locally. `file` selects another
 * package-relative baseline JSON that follows the same ratchet; `undefined` when the
 * file did not exist at that revision (a baseline being introduced by this change).
 */
export function readComparisonBaseline({ cwd, env = process.env, file = baselinePath } = {}) {
  // DESIGN_SYSTEM_BASELINE_BASE_REF is the pre-rename spelling, honored for one release
  // so a workflow pinned to it keeps comparing against the PR base; remove afterwards.
  const configuredBase = env.LINT_BASELINE_BASE_REF || env.DESIGN_SYSTEM_BASELINE_BASE_REF;
  const ref = configuredBase || 'HEAD';
  const contents = gitShow(ref, cwd, file);
  if (!contents) {
    if (!configuredBase) return undefined;
    const status = execFileSync(
      'git',
      ['diff', '--name-status', configuredBase, 'HEAD', '--', file],
      {
        cwd,
        encoding: 'utf8',
      },
    ).trim();
    if (status === `A\t${file}`) return undefined;
    throw new Error(`Could not read ${file} from CI base revision ${configuredBase}`);
  }
  const rulesIndex = gitShow(ref, cwd, rulesIndexPath);
  return {
    ref,
    baseline: JSON.parse(contents),
    rules: rulesIndex === undefined ? undefined : parseRegisteredRules(rulesIndex),
  };
}

function isEnabled(setting) {
  const severity = Array.isArray(setting) ? setting[0] : setting;
  return severity !== undefined && severity !== 'off' && severity !== 0;
}

/**
 * The config entries that enable `ruleIds`, reduced to their `files` / `ignores` scope
 * and the rule's own setting. A `baseline` option is reset to `{}` (other options
 * survive); a setting without one is copied verbatim, since rules with `schema: []`
 * reject any options object. Appended to the repo config these win over later per-file
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
      const [severity, options] = Array.isArray(setting) ? setting : [setting];
      rules[ruleId] =
        options !== null && typeof options === 'object' && 'baseline' in options
          ? [severity, { ...options, baseline: {} }]
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
 * Lint `ruleIds` over the repo's real flat config: file resolution and global ignores
 * (incl. `.gitignore`) come from `eslint.config.js`, only the rule(s) under ratchet run,
 * and the result maps each rule id to `{ [packageRelativeFile]: violationCount }`.
 * `eslintClass` is injectable for tests.
 */
export async function lintRuleFromRepoConfig({ cwd, ruleIds, eslintClass = ESLint }) {
  const ids = [ruleIds].flat();
  const { default: config } = await import(pathToFileURL(path.join(cwd, configPath)).href);
  const eslint = new eslintClass({
    cwd,
    overrideConfig: ruleScopeOverrides(config, ids),
    ruleFilter: ({ ruleId }) => ids.includes(ruleId),
    cache: false,
  });
  const results = await eslint.lintFiles(['.']);
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
