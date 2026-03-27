/**
 * Agent Name Utilities (shared between main and renderer processes)
 *
 * Pure functions for classifying agent names. These are safe to use in both
 * main and renderer processes since they only depend on `unique-names-generator`
 * dictionaries (static data).
 */

import { adjectives, animals } from 'unique-names-generator';

/**
 * Create a Set for O(1) lookup of adjectives and animals.
 * Created once at module load for performance.
 */
const adjectivesSet = new Set(adjectives.map((a) => a.toLowerCase()));
const animalsSet = new Set(animals.map((a) => a.toLowerCase()));

/**
 * Check if a name is a "generic" agent name (e.g., "New Agent", "Orchestrator", "Assistant").
 * Generic names are default/placeholder names that should be overridden by intentional names.
 * Used by UI components to determine how to display agent names.
 * Note: Specialist-based names (e.g., "Coordinator", "Implementor 2") are NOT generic.
 */
export function isGenericAgentName(name: string | undefined | null): boolean {
  if (!name) return true;
  const normalized = name.trim().toLowerCase();
  return (
    normalized === 'new agent' ||
    normalized === 'orchestrator' ||
    normalized === 'assistant' ||
    normalized.startsWith('thread ') ||
    normalized.startsWith('workspace agent') ||
    // Match "Chat HH-MM AM/PM" pattern from legacy timestamp-based names
    /^chat \d{1,2}-\d{2} (am|pm)$/i.test(normalized)
  );
}

/**
 * Check if a name is a random "Adjective Animal" name (e.g., "Swift Falcon", "Clever Otter").
 * These are auto-generated names that should prompt the agent to set a custom name.
 * Used to determine if naming instructions should be included in the first message.
 */
export function isRandomAgentName(name: string | undefined | null): boolean {
  if (!name) return true;

  const trimmed = name.trim();
  // Random names are exactly two capitalized words separated by a space
  const parts = trimmed.split(' ');
  if (parts.length !== 2) return false;

  const [adjective, animal] = parts;
  // Check if both words are in the dictionaries (case-insensitive)
  return adjectivesSet.has(adjective.toLowerCase()) && animalsSet.has(animal.toLowerCase());
}

