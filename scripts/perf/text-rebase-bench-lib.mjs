// Pure helpers of scripts/perf/text-rebase-bench.mjs: argument parsing, the
// paired head/base aggregation of the runner documents, and the text table.
// No git, no processes — text-rebase-bench-lib.test.ts covers this file.

export const USAGE =
  'usage: pnpm perf:text-rebase --base <ref> [--head <ref>] [--runs 5] [--repeats 5] [--shapes a,b] [--json <file>]';

const INTEGER_OPTIONS = {
  '--runs': { key: 'runs', min: 1 },
  '--repeats': { key: 'repeats', min: 1 },
};
const VALUE_OPTIONS = { '--base': 'base', '--head': 'head', '--json': 'json' };
const REF_OPTIONS = new Set(['--base', '--head']);

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function optionValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function integerOption(flag, value, { min }) {
  const parsed = value.trim() === '' ? Number.NaN : Number(value);
  if (!Number.isInteger(parsed) || parsed < min) {
    throw new Error(`${flag} must be an integer of at least ${min}.`);
  }
  return parsed;
}

export function parseArgs(argv) {
  const options = { runs: 5, repeats: 5 };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (seen.has(flag)) throw new Error(`${flag} may only be specified once.`);
    seen.add(flag);
    if (hasOwn(VALUE_OPTIONS, flag)) {
      const value = optionValue(argv, index, flag);
      if (REF_OPTIONS.has(flag) && value.trim() === '') {
        throw new Error(`${flag} requires a non-empty ref.`);
      }
      options[VALUE_OPTIONS[flag]] = value;
    } else if (hasOwn(INTEGER_OPTIONS, flag)) {
      const { key, min } = INTEGER_OPTIONS[flag];
      options[key] = integerOption(flag, optionValue(argv, index, flag), { min });
    } else if (flag === '--shapes') {
      const shapes = optionValue(argv, index, flag)
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name !== '');
      if (shapes.length === 0) throw new Error('--shapes needs at least one shape name.');
      options.shapes = shapes;
    } else {
      throw new Error(`Unknown option: ${flag}`);
    }
    index += 1;
  }
  if (!options.base) throw new Error('--base is required.');
  return options;
}

/**
 * The order the two trees run in for 1-based run `run`: odd runs head then
 * base, even runs base then head, so monotonic host drift (thermal, load,
 * cache pressure) does not always land on the same side of a pair.
 */
export function runOrder(run) {
  if (!Number.isInteger(run) || run < 1) {
    throw new Error(`run must be a positive integer, got ${run}`);
  }
  return run % 2 === 1 ? ['head', 'base'] : ['base', 'head'];
}

const sorted = (values) => [...values].sort((a, b) => a - b);

export function median(values) {
  const ordered = sorted(values);
  const half = ordered.length >> 1;
  return ordered.length % 2 === 1 ? ordered[half] : (ordered[half - 1] + ordered[half]) / 2;
}

/** Nearest-rank percentile: the smallest value at or above the requested share of samples. */
export function percentile(values, share) {
  const ordered = sorted(values);
  return ordered[Math.max(0, Math.ceil(share * ordered.length) - 1)];
}

const rowKey = (row) => `${row.shape}\u0000${row.clock}\u0000${row.phase}`;

function summarizeSamples(rows) {
  const ms = rows.map((row) => row.ms);
  const hits = rows.map((row) => row.deadlineHit);
  return {
    n: ms.length,
    median: median(ms),
    p90: percentile(ms, 0.9),
    deadlineHits: hits.every((hit) => hit === null) ? null : hits.filter(Boolean).length,
  };
}

/**
 * Pairs the i-th head document with the i-th base document and folds every
 * `(shape, clock, phase)` key into one summary row: median / p90 per tree,
 * the head/base ratio of medians, and how many pairs ran slower on head.
 * Row order is the order of first appearance in the head documents.
 */
export function aggregate(headDocuments, baseDocuments) {
  if (headDocuments.length !== baseDocuments.length) {
    throw new Error(
      `paired aggregation needs equal counts, got ${headDocuments.length} head / ${baseDocuments.length} base`,
    );
  }
  const keys = new Map();
  const collect = (documents, side) => {
    documents.forEach((document, run) => {
      for (const row of document.rows) {
        const key = rowKey(row);
        if (!keys.has(key)) {
          keys.set(key, {
            shape: row.shape,
            clock: row.clock,
            phase: row.phase,
            head: [],
            base: [],
          });
        }
        keys.get(key)[side].push({ run, ms: row.ms, deadlineHit: row.deadlineHit });
      }
    });
  };
  collect(headDocuments, 'head');
  collect(baseDocuments, 'base');
  return [...keys.values()].map(({ shape, clock, phase, head, base }) => {
    if (head.length !== base.length) {
      throw new Error(
        `${shape}/${clock}/${phase}: ${head.length} head rows vs ${base.length} base rows`,
      );
    }
    const baseByRun = new Map(base.map((sample) => [sample.run, sample.ms]));
    const headSlowerPairs = head.filter((sample) => sample.ms > baseByRun.get(sample.run)).length;
    const summary = {
      shape,
      clock,
      phase,
      head: summarizeSamples(head),
      base: summarizeSamples(base),
    };
    summary.ratio = summary.base.median === 0 ? null : summary.head.median / summary.base.median;
    summary.pairs = head.length;
    summary.headSlowerPairs = headSlowerPairs;
    return summary;
  });
}

