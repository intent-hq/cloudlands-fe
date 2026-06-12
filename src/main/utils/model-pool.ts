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

const PREFETCH_PROVIDER_IDS = ['auggie', 'claude-code', 'codex', 'opencode'] as const;

export function prefetchProviderModelCaches(providerIds: readonly string[] = PREFETCH_PROVIDER_IDS): void {
  for (const providerId of providerIds) {
    void hydrateProviderModelCacheFromDisk(providerId).then(() => {
      logger.debug('Provider model cache prefetch completed', {
        providerId,
      });
    });
  }
}

/**
 * Passively hydrate a provider's in-memory model cache from persisted disk data.
 *
 * Unlike `getCachedModelsForProvider`, this never performs live CLI/ACP probes.
 * It is safe to run at startup for providers the user has never enabled: if no
 * persisted cache file exists, the provider helper is a pure no-op.
 */
export async function hydrateProviderModelCacheFromDisk(providerId: string): Promise<void> {
  try {
    switch (providerId) {
      case 'auggie': {
        const { hydrateAuggieModelCacheFromDisk } = await import(
          '../../features/auggie/main/auggie.ipc'
        );
        await hydrateAuggieModelCacheFromDisk();
        return;
      }
      case 'claude-code': {
        const { hydrateClaudeCodeModelCacheFromDisk } = await import(
          '../../features/claude-code/main/claude-code.ipc'
        );
        await hydrateClaudeCodeModelCacheFromDisk();
        return;
      }
      case 'codex': {
        const { hydrateCodexModelCacheFromDisk } = await import(
          '../../features/codex/main/codex.ipc'
        );
        await hydrateCodexModelCacheFromDisk();
        return;
      }
      case 'opencode': {
        const { hydrateOpencodeModelCacheFromDisk } = await import(
          '../../features/opencode/main/opencode.ipc'
        );
        await hydrateOpencodeModelCacheFromDisk();
        return;
      }
      default:
        // Unknown / unsupported provider — cortex, mock, or typo. Nothing to hydrate.
        return;
    }
  } catch (error) {
    logger.debug('hydrateProviderModelCacheFromDisk dispatch failed', {
      providerId,
      error: (error as Error).message,
    });
  }
}

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
      case 'droid': {
        const { getCachedDroidModels } = await import(
          '../../features/droid/main/droid.ipc'
        );
        return await getCachedDroidModels();
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
