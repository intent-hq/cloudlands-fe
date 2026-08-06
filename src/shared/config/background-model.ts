/**
 * Background Request Configuration
 *
 * Central configuration for background operations — lightweight tasks that
 * don't need to be shown in the UI:
 * - Note status checks (did the agent complete the task?)
 * - Quick validations
 * - Metadata extraction
 * - Other low-latency, low-cost operations
 *
 * There is intentionally NO hardcoded background model id: when the caller
 * does not supply one, `model` is omitted on the wire and the daemon/CLI
 * default applies (PROTOCOL §5.32).
 *
 * HOW TO USE:
 * Import `makeBackgroundRequest` from `./background-request.service` to make
 * one-off requests. Each request is a stateless daemon-side completion, so
 * there's no shared state or conversation history between requests.
 *
 * Example:
 *   import { makeBackgroundRequest } from '$features/agent/main/background-request.service';
 *
 *   const result = await makeBackgroundRequest({
 *     prompt: 'Is this task complete? Reply COMPLETE or NOT_COMPLETE.',
 *     systemPrompt: 'Be concise.',
 *   });
 *
 *   if (result.success && result.content?.includes('COMPLETE')) {
 *     // Handle completion
 *   }
 */

/**
 * Timeout for background requests in milliseconds.
 * Background requests should be fast, so we use a shorter timeout.
 */
export const BACKGROUND_REQUEST_TIMEOUT_MS = 30_000; // 30 seconds

/**
 * Maximum tokens for background requests.
 * Keep this low since we only need short responses.
 */
export const BACKGROUND_MAX_TOKENS = 500;
