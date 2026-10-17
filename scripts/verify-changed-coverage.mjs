// Coverage contract for `verify:changed`: every check and every resolved unit
// test file of the current plan is an obligation. An obligation is satisfied by
// a pass in this attempt or, under `--resume`, by a compatible earlier receipt.
import { commandIdentity, diffSources, digest } from './verify-changed-receipts.mjs';

export const UNIT_LANES = new Set([
  'vitest-direct',
  'vitest-related',
  'vitest-declared',
  'vitest-full',
  'vitest-ui-invariants',
]);
const SATISFIED = new Set(['executed-passed', 'resumed-passed']);
const PASSING_FILE_STATES = new Set(['passed', 'skipped']);
// Invalidation is computed with the standard unit configuration only; files
// recorded under any other configuration never earn cross-tree credit.
const INVALIDATION_CONFIG = 'vitest.config.ts';

/** The Vitest config a unit lane runs with. */
export function laneConfig(check) {
  const index = check.args.indexOf('--config');
  if (index !== -1 && check.args[index + 1]) return check.args[index + 1];
  const inline = check.args.find((arg) => arg.startsWith('--config='));
  if (inline) return inline.slice('--config='.length);
  return INVALIDATION_CONFIG;
}

export function obligationsFor(plan, selections) {
  const byId = new Map(selections.map((selection) => [selection.id, selection.files]));
  const checks = [];
  const files = [];
  for (const check of plan.checks) {
    const laneFiles = UNIT_LANES.has(check.id) ? (byId.get(check.id) ?? []) : [];
    checks.push({ id: check.id, command: commandIdentity(check), unitFiles: laneFiles.length });
    for (const file of laneFiles) files.push({ lane: check.id, file, config: laneConfig(check) });
  }
  return { checks, files };
}

function invocationsOf(results) {
  const invocations = new Map();
  const entry = (id) => {
    if (!invocations.has(id))
      invocations.set(id, { runEnds: [], checkEnd: null, failedFile: false });
    return invocations.get(id);
  };
  for (const record of results) {
    if (!record.invocation) continue;
    if (record.type === 'unit-run-end') entry(record.invocation).runEnds.push(record);
    else if (record.type === 'check-end') entry(record.invocation).checkEnd = record;
    else if (record.type === 'unit-file' && record.state === 'failed')
      entry(record.invocation).failedFile = true;
  }
  return invocations;
}

/**
 * Per-file results are credible unless their invocation reported unhandled
 * errors, or failed without any failing file to explain the failure (for
 * example a teardown or leak check). Interrupted invocations stay credible for
 * the files that finished.
 */
function credibleFileResults(results) {
  const invocations = invocationsOf(results);
  return results.filter((record) => {
    if (record.type !== 'unit-file' || typeof record.file !== 'string') return false;
    if (!record.invocation) return false;
    const invocation = invocations.get(record.invocation);
    // No end record: the invocation was interrupted; its finished files stand.
    if (!invocation) return true;
    if (invocation.runEnds.some((end) => end.unhandledErrors > 0)) return false;
    if (invocation.checkEnd && invocation.checkEnd.status !== 'passed' && !invocation.failedFile)
      return false;
    return true;
  });
}

function latestFileResults(results) {
  const latest = new Map();
  for (const record of credibleFileResults(results))
    latest.set(`${record.lane}\0${record.config}\0${record.file}`, record);
  return latest;
}

function latestByFile(results) {
  const latest = new Map();
  for (const record of credibleFileResults(results))
    latest.set(`${record.config}\0${record.file}`, record);
  return latest;
}

function latestCheckEnds(results) {
  const latest = new Map();
  for (const record of results)
    if (record.type === 'check-end' && record.id)
      latest.set(`${record.id}\0${record.command}`, record);
  return latest;
}

/**
 * Credits obligations from compatible earlier attempts. An attempt is
 * compatible when its configuration identity matches; its evidence then applies
 * only to what the planner would not select for the changes since that attempt.
 *
 * `invalidatedFiles(changedPaths)` must return `{ all: true }` or
 * `{ all: false, files: Set }` using the planner's own selection rules.
 */
