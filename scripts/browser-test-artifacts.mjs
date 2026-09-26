#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Versioned producer contract for nightly-browser-tests.yml and its completion
// reporter. Artifact names and report paths also preserve `pnpm ct:failures`.
function artifact(suite, shard, shardCount, artifactName, advisory = false) {
  const quarantine = suite === 'quarantine';
  return Object.freeze({
    suite,
    shard,
    shardCount,
    advisory,
    artifactName,
    reportPath: `${quarantine ? 'playwright-report-quarantine' : 'playwright-report'}/results.json`,
    outcomePath: quarantine ? 'browser-quarantine-outcome.json' : 'browser-outcome.json',
  });
}

export const BROWSER_ARTIFACTS = Object.freeze([
  ...[1, 2, 3, 4].map((shard) => artifact('ct', shard, 4, `playwright-ct-report-${shard}-of-4`)),
  ...[1, 2].map((shard) => artifact('root', shard, 2, `playwright-root-report-${shard}`)),
  artifact('electron', 1, 1, 'playwright-electron-lifetime-report'),
  artifact('quarantine', 1, 1, 'playwright-ct-report-quarantine', true),
]);

function runContext(env) {
  return {
    schemaVersion: 1,
    repository: env.GITHUB_REPOSITORY,
    runId: env.GITHUB_RUN_ID,
    runAttempt: env.GITHUB_RUN_ATTEMPT,
    sha: env.GITHUB_SHA,
    ref: env.GITHUB_REF,
    event: env.GITHUB_EVENT_NAME,
  };
}

function reportTestCount(path) {
  try {
    const report = JSON.parse(readFileSync(path, 'utf8'));
    const count = (suites) =>
      suites.reduce(
        (total, suite) =>
          total +
          (suite.specs ?? []).reduce((sum, spec) => sum + spec.tests.length, 0) +
          count(suite.suites ?? []),
        0,
      );
    const total = count(report.suites);
    return Number.isSafeInteger(total) && total >= 0 ? total : null;
  } catch {
    return null;
  }
}

function main(args, env) {
  const context = runContext(env);
  let path;
  let data;
  if (args.length === 1 && args[0] === 'manifest') {
    path = 'browser-test-manifest.json';
    data = { ...context, artifacts: BROWSER_ARTIFACTS };
  } else if (args.length === 3 && args[0] === 'record') {
    const entry = BROWSER_ARTIFACTS.find(
      ({ suite, shard }) => suite === args[1] && String(shard) === args[2],
    );
    if (!entry) throw new Error(`Unknown browser suite/shard: ${args.slice(1).join(' ')}`);
    const testOutcome = env.BROWSER_TEST_OUTCOME || 'skipped';
    const jobStatus = env.BROWSER_JOB_STATUS;
    if (!['success', 'failure', 'cancelled', 'skipped'].includes(testOutcome)) {
      throw new Error(`Invalid test step outcome: ${testOutcome}`);
    }
    if (!['success', 'failure', 'cancelled'].includes(jobStatus)) {
      throw new Error(`Invalid job status: ${jobStatus}`);
    }
    path = entry.outcomePath;
    data = {
      ...context,
      ...entry,
      testOutcome,
      jobStatus,
      reportPresent: existsSync(entry.reportPath),
      testCount: reportTestCount(entry.reportPath),
    };
  } else {
    throw new Error(
      'Usage: browser-test-artifacts.mjs manifest | record <ct|root|electron|quarantine> <shard>',
    );
  }
  // Never rewrite/filter Playwright's report: expected failures, retries, flakes,
  // skipped cases, global errors and attachments are all reporter inputs.
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  if (
    args[0] === 'record' &&
    !data.advisory &&
    data.jobStatus === 'success' &&
    data.testOutcome !== 'success'
  ) {
    throw new Error(`Required ${data.suite} shard ${data.shard} did not run successfully`);
  }
  // Playwright permits an empty shard even without --pass-with-no-tests.
  // Persist the evidence first, then reject an empty/missing/malformed required
  // report. Quarantine is allowed to be empty; setup failures still get outcomes.
  if (
    args[0] === 'record' &&
    !data.advisory &&
    data.testOutcome === 'success' &&
    !(data.testCount > 0)
  ) {
    throw new Error(
      `Required ${data.suite} shard ${data.shard} succeeded without a nonempty JSON test report`,
    );
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2), process.env);
}
