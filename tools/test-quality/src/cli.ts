#!/usr/bin/env node
import {
  calibrationEvidence,
  calibrationReport,
  prepareCalibration,
  readCalibration,
  textCalibration,
} from './calibration.ts';
import { hash } from './files.ts';
import type { ResultRow } from './types.ts';
import { parseArgs, parseEnv } from 'node:util';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { readConfig } from './files.ts';
import { Store } from './database.ts';
import { batches, evaluate, scan } from './runner.ts';
import { report, textReport, writeJsonReport } from './report.ts';
import { DEFAULT_MODEL, DEFAULT_GATEWAY_MODEL } from './jev.ts';
import { CHECKS_VERSION } from './assertion-checks.ts';

const help = `Test quality evaluator (Node 24.15+, standalone package)

node tools/test-quality/src/cli.ts <command> [paths or quoted globs] [options]

Commands:
  scan       Build/cache AST traces offline; list static targets and request count
  audit      Run explicit assertion checks offline and save findings; no model calls
  evaluate   Judge selected files/tests with Jev and save an immutable run
  report     Read saved scores; no API key or source checkout needed
  trace      Retrieve exact saved context with --id <trace-id>
  evaluation Retrieve actual request and raw response with --id <evaluation-id>
  calibrate  Frozen-reference calibration; defaults to offline dry-run
  history    Retrieve a target's score history with --id <target-id>

Selection: --root <path> --config <json> --name <substring>
Storage:   --db <path> (default: <root>/.test-quality/results.sqlite)
Provider:  --provider typesafe|vercel (default typesafe)
           --env <path> (default: <root>/.env)
           TYPESAFE_API_KEY for typesafe; AI_GATEWAY_API_KEY for vercel
           --model <id> (typesafe: ${DEFAULT_MODEL}; vercel: ${DEFAULT_GATEWAY_MODEL}) --fresh
Execution: --concurrency <1..32> (default 4) --batch-size <1..8> (default 8)
           --request-interval-ms <0..60000> (vercel default 1000; typesafe 0)
           --input-tokens-per-second <65536+> (optional rolling token budget)
           --max-consecutive-failures <count> (default 5)
           --retries <0..5> (default 2; use 0 to stop without retrying a failed call)
           --max-requests <count> (fail before spending if exceeded)
Reports:   --run <run-id> (default latest) --format text|json --kind file|test|assertion
           --threshold <0..100> (default 60) --min-confidence <0..1> (default 0.6)
           --failing-only --limit <count> --fail-on-low
           --fail-on-findings (exit 2 for explicit review findings)

Calibration: --cases <json> --split development|held-out|all (default development)
             --calibration-mode dry-run|baseline|evaluate|saved (default dry-run)
             evaluate requires explicit --db and --max-requests; saved requires --db/--run.
             One test-level request per case, no assertion/file calls. Labels never enter requests.

Version 3 thresholds use quality only; criticality is reported separately.
Earlier saved runs keep their legacy combined score and are labeled accordingly.

Exit codes: 0 success, 1 error or partial run, 2 configured low-score or finding gate.
Paths are relative to --root. No tests execute. Jev receives selected source excerpts.
Use --config tools/test-quality/repository.config.json for this repository's aliases.
Harness checks: pnpm --dir tools/test-quality test
`;

