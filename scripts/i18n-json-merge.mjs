#!/usr/bin/env node
// i18n-json-merge.mjs — key-level three-way merge for messages/*.json catalogs.
//
// Branches that each append keys at the end of a catalog conflict line-wise in all
// eight locale files (cloudlands-fe#4527). A key-level merge takes both additions,
// and stops only when one key changed differently on both sides.
//
//   driver <base> <ours> <theirs>  git merge driver (.gitattributes `merge=i18n-json`);
//                                   writes <ours>, or conflict markers on a real conflict
//   resolve                        resolves unmerged messages/*.json from the index
//   install                        registers the driver in local git config (run by
//                                   `prepare`; never fails, so installs stay safe)
//
// Without the driver registered (CI, GitHub's web UI) git uses its normal text merge.

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DRIVER_NAME = 'i18n-json';
const CATALOG_GLOB = 'messages/*.json';

const TOP_LEVEL_KEY = /^ {2}("(?:[^"\\]|\\.)*")\s*:/gm;
const CONFLICT_MARKER = /^<{7}(?: |$)/m;

function parseCatalog(text, label) {
  const value = JSON.parse(text);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} is not a JSON object`);
  }
  // JSON.parse keeps only the last of repeated keys; refuse rather than drop a value.
  const seen = new Set();
  for (const [, quoted] of text.matchAll(TOP_LEVEL_KEY)) {
    const key = JSON.parse(quoted);
    if (seen.has(key)) throw new Error(`${label} repeats key ${quoted}`);
    seen.add(key);
  }
  return value;
}

/**
 * Three-way merge of flat catalogs. Returns ordered `entries` and the sorted keys
 * that both sides changed differently (`conflicts`; `entries` is unusable then).
 * Order follows ours; a key only theirs added follows its preceding theirs key,
 * after any keys only ours added there, so two appended blocks stay contiguous.
 */
export function mergeCatalogs(base, ours, theirs) {
  const has = (obj, key) => Object.hasOwn(obj, key);
  const same = (obj1, obj2, key) =>
    has(obj1, key) === has(obj2, key) && JSON.stringify(obj1[key]) === JSON.stringify(obj2[key]);

  const result = new Map();
  const conflicts = [];
  for (const key of new Set([...Object.keys(ours), ...Object.keys(theirs), ...Object.keys(base)])) {
    let side;
    if (same(ours, theirs, key) || same(base, theirs, key)) side = ours;
    else if (same(base, ours, key)) side = theirs;
    else {
      conflicts.push(key);
      continue;
    }
    if (has(side, key)) result.set(key, side[key]);
  }
  if (conflicts.length > 0) return { entries: [], conflicts: conflicts.sort() };

  const insertsAfter = new Map();
  let anchor = null;
  for (const key of Object.keys(theirs)) {
    if (!result.has(key)) continue;
    if (has(ours, key)) {
      anchor = key;
    } else {
      if (!insertsAfter.has(anchor)) insertsAfter.set(anchor, []);
      insertsAfter.get(anchor).push(key);
    }
  }

  const oursOnly = (key) => !has(base, key) && !has(theirs, key);
  const order = [];
  let pending = insertsAfter.get(null) ?? [];
  for (const key of Object.keys(ours)) {
    if (!result.has(key)) continue;
    if (!oursOnly(key)) {
      order.push(...pending);
      pending = [];
    }
    order.push(key);
    if (insertsAfter.has(key)) pending = [...pending, ...insertsAfter.get(key)];
  }
  order.push(...pending);

  return { entries: order.map((key) => [key, result.get(key)]), conflicts: [] };
}

/** Same bytes as `JSON.stringify(catalog, null, 2) + '\n'`, but keeps entry order for any key. */
export function serializeCatalog(catalog) {
  const entries = Array.isArray(catalog) ? catalog : Object.entries(catalog);
  if (entries.length === 0) return '{}\n';
  const body = entries
    .map(
      ([key, value]) =>
        `  ${JSON.stringify(key)}: ${JSON.stringify(value, null, 2).replace(/\n/g, '\n  ')}`,
    )
    .join(',\n');
  return `{\n${body}\n}\n`;
}

/**
 * Merge three catalog texts; returns `{ text }`, `{ conflicts }` or `{ error }`. An
 * empty base (both sides added the file) counts as an empty catalog.
 */
export function mergeTexts(baseText, oursText, theirsText) {
  let catalogs;
  try {
    catalogs = [
      baseText.trim() === '' ? {} : parseCatalog(baseText, 'base'),
      parseCatalog(oursText, 'ours'),
      parseCatalog(theirsText, 'theirs'),
    ];
  } catch (error) {
    return { error: error.message };
  }
  const { entries, conflicts } = mergeCatalogs(...catalogs);
  return conflicts.length > 0 ? { conflicts } : { text: serializeCatalog(entries) };
}

function describeFailure(path, outcome) {
  if (outcome.error) return `${path}: cannot merge by key (${outcome.error})`;
  return `${path}: both sides changed ${outcome.conflicts.length} key(s) differently: ${outcome.conflicts.join(', ')}`;
}

const CONFLICT_EXIT = 3;
const MERGE_FILE_ARGS = ['merge-file', '-L', 'ours', '-L', 'base', '-L', 'theirs'];

/**
 * The `merge.i18n-json.driver` value. On a real conflict the script writes the usual
 * conflict markers and exits CONFLICT_EXIT; any other failure (say, a checkout that
 * predates this script) falls back to a plain `git merge-file`.
 */
export function driverCommand(scriptPath = 'scripts/i18n-json-merge.mjs', node = 'node') {
  const quote = (value) => `'${value.replace(/'/g, `'\\''`)}'`;
  return (
    `${quote(node)} ${quote(scriptPath)} driver %O %A %B %P; rc=$?; ` +
    `[ $rc -eq 0 ] || [ $rc -eq ${CONFLICT_EXIT} ] && exit $rc; ` +
    `git ${MERGE_FILE_ARGS.join(' ')} %A %O %B`
  );
}

