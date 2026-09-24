import type { ResultRow, RunRow } from './types.ts';
import type { Writable } from 'node:stream';

export interface ReportOptions {
  threshold: number;
  minConfidence: number;
  kind?: string;
  failingOnly?: boolean;
  limit?: number;
}

export function report(run: RunRow, rows: ResultRow[], options: ReportOptions) {
  const classified = rows.map((row) => {
    const lowScore = row.score !== null && row.score.overall < options.threshold;
    const review =
      (row.target.findings?.length ?? 0) > 0 ||
      row.warnings.length > 0 ||
      (row.score !== null && row.score.confidence < options.minConfidence) ||
      row.target.status !== 'active';
    const status = row.error
      ? 'error'
      : row.target.findings?.length
        ? 'finding'
        : lowScore
          ? 'low-score'
          : !row.score
            ? 'unscored'
            : review
              ? 'review'
              : 'pass';
    return { ...row, status, lowScore, review };
  });
  const childrenByParent = new Map<string, typeof classified>();
  const testsByFile = new Map<string, typeof classified>();
  for (const row of classified) {
    if (row.target.parentId) {
      const group = childrenByParent.get(row.target.parentId) ?? [];
      group.push(row);
      childrenByParent.set(row.target.parentId, group);
    }
    if (row.target.kind === 'test') {
      const group = testsByFile.get(row.target.file) ?? [];
      group.push(row);
      testsByFile.set(row.target.file, group);
    }
  }
  const groups = (kind: 'file' | 'test') => {
    return classified
      .filter((r) => r.target.kind === kind)
      .map((parent) => {
        const children =
          (kind === 'test'
            ? childrenByParent.get(parent.target.id)
            : testsByFile.get(parent.target.file)) ?? [];
        const scored = children.filter((r) => r.score !== null);
        return {
          id: parent.target.id,
          name: parent.target.name,
          children: children.length,
          scored: scored.length,
          meanScore: scored.length
            ? Math.round((scored.reduce((s, r) => s + r.score!.overall, 0) / scored.length) * 10) /
              10
            : null,
          meanCriticality:
            scored.length && scored.every((r) => r.score!.criticality !== undefined)
              ? scored.reduce((sum, r) => sum + r.score!.criticality!, 0) / scored.length
              : null,
          minimumScore: scored.length ? Math.min(...scored.map((r) => r.score!.overall)) : null,
          lowScores: children.filter((r) => r.lowScore).length,
          errors: children.filter((r) => r.status === 'error').length,
        };
      });
  };
  const matching = classified
    .filter(
      (r) =>
        (!options.kind || r.target.kind === options.kind) &&
        (!options.failingOnly || r.lowScore || r.status === 'error' || r.status === 'finding'),
    )
    .sort(
      (a, b) =>
        (a.score?.overall ?? -1) - (b.score?.overall ?? -1) ||
        a.target.file.localeCompare(b.target.file) ||
        a.target.line - b.target.line,
    );
  return {
    run: { ...run, options: JSON.parse(run.options) },
    scoreMetric:
      JSON.parse(run.options).assessment === 'static'
        ? 'static-checks'
        : rows.some((row) => row.score?.quality !== undefined)
          ? 'quality'
          : 'legacy-combined',
    rubricNote:
      JSON.parse(run.options).assessment === 'static'
        ? 'Offline AST checks only; no model scores assigned. Findings identify patterns for review, not proven defects. An empty finding list does not certify test quality.'
        : 'Version 2 thresholds apply to quality alone; criticality is separate. Earlier runs retain their legacy combined scores. These are static estimates, not measured defect-prevention probabilities. Review evidence before changing tests.',
    policy: options,
    summary: {
      targets: rows.length,
      files: rows.filter((r) => r.target.kind === 'file').length,
      tests: rows.filter((r) => r.target.kind === 'test').length,
      assertions: rows.filter((r) => r.target.kind === 'assertion').length,
      lowScores: classified.filter((r) => r.lowScore).length,
      review: classified.filter((r) => r.review).length,
      errors: classified.filter((r) => r.status === 'error').length,
      findingTargets: classified.filter((r) => r.status === 'finding').length,
      findings: new Set(
        rows
          .flatMap((row) => row.target.findings ?? [])
          .map((f) => JSON.stringify([f.rule, f.file, f.line, f.code])),
      ).size,
      cachedTargets: classified.filter((r) => r.cached).length,
      matching: matching.length,
    },
    aggregates: { files: groups('file'), tests: groups('test') },
    results: matching.slice(0, options.limit ?? matching.length),
  };
}

export function textReport(value: ReturnType<typeof report>): string {
  const s = value.summary;
  const lines = [
    `Run ${value.run.id} (${value.run.status})`,
    `${s.files} files, ${s.tests} tests, ${s.assertions} assertion sites; ${s.lowScores} low scores, ${s.review} need review, ${s.errors} errors.`,
    `${s.findings} explicit check findings (review candidates, not model scores).`,
    `Threshold: ${value.policy.threshold}/100 (${value.scoreMetric}); confidence floor: ${value.policy.minConfidence}.`,
    value.rubricNote,
    '',
  ];
  for (const row of value.results) {
    lines.push(
      `${row.status.toUpperCase()} ${row.score ? row.score.overall.toFixed(1) : 'n/a'} ${row.target.kind} ${row.target.file}:${row.target.line} ${row.target.name}`,
    );
    lines.push(`  id=${row.target.id} trace=${row.traceId}`);
    if (row.score?.quality !== undefined)
      lines.push(
        `  quality=${row.score.quality.toFixed(1)} criticality=${row.score.criticality?.toFixed(1)} criticalityConfidence=${row.score.criticalityConfidence?.toFixed(2)}`,
      );
    if (row.score)
      lines.push(
        `  ${Object.entries(row.score.dimensions)
          .map(([name, d]) => `${name}=${d.score.toFixed(1)}`)
          .join(' ')} confidence=${row.score.confidence.toFixed(2)}`,
      );
    if (row.error) lines.push(`  error: ${row.error}`);
    for (const finding of row.target.findings ?? [])
      lines.push(
        `  finding [${finding.rule}] ${finding.file}:${finding.line}: ${finding.message}\n    ${finding.code.replaceAll('\n', ' ')}`,
      );
    if (row.warnings.length) lines.push(`  review: ${row.warnings.join('; ')}`);
  }
  if (value.results.length < s.matching)
    lines.push(
      `Showing ${value.results.length} of ${s.matching} matching targets; use --limit to show more or --format json.`,
    );
  return lines.join('\n');
}

export async function writeJsonReport(
  value: ReturnType<typeof report> & { metrics?: unknown },
  output: Writable,
): Promise<void> {
  let buffer = '';
  const flush = async () => {
    const chunk = buffer;
    buffer = '';
    await new Promise<void>((resolve, reject) => {
      output.write(chunk, (error) => (error ? reject(error) : resolve()));
    });
  };
  const append = async (chunk: string) => {
    buffer += chunk;
    if (buffer.length >= 65_536) await flush();
  };
  await append('{');
  let first = true;
  for (const [key, field] of Object.entries(value)) {
    if (field === undefined) continue;
    await append(`${first ? '' : ','}${JSON.stringify(key)}:`);
    first = false;
    if (Array.isArray(field)) {
      await append('[');
      for (let index = 0; index < field.length; index++)
        await append(`${index ? ',' : ''}${JSON.stringify(field[index]) ?? 'null'}`);
      await append(']');
    } else await append(JSON.stringify(field));
  }
  await append('}\n');
  if (buffer) await flush();
}
