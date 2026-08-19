/**
 * Async Utilities for Main Process
 *
 * Provides async alternatives to synchronous operations to prevent
 * blocking the main thread and causing UI freezes (beach balls).
 *
 * Execution helpers (`execAsync`, `execFileAsync`) route through the
 * daemon's streaming exec seam (`host.execStream`,
 * PROTOCOL.md §5.14), frame-accumulating stdout/stderr and throwing on
 * non-zero exit with `.stdout` / `.stderr` / numeric `.code` — the same
 * G1 fidelity contract git-env exposes. `findExecutableAsync` /
 * `findVSCodeAsync` forward to `host.findBinary` via the shared
 * `findBinary` helper; `findAuggieAsync` delegates to the daemon-backed
 * `findAuggiePathAsync` (`host.checkAuggie`). The fs helpers below stay as
 * local promisified `fs` calls (not execution — untouched by this seam).
 */

import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../logger';
import { renameWithRetry } from './file-sync-utils';

const logger = new Logger('AsyncUtils');
export const existsAsync = async (filePath: string): Promise<boolean> => {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
};

/**
 * Find an executable in PATH or common locations asynchronously.
 * Delegates to shared `findBinary()`. Note: common path checks use
 * synchronous `fs.existsSync` which briefly blocks, but this is
 * negligible for the small number of paths checked.
 *
 * @param command - The command to find (e.g., 'code', 'auggie')
 * @param commonPaths - Optional list of common paths to check
 * @returns The path to the executable, or null if not found
 */
async function findExecutableAsync(
  command: string,
  commonPaths: string[] = [],
): Promise<string | null> {
  const { findBinary } = await import('./find-binary');
  const result = await findBinary(command, {
    commonPaths,
    timeout: 5000,
    useEnhancedPath: false,
    useLoginShell: false,
  });

  if (result) {
    logger.debug(`Found ${command} via shared findBinary`, { path: result });
  }

  return result;
}

/**
 * Common paths for VSCode on different platforms
 */
const VSCODE_COMMON_PATHS: string[] =
  process.platform === 'darwin'
    ? [
        '/usr/local/bin/code',
        '/opt/homebrew/bin/code',
        '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
      ]
    : process.platform === 'win32'
      ? [
          'C:\\Program Files\\Microsoft VS Code\\bin\\code.cmd',
          'C:\\Program Files (x86)\\Microsoft VS Code\\bin\\code.cmd',
        ]
      : ['/usr/bin/code', '/snap/bin/code'];

/**
 * Find VSCode executable asynchronously
 */
export async function findVSCodeAsync(): Promise<string | null> {
  return findExecutableAsync('code', VSCODE_COMMON_PATHS);
}

/**
 * Find the Auggie CLI asynchronously by delegating to the daemon-backed
 * `findAuggiePathAsync` (`host.checkAuggie`). The BE owns the settings
 * precedence (`context.auggiePath` → `providers.paths.auggie`) and the
 * canonical discovery (`~/.augment/bin/auggie`, enhanced-PATH scan) — no
 * local cache files or hardcoded install-path lists on this side.
 */
export async function findAuggieAsync(): Promise<string | null> {
  const { findAuggiePathAsync } = await import('../../features/auggie/main/auggie-path');
  return findAuggiePathAsync();
}

/**
 * Write JSON to file asynchronously with atomic write pattern
 */
export async function writeJsonAsync(
  filePath: string,
  data: unknown,
  options?: { spaces?: number },
): Promise<void> {
  const content = JSON.stringify(data, null, options?.spaces ?? 2);
  const dir = path.dirname(filePath);

  // Ensure directory exists (guard against Windows drive roots like C:\)
  if (dir && dir.length > 3 && !/^[A-Za-z]:\\?$/.test(dir)) {
    await fs.promises.mkdir(dir, { recursive: true });
  }

  // Write to temp file first, then rename (atomic)
  const tempPath = `${filePath}.tmp.${Date.now()}`;
  await fs.promises.writeFile(tempPath, content, 'utf-8');
  await renameWithRetry(tempPath, filePath);
}
