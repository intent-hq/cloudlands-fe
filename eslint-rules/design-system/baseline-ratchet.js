import { execFileSync } from 'node:child_process';

const baselinePath = 'eslint-rules/design-system/baseline.json';
const rulesIndexPath = 'eslint-rules/design-system/index.js';

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
      `Design-system baseline entries and counts may only shrink:\n${JSON.stringify(growth, null, 2)}`,
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
 * The baseline as committed at the comparison revision — `DESIGN_SYSTEM_BASELINE_BASE_REF`
 * (the PR / merge-queue base on CI) or `HEAD` locally. `file` selects another
 * package-relative baseline JSON that follows the same ratchet; `undefined` when the
 * file did not exist at that revision (a baseline being introduced by this change).
 */
export function readComparisonBaseline({ cwd, env = process.env, file = baselinePath } = {}) {
  const configuredBase = env.DESIGN_SYSTEM_BASELINE_BASE_REF;
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
