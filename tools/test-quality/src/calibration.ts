import { batches } from './runner.ts';
import type { EvidenceCompleteness } from './types.ts';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Analyzer } from './analyzer.ts';
import { hash, Sources } from './files.ts';
import type { Config, Disposition, ResultRow, Trace } from './types.ts';

export interface CalibrationCase {
  id: string;
  file: string;
  line: number;
  name: string;
  status: string;
  family: string;
  sourceHash: string;
  testCode: string;
  expectedDisposition: Disposition;
  reason: string;
  evidence: string[];
  baseline: { quality: number; confidence: number; traceId: string; evaluationId: number };
}
export interface CalibrationSet {
  version: string;
  sourceRevision: string;
  labelProvenance: string;
  selection: string;
  cases: CalibrationCase[];
}
export type Split = 'development' | 'held-out' | 'all';
export const SPLIT_VERSION = 'family-sha256-v1';
export function caseSplit(family: string, families: string[]): Exclude<Split, 'all'> {
  const ordered = [...new Set(families)].sort((a, b) =>
    hash(`${SPLIT_VERSION}:${a}`).localeCompare(hash(`${SPLIT_VERSION}:${b}`)),
  );
  const index = ordered.indexOf(family);
  if (index < 0) throw new Error('Family is absent from the frozen split');
  return index % 3 === 0 ? 'held-out' : 'development';
}
export function readCalibration(file: string): CalibrationSet {
  const data = JSON.parse(readFileSync(file, 'utf8')) as CalibrationSet;
  if (
    !/^[a-f0-9]{40}$/.test(data.sourceRevision) ||
    !Array.isArray(data.cases) ||
    !data.cases.length
  )
    throw new Error('Calibration requires a pinned revision and frozen cases');
  const ids = new Set<string>();
  const familyByFile = new Map<string, string>();
  for (const c of data.cases) {
    if (
      !c.family ||
      !c.testCode ||
      !/^[a-f0-9]{64}$/.test(c.sourceHash) ||
      ids.has(c.id) ||
      ![
        'keep',
        'strengthen',
        'consolidate',
        'remove',
        'insufficient-evidence',
        'retire-skipped',
      ].includes(c.expectedDisposition)
    )
      throw new Error(`Invalid frozen calibration case: ${c.id}`);
    if (familyByFile.has(c.file) && familyByFile.get(c.file) !== c.family)
      throw new Error(`Split leakage: ${c.file} belongs to multiple families`);
    familyByFile.set(c.file, c.family);
    ids.add(c.id);
  }
  return data;
}

