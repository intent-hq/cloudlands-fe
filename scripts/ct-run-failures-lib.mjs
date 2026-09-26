// ct-run-failures-lib.mjs — pure parsing for `pnpm ct:failures <run-id>`.
//
// Turns the inputs of one `Intent PR Checks` run into a de-duplicated list of
// failing and flaky Playwright CT cases per shard. No network, no filesystem:
// the CLI (scripts/ct-run-failures.mjs) fetches jobs, artifacts, and logs and
// hands the payloads here.
//
// Sources, in order of preference:
//   1. The Playwright JSON report (`playwright-report/results.json` in the
//      `playwright-ct-report-N-of-M` artifact). Each test carries a `status`
//      (`expected` / `unexpected` / `flaky` / `skipped`) and the file suite
//      names the spec file — the only source that locates generated tests at
//      their spec instead of the generator helper.
//   2. The list reporter's final summary block (`N failed` / `N flaky` headers
//      followed by one `[project] › file:line:col › title` line per case).
//      Never the per-test `✘` lines: those repeat per retry and include
//      `test.fail()` expected failures (the incident triage on
//      cloudlands-fe#2533 missed five cases for exactly that reason).

const CT_JOB_NAME = /(?:^| \/ )Component Tests \(shard (\d+)\/(\d+)\)$/;
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
// `gh run view --log` prefixes every line with `<job>\t<step>\t`; the raw job
// log (BOM-prefixed, and `gh` after it) prefixes the content with an RFC3339
// timestamp.
const GH_LOG_PREFIX =
  /^\uFEFF?(?:[^\t\n]*\t[^\t\n]*\t)?(?:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z ?)?/;
const SUMMARY_HEADER = /^\s*(\d+) (failed|flaky|interrupted|skipped|did not run|passed)(?:\s|$)/;
const SUMMARY_CASE = /^\s*(?:\[[^\]]*\] › )?(\S+?):(\d+):(\d+) › (.+?)\s*$/;
const TITLE_SEPARATOR = ' › ';
// The required lane's command echo (intent-pr.yml "Component tests" step): the
// only CT invocation in the job that excludes the @quarantine tag. The advisory
// quarantine lane echoes `--grep '@quarantine\b'` and the warm-up echoes
// `--only-changed`, so neither matches.
const REQUIRED_LANE_COMMAND = /--grep-invert\s+'?@quarantine/;
const STEP_GROUP_START = /^##\[group\]Run /;

/**
 * Select the `Component Tests (shard N/M)` jobs of a GitHub
 * `actions/runs/{id}/jobs` payload (or its bare `jobs` array), sorted by shard.
 * Other jobs (lint, quarantine lane, …) are ignored; `[]` when there are none.
 */
export function parseCtJobs(jobs) {
  const list = Array.isArray(jobs) ? jobs : Array.isArray(jobs?.jobs) ? jobs.jobs : [];
  const shards = [];
  for (const job of list) {
    const match = CT_JOB_NAME.exec(job?.name ?? '');
    if (!match) continue;
    shards.push({
      jobId: job.id,
      shard: Number(match[1]),
      shardCount: Number(match[2]),
      status: job.status,
      conclusion: job.conclusion ?? null,
      name: job.name,
    });
  }
  return shards.sort((a, b) => a.shard - b.shard);
}

function statusFromPlaywright(status) {
  if (status === 'unexpected') return 'failed';
  if (status === 'flaky') return 'flaky';
  return null;
}

/**
 * Failing and flaky cases of a Playwright JSON report.
 *
 * Walks `suites` recursively; `specFile` is the top-level (file) suite's
 * `file`, `title` the describe/test titles below it joined with ` › `, and
 * `location` the spec's own `file:line:column` (a generator helper for
 * generated tests). A spec is listed once even with retries or several
 * projects: `failed` if any project's test is `unexpected`, else `flaky` if
 * any is `flaky`. `expected` (including `test.fail()`) and `skipped` are
 * dropped.
 */
export function casesFromJsonReport(report) {
  const cases = [];
  const visit = (suite, specFile, titles) => {
    for (const spec of suite.specs ?? []) {
      const statuses = (spec.tests ?? []).map((test) => statusFromPlaywright(test.status));
      const status = statuses.includes('failed')
        ? 'failed'
        : statuses.includes('flaky')
          ? 'flaky'
          : null;
      if (!status) continue;
      cases.push({
        status,
        specFile,
        title: [...titles, spec.title].join(TITLE_SEPARATOR),
        location: `${spec.file}:${spec.line}:${spec.column}`,
      });
    }
    for (const child of suite.suites ?? []) visit(child, specFile, [...titles, child.title]);
  };
  for (const fileSuite of report?.suites ?? []) visit(fileSuite, fileSuite.file, []);
  return cases;
}

/** Strip ANSI colors and the GitHub Actions log prefixes from every line. */
export function cleanLogLines(logText) {
  return String(logText ?? '')
    .split(/\r?\n/)
    .map((line) => line.replace(ANSI_ESCAPE, '').replace(GH_LOG_PREFIX, ''));
}

/**
 * The slice of a raw job log that belongs to the REQUIRED component-tests step:
 * from its command echo up to (excluding) the next step's `##[group]Run` line.
 * On shard 1 the advisory quarantine lane runs after the required lane even
 * when it is red, and its own summary block would otherwise be the last one in
 * the log. Returns `null` when the required-lane invocation cannot be found.
 */
