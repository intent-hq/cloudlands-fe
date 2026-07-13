/**
 * Background Model Configuration
 *
 * Central configuration for cheap/fast models used for background operations.
 * These models are used for lightweight tasks that don't need to be shown in the UI:
 * - Note status checks (did the agent complete the task?)
 * - Quick validations
 * - Metadata extraction
 * - Other low-latency, low-cost operations
 *
 * HOW TO USE:
 * Import `makeBackgroundRequest` from `./background-request.service` to make
 * one-off requests. Each request creates a fresh ACP provider, so there's no
 * shared state or conversation history between requests.
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

import { MODEL_DEFAULTS } from '$shared/constants/agent-services';

/**
 * The model ID to use for background requests.
 * Uses MODEL_DEFAULTS.BACKGROUND_REQUEST_MODEL as the single source of truth.
 * Currently set to Haiku for fast, cheap, reliable background operations.
 */
export const BACKGROUND_MODEL_ID = MODEL_DEFAULTS.BACKGROUND_REQUEST_MODEL;

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
