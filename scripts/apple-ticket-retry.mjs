#!/usr/bin/env node
/**
 * Runs `xcrun stapler staple|validate` with backoff for Apple ticket-service outages.
 *
 * Exit 68 is stapler's network/service failure (NSURLErrorDomain -1005 "network
 * connection was lost" talking to api.apple-cloudkit.com, intent-hq/intent#7614);
 * only that exit is retried. Any other exit — e.g. 65 for a missing or invalid
 * ticket — fails on the first try, and exhausting every retry still fails, so the
 * signing/notarization guards keep their meaning.
 *
 * CLI: node scripts/apple-ticket-retry.mjs <staple|validate> <path/to/App.app>
 * APPLE_TICKET_RETRY_DELAYS_MS overrides the waits (comma-separated milliseconds).
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RETRYABLE_STAPLER_EXIT = 68;
export const DEFAULT_RETRY_DELAYS_MS = [30_000, 60_000, 120_000, 240_000];
const ACTIONS = new Set(['staple', 'validate']);

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

// Bounds one stapler call, as the isolated package verifier's 120s command timeout did.
const STAPLER_TIMEOUT_MS = 120_000;

function runXcrun(args) {
  const result = spawnSync('xcrun', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: STAPLER_TIMEOUT_MS,
  });
  const output = [result.stdout, result.stderr, result.error?.message].filter(Boolean).join('\n');
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  return { status: result.status, output };
}

const defaultSleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Resolves with the successful stapler output; rejects with a StaplerError otherwise. */
export async function runStaplerWithBackoff(action, appPath, options = {}) {
  if (!ACTIONS.has(action)) throw new Error(`Unsupported stapler action: ${action}`);
  const {
    run = runXcrun,
    sleep = defaultSleep,
    log = console.log,
    delaysMs = retryDelaysFromEnv(),
  } = options;
  const attempts = delaysMs.length + 1;
  const args = ['stapler', action, '-v', appPath];
  for (let attempt = 1; ; attempt++) {
    const { status, output } = run(args);
    if (status === 0) return output;
    if (status !== RETRYABLE_STAPLER_EXIT) {
      throw new StaplerError(
        `xcrun stapler ${action} failed with exit ${status} (not retried)\n\n${output}`,
        status,
        output,
      );
    }
    if (attempt === attempts) {
      log(
        `::error::Apple ticket ${action} still lost its connection to Apple after ${attempts} attempts (exit ${status}).`,
      );
      throw new StaplerError(
        `xcrun stapler ${action} failed with exit ${status} after ${attempts} attempts\n\n${output}`,
        status,
        output,
      );
    }
    const wait = delaysMs[attempt - 1];
    log(
      `::warning::Apple ticket ${action} attempt ${attempt}/${attempts} lost its connection to Apple (exit ${status}); retrying in ${wait / 1000}s.`,
    );
    await sleep(wait);
  }
}

async function main(argv) {
  const [action, appPath] = argv;
  if (!ACTIONS.has(action) || !appPath) {
    console.error('Usage: apple-ticket-retry.mjs <staple|validate> <path/to/App.app>');
    return 2;
  }
  try {
    await runStaplerWithBackoff(action, appPath);
    return 0;
  } catch (error) {
    console.error(error.message);
    return Number.isInteger(error.exitCode) && error.exitCode > 0 ? error.exitCode : 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
