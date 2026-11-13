import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import type { ResolvedSpecialist } from './initial-agent-defaults';

const logger = createLogger('SpecialistDefaultPreviews');

/**
 * Daemon-resolved default-model previews per provider context (PROTOCOL
 * §5.11): `specialist.list` with a provider returns additive
 * `resolvedModel`/`resolvedProvider` fields computed by the same resolver a
 * no-model create uses, so a form names exactly the model the daemon would
 * pin. The store's specialist view carries the daemon-default-provider
 * context, so it serves as the fallback until a provider's fetch lands.
 */
export class SpecialistDefaultPreviews {
  byProvider = $state<Record<string, Record<string, ResolvedSpecialist>>>({});
  // Bumped on every invalidation; in-flight fetches from an older generation
  // are dropped so they can't overwrite fresher previews.
  #generation = 0;

  /** Forget every preview (the store's specialist view refreshed). */
  invalidate(): void {
    this.#generation += 1;
    this.byProvider = {};
  }

  /** Fetch a provider's previews unless they are already loaded. */
  load(provider: string): void {
    if (!provider || provider in this.byProvider) return;
    const generation = this.#generation;
    void (async () => {
      try {
        const defs = await appClient.specialists.list(provider);
        if (generation !== this.#generation || defs.length === 0) return;
        const byId: Record<string, ResolvedSpecialist> = {};
        for (const def of defs) byId[def.id] = def;
        this.byProvider = { ...this.byProvider, [provider]: byId };
      } catch (error) {
        logger.debug('Failed to fetch resolved-model previews:', { provider, error });
      }
    })();
  }
}
