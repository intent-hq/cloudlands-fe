#!/usr/bin/env node
// ct-run-failures.mjs — `pnpm ct:failures <run-id>`: list every failing and
// flaky Playwright CT case of an `Intent PR Checks` run, per shard.
//
// Resolves the run's `Component Tests (shard N/M)` jobs via `gh`, reads each
// red shard's JSON report from its `playwright-ct-report-N-of-M` artifact and
// falls back to the job log's list-reporter summary when the artifact is
// missing, expired, or predates the JSON reporter. Parsing lives in
// ct-run-failures-lib.mjs; this file owns argv, `gh`, and the temp dir.
//
// Exit codes: 0 listing produced (with or without failures), 2 usage error or
// no CT jobs in the run, 3 `gh` failure (its stderr is surfaced verbatim).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  casesFromJsonReport,
  casesFromListLog,
  formatReport,
  hasListLogSummary,
  parseCtJobs,
  requiredLaneLog,
} from './ct-run-failures-lib.mjs';

export const DEFAULT_REPO = 'intent-hq/cloudlands-fe';
const RUN_URL = /\/actions\/runs\/(\d+)(?:[/?#]|$)/;
const REPORT_PATH = join('playwright-report', 'results.json');

export const USAGE = `usage: ct-run-failures.mjs <run-id | run-url> [--repo owner/name] [--attempt N] [--json]

Lists every failed and flaky Playwright CT case of an Intent PR Checks run, per shard.
  --repo      GitHub repository (default ${DEFAULT_REPO})
  --attempt   run attempt to inspect (default: latest)
  --json      print the machine-readable report instead of text
Exit codes: 0 listing printed, 2 usage error or no CT jobs, 3 gh failure.`;

export class UsageError extends Error {}
export class GhError extends Error {}

/** Parse argv (without node/script) into options; throws `UsageError`. */
export function parseArgs(argv) {
  const opts = {
    runId: undefined,
    repo: DEFAULT_REPO,
    attempt: undefined,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--repo' || arg === '--attempt') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--'))
        throw new UsageError(`${arg} needs a value`);
      i += 1;
      if (arg === '--repo') {
        if (!/^[^/\s]+\/[^/\s]+$/.test(value))
          throw new UsageError(`--repo expects owner/name, got ${value}`);
        opts.repo = value;
      } else {
        if (!/^[1-9]\d*$/.test(value))
          throw new UsageError(`--attempt expects a positive integer, got ${value}`);
        opts.attempt = Number(value);
      }
    } else if (arg.startsWith('-')) {
      throw new UsageError(`unknown option ${arg}`);
    } else if (opts.runId !== undefined) {
      throw new UsageError(`unexpected argument ${arg}`);
    } else {
      const runId = /^\d+$/.test(arg) ? arg : RUN_URL.exec(arg)?.[1];
      if (!runId) throw new UsageError(`expected a run id or …/actions/runs/<id> URL, got ${arg}`);
      opts.runId = runId;
    }
  }
  if (!opts.help && opts.runId === undefined) throw new UsageError('missing <run-id>');
  return opts;
}

function gh(args) {
  try {
    return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    const stderr = String(error?.stderr ?? '').trim();
    throw new GhError(`gh ${args.slice(0, 2).join(' ')} failed${stderr ? `: ${stderr}` : ''}`);
  }
}

/**
 * The real `gh` boundary; tests inject a fake with the same shape, or a fake
 * `run` to assert the exact `gh` argv.
 */
export function createGhRunner({ tmpDir, run = gh }) {
  return {
    api: (path) => JSON.parse(run(['api', path])),
    // `--allow-escape-sequences`: the list reporter's ANSI colours make gh
    // refuse to emit the log otherwise.
    jobLog: (repo, jobId) =>
      run(['api', '--allow-escape-sequences', `repos/${repo}/actions/jobs/${jobId}/logs`]),
    // The Playwright JSON report of a shard artifact, or null when the artifact
    // has none (uploaded before the JSON reporter existed).
    jsonReport: (repo, runId, artifactName) => {
      const dest = join(tmpDir, artifactName);
      run(['run', 'download', runId, '--repo', repo, '--name', artifactName, '--dir', dest]);
      const file = join(dest, REPORT_PATH);
      return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
    },
  };
}

