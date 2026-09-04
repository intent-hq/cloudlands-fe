/**
 * Prompt Loader for Testing
 *
 * Loads specialist behavior prompts directly from the constants in the codebase.
 * This ensures tests always use the exact same prompts as production code.
 *
 * Key benefits:
 * - Tests stay in sync with prompt changes
 * - No duplication of prompt content
 * - Validates prompt structure and content
 */

import { SPECIALISTS, type Specialist } from '$lib/constants/specialists';

/**
 * Get all specialist configurations
 */
export function getSpecialists(): Specialist[] {
  return SPECIALISTS;
}

/**
 * Get a specific specialist by ID
 */
export function getSpecialist(id: Specialist['id']): Specialist | undefined {
  return SPECIALISTS.find((s) => s.id === id);
}

/**
 * Validate that a prompt contains expected sections/patterns
 *
 * @param content - Prompt content
 * @param expectedPatterns - Array of patterns (string or RegExp) that should be present
 * @returns Validation result with missing patterns
 */
function validatePromptContent(
  content: string,
  expectedPatterns: (string | RegExp)[],
): { valid: boolean; missingPatterns: (string | RegExp)[] } {
  const missingPatterns: (string | RegExp)[] = [];

  for (const pattern of expectedPatterns) {
    if (typeof pattern === 'string') {
      if (!content.includes(pattern)) {
        missingPatterns.push(pattern);
      }
    } else {
      if (!pattern.test(content)) {
        missingPatterns.push(pattern);
      }
    }
  }

  return {
    valid: missingPatterns.length === 0,
    missingPatterns,
  };
}

/**
 * Specialist prompt patterns that should be present
 * These patterns are validated against the defaultBehaviorPrompt of each specialist
 */
const SPECIALIST_PATTERNS = {
  'spec-writer': [
    /coordinator/i,
    /delegate|delegation/i,
    /wave/i,
    /spec|plan/i, // Spec-writer focuses on planning and spec creation
  ],
  // Updated patterns to match optimized implementor behavior prompt
  implementor: [/implement/i, /task/i, /scope/i, /execution/i],
  // Updated patterns to match optimized verifier behavior prompt
  verifier: [/verify|verification/i, /check/i, /test/i, /evidence|criteria/i],
  // PR Reviewer patterns for code review and high-confidence feedback
  'pr-reviewer': [
    /review|code review/i,
    /high confidence/i,
    /severity/i,
    /delegate.*implementor|do not make.*changes/i,
  ],
  // UI Designer patterns for accessibility and design system discovery
  'ui-designer': [
    /accessible|accessibility/i,
    /contrast|focus/i,
    /discover|search.*codebase|existing pattern/i,
    /design system|design token/i,
  ],
} as const;

/**
 * Validate specialist behavior prompt contains expected patterns
 *
 * @param specialistId - Specialist ID
 * @param behaviorPrompt - The behavior prompt to validate (defaultBehaviorPrompt from Specialist)
 * @returns Validation result
 */
export function validateSpecialistPrompt(
  specialistId: Specialist['id'],
  behaviorPrompt: string,
): { valid: boolean; missingPatterns: RegExp[] } {
  const patterns = SPECIALIST_PATTERNS[specialistId] || [];
  return validatePromptContent(behaviorPrompt, patterns) as {
    valid: boolean;
    missingPatterns: RegExp[];
  };
}