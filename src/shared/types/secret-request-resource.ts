/**
 * Agent secret request resource (PROTOCOL §5.56). The daemon attaches one
 * trailing `resource` block per `ws.secret.request` call to the turn's final
 * assistant message. The payload names the secret only — it never carries a
 * value. Cards render in the composer slot (see `pending-secret-requests`),
 * never in the transcript, so transcript renderers strip these blocks with
 * `isSecretRequestResourceBlock`.
 */
export const SECRET_REQUEST_RESOURCE_MIME_TYPE = 'application/vnd.intent.secret-request+json';

export interface SecretRequest {
  /** Daemon-minted request id (`sec-…`); keys the card and `secret.provide`. */
  requestId: string;
  /** The agent that asked; only it can use the secret. */
  agentId: string;
  /** Secret name, e.g. `OPENROUTER_API_KEY`. */
  name: string;
  /** Why the agent needs it, shown on the card. */
  reason: string;
}

function isSecretRequest(value: unknown): value is SecretRequest {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SecretRequest>;
  return (
    typeof candidate.requestId === 'string' &&
    candidate.requestId.length > 0 &&
    typeof candidate.agentId === 'string' &&
    typeof candidate.name === 'string' &&
    candidate.name.length > 0 &&
    typeof candidate.reason === 'string'
  );
}

/**
 * Whether a content block is a secret-request resource block. MIME-only: a
 * malformed payload must not reach the transcript either.
 */
export function isSecretRequestResourceBlock(block: unknown): boolean {
  if (!block || typeof block !== 'object') return false;
  const candidate = block as { type?: unknown; resource?: unknown };
  if (candidate.type !== 'resource') return false;
  const resource = candidate.resource as { mimeType?: unknown } | null | undefined;
  return (
    typeof resource === 'object' &&
    resource !== null &&
    resource.mimeType === SECRET_REQUEST_RESOURCE_MIME_TYPE
  );
}

/** The request carried by a secret-request resource block, or null. */
export function getSecretRequestFromResourceBlock(block: unknown): SecretRequest | null {
  if (!isSecretRequestResourceBlock(block)) return null;
  const text = (block as { resource: { text?: unknown } }).resource.text;
  if (typeof text !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return isSecretRequest(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** How an answered request ended. */
export type SecretRequestOutcome = 'provided' | 'declined';

/** `secret.list` result for one agent: names only, never values. */
export interface SecretListing {
  secrets: { name: string }[];
  pendingRequests: { requestId: string; name: string }[];
  answeredRequests: { requestId: string; name: string; outcome: SecretRequestOutcome }[];
}

/**
 * One agent's latest `secret.list` as the cards need it. `covered` holds every
 * request id the transcript showed when a listing was requested: the daemon
 * had already created those, so a later listing that lacks one proves it is
 * gone. `failed` is set when the latest refresh failed.
 */
export interface AgentSecretListing {
  listing: SecretListing | null;
  covered: readonly string[];
  failed: boolean;
}

/** Result of `secret.provide` / `secret.dismiss` as the card needs it. */
export type SecretAnswerResult =
  | { ok: true }
  | {
      ok: false;
      /** The request is no longer pending (`secret-request-unknown`). */
      expired: boolean;
      error: string;
    };

function nameOnly(value: unknown): value is { name: string } {
  return (
    !!value && typeof value === 'object' && typeof (value as { name?: unknown }).name === 'string'
  );
}

function pendingEntry(value: unknown): value is { requestId: string; name: string } {
  return nameOnly(value) && typeof (value as { requestId?: unknown }).requestId === 'string';
}

function answeredEntry(
  value: unknown,
): value is { requestId: string; name: string; outcome: SecretRequestOutcome } {
  const outcome = (value as { outcome?: unknown } | null)?.outcome;
  return pendingEntry(value) && (outcome === 'provided' || outcome === 'declined');
}

/** Validate a `secret.list` response; malformed entries are dropped. */
export function parseSecretListing(value: unknown): SecretListing | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const list = (key: string): unknown[] => (Array.isArray(raw[key]) ? (raw[key] as unknown[]) : []);
  return {
    secrets: list('secrets')
      .filter(nameOnly)
      .map(({ name }) => ({ name })),
    pendingRequests: list('pendingRequests')
      .filter(pendingEntry)
      .map(({ requestId, name }) => ({ requestId, name })),
    answeredRequests: list('answeredRequests')
      .filter(answeredEntry)
      .map(({ requestId, name, outcome }) => ({ requestId, name, outcome })),
  };
}
