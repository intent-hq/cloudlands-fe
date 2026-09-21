/**
 * Canonical FE model representation: an explicit provider, a bare model id
 * (never a `provider:model` compound string), and an optional reasoning
 * effort. The daemon hard-rejects compound model ids on the wire, so every
 * surface threads the parts explicitly instead of encoding the provider
 * into the model string.
 */
export interface ModelTriple {
  /** ACP provider id (e.g. `opencode`, `claude-code`). */
  providerId: string;
  /** Bare model id with no provider prefix (e.g. `claude-sonnet-4`). */
  modelId: string;
  /**
   * Reasoning-effort level for the model (provider-interpreted string, e.g.
   * "low"/"medium"/"high"). Omitted ⇒ the model's default effort.
   */
  reasoningEffort?: string;
}