export async function reconcile({
  plan,
  selections,
  configuration,
  source,
  attempts,
  loadTree,
  invalidatedFiles,
}) {
  const obligations = obligationsFor(plan, selections);
  const compatible = attempts
    .filter((attempt) => attempt.run.identities?.configuration?.digest === configuration.digest)
    .reverse();
  const changedFor = new Map();
  const changed = (attempt) => {
    if (!changedFor.has(attempt.id)) {
      const tree = loadTree(attempt.run.identities?.source?.digest);
      changedFor.set(attempt.id, tree ? diffSources(tree, source.files) : null);
    }
    return changedFor.get(attempt.id);
  };
  const invalidationCache = new Map();
  const invalidation = async (paths) => {
    const key = digest(paths);
    if (!invalidationCache.has(key)) invalidationCache.set(key, await invalidatedFiles(paths));
    return invalidationCache.get(key);
  };
  const evidence = compatible.map((attempt) => ({
    attempt,
    checks: latestCheckEnds(attempt.results),
    files: latestByFile(attempt.results),
  }));

  const checks = new Map();
  for (const obligation of obligations.checks) {
    if (obligation.unitFiles) continue;
    for (const { attempt, checks: ends } of evidence) {
      const end = ends.get(`${obligation.id}\0${obligation.command}`);
      if (!end) continue;
      const paths = changed(attempt);
      // Non-unit checks are repo-wide or not graph-scoped: identical sources only.
      if (!paths || paths.length) continue;
      if (end.status === 'passed') checks.set(obligation.id, attempt.id);
      break;
    }
  }

  const files = new Map();
  for (const obligation of obligations.files) {
    if (obligation.config !== INVALIDATION_CONFIG) continue;
    for (const { attempt, files: results } of evidence) {
      const record = results.get(`${obligation.config}\0${obligation.file}`);
      if (!record) continue;
      const paths = changed(attempt);
      if (!paths) continue;
      if (paths.length) {
        const invalid = await invalidation(paths);
        // Stale evidence (pass or failure) for a file affected since then is ignored.
        if (invalid.all || invalid.files.has(obligation.file)) continue;
      }
      if (PASSING_FILE_STATES.has(record.state))
        files.set(`${obligation.lane}\0${obligation.file}`, attempt.id);
      break;
    }
  }
  for (const obligation of obligations.checks) {
    if (!obligation.unitFiles) continue;
    const lane = obligations.files.filter((file) => file.lane === obligation.id);
    if (lane.every((file) => files.has(`${file.lane}\0${file.file}`)))
      checks.set(obligation.id, null);
  }
  return { obligations, checks, files };
}

/** Files of a unit lane that still need to run under the given credits. */
export function remainingLaneFiles(laneId, selections, credits) {
  const selection = selections.find((entry) => entry.id === laneId);
  if (!selection) return null;
  if (!credits) return selection.files;
  return selection.files.filter((file) => !credits.files.has(`${laneId}\0${file}`));
}

/**
 * Builds the coverage report for the current attempt. `complete` is true only
 * when every obligation is satisfied.
 */
export function buildCoverage({ attemptId, obligations, credits, results }) {
  const ends = new Map();
  for (const record of results)
    if (record.type === 'check-end' && record.id) ends.set(record.id, record);
  const fileResults = latestFileResults(results);
  const checks = obligations.checks.map((obligation) => {
    const entry = { id: obligation.id, command: obligation.command };
    if (credits?.checks.has(obligation.id)) {
      const source = credits.checks.get(obligation.id);
      return { ...entry, status: 'resumed-passed', source_attempt: source ?? 'per-file' };
    }
    const end = ends.get(obligation.id);
    return {
      ...entry,
      status: !end ? 'unfinished' : end.status === 'passed' ? 'executed-passed' : 'failed',
    };
  });
  const files = obligations.files.map((obligation) => {
    const entry = { lane: obligation.lane, file: obligation.file, config: obligation.config };
    const credit = credits?.files.get(`${obligation.lane}\0${obligation.file}`);
    if (credit) return { ...entry, status: 'resumed-passed', source_attempt: credit };
    const record = fileResults.get(`${obligation.lane}\0${obligation.config}\0${obligation.file}`);
    if (!record) return { ...entry, status: 'unfinished' };
    return {
      ...entry,
      status: PASSING_FILE_STATES.has(record.state) ? 'executed-passed' : 'failed',
    };
  });
  const count = (entries) => {
    const counts = { 'executed-passed': 0, 'resumed-passed': 0, failed: 0, unfinished: 0 };
    for (const entry of entries) counts[entry.status] += 1;
    return counts;
  };
  return {
    attempt: attemptId,
    complete: [...checks, ...files].every((entry) => SATISFIED.has(entry.status)),
    counts: { checks: count(checks), unitFiles: count(files) },
    checks,
    unitFiles: files,
  };
}
