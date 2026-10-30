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
