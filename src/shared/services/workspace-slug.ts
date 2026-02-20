/**
 * Workspace Slug Generator
 *
 * Generates friendly, memorable workspace IDs using adjective-noun combinations.
 * Suffixes are only added when needed to avoid collisions.
 *
 * Format: word-word (e.g., "amber-forest", "auth-refactor")
 * With collision suffix: word-word-N (e.g., "amber-forest-2", "auth-refactor-3")
 */

import { uniqueNamesGenerator, adjectives, animals } from 'unique-names-generator';

/**
 * Pattern for validating workspace slugs
 * Format: word-word (base) or word-word-N (with numeric suffix for collisions)
 * Each word must be 2-15 lowercase letters
 * Optional suffix is a number (no limit, but practically 1-999)
 */
export const WORKSPACE_SLUG_PATTERN = /^[a-z]{2,15}-[a-z]{2,15}(-[0-9]+)?$/;

/**
 * Generate a base workspace slug (without suffix).
 *
 * Uses unique-names-generator for adjective-noun combinations.
 * The caller is responsible for checking collisions and adding a numeric suffix if needed.
 *
 * Examples:
 * - amber-forest
 * - silver-canyon
 * - cobalt-river
 *
 * @returns A workspace slug in the format "adjective-noun"
 */
export function generateWorkspaceSlug(): string {
  return uniqueNamesGenerator({
    dictionaries: [adjectives, animals],
    separator: '-',
    style: 'lowerCase',
    length: 2,
  });
}

/**
 * Add a numeric suffix to a base slug to make it unique.
 *
 * @param baseSlug - The base slug (e.g., "auth-refactor")
 * @param number - The collision number (e.g., 2 for the second occurrence)
 * @returns The slug with suffix (e.g., "auth-refactor-2")
 */
export function appendSlugSuffix(baseSlug: string, number: number): string {
  return `${baseSlug}-${number}`;
}

/**
 * Extract the base slug from a potentially suffixed slug.
 *
 * @param slug - The full slug (e.g., "auth-refactor-2" or "auth-refactor")
 * @returns The base slug without suffix (e.g., "auth-refactor")
 */
export function extractBaseSlug(slug: string): string {
  // Match word-word-N pattern and extract just word-word
  const match = slug.match(/^([a-z]{2,15}-[a-z]{2,15})(?:-[0-9]+)?$/);
  return match ? match[1] : slug;
}

// Create Sets for O(1) lookup of adjectives and animals
const adjectivesSet = new Set(adjectives);
const animalsSet = new Set(animals);

// Registry of known workspace slugs (for intent-based slugs that don't match adjective-animal pattern)
// This is populated by the workspace service when workspaces are loaded/created
const knownWorkspaceSlugs = new Set<string>();

/**
 * Register a workspace slug as known.
 * Called when workspaces are created or loaded from storage.
 */
export function registerWorkspaceSlug(slug: string): void {
  if (slug && WORKSPACE_SLUG_PATTERN.test(slug)) {
    knownWorkspaceSlugs.add(slug);
  }
}

/**
 * Register multiple workspace slugs as known.
 */
export function registerWorkspaceSlugs(slugs: string[]): void {
  for (const slug of slugs) {
    registerWorkspaceSlug(slug);
  }
}

/**
 * Unregister a workspace slug (e.g., when deleted).
 */
export function unregisterWorkspaceSlug(slug: string): void {
  knownWorkspaceSlugs.delete(slug);
}

/**
 * Clear all registered workspace slugs.
 * Useful for testing or when reloading workspace list.
 */
export function clearWorkspaceSlugRegistry(): void {
  knownWorkspaceSlugs.clear();
}

/**
 * Validate if a string is a valid workspace slug
 *
 * @param slug - The string to validate
 * @returns true if the slug matches the expected format
 */
export function isValidWorkspaceSlug(slug: string): boolean {
  if (!slug || typeof slug !== 'string') {
    return false;
  }

  // Check the new pattern (word-word or word-word-N)
  if (WORKSPACE_SLUG_PATTERN.test(slug)) {
    return true;
  }

  // Legacy pattern: word-word-xxxx (4 alphanumeric chars) for backward compatibility
  const LEGACY_SLUG_PATTERN = /^[a-z]{2,15}-[a-z]{2,15}-[a-z0-9]{4}$/;
  if (LEGACY_SLUG_PATTERN.test(slug)) {
    return true;
  }

  // Also accept legacy UUID format for backward compatibility
  const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  return UUID_PATTERN.test(slug);
}

/**
 * Check if a string looks like a workspace slug.
 *
 * Checks in order:
 * 1. Known registered workspace slugs (for intent-based slugs like "auth-refactor")
 * 2. Adjective-animal pattern (for random slugs like "amber-forest" or "amber-forest-2")
 * 3. Legacy adjective-animal-xxxx pattern (for backward compatibility)
 *
 * This is stricter than isValidWorkspaceSlug and avoids false positives
 * from branch names that happen to match the pattern but aren't workspace slugs.
 *
 * @param slug - The string to check
 * @returns true if the slug is a known workspace or matches adjective-animal format
 */
export function isWorkspaceSlug(slug: string): boolean {
  if (!slug || typeof slug !== 'string') {
    return false;
  }

  // Check if it's a known registered workspace slug (intent-based slugs)
  if (knownWorkspaceSlugs.has(slug)) {
    return true;
  }

  // Check new pattern (word-word or word-word-N)
  if (WORKSPACE_SLUG_PATTERN.test(slug)) {
    // Extract base slug (remove numeric suffix if present)
    const baseSlug = extractBaseSlug(slug);

    // Split base into parts: word-word
    const parts = baseSlug.split('-');
    if (parts.length === 2) {
      const [adjective, animal] = parts;
      // Check if adjective and animal are from the known dictionaries
      if (adjectivesSet.has(adjective) && animalsSet.has(animal)) {
        return true;
      }
    }
  }

  // Legacy pattern: word-word-xxxx (4 alphanumeric chars)
  const LEGACY_SLUG_PATTERN = /^[a-z]{2,15}-[a-z]{2,15}-[a-z0-9]{4}$/;
  if (LEGACY_SLUG_PATTERN.test(slug)) {
    // Extract the first two parts (adjective and animal)
    const parts = slug.split('-');
    if (parts.length === 3) {
      const [adjective, animal] = parts;
      if (adjectivesSet.has(adjective) && animalsSet.has(animal)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if a workspace ID is a legacy UUID format
 *
 * @param id - The workspace ID to check
 * @returns true if the ID is a UUID
 */
export function isLegacyWorkspaceId(id: string): boolean {
  const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  return UUID_PATTERN.test(id);
}

/**
 * Extract a short display name from a workspace ID
 *
 * @param id - The workspace ID (either slug or UUID)
 * @returns A shortened display-friendly version
 */
export function formatWorkspaceIdForDisplay(id: string): string {
  if (!id) return '';

  // If it's a slug, return as-is (already friendly)
  if (WORKSPACE_SLUG_PATTERN.test(id)) {
    return id;
  }

  // If it's a UUID, return first 8 chars
  if (isLegacyWorkspaceId(id)) {
    return id.slice(0, 8);
  }

  // Unknown format, truncate if needed
  return id.length > 20 ? `${id.slice(0, 17)}...` : id;
}
