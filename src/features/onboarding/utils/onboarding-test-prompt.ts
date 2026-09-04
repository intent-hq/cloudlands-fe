/**
 * Onboarding "Send a test prompt" helpers: the `supportsTestPrompt` catalog
 * gate and the failure-reason → actionable-guidance mapping rendered on the
 * welcome step when `host.providerTestPrompt` reports `{ ok: false }`.
 *
 * The auth-required branch mirrors `selectProviderAuthFailureGuidance`
 * (provider-catalog selectors): the catalog `loginCommandHint` with the
 * `<command> login` fallback, plus the claude-code desktop-app caveat.
 */

import { m } from '$shared/paraglide/messages.js';
import type { ProviderCatalogEntry } from '$shared/provider-catalog';

/**
 * Whether the provider's catalog row opts into the live test prompt. The
 * flag is always present on rows from a v9.3+ daemon; absence (older daemon
 * without the RPC) is treated as unsupported so the checkbox never offers a
 * test the daemon cannot run.
 */
export function providerSupportsTestPrompt(entry: ProviderCatalogEntry | undefined): boolean {
  return entry?.supportsTestPrompt === true;
}

/** Actionable guidance for one structured test-prompt failure. */
export interface TestPromptFailureGuidance {
  /** User-facing summary of what went wrong. */
  message: string;
  /** auth-required only: login command to surface (with copy affordance). */
  loginCommandHint?: string;
  /** auth-required only: catalog docs link, when present. */
  loginDocsUrl?: string;
  /** claude-code only: desktop-app sign-in does not carry over to the CLI. */
  showClaudeDesktopNote: boolean;
  /** True for auth-required — callers force an auth-status refresh. */
  isAuthRequired: boolean;
}

/**
 * Map a structured `{ ok: false, reason, message }` result to rendered
 * guidance. `reason` is typed as string so future additive reasons fall
 * through to the generic branch instead of failing.
 */
export function mapTestPromptFailure(
  failure: { reason: string; message: string },
  entry: ProviderCatalogEntry | undefined,
  providerId: string,
): TestPromptFailureGuidance {
  const name = entry?.displayName ?? providerId;
  const base = { showClaudeDesktopNote: false, isAuthRequired: false };
  switch (failure.reason) {
    case 'auth-required':
      return {
        message: m.onboarding_testPrompt_authRequired_error({ name }),
        loginCommandHint: entry?.loginCommandHint || `${entry?.command ?? providerId} login`,
        loginDocsUrl: entry?.loginDocsUrl,
        showClaudeDesktopNote: providerId === 'claude-code',
        isAuthRequired: true,
      };
    case 'busy':
      return { ...base, message: m.onboarding_testPrompt_busy_error() };
    case 'timeout':
      return { ...base, message: m.onboarding_testPrompt_timeout_error({ name }) };
    case 'not-installed':
      return {
        ...base,
        message: m.onboarding_testPrompt_notInstalled_error({ name, message: failure.message }),
      };
    case 'unsupported':
      return { ...base, message: m.onboarding_testPrompt_unsupported_error({ name }) };
    default:
      // spawn-failed, error, and any future additive reason.
      return {
        ...base,
        message: m.onboarding_testPrompt_generic_error({ message: failure.message }),
      };
  }
}
