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

/**
 * Resolve the auggie binary path by delegating to the daemon host
 * (`host.checkAuggie`). The BE applies the settings precedence
 * (`context.auggiePath` → `providers.paths.auggie`) and falls back to the
 * canonical discovery (Intent-managed binary at `~/.augment/bin/auggie`,
 * then a scan of the enhanced PATH including nvm/fnm/volta/asdf/homebrew).
 *
 * Return contract is unchanged (`string | null`) so existing consumers in
 * `provider-availability.service.ts` and the spawn
 * helpers in `execute-auggie-command.ts` keep working without changes.
 */
export async function findAuggiePathAsync(): Promise<string | null> {
  try {
    const result = await getBackendClient().request<{
      available: boolean;
      path?: string;
    }>('host.checkAuggie');
    if (result?.available && typeof result.path === 'string' && result.path.trim()) {
      return result.path.trim();
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
