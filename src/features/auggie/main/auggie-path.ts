/**
 * Auggie path helpers — daemon-backed.
 *
 * Shared PATH / auggie-binary discovery used by `auggie.ipc.ts` (IPC handlers)
 * and `execute-auggie-command.ts` (CLI invocation). All probing is delegated
 * to the daemon: `getEnhancedPath()` returns the cached `host.env.enhancedPath`
 * (see `shared/main/find-binary.ts#initializeHostEnv`) so synchronous callers
 * still get an authoritative PATH, and `findAuggiePathAsync()` /
 * `findAuggieInEnhancedPath()` both delegate to `host.checkAuggie`.
 *
 * Lives in its own module to avoid the circular import that previously existed
 * between `auggie.ipc.ts` and `execute-auggie-command.ts`.
 */

import { existsSync } from 'fs';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Logger } from '../../../shared/logger';
import { getEnhancedPath as getHostEnhancedPath } from '../../../shared/main/find-binary';
import { getBackendClient } from '../../backend/main/backend.ipc';

const logger = new Logger('AuggiePath');

/**
 * Return the daemon's enhanced PATH (sourced via `host.env`). No local shell
 * profile parsing, NVM directory scans, or `existsSync` probes — every PATH
 * entry is what the daemon reports for the host the workspace targets.
 */
export function getEnhancedPath(): string {
  return getHostEnhancedPath();
}

export async function saveAuggiePath(auggiePath: string): Promise<void> {
  const savedPathFile = path.join(os.homedir(), '.augment', 'auggie-path');
  const augmentDir = path.join(os.homedir(), '.augment');

  try {
    if (!existsSync(augmentDir)) {
      await fs.mkdir(augmentDir, { recursive: true });
    }

    await fs.writeFile(savedPathFile, auggiePath, 'utf8');
    logger.debug('Saved auggie path to file', { file: savedPathFile });

    // Verify the file is immediately readable (handles file system sync delays)
    for (let verifyAttempt = 0; verifyAttempt < 5; verifyAttempt++) {
      try {
        const verifyContent = await fs.readFile(savedPathFile, 'utf8');
        if (verifyContent.trim() === auggiePath) {
          logger.debug('Verified saved auggie path file is readable', {
            attempt: verifyAttempt + 1,
          });
          break;
        }
      } catch (verifyError) {
        logger.debug('File not yet readable, retrying', {
          attempt: verifyAttempt + 1,
          error: (verifyError as Error).message,
        });
      }

      if (verifyAttempt < 4) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
  } catch (error) {
    logger.debug('Could not save auggie path', { error: (error as Error).message });
  }
}

/**
 * Resolve the auggie binary path by delegating to the daemon host
 * (`host.checkAuggie`). The BE applies the settings precedence
 * (`context.auggiePath` → `providers.paths.auggie`) and falls back to the
 * canonical discovery (Intent-managed binary at `~/.augment/bin/auggie`,
 * then a scan of the enhanced PATH including nvm/fnm/volta/asdf/homebrew).
 *
 * Return contract is unchanged (`string | null`) so existing consumers in
 * `provider-availability.service.ts`, `acp-provider.ts`, and the spawn
 * helpers in `execute-auggie-command.ts` keep working without changes.
 */
export async function findAuggiePathAsync(): Promise<string | null> {
  try {
    const result = await getBackendClient().request<{
      available: boolean;
      path?: string;
      version?: string;
    }>('host.checkAuggie');
    if (result?.available && typeof result.path === 'string' && result.path.trim()) {
      const resolved = result.path.trim();
      logger.info('Resolved auggie via host.checkAuggie', { path: resolved });
      return resolved;
    }
    logger.debug('host.checkAuggie reported auggie unavailable');
    return null;
  } catch (error) {
    logger.warn('host.checkAuggie failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Backwards-compatible alias for the daemon-backed `findAuggiePathAsync()`.
 * Pre-host-services this routine temporarily mutated `process.env.PATH` to
 * include NVM/FNM/Volta/Homebrew dirs before invoking `findBinary`; the daemon
 * now owns that scan, so the FE just forwards the request.
 */
export async function findAuggieInEnhancedPath(): Promise<string | null> {
  return findAuggiePathAsync();
}