function runDriver([basePath, oursPath, theirsPath, displayPath = oursPath]) {
  const oursText = readFileSync(oursPath, 'utf8');
  const theirsText = readFileSync(theirsPath, 'utf8');
  const outcome = mergeTexts(readFileSync(basePath, 'utf8'), oursText, theirsText);
  if (outcome.text === undefined) {
    console.error(`i18n-json-merge: ${describeFailure(displayPath, outcome)}`);
    const textMerge = spawnSync('git', [...MERGE_FILE_ARGS, oursPath, basePath, theirsPath], {
      stdio: 'ignore',
    });
    // A clean text merge would hide the key conflict (e.g. a duplicated key): mark the whole file.
    if (textMerge.status === 0) {
      writeFileSync(oursPath, `<<<<<<< ours\n${oursText}=======\n${theirsText}>>>>>>> theirs\n`);
    }
    return CONFLICT_EXIT;
  }
  writeFileSync(oursPath, outcome.text);
  return 0;
}

function git(args, options = {}) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

function runResolve() {
  const root = git(['rev-parse', '--show-toplevel']).trim();
  const stages = new Map();
  for (const record of git(['ls-files', '-u', '-z', '--', CATALOG_GLOB], { cwd: root }).split(
    '\0',
  )) {
    const match = /^\d+ ([0-9a-f]+) ([123])\t(.+)$/.exec(record);
    if (!match) continue;
    const [, blob, stage, path] = match;
    if (!stages.has(path)) stages.set(path, {});
    stages.get(path)[stage] = git(['cat-file', 'blob', blob], { cwd: root });
  }
  if (stages.size === 0) {
    console.log('i18n-json-merge: no conflicted messages/*.json files');
    return 0;
  }

  let failed = 0;
  for (const [path, stage] of stages) {
    let worktreeText = '';
    try {
      worktreeText = readFileSync(join(root, path), 'utf8');
    } catch {
      // Deleted in the worktree; reported below.
    }
    let outcome;
    if (stage[2] === undefined || stage[3] === undefined) {
      outcome = { error: 'one side deleted the file' };
    } else if (!CONFLICT_MARKER.test(worktreeText)) {
      outcome = {
        error: 'no conflict markers left; keeping your edits (`git checkout -m` restores them)',
      };
    } else {
      outcome = mergeTexts(stage[1] ?? '', stage[2], stage[3]);
    }
    if (outcome.text === undefined) {
      console.error(`i18n-json-merge: ${describeFailure(path, outcome)}`);
      failed += 1;
      continue;
    }
    // Keep the pre-resolve file (markers plus any hand edits) recoverable from git.
    const backup = git(['hash-object', '-w', '--', path], { cwd: root }).trim();
    writeFileSync(join(root, path), outcome.text);
    git(['add', '--', path], { cwd: root });
    console.log(
      `i18n-json-merge: resolved ${path} (previous file: git cat-file -p ${backup} > ${path})`,
    );
  }
  return failed > 0 ? 1 : 0;
}

function runInstall() {
  try {
    git(['rev-parse', '--git-dir']);
    git(['config', `merge.${DRIVER_NAME}.name`, 'Key-level merge for Paraglide message catalogs']);
    git(['config', `merge.${DRIVER_NAME}.driver`, driverCommand()]);
  } catch {
    // No git, or not a checkout (e.g. a packed source tree): nothing to register.
  }
  return 0;
}

const COMMANDS = { driver: runDriver, resolve: runResolve, install: runInstall };

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [command, ...args] = process.argv.slice(2);
  const run = COMMANDS[command];
  if (!run) {
    console.error(
      'usage: i18n-json-merge.mjs driver <base> <ours> <theirs> [path] | resolve | install',
    );
    process.exit(2);
  }
  process.exit(run(args));
}
