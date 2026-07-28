/**
 * Intent-based Slug Generator
 *
 * Generates workspace slugs based on user intent using a quick LLM call.
 * Falls back to random slugs if the LLM call fails or times out.
 *
 * Format: word-word (e.g., "auth-refactor", "api-tests")
 * Collision handling (adding numeric suffix) is done by the workspace service.
 *
 * NOTE: This module is MAIN PROCESS ONLY. It uses makeBackgroundRequest
 * which spawns auggie processes and cannot run in the renderer.
 */

import { Logger } from '$shared/logger';
import {
  makeBackgroundRequest,
  type BackgroundRequestResult,
} from '$features/agent/main/background-request.service';

const logger = new Logger('IntentSlugGenerator');

// Very short timeout for slug generation - this should be fast
const SLUG_GENERATION_TIMEOUT_MS = 5_000;

/**
 * Generate a workspace slug based on user intent.
 *
 * Uses a quick LLM call to extract 2 meaningful words from the user's intent.
 * Returns null if generation fails - caller should fall back to random slug.
 *
 * @param intent - The user's initial prompt/intent for the workspace
 * @returns A slug like "auth-refactor" (without suffix) or null if failed
 */
export async function generateIntentBasedSlug(intent: string): Promise<string | null> {
  if (!intent || intent.trim().length < 5) {
    logger.debug('Intent too short for slug generation', { length: intent?.length });
    return null;
  }

  try {
    const truncatedIntent = intent.length > 200 ? `${intent.slice(0, 200)}...` : intent;

    const result: BackgroundRequestResult = await makeBackgroundRequest({
      // i18n-ignore (LLM prompt content)
      prompt: `Task: "${truncatedIntent}"

Extract a 2-word slug that describes this task. Output ONLY two lowercase words separated by a hyphen.

Examples:
- "add dark mode" -> "dark-mode"
- "fix authentication bug" -> "auth-fix"
- "refactor the payment service" -> "payment-refactor"
- "add user dashboard" -> "user-dashboard"
- "improve api performance" -> "api-perf"

Output only the slug, nothing else.`,
      // i18n-ignore (LLM prompt content)
      systemPrompt:
        // i18n-ignore (LLM prompt content)
        'You extract 2-word slugs from task descriptions. Output ONLY the slug in format "word-word". No explanations, no quotes, just the slug.',
      timeoutMs: SLUG_GENERATION_TIMEOUT_MS,
    });

    if (!result.success || !result.content) {
      logger.info('Slug generation failed, will use random slug', { error: result.error });
      return null;
    }

    const slug = parseSlugResponse(result.content);
    if (slug) {
      logger.info('Generated intent-based slug', { intent: truncatedIntent, slug });
    }
    return slug;
  } catch (error) {
    logger.error('Slug generation error', error as Error);
    return null;
  }
}

// Words that indicate an error response or invalid content
const INVALID_SLUG_WORDS = new Set([
  'error',
  'model',
  'gemini',
  'claude',
  'gpt',
  'http',
  'internal',
  'timeout',
  'failed',
  'null',
  'undefined',
  'exception',
]);

/**
 * Parse and validate the LLM response into a valid slug base.
 * Returns null if the response is invalid.
 */
function parseSlugResponse(response: string): string | null {
  // Reject responses that look like error messages
  if (response.includes('error') || response.includes('Error') || response.includes('HTTP')) {
    return null;
  }

  // Clean up the response - remove everything except letters, hyphens, and spaces
  const cleaned = response
    .toLowerCase()
    .trim()
    .replace(/[^a-z-\s]/g, '') // Remove everything except letters, hyphen, space
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens

  // Split and validate
  const parts = cleaned.split('-').filter((p) => p.length > 0);

  // We need at least 2 words
  if (parts.length < 2) return null;

  const word1 = parts[0];
  const word2 = parts[1];

  // Each word must be 2-15 lowercase letters only
  const wordPattern = /^[a-z]{2,15}$/;

  if (!wordPattern.test(word1)) return null;
  if (!wordPattern.test(word2)) return null;

  // Reject suspicious words that indicate error responses
  if (INVALID_SLUG_WORDS.has(word1) || INVALID_SLUG_WORDS.has(word2)) {
    return null;
  }

  return `${word1}-${word2}`;
}

/**
 * Generate a base workspace slug from intent.
 * Returns just the base slug without any suffix.
 * Collision handling (adding numeric suffix) is done by the workspace service.
 * Falls back to null if generation fails.
 *
 * @param intent - The user's initial prompt/intent
 * @returns Base slug like "auth-refactor" or null
 */
export async function generateCompleteIntentSlug(intent: string): Promise<string | null> {
  return generateIntentBasedSlug(intent);
}
