/**
 * Main-side dispatcher for provider model lists.
 *
 * The daemon owns per-provider model probing and caching (`models.list
 * { providerId }`, PROTOCOL §6.7); this module exposes a single
 * `getCachedModelsForProvider(providerId)` entry point so main-process code
 * (notably the model-override validator in `agent-interaction-tools.ts`) can
 * read the live list without importing from a feature's `main/` subtree
 * directly — preserving the module boundary rule that cross-feature code
 * should go through a shared utility rather than reaching into a peer
 * feature's internals.
 *
 * Return contract:
 *   - `string[]` (possibly empty) when the daemon produced a definitive list.
 *   - `null` when the live list is unavailable (daemon unreachable, provider
 *     served a static/warning fallback with no rows, etc.). Callers should
 *     treat `null` as "unknown — skip validation" rather than "empty list —
 *     reject everything".
 */

import { Logger } from '../../shared/logger';
import { listProviderModels } from './daemon-model-catalog';

const logger = new Logger('ModelPoolDispatcher');

const KNOWN_PROVIDER_IDS = new Set([
  'auggie',
  'claude-code',
  'codex',
  'opencode',
  'pi',
  'droid',
  'cortex',
]);

/**
 * Look up the daemon-cached live model IDs for a provider.
 *
 * Returns bare model value strings — the same `value` field each provider's
 * `GET_MODELS` IPC handler returns (e.g. `sonnet4.6`, `gpt-5.3-codex/high`,
 * `openai/gpt-5.2`, `default`). Compound `<provider>:<model>` qualification
 * is the caller's responsibility.
 *
 * Unknown provider IDs return `null` (so the caller falls back through its
 * existing no-live-list pathway). A daemon result with zero rows also folds
 * to `null`: the daemon degrades probe failures to empty-list + `warning`
 * rather than erroring, so an empty catalog is indistinguishable from
 * "unavailable" here — skipping validation is the safe interpretation.
 */
export async function getCachedModelsForProvider(
  providerId: string,
): Promise<string[] | null> {
  if (!KNOWN_PROVIDER_IDS.has(providerId)) {
    // Unknown / unsupported provider — mock, or typo. Skip live validation
    // so the caller falls through its existing path.
    return null;
  }

  try {
    const catalog = await listProviderModels(providerId);
    if (catalog.models.length === 0) return null;
    return catalog.models.map((m) => m.value);
  } catch (error) {
    logger.debug('getCachedModelsForProvider daemon read failed', {
      providerId,
      error: (error as Error).message,
    });
    return null;
  }
}
