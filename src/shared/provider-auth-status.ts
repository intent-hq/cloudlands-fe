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

/**
 * Additive identity metadata a logged-in probe captured (protocol 9.4,
 * intent-hq/intentd#1685). Present only when at least one field survived the
 * daemon's trimming; pre-9.4 daemons never send it.
 */
export interface ProviderAuthIdentity {
  email?: string;
  orgName?: string;
  subscriptionType?: string;
}

interface ProviderAuthStatusEntry {
  id: string;
  /**
   * true = authenticated/ready, false = explicitly not authenticated,
   * null = unknown (not installed, probe failed, or timed out).
   */
  authenticated: boolean | null;
  identity?: ProviderAuthIdentity;
}

export interface ProviderAuthStatusResponse {
  providers: ProviderAuthStatusEntry[];
}

/** One provider's folded verdict: the auth flag plus the rendered identity line. */
export interface ProviderAuthVerdict {
  /** `undefined` for the wire's `null` (unknown). */
  authenticated: boolean | undefined;
  /** {@link formatProviderIdentity} of the wire identity, when it yields text. */
  authDetails?: string;
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

function nonEmpty(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Whether an org name is just the email itself or its email-derived default
 * (e.g. Claude's "x@y.com's Organization") and therefore adds no signal next
 * to the email.
 */
function isEmailDerivedOrg(email: string, orgName: string): boolean {
  const org = orgName.toLowerCase();
  const address = email.toLowerCase();
  if (!org.startsWith(address)) return false;
  return /^((['’]s)?\s*organization)?$/.test(org.slice(address.length).trim());
}

/**
 * Render the identity line for `ProviderStatus.authDetails`: the email, plus
 * the org name only when it carries signal beyond the email ("email · org").
 * An email-derived default org collapses to the email alone; with no email
 * the org name stands in. `undefined` when nothing renders.
 */
export function formatProviderIdentity(
  identity: ProviderAuthIdentity | null | undefined,
): string | undefined {
  const email = nonEmpty(identity?.email);
  const orgName = nonEmpty(identity?.orgName);
  if (email && orgName) {
    return isEmailDerivedOrg(email, orgName) ? email : `${email} · ${orgName}`;
  }
  return email ?? orgName;
}

/**
 * Fold a response into an id → verdict map, mapping the wire `null`
 * ("unknown") to `undefined` so `ProviderStatus.authenticated` renders no
 * indicator for unknowns. The optional wire `identity` is rendered via
 * {@link formatProviderIdentity} into `authDetails`; entries without it (or
 * from pre-9.4 daemons) carry no `authDetails` key.
 */
export function toAuthVerdictMap(
  response: ProviderAuthStatusResponse | null | undefined,
): Record<string, ProviderAuthVerdict> {
  const map: Record<string, ProviderAuthVerdict> = {};
  for (const entry of response?.providers ?? []) {
    const verdict: ProviderAuthVerdict = { authenticated: entry.authenticated ?? undefined };
    const authDetails = formatProviderIdentity(entry.identity);
    if (authDetails !== undefined) verdict.authDetails = authDetails;
    map[entry.id] = verdict;
  }
  return map;
}
