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
    const currentCounts = baselineCounts(entries);
    const previousCounts = baselineCounts(base[rule]);
    if (currentCounts) {
      if (previousCounts) {
        const increased = Object.entries(currentCounts)
          .filter(([file, count]) => count > (previousCounts[file] ?? 0))
          .map(([file, count]) => ({ file, previous: previousCounts[file] ?? 0, current: count }));
        if (increased.length) growth[rule] = increased;
        continue;
      }
      // File exemptions may convert to counted violations, but only for the files
      // that were already exempt.
      const previous = new Set(baselineFiles(base[rule]));
      const converted = Object.entries(currentCounts)
        .filter(([file]) => !previous.has(file))
        .map(([file, count]) => ({ file, previous: 0, current: count }));
      if (converted.length) growth[rule] = converted;
      continue;
    }
    if (previousCounts) {
      // Dropping the per-file cap is growth, not a rewrite.
      growth[rule] = [...baselineFiles(entries)]
        .sort()
        .map((file) => ({ file, previous: previousCounts[file] ?? 0, current: 'uncounted' }));
      continue;
    }
    const previous = new Set(baselineFiles(base[rule]));
    const added = baselineFiles(entries)
      .filter((file) => !previous.has(file))
      .sort();
    if (added.length) growth[rule] = added;
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

export function readComparisonBaseline({ cwd, env = process.env } = {}) {
  const configuredBase = env.DESIGN_SYSTEM_BASELINE_BASE_REF;
  const ref = configuredBase || 'HEAD';
  const contents = gitShow(ref, cwd);
  if (!contents) {
    if (!configuredBase) return undefined;
    const status = execFileSync(
      'git',
      ['diff', '--name-status', configuredBase, 'HEAD', '--', baselinePath],
      {
        cwd,
        encoding: 'utf8',
      },
    ).trim();
    if (status === `A\t${baselinePath}`) return undefined;
    throw new Error(
      `Could not read design-system baseline from CI base revision ${configuredBase}`,
    );
  }
  const rulesIndex = gitShow(ref, cwd, rulesIndexPath);
  return {
    ref,
    baseline: JSON.parse(contents),
    rules: rulesIndex === undefined ? undefined : parseRegisteredRules(rulesIndex),
  };
}
