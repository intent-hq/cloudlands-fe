#!/usr/bin/env node
// release-pr-fast-path.mjs — decide whether a PR diff has the exact shape of a
// known safe-to-skip PR, so CI can skip the heavy jobs. Two shapes are
// recognized: a release-please release PR (version/changelog-only) and an
// intentd sidecar pin bump (intentd.version-only; see auto-pin-intentd.yml).
// Ported from intentd's scripts/release-pr-fast-path.sh (same design:
// shape-based match, fail-safe fallback to full CI).
//
// Usage: node scripts/release-pr-fast-path.mjs <base-ref-or-sha> [<head-ref-or-sha>]
//   <head> defaults to HEAD.
//
// Output contract (for CI):
//   - Prints `fast_path=true` and exits 0 when the diff matches the shape.
//   - Prints `fast_path=false` and exits 0 on any non-match (the reason is
//     logged to stderr). A non-match must never fail the calling job.
//   - Exits non-zero only on unexpected errors; callers must treat a non-zero
//     exit as a non-match.
//
// Release shape (all must hold; diff is taken from merge-base(base, head)):
//   1. Changed files ⊆ { CHANGELOG.md, package.json,
//      .release-please-manifest.json }, all pure modifications (no
//      adds/deletes/renames), and package.json is among them.
//   2. Exactly one old version A and one new version B, taken from the
//      top-level "version" delta of package.json (A != B).
//   3. package.json is byte-identical to its base blob after replacing the
//      literal string `"version": "B"` with `"version": "A"` — i.e. nothing
//      but the version string changed (a dependency bump breaks the match).
//   4. .release-please-manifest.json, when changed, maps "." to A at base and
//      to B at head, and is byte-identical to its base blob after replacing
//      the literal string `"B"` with `"A"`.
//   CHANGELOG.md content is unconstrained (it does not affect the build).
//
// Pin-bump shape (all must hold; mutually exclusive with the release shape —
// a diff mixing intentd.version with any other file matches neither):
//   1. The diff is exactly one file, intentd.version, a pure modification.
//   2. Base and head each contain exactly one non-comment, non-blank pin
//      line; both parse as a plausible bare version (no leading 'v'), and
//      old pin A != new pin B.
//   3. The head file is byte-identical to the base file after replacing the
//      new pin line B with the old pin line A — i.e. nothing but the pin
//      value changed (a comment edit or added line breaks the match).
//
// Git history requirements (shallow CI checkouts): the <base> and <head>
// commits — and ideally their merge-base — must be present locally. With
// actions/checkout, fetch the PR base sha explicitly and pass it as <base>:
//   git fetch --depth=1 origin "$PR_BASE_SHA"
// If the merge-base cannot be computed (too-shallow history), the script
// falls back to diffing directly against <base>. No network access is
// performed by this script.

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ALLOWED_FILES = new Set(['CHANGELOG.md', 'package.json', '.release-please-manifest.json']);
const VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z.+-]*$/;
const PIN_FILE = 'intentd.version';
// Same strictness as VERSION_RE, but pins are bare versions (no leading 'v'),
// so require a leading digit.
const PIN_VERSION_RE = /^[0-9][0-9A-Za-z.+-]*$/;