const LOG_WARNING =
  'no JSON report artifact — derived from the list-reporter summary; locations may point at generator helpers';
const NO_LANE_WARNING =
  'required-lane step not found in the job log — parsed the whole log; an advisory quarantine summary may mask the required lane';
const NO_SUMMARY_NOTE = 'red, no test summary found — see job URL';

/**
 * Resolve the run's shards and their cases through `runner`. Returns
 * `{ shards, attempt, warnings }` — `shards` is `formatReport` input, empty
 * when the run has no CT shard jobs; `warnings` are the log-fallback notices.
 */
export function collectRun({ runId, repo, attempt, runner }) {
  const jobsPath =
    attempt === undefined
      ? `repos/${repo}/actions/runs/${runId}/jobs?per_page=100`
      : `repos/${repo}/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100`;
  const jobsPayload = runner.api(jobsPath);
  const jobs = parseCtJobs(jobsPayload);
  if (jobs.length === 0) return { shards: [], attempt, warnings: [] };
  const resolvedAttempt = attempt ?? jobsPayload?.jobs?.[0]?.run_attempt;

  const warnings = [];
  let artifacts;
  const shards = jobs.map((job) => {
    if (job.conclusion === 'success') return { ...job, source: null, cases: [] };
    artifacts ??= runner.api(`repos/${repo}/actions/runs/${runId}/artifacts?per_page=100`);
    const name = `playwright-ct-report-${job.shard}-of-${job.shardCount}`;
    const artifact = (artifacts?.artifacts ?? []).find((a) => a?.name === name && !a.expired);
    const report = artifact ? runner.jsonReport(repo, runId, name) : null;
    if (report) return { ...job, source: 'json', cases: casesFromJsonReport(report) };
    const fullLog = runner.jobLog(repo, job.jobId);
    // Only the required lane's segment: on shard 1 the advisory quarantine
    // lane runs afterwards and prints its own summary block.
    const laneLog = requiredLaneLog(fullLog);
    const log = laneLog ?? fullLog;
    if (!hasListLogSummary(log)) return { ...job, source: null, cases: [], note: NO_SUMMARY_NOTE };
    if (laneLog === null) warnings.push(`shard ${job.shard}/${job.shardCount}: ${NO_LANE_WARNING}`);
    warnings.push(`shard ${job.shard}/${job.shardCount}: ${LOG_WARNING}`);
    return { ...job, source: 'log', cases: casesFromListLog(log) };
  });
  return { shards, attempt: resolvedAttempt, warnings };
}

/**
 * Run the CLI: parse `argv`, collect through `runner` (created from
 * `createRunner({ tmpDir })` when omitted), print to `stdout` / `stderr`, and
 * return the exit code.
 */
export function main(argv, { createRunner = createGhRunner, stdout, stderr } = {}) {
  const out = (line) => (stdout ?? process.stdout).write(`${line}\n`);
  const err = (line) => (stderr ?? process.stderr).write(`${line}\n`);
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    err(`error: ${error.message}`);
    err(USAGE);
    return 2;
  }
  if (opts.help) {
    out(USAGE);
    return 0;
  }

  const tmpDir = mkdtempSync(join(tmpdir(), 'ct-run-failures-'));
  try {
    const { runId, repo } = opts;
    const runner = createRunner({ tmpDir });
    const { shards, attempt, warnings } = collectRun({
      runId,
      repo,
      attempt: opts.attempt,
      runner,
    });
    if (shards.length === 0) {
      err(`Run ${runId} (${repo}) has no Component Tests shard jobs.`);
      return 2;
    }
    for (const warning of warnings) err(`warning: ${warning}`);
    const report = formatReport({ runId, repo, attempt, shards });
    out(opts.json ? JSON.stringify(report.json, null, 2) : report.text);
    return 0;
  } catch (error) {
    if (!(error instanceof GhError)) throw error;
    err(`error: ${error.message}`);
    return 3;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirectRun) {
  process.exitCode = main(process.argv.slice(2));
}
