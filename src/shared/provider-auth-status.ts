/**
 * Typed contract for the daemon's `host.providerAuthStatus` RPC
 * (intent-hq/intentd#339, PROTOCOL §5.14 companion).
 *
 * The daemon owns every provider auth/readiness probe (CLI probes, ACP stdio
 * probes, output-marker parsing, caching); the FE only consumes the verdicts.
 * Transport-agnostic: the main process calls it via `getBackendClient()`
 * (see `shared/main/provider-auth-status.ts`) and the renderer mock-router
 * build via `backendRequest`.
 */

export const PROVIDER_AUTH_STATUS_METHOD = 'host.providerAuthStatus';

export interface ProviderAuthStatusParams {
  /** Restrict the probe to one provider; omit for a full sweep. */
  providerId?: string;
  /** Bypass the daemon's result cache (must be a boolean when present). */
  force?: boolean;
}

export interface ProviderAuthStatusEntry {
  id: string;
  /**
   * true = authenticated/ready, false = explicitly not authenticated,
   * null = unknown (not installed, probe failed, or timed out).
   */
  authenticated: boolean | null;
}

export interface ProviderAuthStatusResponse {
  providers: ProviderAuthStatusEntry[];
}

/**
 * Build the wire params, omitting absent fields so the daemon's strict
 * validation (`force` must be a boolean, unknown `providerId` → -32602)
 * only ever sees intentional values.
 */
export function buildProviderAuthStatusParams(
  options: ProviderAuthStatusParams = {},
): ProviderAuthStatusParams {
  const params: ProviderAuthStatusParams = {};
  if (typeof options.providerId === 'string' && options.providerId.length > 0) {
    params.providerId = options.providerId;
  }
  if (typeof options.force === 'boolean') {
    params.force = options.force;
  }
  return params;
}

/**
 * Fold a response into an id → verdict map, mapping the wire `null`
 * ("unknown") to `undefined` so `ProviderStatus.authenticated` renders no
 * indicator for unknowns.
 */
export function toAuthVerdictMap(
  response: ProviderAuthStatusResponse | null | undefined,
): Record<string, boolean | undefined> {
  const map: Record<string, boolean | undefined> = {};
  for (const entry of response?.providers ?? []) {
    map[entry.id] = entry.authenticated ?? undefined;
  }
  return map;
}