export async function main(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      cases: { type: 'string' },
      split: { type: 'string' },
      'calibration-mode': { type: 'string' },
      root: { type: 'string' },
      config: { type: 'string' },
      name: { type: 'string' },
      db: { type: 'string' },
      env: { type: 'string' },
      model: { type: 'string' },
      provider: { type: 'string' },
      fresh: { type: 'boolean' },
      concurrency: { type: 'string' },
      'request-interval-ms': { type: 'string' },
      'input-tokens-per-second': { type: 'string' },
      'max-consecutive-failures': { type: 'string' },
      retries: { type: 'string' },
      'batch-size': { type: 'string' },
      'max-requests': { type: 'string' },
      run: { type: 'string' },
      format: { type: 'string' },
      kind: { type: 'string' },
      threshold: { type: 'string' },
      'min-confidence': { type: 'string' },
      'failing-only': { type: 'boolean' },
      limit: { type: 'string' },
      'fail-on-low': { type: 'boolean' },
      'fail-on-findings': { type: 'boolean' },
      id: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [command, ...selectors] = positionals;
  if (values.help || !command) {
    console.log(help);
    return 0;
  }
  if (
    ![
      'scan',
      'audit',
      'evaluate',
      'report',
      'trace',
      'history',
      'evaluation',
      'calibrate',
    ].includes(command)
  )
    throw new Error(`Unknown command: ${command}`);
  const number = (
    key: keyof typeof values,
    fallback: number,
    min: number,
    max: number,
    integer = false,
  ): number => {
    const value = values[key] === undefined ? fallback : Number(values[key]);
    if (
      !Number.isFinite(value) ||
      value < min ||
      value > max ||
      (integer && !Number.isInteger(value))
    )
      throw new Error(`Invalid --${key}; expected ${min}..${max}${integer ? ' integer' : ''}`);
    return value;
  };
  const root = realpathSync(path.resolve(values.root ?? process.cwd()));
  const format = values.format ?? 'text';
  if (!['text', 'json'].includes(format)) throw new Error('--format must be text or json');
  if (values.kind && !['file', 'test', 'assertion'].includes(values.kind))
    throw new Error('--kind must be file, test, or assertion');
  const concurrency = number('concurrency', 4, 1, 32, true);
  const provider = values.provider ?? 'typesafe';
  if (provider !== 'typesafe' && provider !== 'vercel')
    throw new Error('--provider must be typesafe or vercel');
  const requestIntervalMs = number(
    'request-interval-ms',
    provider === 'vercel' ? 1000 : 0,
    0,
    60_000,
    true,
  );
  const maxConsecutiveFailures = number('max-consecutive-failures', 5, 1, 100, true);
  const retries = number('retries', 2, 0, 5, true);
  const inputTokensPerSecond =
    values['input-tokens-per-second'] === undefined
      ? undefined
      : number('input-tokens-per-second', 0, 65_536, Number.MAX_SAFE_INTEGER, true);
  const batchSize = number('batch-size', 8, 1, 8, true);
  const threshold = number('threshold', 60, 0, 100);
  const minConfidence = number('min-confidence', 0.6, 0, 1);
  const limit =
    values.limit === undefined ? undefined : number('limit', 0, 1, Number.MAX_SAFE_INTEGER, true);
  const maxRequests =
    values['max-requests'] === undefined
      ? undefined
      : number('max-requests', 0, 0, Number.MAX_SAFE_INTEGER, true);
  if (command === 'calibrate') {
    const mode = values['calibration-mode'] ?? 'dry-run';
    const split = values.split ?? 'development';
    if (!['dry-run', 'baseline', 'evaluate', 'saved'].includes(mode))
      throw new Error('Invalid --calibration-mode');
    if (split !== 'development' && split !== 'held-out' && split !== 'all')
      throw new Error('Invalid --split');
    const data = readCalibration(
      path.resolve(
        values.cases ?? fileURLToPath(new URL('../calibration/reviewed-v1.json', import.meta.url)),
      ),
    );
    const config = readConfig(values.config ? path.resolve(values.config) : undefined);
    const prepared = prepareCalibration(root, config, data, split);
    let rows: ResultRow[] = [];
    let evaluation: unknown;
    if (mode === 'evaluate' || mode === 'saved') {
      if (
        !values.db ||
        (mode === 'evaluate' && maxRequests === undefined) ||
        (mode === 'saved' && !values.run)
      )
        throw new Error(
          'Calibration evaluate requires --db and --max-requests; saved requires --db and --run',
        );
      const calibrationDb = path.resolve(root, values.db);
      if (calibrationDb === path.resolve(root, '.test-quality/results.sqlite'))
        throw new Error('Use a separate calibration database to preserve historical results');
      if (mode === 'saved' && !existsSync(calibrationDb))
        throw new Error('Saved calibration database not found');
      const store = new Store(calibrationDb);
      try {
        if (mode === 'evaluate') {
          for (const trace of prepared.traces)
            store.saveAnalysis(trace.id, {
              traces: [trace],
              dependencies: trace.dependencies,
              warnings: trace.warnings,
            });
          const envPath = path.resolve(root, values.env ?? '.env');
          const env = existsSync(envPath) ? parseEnv(readFileSync(envPath, 'utf8')) : {};
          const keyName = provider === 'vercel' ? 'AI_GATEWAY_API_KEY' : 'TYPESAFE_API_KEY';
          const result = await evaluate(
            store,
            prepared.traces,
            {
              apiKey: process.env[keyName] || env[keyName],
              provider,
              model: values.model,
              requestIntervalMs,
              inputTokensPerSecond,
              maxConsecutiveFailures,
              retries,
              concurrency,
              batchSize: 1,
              maxRequests,
              fresh: values.fresh,
            },
            { calibrationHash: hash(data), sourceRevision: data.sourceRevision, split, config },
          );
          rows = store.results(result.runId);
          evaluation = result;
        } else {
          const run = store.run(values.run);
          const metadata = JSON.parse(run.options).metadata;
          if (
            metadata?.calibrationHash !== hash(data) ||
            metadata?.sourceRevision !== data.sourceRevision
          )
            throw new Error('Saved calibration run does not match frozen manifest/revision');
          rows = store.results(run.id);
          for (const row of rows) {
            const trace = prepared.traces.find((t) => t.targets[0].id === row.target.id);
            if (trace && trace.id !== row.traceId)
              throw new Error(
                'Saved calibration evidence differs; use the original analyzer/configuration or rerun explicitly',
              );
          }
        }
      } finally {
        store.close();
      }
    }
    const value = calibrationReport(data, prepared.cases, rows, mode, {
      ...calibrationEvidence(prepared.traces),
      requestsMade: mode === 'evaluate' ? (evaluation as { requests: number }).requests : 0,
      evaluation,
    });
    if (format === 'json') await writeJsonReport(value, process.stdout);
    else console.log(textCalibration(value));
    return rows.some((r) => r.error) ? 1 : 0;
  }
  const dbPath = path.resolve(root, values.db ?? '.test-quality/results.sqlite');
  if (!['scan', 'audit', 'evaluate'].includes(command) && !existsSync(dbPath))
    throw new Error(`Database not found: ${dbPath}`);
  const store = new Store(dbPath);
  const output = (value: unknown): void => {
    console.log(JSON.stringify(value, null, 2));
  };
  try {
    if (command === 'trace' || command === 'evaluation' || command === 'history') {
      if (!values.id) throw new Error(`${command} requires --id`);
      if (command === 'trace') output(store.trace(values.id));
      else if (command === 'history') output(store.history(values.id));
      else {
        const id = Number(values.id);
        if (!Number.isSafeInteger(id) || id < 1)
          throw new Error('Evaluation id must be a positive integer');
        output(store.evaluation(id));
      }
      return 0;
    }
    let runId = values.run;
    let metrics: unknown;
    if (command !== 'report') {
      const config = readConfig(values.config ? path.resolve(values.config) : undefined);
      const start = performance.now();
      const result = scan(root, config, selectors, store, values.name);
      const summary = {
        files: result.files,
        cachedFiles: result.cachedFiles,
        traces: result.traces.length,
        targets: result.traces.reduce((n, t) => n + t.targets.length, 0),
        requestsBeforeScoreCache:
          command === 'audit'
            ? 0
            : result.traces.reduce((n, t) => n + batches(t, batchSize).length, 0),
        elapsedMs: Math.round(performance.now() - start),
      };
      if (command === 'scan') {
        if (format === 'json')
          output({
            ...summary,
            traces: result.traces.map((t) => ({
              id: t.id,
              file: t.file,
              warnings: t.warnings,
              targets: t.targets.map(({ code: _code, ...target }) => target),
            })),
          });
        else
          console.log(
            `${summary.files} files, ${summary.traces} traces, ${summary.targets} targets; ${summary.cachedFiles} cached files; ${summary.requestsBeforeScoreCache} requests before score cache; ${summary.elapsedMs}ms.\nDatabase: ${dbPath}\nUse --format json to inspect target and trace IDs.`,
          );
        return 0;
      }
      if (command === 'audit') {
        runId = store.start({
          assessment: 'static',
          checksVersion: CHECKS_VERSION,
          root,
          config,
          selectors,
          name: values.name,
        });
        for (const trace of result.traces)
          for (const target of trace.targets)
            store.result(
              runId,
              target,
              trace.id,
              null,
              null,
              trace.warnings,
              null,
              false,
              trace.evidence,
            );
        store.finish(runId, 'complete');
        metrics = {
          ...summary,
          elapsedMs: Math.round(performance.now() - start),
          requests: 0,
        };
      } else {
        const envPath = path.resolve(root, values.env ?? '.env');
        const env = existsSync(envPath) ? parseEnv(readFileSync(envPath, 'utf8')) : {};
        const keyName = provider === 'vercel' ? 'AI_GATEWAY_API_KEY' : 'TYPESAFE_API_KEY';
        const apiKey = process.env[keyName] || env[keyName];
        const resultEval = await evaluate(
          store,
          result.traces,
          {
            apiKey,
            provider,
            requestIntervalMs,
            inputTokensPerSecond,
            maxConsecutiveFailures,
            retries,
            model: values.model,
            fresh: values.fresh,
            concurrency,
            batchSize,
            maxRequests,
            progress: (done, total) => {
              if (done === total || done % 25 === 0)
                console.error(`Evaluated ${done}/${total} batches`);
            },
          },
          { root, config, selectors, name: values.name, scan: summary },
        );
        runId = resultEval.runId;
        metrics = resultEval;
      }
    }
    const run = store.run(runId);
    const value = report(run, store.results(run.id), {
      threshold,
      minConfidence,
      kind: values.kind,
      failingOnly: values['failing-only'],
      limit,
    });
    if (format === 'json') await writeJsonReport({ ...value, metrics }, process.stdout);
    else {
      console.log(textReport(value));
      if (metrics) console.log(JSON.stringify(metrics));
    }
    if (run.status !== 'complete' || value.summary.errors) return 1;
    return (values['fail-on-low'] && value.summary.lowScores) ||
      (values['fail-on-findings'] && value.summary.findings)
      ? 2
      : 0;
  } finally {
    store.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : 'Test quality evaluation failed');
      process.exitCode = 1;
    });
}
