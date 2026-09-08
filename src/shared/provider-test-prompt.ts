/**
 * Typed contract for the daemon's `host.providerTestPrompt` RPC (PROTOCOL
 * §5.14, v9.3): one live ephemeral test prompt ("say hello") driven through
 * the provider's real ACP adapter — the only conclusive end-to-end auth/setup
 * check (some providers serve local probes uncredentialed and only fail at
 * `session/prompt`).
 *
 * Result contract (never a wire error once the provider id is known): success
 * is `{ ok: true }`; failure is `{ ok: false, reason, message }`. On the
 * daemon a success promotes the cached `host.providerAuthStatus` verdict and
 * an `auth-required` failure demotes it, so callers should force an
 * auth-status refresh after an auth-required result to re-sync the UI.
 */

import { z } from 'zod';

export const PROVIDER_TEST_PROMPT_METHOD = 'host.providerTestPrompt';

/**
 * `host.providerTestPrompt` response. The documented failure `reason`
 * vocabulary is `unsupported | not-installed | spawn-failed | auth-required |
 * busy | timeout | error` (§5.14; `busy` is pre-spawn queueing pressure —
 * no provider was launched, back off and retry — kept distinct from
 * `timeout`, the provider itself blowing a setup/prompt budget), but
 * `reason` is validated as a non-empty string (not an enum) so a future
 * additive reason survives parsing — the FE maps unknown reasons to generic
 * copy instead of rejecting the payload. `.passthrough()` preserves unknown
 * fields per the PROTOCOL additive compatibility policy.
 */
export const ProviderTestPromptResponseSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }).passthrough(),
  z
    .object({
      ok: z.literal(false),
      reason: z.string().min(1),
      message: z.string(),
    })
    .passthrough(),
]);

export type ProviderTestPromptResult = z.infer<typeof ProviderTestPromptResponseSchema>;
