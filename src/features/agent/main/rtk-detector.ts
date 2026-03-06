/**
 * RTK Detector
 *
 * Detects whether the `rtk` CLI tool is installed and parses its available
 * subcommands. When the user has enabled the rtk setting, generates a system
 * prompt instruction that tells agents to prefix supported commands with `rtk`.
 */

import { execAsync } from '../../../shared/main/async-utils';
import { getSetting } from '../../workspace/main/app-settings.service';
import { Logger } from '../../../shared/logger';

const logger = new Logger('RtkDetector');

// ── Types ──────────────────────────────────────────────────────────────────

export interface RtkStatus {
  available: boolean;
  subcommands?: string[];
}

// ── Module-level cache ─────────────────────────────────────────────────────

let cachedStatus: RtkStatus | null = null;
let detectPromise: Promise<RtkStatus> | null = null;

// ── Excluded commands ──────────────────────────────────────────────────────

/** rtk-internal / meta commands that shouldn't be used as prefixes */
const RTK_INTERNAL_COMMANDS = new Set([
  'smart',
  'err',
  'summary',
  'init',
  'config',
  'gain',
  'cc-economics',
  'discover',
  'learn',
  'proxy',
  'verify',
  'hook-audit',
  'rewrite',
  'help',
]);

/** Commands that conflict with shell builtins or are too generic */
const CONFLICTING_COMMANDS = new Set([
  'read',
  'test',
  'json',
  'deps',
  'env',
  'log',
  'lint',
  'format',
  'next',
]);

// ── Detection ──────────────────────────────────────────────────────────────

/**
 * Detect whether rtk is installed and parse its subcommands.
 * Results are cached — only runs detection once per app session.
 */
export async function detectRtk(): Promise<RtkStatus> {
  if (cachedStatus) return cachedStatus;
  if (detectPromise) return detectPromise;

  detectPromise = doDetect();
  cachedStatus = await detectPromise;
  detectPromise = null;
  return cachedStatus;
}

async function doDetect(): Promise<RtkStatus> {
  try {
    // 1. Check if rtk exists
    const whichCmd = process.platform === 'win32' ? 'where rtk' : 'which rtk';
    await execAsync(whichCmd, { timeout: 5000 });

    // 2. Parse subcommands from `rtk help`
    const { stdout } = await execAsync('rtk help', { timeout: 10000 });
    const subcommands = parseRtkHelp(stdout);

    logger.info('rtk detected', { subcommandCount: subcommands.length });
    return { available: true, subcommands };
  } catch {
    logger.debug('rtk not available');
    return { available: false };
  }
}

/**
 * Parse the `Commands:` section of `rtk help` output.
 * Each command line looks like: `  ls             List directory...`
 */
export function parseRtkHelp(output: string): string[] {
  const lines = output.split('\n');
  let inCommands = false;
  const subcommands: string[] = [];

  for (const line of lines) {
    if (/^(Commands|Available Commands):?\s*$/i.test(line.trim())) {
      inCommands = true;
      continue;
    }
    // End of commands section on blank line or new section header
    if (inCommands && (line.trim() === '' || /^[A-Z]/.test(line.trim()))) {
      if (subcommands.length > 0) break;
      continue;
    }
    if (inCommands) {
      const match = line.match(/^\s{2,}(\S+)/);
      if (match) {
        const cmd = match[1];
        if (!RTK_INTERNAL_COMMANDS.has(cmd) && !CONFLICTING_COMMANDS.has(cmd)) {
          subcommands.push(cmd);
        }
      }
    }
  }

  return subcommands;
}

// ── Synchronous accessors ──────────────────────────────────────────────────

/**
 * Get the cached rtk status. Returns `{ available: false }` if detection
 * hasn't completed yet.
 */
export function getRtkStatus(): RtkStatus {
  return cachedStatus ?? { available: false };
}

/**
 * Build the system-prompt instruction line when rtk is enabled and available.
 * Returns `null` when the feature is off or rtk isn't installed.
 */
export function getRtkPromptInstruction(): string | null {
  const enabled = getSetting<boolean>('rtkEnabled', false);
  if (!enabled) return null;

  const status = getRtkStatus();
  if (!status.available || !status.subcommands || status.subcommands.length === 0) return null;

  return `Prefix these commands with rtk for compressed, LLM-friendly output: ${status.subcommands.join(', ')}`;
}