export function requiredLaneLog(logText) {
  const rawLines = String(logText ?? '').split(/\r?\n/);
  const lines = cleanLogLines(logText);
  const start = lines.findIndex((line) => REQUIRED_LANE_COMMAND.test(line));
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && !STEP_GROUP_START.test(lines[end])) end += 1;
  return rawLines.slice(start, end).join('\n');
}

/**
 * Whether the log carries a list-reporter summary block at all. Distinguishes
 * "the shard ran and reported nothing red" from "the shard died before the
 * reporter summarized" (OOM kill, cancelled job), where `casesFromListLog`
 * also returns `[]`.
 */
export function hasListLogSummary(logText) {
  return cleanLogLines(logText).some((line) => SUMMARY_HEADER.test(line));
}

/**
 * Failing and flaky cases from a list-reporter log, read from the final
 * summary block only (the last contiguous run of `N failed` / `N flaky` /
 * `N passed` … header lines and their indented case lines). Per-test `✘`
 * lines are never consulted. `specFile` and `location` both come from the
 * summary line's `file:line:col`, so generated tests point at their generator
 * helper. Returns `[]` when the log has no summary block.
 */
export function casesFromListLog(logText) {
  const lines = cleanLogLines(logText);
  const isBlockLine = (line) => SUMMARY_HEADER.test(line) || SUMMARY_CASE.test(line);
  let end = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (SUMMARY_HEADER.test(lines[index])) {
      end = index;
      break;
    }
  }
  if (end < 0) return [];
  let start = end;
  while (start > 0 && isBlockLine(lines[start - 1])) start -= 1;
  while (end + 1 < lines.length && isBlockLine(lines[end + 1])) end += 1;

  const cases = [];
  const seen = new Set();
  let status = null;
  for (const line of lines.slice(start, end + 1)) {
    const header = SUMMARY_HEADER.exec(line);
    if (header) {
      status = header[2] === 'failed' ? 'failed' : header[2] === 'flaky' ? 'flaky' : null;
      continue;
    }
    if (!status) continue;
    const match = SUMMARY_CASE.exec(line);
    if (!match) continue;
    const [, file, line_, column, title] = match;
    const location = `${file}:${line_}:${column}`;
    const key = `${status}\0${location}\0${title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cases.push({ status, specFile: file, title, location });
  }
  return cases;
}

const SOURCE_NOTES = {
  json: 'source: json',
  log: 'source: log — no JSON report artifact; locations may be generator helpers',
};

function jobUrl(repo, runId, jobId) {
  return `https://github.com/${repo}/actions/runs/${runId}/job/${jobId}`;
}

function sortCases(cases) {
  const rank = { failed: 0, flaky: 1 };
  return [...cases].sort((a, b) => rank[a.status] - rank[b.status]);
}

/**
 * Render the per-shard listing (see the spec's Output format).
 *
 * `shards` is `parseCtJobs` output enriched per shard with `source`
 * (`'json'` | `'log'` | `null` when neither was available), `cases` (from
 * `casesFromJsonReport` / `casesFromListLog`), optionally `note` to replace
 * the default source annotation, and `pending: true` for unfinished jobs.
 * Pending shards are listed without a source annotation or red-shard count.
 * A finished shard is red when its `conclusion` is not `success`.
 * Returns `{ text, json }` — `json` is the `--json` output shape.
 */
export function formatReport({ runId, repo, attempt, shards }) {
  const lines = [];
  const runLabel = attempt === undefined ? repo : `${repo}, attempt ${attempt}`;
  lines.push(`Run ${runId} (${runLabel}) — Component Tests`);

  const totals = { failed: 0, flaky: 0, redShards: 0 };
  const redJobs = [];
  const jsonShards = [];
  for (const shard of shards) {
    const cases = sortCases(shard.cases ?? []);
    const red = !shard.pending && shard.conclusion !== 'success';
    const source = shard.source ?? null;
    const label = shard.pending ? 'pending' : (shard.conclusion ?? 'unknown');
    let line = `shard ${shard.shard}/${shard.shardCount}  ${label}`;
    if (red) {
      const note =
        shard.note ??
        SOURCE_NOTES[source] ??
        'source: none — no JSON report artifact and no log summary block';
      line += `  (${note})`;
      totals.redShards += 1;
      redJobs.push(`job ${shard.jobId}: ${jobUrl(repo, runId, shard.jobId)}`);
    }
    lines.push(line);
    for (const item of cases) {
      const sameFile = item.location.startsWith(`${item.specFile}:`);
      lines.push(
        sameFile
          ? `  ${item.status.padEnd(6)}  ${item.location}  ${item.title}`
          : `  ${item.status.padEnd(6)}  ${item.specFile}  ${item.title} (${item.location})`,
      );
      totals[item.status] += 1;
    }
    jsonShards.push({
      shard: shard.shard,
      shardCount: shard.shardCount,
      jobId: shard.jobId,
      jobUrl: jobUrl(repo, runId, shard.jobId),
      conclusion: shard.conclusion ?? null,
      ...(shard.pending ? { pending: true } : {}),
      source,
      cases,
    });
  }

  const shardWord = totals.redShards === 1 ? 'red shard' : 'red shards';
  const jobList = redJobs.length ? ` (${redJobs.join(', ')})` : '';
  lines.push(
    `Total: ${totals.failed} failed, ${totals.flaky} flaky across ${totals.redShards} ${shardWord}${jobList}`,
  );

  return {
    text: lines.join('\n'),
    json: { runId, repo, attempt: attempt ?? null, shards: jsonShards, totals },
  };
}