// Pin lines: everything but blank and '#'-comment lines (mirrors
// auto-pin-intentd.yml's `grep -Ev '^[[:space:]]*(#|$)'`).
const pinLines = (text) => text.split('\n').filter((line) => !/^[\t ]*(#|$)/.test(line));

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function noMatch(reason) {
  return { fastPath: false, reason };
}

/**
 * Evaluate whether the base..head diff has the release-please release-PR
 * shape or the intentd.version pin-bump shape. Returns { fastPath: true }
 * or { fastPath: false, reason }.
 * Throws on unexpected errors (unresolvable refs, git failures).
 */
export function evaluateFastPath(baseRef, headRef, cwd = process.cwd()) {
  const rev = (ref) => {
    try {
      return git(cwd, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`).trim();
    } catch {
      throw new Error(`cannot resolve '${ref}'`);
    }
  };
  const base = rev(baseRef);
  const head = rev(headRef ?? 'HEAD');

  let mergeBase;
  try {
    mergeBase = git(cwd, 'merge-base', base, head).trim();
  } catch {
    mergeBase = base;
  }

  const diff = git(cwd, 'diff', '--name-status', mergeBase, head)
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.split('\t'));
  if (diff.length === 0) return noMatch('empty diff');

  const show = (revision, path) => git(cwd, 'show', `${revision}:${path}`);

  // --- Pin-bump shape: intentd.version alone, pure modification --------------
  if (diff.length === 1 && diff[0][1] === PIN_FILE) {
    const [status] = diff[0];
    if (status !== 'M') return noMatch(`non-modification change (${status} ${PIN_FILE})`);
    const pinBase = show(mergeBase, PIN_FILE);
    const pinHead = show(head, PIN_FILE);
    const baseLines = pinLines(pinBase);
    const headLines = pinLines(pinHead);
    if (baseLines.length !== 1) {
      return noMatch(`expected exactly one pin line at base (found ${baseLines.length})`);
    }
    if (headLines.length !== 1) {
      return noMatch(`expected exactly one pin line at head (found ${headLines.length})`);
    }
    const [pinA] = baseLines;
    const [pinB] = headLines;
    if (!PIN_VERSION_RE.test(pinA)) return noMatch(`unparseable base pin '${pinA}'`);
    if (!PIN_VERSION_RE.test(pinB)) return noMatch(`unparseable head pin '${pinB}'`);
    if (pinA === pinB) return noMatch(`no pin change in ${PIN_FILE}`);
    // The pin line is exactly the bare version (no other line can equal it:
    // every other line is blank or a comment), so a whole-line replacement
    // reverts only the pin value.
    const reverted = pinHead
      .split('\n')
      .map((line) => (line === pinB ? pinA : line))
      .join('\n');
    if (reverted !== pinBase) return noMatch(`non-pin change in ${PIN_FILE}`);
    return { fastPath: true };
  }

  // --- Condition 1: allowed file set, modifications only ---------------------
  for (const [status, path] of diff) {
    if (status !== 'M') return noMatch(`non-modification change (${status} ${path})`);
    if (!ALLOWED_FILES.has(path)) return noMatch(`disallowed file: ${path}`);
  }
  const changed = new Set(diff.map(([, path]) => path));
  if (!changed.has('package.json')) return noMatch('package.json unchanged (no version delta)');

  const parseJson = (text) => {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  };

  // --- Condition 2: single version delta A -> B in package.json --------------
  const pkgBase = show(mergeBase, 'package.json');
  const pkgHead = show(head, 'package.json');
  const verA = parseJson(pkgBase)?.version;
  const verB = parseJson(pkgHead)?.version;
  if (typeof verA !== 'string' || !VERSION_RE.test(verA)) {
    return noMatch(`unparseable base version '${verA}'`);
  }
  if (typeof verB !== 'string' || !VERSION_RE.test(verB)) {
    return noMatch(`unparseable head version '${verB}'`);
  }
  if (verA === verB) return noMatch('no version change in package.json');

  // --- Condition 3: package.json is version-only -----------------------------
  // Literal (non-regex) replacement of `"version": "B"` -> `"version": "A"`.
  if (pkgHead.replaceAll(`"version": "${verB}"`, `"version": "${verA}"`) !== pkgBase) {
    return noMatch('non-version change in package.json');
  }

  // --- Condition 4: manifest differs only in the "." version value -----------
  if (changed.has('.release-please-manifest.json')) {
    const mfBase = show(mergeBase, '.release-please-manifest.json');
    const mfHead = show(head, '.release-please-manifest.json');
    if (parseJson(mfBase)?.['.'] !== verA) {
      return noMatch(`manifest "." at base is not '${verA}'`);
    }
    if (parseJson(mfHead)?.['.'] !== verB) {
      return noMatch(`manifest "." at head is not '${verB}'`);
    }
    if (mfHead.replaceAll(`"${verB}"`, `"${verA}"`) !== mfBase) {
      return noMatch('non-version change in .release-please-manifest.json');
    }
  }

  return { fastPath: true };
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirectRun) {
  const args = process.argv.slice(2);
  if (args.length < 1 || args.length > 2) {
    console.error('usage: release-pr-fast-path.mjs <base-ref-or-sha> [<head-ref-or-sha>]');
    process.exit(2);
  }
  let result;
  try {
    result = evaluateFastPath(args[0], args[1] ?? 'HEAD');
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : err}`);
    process.exit(2);
  }
  if (!result.fastPath) console.error(`release-pr-fast-path: no match: ${result.reason}`);
  console.log(`fast_path=${result.fastPath}`);
}
