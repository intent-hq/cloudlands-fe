import { execFileSync } from 'node:child_process';

export const baselinePath = 'eslint-rules/design-system/baseline.json';

export function baselineFiles(entries = []) {
  if (entries.every((entry) => typeof entry === 'string')) return entries;
  return entries.flatMap((entry) => entry.files);
}

export function findBaselineGrowth(base, current) {
  const growth = {};
  for (const [rule, entries] of Object.entries(current)) {
    if (!(rule in base)) continue;
    const previous = new Set(baselineFiles(base[rule]));
    const added = baselineFiles(entries)
      .filter((file) => !previous.has(file))
      .sort();
    if (added.length) growth[rule] = added;
  }
  return growth;
}

export function assertBaselineOnlyShrinks(base, current) {
  const growth = findBaselineGrowth(base, current);
  if (Object.keys(growth).length) {
    throw new Error(
      `Design-system baseline entries may only be removed:\n${JSON.stringify(growth, null, 2)}`,
    );
  }
}

function gitShow(ref, cwd) {
  try {
    return execFileSync('git', ['show', `${ref}:${baselinePath}`], {
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
  return { ref, baseline: JSON.parse(contents) };
}
