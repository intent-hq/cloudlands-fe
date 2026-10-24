#!/usr/bin/env node
/**
 * Runs `xcrun stapler staple|validate` with backoff for Apple ticket-service outages.
 *
 * Exit 68 is stapler's network/service failure (NSURLErrorDomain -1005 "network
 * connection was lost" talking to api.apple-cloudkit.com, intent-hq/intent#7614);
 * only that exit — or a call stalled past the per-call timeout — is retried. Any
 * other exit, e.g. 65 for a missing or invalid ticket, fails on the first try, and
 * exhausting every retry still fails, so the signing/notarization guards keep
 * their meaning.
 *
 * CLI: node scripts/apple-ticket-retry.mjs <staple|validate> <path/to/App.app>
 * APPLE_TICKET_RETRY_DELAYS_MS overrides the waits (comma-separated milliseconds).
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RETRYABLE_STAPLER_EXIT = 68;
export const DEFAULT_RETRY_DELAYS_MS = [30_000, 60_000, 120_000, 240_000];
export const STAPLER_TIMEOUT_MS = 120_000;
// Same flags as before: @electron/notarize staples with -v; validation never used it.
const ACTION_ARGS = { staple: ['-v'], validate: [] };

export class StaplerError extends Error {
  constructor(message, exitCode, output) {
    super(message);
    this.name = 'StaplerError';
    this.exitCode = exitCode;
    this.output = output;
  }
}

export function retryDelaysFromEnv(env = process.env) {
  const raw = env.APPLE_TICKET_RETRY_DELAYS_MS;
  if (raw === undefined || raw.trim() === '') return [...DEFAULT_RETRY_DELAYS_MS];
  return raw.split(',').map((part) => {
    const value = part.trim();
    if (!/^\d+$/.test(value))
      throw new Error(
        `APPLE_TICKET_RETRY_DELAYS_MS must be comma-separated non-negative integers, got "${raw}"`,
      );
    return Number(value);
  });
}

function runXcrun(args) {
  const result = spawnSync('xcrun', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: STAPLER_TIMEOUT_MS,
  });
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    output: [result.stdout, result.stderr, result.error?.message].filter(Boolean).join('\n'),
    timedOut: result.error?.code === 'ETIMEDOUT',
  };
}

const defaultSleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * Resolves with the successful stapler stdout; rejects with a StaplerError otherwise.
 * `afterFailure: true` means the caller already saw one retryable failure, so the
 * first call waits out the first delay instead of hitting Apple immediately again.
 */
export async function runStaplerWithBackoff(action, appPath, options = {}) {
  if (!Object.hasOwn(ACTION_ARGS, action)) throw new Error(`Unsupported stapler action: ${action}`);
  const {
    run = runXcrun,
    sleep = defaultSleep,
    log = console.log,
    delaysMs = retryDelaysFromEnv(),
    afterFailure = false,
  } = options;
  const attempts = delaysMs.length + 1;
  const args = ['stapler', action, ...ACTION_ARGS[action], appPath];
  for (let attempt = afterFailure ? 2 : 1; attempt <= attempts; attempt++) {
    if (attempt > 1) await sleep(delaysMs[attempt - 2]);
    const { status, stdout = '', output, timedOut = false } = run(args);
    if (status === 0) return stdout;
    const reason = timedOut ? `timed out after ${STAPLER_TIMEOUT_MS / 1000}s` : `exit ${status}`;
    if (status !== RETRYABLE_STAPLER_EXIT && !timedOut)
      throw new StaplerError(
        `xcrun stapler ${action} failed with ${reason} (not retried)`,
        status,
        output,
      );
    if (attempt === attempts) {
      const message = `Apple ticket ${action} still could not reach Apple after ${attempts} attempts (${reason}).`;
      log(`::error::${message}`);
      throw new StaplerError(message, status, output);
    }
    log(
      `::warning::Apple ticket ${action} attempt ${attempt}/${attempts} could not reach Apple (${reason}); retrying in ${delaysMs[attempt - 1] / 1000}s.`,
    );
  }
  // Only reachable with afterFailure and no delays: never report an unstapled app as passing.
  throw new StaplerError(`xcrun stapler ${action} had no retry attempts left`, null, '');
}

async function main(argv) {
  const [action, appPath] = argv;
  if (!Object.hasOwn(ACTION_ARGS, action ?? '') || !appPath) {
    console.error('Usage: apple-ticket-retry.mjs <staple|validate> <path/to/App.app>');
    return 2;
  }
  try {
    await runStaplerWithBackoff(action, appPath);
    return 0;
  } catch (error) {
    // The stapler output was already streamed; repeat only the summary.
    console.error(error.message);
    return Number.isInteger(error.exitCode) && error.exitCode > 0 ? error.exitCode : 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
