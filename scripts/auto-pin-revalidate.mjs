#!/usr/bin/env node
// auto-pin-revalidate.mjs — last-second race guard for auto-pin-intentd.yml
// (intent-hq/monorepo#4359).
//
// The workflow's checkout is the event snapshot of main, and its pin bump is
// built against the pin read from that snapshot. A previously queued rolling
// pin PR can squash-merge while the run is still working (the merge also
// deletes the rolling branch, so the workflow's remote-branch tree check never
// sees it), leaving the run to recreate an already-landed bump as a duplicate
// PR that defers the alpha cut. This script re-reads the pin from LIVE main
// immediately before the branch is published and decides whether the bump
// built from the snapshot is still the right thing to push.
//
// Usage: node scripts/auto-pin-revalidate.mjs --current <pin> --latest <pin>
//                                             [--remote origin] [--branch main]
//   <current> is the pin the run started from (the snapshot's intentd.version),
//   <latest> the alpha version the run is bumping to.
//
// Decision (main's pin is read from `<remote>/<branch>` after a fresh fetch):
//   - main pin == current  -> proceed=true  (nothing landed under us; publish)
//   - main pin == latest   -> proceed=false (the bump already landed on main)
//   - anything else        -> proceed=false (main moved to a different pin
//                             since the run started; a commit built on the
//                             stale snapshot would conflict or downgrade, so
//                             let the next run rebuild from a fresh checkout)
//
// Output contract (for CI):
//   - Prints `proceed=true|false` and `main_pin=<pin>` (GITHUB_OUTPUT lines)
//     and exits 0 whenever a decision was reached; the reason is logged to
//     stderr.
//   - Exits non-zero only on unexpected errors (fetch failure, unreadable pin
//     on main). Callers must treat a non-zero exit as "do not publish".

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseVersionPin } from './fetch-sidecar-lib.mjs';

const PIN_FILE = 'intentd.version';

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * Fetch `<remote>/<branch>` and compare its intentd.version pin with the pin
 * this run started from. Returns { proceed, mainPin, mainSha, reason }.
 * Throws on unexpected errors (fetch failure, unreadable pin on main).
 */
export function revalidateAgainstLiveMain({
  current,
  latest,
  cwd = process.cwd(),
  remote = 'origin',
  branch = 'main',
}) {
  try {
    git(cwd, 'fetch', '--quiet', remote, branch);
  } catch (err) {
    throw new Error(
      `cannot fetch ${remote}/${branch}: ${err instanceof Error ? err.message : err}`,
    );
  }
  const mainSha = git(cwd, 'rev-parse', '--verify', 'FETCH_HEAD^{commit}').trim();
  let mainPin;
  try {
    mainPin = parseVersionPin(git(cwd, 'show', `${mainSha}:${PIN_FILE}`));
  } catch (err) {
    throw new Error(
      `cannot read ${PIN_FILE} on ${remote}/${branch} (${mainSha}): ${err instanceof Error ? err.message : err}`,
    );
  }

  if (mainPin === current) {
    return {
      proceed: true,
      mainPin,
      mainSha,
      reason: `live ${remote}/${branch} still carries pin ${current}; bump to ${latest} is pending`,
    };
  }
  if (mainPin === latest) {
    return {
      proceed: false,
      mainPin,
      mainSha,
      reason: `pin ${latest} already landed on ${remote}/${branch} (${mainSha}) since this run started; nothing to publish`,
    };
  }
  return {
    proceed: false,
    mainPin,
    mainSha,
    reason: `pin on ${remote}/${branch} moved ${current} -> ${mainPin} since this run started (target ${latest}); skipping so the next run rebuilds from a fresh checkout`,
  };
}

function parseArgs(argv) {
  const opts = { remote: 'origin', branch: 'main' };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!['--current', '--latest', '--remote', '--branch'].includes(flag) || value === undefined) {
      return undefined;
    }
    opts[flag.slice(2)] = value;
    i += 1;
  }
  if (!opts.current || !opts.latest) return undefined;
  return opts;
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirectRun) {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts) {
    console.error(
      'usage: auto-pin-revalidate.mjs --current <pin> --latest <pin> [--remote origin] [--branch main]',
    );
    process.exit(2);
  }
  let result;
  try {
    result = revalidateAgainstLiveMain(opts);
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : err}`);
    process.exit(2);
  }
  console.error(`auto-pin-revalidate: ${result.reason}`);
  console.log(`proceed=${result.proceed}`);
  console.log(`main_pin=${result.mainPin}`);
}
