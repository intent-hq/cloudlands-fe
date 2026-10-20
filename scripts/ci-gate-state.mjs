#!/usr/bin/env node
// ci-gate-state.mjs — summarize the required "CI Gate" check of a PR for the
// release workflows (auto-cut-alpha.yml, auto-pin-intentd.yml).
//
// Both workflows used to carry their own inline jq for this and the copies
// drifted: one treated SKIPPED / NEUTRAL / STARTUP_FAILURE / STALE as pending
// (retry forever), the other as terminal. Both also printed an empty state for
// an in-progress run, because gh reports `conclusion: ""` (not null) until a
// check run completes. This is the one tested copy.
//
// Input (stdin): the JSON of `gh pr view --json statusCheckRollup` — add
// `headRefOid` when passing `--head`.
//
// Output (stdout), exactly one line:
//   success              every CI Gate check run concluded SUCCESS
//   missing              no CI Gate check run on the head yet
//   pending:<states>     at least one CI Gate run has not concluded, none failed
//   failed:<states>      at least one CI Gate run concluded with anything but
//                        SUCCESS (terminal: re-reading cannot turn it green)
//   head-mismatch:<sha>  with --head: the PR head is not the expected commit
//   unreadable           the input is not the expected JSON
// <states> lists each CI Gate run's conclusion, or its status while running.
// A decision always exits 0; only a usage error exits 2.
//
// Usage: node scripts/ci-gate-state.mjs [--head <sha>] < pr-view.json

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CI_GATE_CHECK_NAME = 'CI Gate';

const conclusionOf = (run) =>
  typeof run.conclusion === 'string' && run.conclusion !== '' ? run.conclusion.toUpperCase() : '';

/** One CI Gate run's display state: its conclusion, else its live status. */
function stateOf(run) {
  const conclusion = conclusionOf(run);
  if (conclusion) return conclusion;
  return typeof run.status === 'string' && run.status !== '' ? run.status.toUpperCase() : 'PENDING';
}

/**
 * Summarize the CI Gate check runs in a `gh pr view` JSON object.
 * Any concluded run other than SUCCESS is terminal, including SKIPPED,
 * NEUTRAL, STARTUP_FAILURE, STALE and conclusions GitHub may add later:
 * a gate that did not actually pass never counts as green.
 *
 * @param {unknown} detail parsed `gh pr view --json [headRefOid,]statusCheckRollup`
 * @param {{ head?: string }} [options] expected head commit, when it must match
 * @returns {string} the state line described in the file header
 */
export function summarizeCiGate(detail, { head } = {}) {
  if (detail === null || typeof detail !== 'object' || Array.isArray(detail)) return 'unreadable';
  if (head !== undefined) {
    const current = detail.headRefOid;
    if (typeof current !== 'string' || current === '') return 'unreadable';
    if (current !== head) return `head-mismatch:${current}`;
  }
  const rollup = detail.statusCheckRollup ?? [];
  if (!Array.isArray(rollup)) return 'unreadable';
  const runs = rollup.filter(
    (run) => run !== null && typeof run === 'object' && run.name === CI_GATE_CHECK_NAME,
  );
  if (runs.length === 0) return 'missing';
  if (runs.every((run) => conclusionOf(run) === 'SUCCESS')) return 'success';
  const states = runs.map(stateOf).join(',');
  const failed = runs.some((run) => {
    const conclusion = conclusionOf(run);
    return conclusion !== '' && conclusion !== 'SUCCESS';
  });
  return `${failed ? 'failed' : 'pending'}:${states}`;
}

/** Parse stdin text and summarize; invalid JSON is `unreadable`. */
export function summarizeCiGateText(text, options = {}) {
  let detail;
  try {
    detail = JSON.parse(text);
  } catch {
    return 'unreadable';
  }
  return summarizeCiGate(detail, options);
}

function parseArgs(argv) {
  if (argv.length === 0) return {};
  if (argv.length === 2 && argv[0] === '--head' && /^[0-9a-f]{40}$/.test(argv[1])) {
    return { head: argv[1] };
  }
  return undefined;
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirectRun) {
  const options = parseArgs(process.argv.slice(2));
  if (!options) {
    console.error('usage: ci-gate-state.mjs [--head <40-char sha>] < pr-view.json');
    process.exit(2);
  }
  let text;
  try {
    text = readFileSync(0, 'utf8');
  } catch {
    text = '';
  }
  console.log(summarizeCiGateText(text, options));
}