export function formatMs(ms) {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  if (ms >= 100) return `${ms.toFixed(0)} ms`;
  return `${ms.toFixed(ms >= 10 ? 1 : 2)} ms`;
}

const formatRatio = (ratio) => {
  if (ratio === null) return 'n/a';
  return `${ratio >= 0.1 ? ratio.toFixed(2) : ratio.toPrecision(2)}x`;
};
const formatHits = (side) => (side.deadlineHits === null ? '-' : `${side.deadlineHits}/${side.n}`);

export function formatTable(summary) {
  const columns = [
    { title: 'shape', align: 'left', value: (row) => row.shape },
    { title: 'clock', align: 'left', value: (row) => row.clock },
    { title: 'phase', align: 'left', value: (row) => row.phase },
    { title: 'head med', align: 'right', value: (row) => formatMs(row.head.median) },
    { title: 'head p90', align: 'right', value: (row) => formatMs(row.head.p90) },
    { title: 'base med', align: 'right', value: (row) => formatMs(row.base.median) },
    { title: 'base p90', align: 'right', value: (row) => formatMs(row.base.p90) },
    { title: 'head/base', align: 'right', value: (row) => formatRatio(row.ratio) },
    { title: 'head slower', align: 'right', value: (row) => `${row.headSlowerPairs}/${row.pairs}` },
    {
      title: 'deadline h|b',
      align: 'right',
      value: (row) => `${formatHits(row.head)}|${formatHits(row.base)}`,
    },
  ];
  const cells = summary.map((row) => columns.map((column) => column.value(row)));
  const widths = columns.map((column, index) =>
    Math.max(column.title.length, ...cells.map((line) => line[index].length)),
  );
  const pad = (text, index) =>
    columns[index].align === 'left' ? text.padEnd(widths[index]) : text.padStart(widths[index]);
  const line = (values) => values.map(pad).join('  ').trimEnd();
  return [
    line(columns.map((column) => column.title)),
    line(widths.map((width) => '-'.repeat(width))),
    ...cells.map(line),
  ].join('\n');
}

/**
 * The one `mapperMode` every document of a tree reports (`bidirectional` |
 * `legacy-two-mapper`, emitted by the runner's reporter); throws when the
 * documents disagree or one carries none.
 */
export function mapperModeOf(tree, documents) {
  const modes = new Set(documents.map((document) => document.mapperMode));
  if (modes.size !== 1 || modes.has(undefined)) {
    const named = [...modes].filter((mode) => mode !== undefined);
    const problem = named.length === 0 ? 'no' : 'inconsistent';
    throw new Error(`${tree} documents report ${problem} mapperMode: ${named.join(', ') || '-'}`);
  }
  return [...modes][0];
}

/** The warning printed under the header when the two trees do not build the pair the same way, else `null`. */
export function mapperModeWarning({ headMode, baseMode }) {
  if (headMode === baseMode) return null;
  const legacy = baseMode === 'legacy-two-mapper' ? 'base' : 'head';
  return `WARNING: mapper modes differ (head ${headMode}, base ${baseMode}): ${legacy} measures two one-way alignments (createOffsetMapper each way), the other one bidirectional alignment, so the rows are not comparable like-for-like.`;
}

export function formatHeader({ head, headMode, base, baseMode, runs, repeats, shapes, node }) {
  const lines = [
    `text-rebase bench: head ${head} [${headMode}] vs base ${base} [${baseMode}]`,
    `${runs} paired cold process(es) per tree, interleaved with the head/base order alternating per run; ${repeats} cached call(s) per shape per process; shapes: ${shapes ?? 'all'}; node ${node}`,
    'Bare packages (diff, marked, ...) resolve from the current node_modules for BOTH trees; the projection is the current tree\u2019s.',
  ];
  const warning = mapperModeWarning({ headMode, baseMode });
  if (warning) lines.push(warning);
  return lines.join('\n');
}
