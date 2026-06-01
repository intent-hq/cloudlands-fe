/**
 * Main-side dispatcher for provider model-list caches.
 *
 * Each ACP provider's IPC handler module owns its own TTL cache around the
 * shell-out / probe that fetches live models. This module exposes a single
 * `getCachedModelsForProvider(providerId)` entry point so main-process code
 * (notably the model-override validator in `agent-interaction-tools.ts`) can
 * read the live list without importing from a feature's `main/` subtree
 * directly — preserving the module boundary rule that cross-feature code
 * should go through a shared utility rather than reaching into a peer
 * feature's internals.
 *
 * Return contract:
 *   - `string[]` (possibly empty) when the cache / live fetch produced a
 *     definitive list.
 *   - `null` when the live list is unavailable (provider not installed,
 *     CLI failed, etc.). Callers should treat `null` as "unknown — skip
 *     validation" rather than "empty list — reject everything".
 */

import { Logger } from '../../shared/logger';

const logger = new Logger('ModelPoolDispatcher');

/**
 * Look up the cached (or freshly fetched) live model IDs for a provider.
 *
 * Returns bare model value strings — the same `value` field each provider's
 * `GET_MODELS` IPC handler returns (e.g. `sonnet4.6`, `gpt-5.3-codex/high`,
 * `openai/gpt-5.2`, `default`). Compound `<provider>:<model>` qualification
 * is the caller's responsibility.
 *
 * Unknown provider IDs return `null` (so the caller falls back through its
 * existing no-live-list pathway).
 */
export async function getCachedModelsForProvider(
  providerId: string,
): Promise<string[] | null> {
  try {
    switch (providerId) {
      case 'auggie': {
        const { getCachedAuggieModels } = await import(
          '../../features/auggie/main/auggie.ipc'
        );
        return await getCachedAuggieModels();
      }
      case 'claude-code': {
        const { getCachedClaudeCodeModels } = await import(
          '../../features/claude-code/main/claude-code.ipc'
        );
        return await getCachedClaudeCodeModels();
      }
      case 'codex': {
        const { getCachedCodexModels } = await import(
          '../../features/codex/main/codex.ipc'
        );
        return await getCachedCodexModels();
      }
      case 'opencode': {
        const { getCachedOpencodeModels } = await import(
          '../../features/opencode/main/opencode.ipc'
        );
        return await getCachedOpencodeModels();
      }
      default:
        // Unknown / unsupported provider — cortex, mock, or typo. Skip live
        // validation so the caller falls through its existing path.
        return null;
    }
  } catch (error) {
    logger.debug('getCachedModelsForProvider dispatch failed', {
      providerId,
      error: (error as Error).message,
    });
    return null;
  }
}
