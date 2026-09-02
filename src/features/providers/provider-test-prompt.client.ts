/**
 * Provider Test Prompt Client
 *
 * Single renderer-side entry point for the daemon's live end-to-end provider
 * test prompt (`host.providerTestPrompt`, PROTOCOL §5.14). The daemon runs
 * one ephemeral ACP completion ("say hello") against the provider's adapter
 * and reports the structured outcome; the response is validated at the wire
 * boundary so a divergent payload fails loudly instead of being silently
 * absorbed.
 */

import { backendRequest } from '$lib/client/live/backend-transport';
import {
  PROVIDER_TEST_PROMPT_METHOD,
  ProviderTestPromptResponseSchema,
  type ProviderTestPromptResult,
} from '$shared/provider-test-prompt';

/**
 * Transport budget for the RPC. The daemon's own `session/prompt` budget is
 * 90s (sized to absorb a first-run npx download) on top of npx-aware staged
 * setup budgets, so the transport must wait well past the flat 30s default —
 * the daemon's structured `{ ok: false }` result (e.g. `timeout`) must win
 * over a transport timeout.
 */
const TEST_PROMPT_TIMEOUT_MS = 180_000;

/**
 * Run one live test prompt against `providerId`'s adapter. `model` is
 * optional — when omitted the daemon applies its resolved default exactly
 * like `agent.completeOnce`. Throws on wire/transport errors (unknown
 * provider, daemon unreachable); every runtime failure is a structured
 * `{ ok: false, reason, message }` result.
 */
export async function runProviderTestPrompt(params: {
  providerId: string;
  model?: string;
}): Promise<ProviderTestPromptResult> {
  const raw = await backendRequest(
    PROVIDER_TEST_PROMPT_METHOD,
    {
      providerId: params.providerId,
      ...(params.model ? { model: params.model } : {}),
    },
    { timeoutMs: TEST_PROMPT_TIMEOUT_MS },
  );
  return ProviderTestPromptResponseSchema.parse(raw);
}
