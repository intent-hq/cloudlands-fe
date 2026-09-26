#!/usr/bin/env node
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER_ARTIFACTS } from './browser-test-artifacts.mjs';
import { githubClient, readJson } from './nightly-test-github.mjs';
import { synchronizeIssues } from './nightly-test-issues.mjs';
import {
  analyzeReports,
  parseReport,
  safeText,
  SOURCE_REPO,
  trustedRun,
} from './nightly-test-report.mjs';

function save(directory, name, value) {
  writeFileSync(join(directory, name), `${JSON.stringify(value, null, 2)}\n`);
}
function summary(directory, text, env) {
  writeFileSync(join(directory, 'summary.md'), `${text}\n`);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${text}\n`);
}
function writeScope(plan, env) {
  if (
    env.GITHUB_EVENT_NAME !== 'workflow_run' ||
    env.GITHUB_REPOSITORY !== SOURCE_REPO ||
    env.GITHUB_REF !== 'refs/heads/main' ||
    !env.GH_TOKEN ||
    !trustedRun(plan.run)
  ) {
    throw new Error(
      'Issue writes require the trusted main workflow_run job and MONOREPO_ISSUES_TOKEN',
    );
  }
  const event = readJson(env.GITHUB_EVENT_PATH);
  if (
    event.action !== 'completed' ||
    !trustedRun(event.workflow_run) ||
    event.workflow_run.id !== plan.run.id ||
    event.workflow_run.head_sha !== plan.run.head_sha
  ) {
    throw new Error('Completion event does not match the report');
  }
}

export function main(argv, { env = process.env, createClient = githubClient } = {}) {
  let directory;
  try {
    const [command, ...args] = argv;
    let runId;
    let write = false;
    let historical = false;
    for (let i = 0; i < args.length; i += 1) {
      if (args[i] === '--out' && args[i + 1]) directory = resolve(args[++i]);
      else if (args[i] === '--run' && /^\d+$/.test(args[i + 1] ?? '')) runId = args[++i];
      else if (args[i] === '--write') write = true;
      else if (args[i] === '--historical') historical = true;
      else throw new Error(`Unknown or incomplete option: ${args[i]}`);
    }
    if (
      !directory ||
      !['collect', 'publish'].includes(command) ||
      (command === 'collect' && (!runId || write))
    ) {
      throw new Error(
        'Usage: nightly-test-failures.mjs collect --run ID --out DIR [--historical] | publish --out DIR [--write]',
      );
    }
    mkdirSync(directory, { recursive: true });
    const client = createClient({ directory });
    if (command === 'collect') {
      const run = client.run(runId);
      save(directory, 'run.json', run);
      if (
        !Number.isSafeInteger(run.id) ||
        String(run.id) !== runId ||
        !Number.isSafeInteger(run.run_attempt) ||
        run.run_attempt < 1 ||
        !/^[a-f0-9]{40}$/.test(run.head_sha) ||
        !Number.isFinite(Date.parse(run.updated_at)) ||
        run.status !== 'completed'
      )
        throw new Error('Run is incomplete or has invalid metadata');
      if (!trustedRun(run) && !historical)
        throw new Error('Run is outside trusted nightly/main manual scope');
      const jobs = client.jobs(runId); // Fail closed on unreadable history, never use artifact age alone.
      save(directory, 'jobs.json', jobs);
      const artifacts = client.artifacts(runId);
      save(directory, 'artifacts.json', artifacts);
      const documents = {};
      for (const entry of [
        {
          artifactName: 'browser-test-manifest',
          paths: { manifest: 'browser-test-manifest.json' },
        },
        ...BROWSER_ARTIFACTS.map((e) => ({
          ...e,
          paths: { outcome: e.outcomePath, report: e.reportPath },
        })),
      ]) {
        const matches = artifacts.filter((a) => a.name === entry.artifactName && !a.expired);
        if (matches.length === 1)
          documents[entry.artifactName] = client.archive(matches[0], entry.paths);
      }
      save(directory, 'documents.json', documents);
      const latest = client.run(runId);
      if (
        latest.run_attempt !== run.run_attempt ||
        latest.status !== 'completed' ||
        latest.head_sha !== run.head_sha
      )
        throw new Error('Source run changed during collection; retry after completion');
      const plan = analyzeReports({ run, jobs, artifacts, documents });
      plan.historical = historical;
      if (historical) {
        plan.historicalFailures = [];
        for (const entry of BROWSER_ARTIFACTS) {
          const report = documents[entry.artifactName]?.report;
          if (report) plan.historicalFailures.push(...parseReport(report, entry).failures);
        }
      }
      save(directory, 'plan.json', plan);
      summary(
        directory,
        `Browser report for [run ${run.id}](https://github.com/${SOURCE_REPO}/actions/runs/${run.id}), attempt ${run.run_attempt}.\n\n` +
          `${plan.lanes.length} validated reports. ${plan.items.length} issue candidates. ${plan.incidents.length} evidence gaps.\n\n` +
          (historical
            ? 'Read-only historical evidence: missing producer metadata cannot establish completeness or freshness. No issue writes are authorized.\n\n'
            : '') +
          plan.incidents.map((s) => `- ${safeText(s)}`).join('\n'),
        env,
      );
      return 0;
    }
    const plan = readJson(join(directory, 'plan.json'));
    if (write) {
      if (plan.historical) throw new Error('Historical diagnostics cannot write issues');
      writeScope(plan, env);
    }
    const results = synchronizeIssues(plan, client, {
      write,
      checkpoint: (receipts) => save(directory, 'receipts.json', receipts),
    });
    save(directory, 'receipts.json', results);
    summary(
      directory,
      `${write ? 'Reported' : 'Dry run for'} [browser run ${plan.run.id}, attempt ${plan.run.run_attempt}](https://github.com/${SOURCE_REPO}/actions/runs/${plan.run.id}/attempts/${plan.run.run_attempt}).\n\n` +
        (results.length
          ? results
              .map((r) => `- ${r.url ? `[Issue ${r.issue}](${r.url})` : r.key}: ${r.action}`)
              .join('\n')
          : 'All expected reports were validated; no unexpected failures or flakes.') +
        `\n\nReports and traces: [source artifacts](https://github.com/${SOURCE_REPO}/actions/runs/${plan.run.id}#artifacts).\n\n` +
        (plan.incidents.length
          ? `CI evidence is incomplete; see the infrastructure issue and saved plan.\n${plan.incidents.map((s) => `- ${safeText(s)}`).join('\n')}`
          : ''),
      env,
    );
    return 0;
  } catch (error) {
    if (directory) {
      mkdirSync(directory, { recursive: true });
      save(directory, 'error.json', {
        error: error.message,
        retry:
          'Rerun the failed reporter after correcting the cause; existing occurrence markers prevent duplicate writes.',
      });
      const receipts = (() => {
        try {
          return readJson(join(directory, 'receipts.json'));
        } catch {
          return [];
        }
      })();
      summary(
        directory,
        `Browser failure reporting failed: ${safeText(error.message)}.\n\nInputs, plan and partial receipts are retained for retry.\n\n` +
          receipts
            .filter((r) => r.url)
            .map((r) => `- [Issue ${r.issue}](${r.url}): ${r.action}`)
            .join('\n'),
        env,
      );
    }
    process.stderr.write(`Browser failure reporting failed: ${error.message}\n`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = main(process.argv.slice(2));