/** Read Git blobs without checking out, running, or importing application code. */
export class RevisionSources extends Sources {
  revision: string;
  constructor(root: string, revision: string) {
    super(root);
    if (!/^[a-f0-9]{40}$/.test(revision))
      throw new Error('Source revision must be a full commit hash');
    this.revision = revision;
    const resolved = execFileSync('git', ['rev-parse', '--verify', `${revision}^{commit}`], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    if (resolved !== revision) throw new Error('Pinned source revision is unavailable');
  }
  override read(file: string): string {
    if (path.isAbsolute(file) || file.split('/').includes('..'))
      throw new Error('Invalid pinned source path');
    if (!this.texts.has(file)) {
      const text = execFileSync('git', ['show', `${this.revision}:${file}`], {
        cwd: this.root,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
      });
      this.texts.set(file, text);
      this.hashes.set(file, hash(text));
    }
    return this.texts.get(file)!;
  }
  files(config: Config): string[] {
    return execFileSync('git', ['ls-tree', '-r', '--name-only', this.revision], {
      cwd: this.root,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    })
      .trim()
      .split('\n')
      .filter(
        (f) =>
          /\.(?:[cm]?[jt]sx?|svelte|json|css)$/.test(f) &&
          !f.startsWith('tools/test-quality/') &&
          !config.exclude.some((p) => path.matchesGlob(f, p)),
      );
  }
}
export function validateFrozenSource(c: CalibrationCase, sources: Sources): void {
  if (sources.digest(c.file) !== c.sourceHash || !sources.read(c.file).includes(c.testCode))
    throw new Error(
      `Stale calibration source: ${c.file}; expected the original frozen body at the pinned revision`,
    );
}
export function prepareCalibration(
  root: string,
  config: Config,
  data: CalibrationSet,
  split: Split,
) {
  const selected = data.cases.filter(
    (c) =>
      split === 'all' ||
      caseSplit(
        c.family,
        data.cases.map((c) => c.family),
      ) === split,
  );
  const sources = new RevisionSources(root, data.sourceRevision);
  const analyzer = new Analyzer(sources, sources.files(config), config);
  const analyzed = new Map<string, ReturnType<Analyzer['analyze']>>();
  const traces: Trace[] = [];
  for (const c of selected) {
    validateFrozenSource(c, sources);
    let analysis = analyzed.get(c.file);
    if (!analysis) {
      analysis = analyzer.analyze(c.file);
      analyzed.set(c.file, analysis);
    }
    const original = analysis.traces.find((t) => t.targets[0].id === c.id);
    if (
      !original ||
      original.targets[0].name !== c.name ||
      !c.testCode.startsWith(original.targets[0].code)
    )
      throw new Error(`Frozen target identity differs: ${c.id}`);
    // Only source evidence enters the judge. Labels, reasons, reference evidence and baseline scores stay here.
    const trace = { ...original, targets: [original.targets[0]], id: '' };
    trace.id = hash(trace);
    traces.push(trace);
  }
  return { cases: selected, traces, sourceRevision: data.sourceRevision };
}

export function calibrationMetrics(cases: CalibrationCase[], rows: ResultRow[]) {
  const byId = new Map(rows.map((r) => [r.target.id, r]));
  const metrics = (selected: CalibrationCase[]) => {
    const confusion: Record<string, Record<string, number>> = {};
    const mismatches: {
      id: string;
      file: string;
      expected: string;
      actual: string;
      rationale: string | null;
    }[] = [];
    let decidedAgreements = 0;
    let agreements = 0,
      abstentions = 0,
      unavailable = 0,
      incorrectRemoves = 0,
      decisions = 0;
    for (const c of selected) {
      const row = byId.get(c.id);
      const actual = row?.decision?.disposition ?? 'unavailable';
      confusion[c.expectedDisposition] ??= {};
      confusion[c.expectedDisposition][actual] =
        (confusion[c.expectedDisposition][actual] ?? 0) + 1;
      if (actual === 'unavailable') unavailable++;
      else if (actual === 'insufficient-evidence') abstentions++;
      else decisions++;
      if (actual === c.expectedDisposition) {
        agreements++;
        if (!['unavailable', 'insufficient-evidence'].includes(actual)) decidedAgreements++;
      }
      if (actual === 'remove' && c.expectedDisposition !== 'remove') incorrectRemoves++;
      if (actual !== c.expectedDisposition)
        mismatches.push({
          id: c.id,
          file: c.file,
          expected: c.expectedDisposition,
          actual,
          rationale: row?.decision?.rationale ?? null,
        });
    }
    const available = selected.length - unavailable;
    return {
      cases: selected.length,
      decisions,
      agreements,
      dispositionAgreement: available ? agreements / available : null,
      decidedAgreement: decisions ? decidedAgreements / decisions : null,
      confusion,
      incorrectRemoveRecommendations: available ? incorrectRemoves : null,
      abstentions,
      abstentionRate: available ? abstentions / available : null,
      unavailable,
      coverage: selected.length ? decisions / selected.length : null,
      mismatches,
    };
  };
  return {
    active: metrics(cases.filter((c) => c.status === 'active')),
    skippedOrRetired: metrics(cases.filter((c) => c.status !== 'active')),
  };
}
export function calibrationReport(
  data: CalibrationSet,
  cases: CalibrationCase[],
  rows: ResultRow[],
  mode: string,
  extra: Record<string, unknown> = {},
) {
  const splits = {
    development: cases.filter(
      (c) =>
        caseSplit(
          c.family,
          data.cases.map((c) => c.family),
        ) === 'development',
    ),
    'held-out': cases.filter(
      (c) =>
        caseSplit(
          c.family,
          data.cases.map((c) => c.family),
        ) === 'held-out',
    ),
  };
  return {
    mode,
    manifestHash: hash(data),
    sourceRevision: data.sourceRevision,
    splitVersion: SPLIT_VERSION,
    labelProvenance: data.labelProvenance,
    selection: data.selection,
    limitations:
      'Selected low-score sample with agent-reviewed labels, not human ground truth or representative performance. Static evidence only; no measured mutation detection or runtime savings. Related families are kept together. Held-out means partitioned, not independently blinded: these reviewed examples informed the requirements.',
    baseline: {
      disposition: 'unavailable',
      reason:
        'Historical scores contain no review decisions; no score-to-disposition conversion is performed.',
      scores: cases.map((c) => ({ id: c.id, ...c.baseline })),
    },
    families: Object.fromEntries(
      [...new Set(cases.map((c) => c.family))].sort().map((f) => [
        f,
        caseSplit(
          f,
          data.cases.map((c) => c.family),
        ),
      ]),
    ),
    metrics: calibrationMetrics(cases, rows),
    bySplit: Object.fromEntries(
      Object.entries(splits).map(([split, entries]) => [split, calibrationMetrics(entries, rows)]),
    ),
    results: cases.map((c) => ({
      id: c.id,
      file: c.file,
      name: c.name,
      family: c.family,
      split: caseSplit(
        c.family,
        data.cases.map((c) => c.family),
      ),
      status: c.status,
      expected: c.expectedDisposition,
      referenceReason: c.reason,
      referenceEvidence: c.evidence,
      decision: rows.find((r) => r.target.id === c.id)?.decision ?? null,
    })),
    ...extra,
  };
}
export function textCalibration(value: ReturnType<typeof calibrationReport>): string {
  const lines = [
    `Calibration ${value.mode}: ${value.results.length} frozen cases at ${value.sourceRevision}`,
    value.labelProvenance,
    value.selection,
    value.limitations,
    'Baseline disposition: unavailable (historical scores only).',
    `Families: ${JSON.stringify(value.families)}`,
  ];
  for (const [name, m] of Object.entries(value.metrics)) {
    lines.push(
      `${name}: agreement=${m.dispositionAgreement ?? 'unavailable'} coverage=${m.coverage ?? 'unavailable'} abstentions=${m.abstentions} unavailable=${m.unavailable} incorrect-removes=${m.incorrectRemoveRecommendations ?? 'unavailable'}`,
    );
    lines.push(`Confusion matrix: ${JSON.stringify(m.confusion)}`);
    for (const mismatch of m.mismatches)
      lines.push(
        `${mismatch.file} ${mismatch.id}: expected ${mismatch.expected}; got ${mismatch.actual}${mismatch.rationale ? `; ${mismatch.rationale}` : ''}`,
      );
  }
  for (const key of ['requestsBeforeCache', 'requestsMade', 'evidenceSummary', 'evaluation'])
    if (key in value) lines.push(`${key}: ${JSON.stringify(value[key as keyof typeof value])}`);
  return lines.join('\n');
}

/** Completeness describes the actual request after its byte budget, not just the larger saved trace. */
export function calibrationEvidence(traces: Trace[]) {
  const requests = traces.flatMap((trace) => batches(trace, 1).map((batch) => ({ trace, batch })));
  const details = requests.map(({ trace, batch }) => {
    const fragments = batch.state.fragments as Trace['fragments'];
    return {
      id: trace.targets[0].id,
      traceId: trace.id,
      traceCompleteness: trace.evidence,
      requestCompleteness: batch.state.evidence as EvidenceCompleteness,
      stateBytes: Buffer.byteLength(JSON.stringify(batch.state)),
      fragments: fragments.map(({ code: _code, ...f }) => f),
      omittedFragments: batch.omittedFragments.map(({ code: _code, ...f }) => f),
      // General source locations/reasons let reviewers check any handler or helper without example-specific code paths.
      handlerAndHelperEvidence: fragments
        .filter((f) =>
          /binding reference|instance member|Local reference|event\/state\/render/.test(f.reason),
        )
        .map((f) => ({ file: f.file, line: f.line, endLine: f.endLine, reason: f.reason })),
    };
  });
  return {
    requestsBeforeCache: requests.length,
    evidenceSummary: {
      bounded: details.filter((d) => d.requestCompleteness.completeness === 'bounded').length,
      partial: details.filter((d) => d.requestCompleteness.completeness === 'partial').length,
      unknown: details.filter((d) => d.requestCompleteness.completeness === 'unknown').length,
      traceBounded: details.filter((d) => d.traceCompleteness?.completeness === 'bounded').length,
      optionalFragmentsOmitted: details.reduce(
        (n, d) => n + d.omittedFragments.filter((f) => f.required === false).length,
        0,
      ),
      requiredFragmentsOmitted: details.reduce(
        (n, d) => n + d.omittedFragments.filter((f) => f.required !== false).length,
        0,
      ),
    },
    evidence: details,
  };
}
