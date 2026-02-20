/**
 * Agent Name Generator
 *
 * Generates descriptive names for agent sessions based on their initial message.
 * Uses simple text-based generation - agents can rename themselves if needed.
 * For default names, uses unique-names-generator with Adjective Animal format.
 */

import { uniqueNamesGenerator, adjectives, animals } from 'unique-names-generator';

/**
 * Maximum length for generated agent names
 */
const MAX_NAME_LENGTH = 80;

/**
 * List of adjectives to block from agent names.
 * These words may be inappropriate or could cause confusion in a professional context.
 */
const BLOCKED_ADJECTIVES = new Set([
  'gay',
  'sexual',
  'sexy',
  'erotic',
  'nude',
  'naked',
  'horny',
  'kinky',
  'slutty',
  'naughty',
  'dirty',
  'drunk',
  'stoned',
  'wasted',
  'racist',
  'sexist',
]);

/**
 * Filtered list of adjectives that excludes inappropriate words.
 * Created once at module load for performance.
 */
const safeAdjectives = adjectives.filter(
  (adj) => !BLOCKED_ADJECTIVES.has(adj.toLowerCase()),
);

/**
 * Generate a random agent name in "Adjective Animal" format (e.g., "Witty Penguin", "Swift Falcon").
 * Uses unique-names-generator for consistent, memorable names.
 * Filters out inappropriate adjectives to ensure professional naming.
 */
export function generateRandomAgentName(): string {
  return uniqueNamesGenerator({
    dictionaries: [safeAdjectives, animals],
    separator: ' ',
    style: 'capital',
    length: 2,
  });
}

/**
 * Default name for agents without a derived name.
 * Use this constant throughout the codebase for consistency.
 * @deprecated Use generateRandomAgentName() for new agents to get unique names.
 * This constant is kept for backwards compatibility with existing code that checks for generic names.
 */
export const DEFAULT_AGENT_NAME = 'Coordinator';

/**
 * Check if a name is a generic/default name that should be replaced.
 * Used by UI components to determine how to display agent names.
 * Note: Adjective Animal names are NOT considered generic - they are unique random names.
 */
export function isGenericAgentName(name: string | undefined | null): boolean {
  if (!name) return true;
  const normalized = name.trim().toLowerCase();
  return (
    normalized === 'new agent' ||
    normalized === 'coordinator' ||
    normalized === 'orchestrator' ||
    normalized === 'assistant' ||
    normalized.startsWith('agent ') ||
    normalized.startsWith('thread ') ||
    normalized.startsWith('workspace agent') ||
    // Match "Chat HH-MM AM/PM" pattern from legacy timestamp-based names
    /^chat \d{1,2}-\d{2} (am|pm)$/i.test(normalized)
  );
}

/**
 * Create a Set for O(1) lookup of adjectives and animals.
 * Created once at module load for performance.
 */
const adjectivesSet = new Set(adjectives.map((a) => a.toLowerCase()));
const animalsSet = new Set(animals.map((a) => a.toLowerCase()));

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

/**
 * Generate an agent name from a message or task text.
 * This follows the VS Code webview pattern of using the first message as the title.
 *
 * @param text - The message or task text to derive the name from
 * @param options - Optional configuration
 * @returns A sanitized, properly formatted agent name
 */
export function generateAgentNameFromText(
  text: string,
  options: { maxLength?: number; prefix?: string } = {},
): string {
  const maxLength = options.maxLength ?? MAX_NAME_LENGTH;

  if (!text || text.trim().length === 0) {
    return generateRandomAgentName();
  }

  // Clean up the text
  let name = text.trim();

  // Remove common instruction prefixes that don't add meaning
  const prefixesToRemove = [
    /^please\s+/i,
    /^can you\s+/i,
    /^could you\s+/i,
    /^i want you to\s+/i,
    /^i need you to\s+/i,
    /^help me\s+/i,
    /^work on\s+/i,
    /^please work on\s+/i,
    /^please work on this task:\s*/i,
  ];

  for (const prefix of prefixesToRemove) {
    name = name.replace(prefix, '');
  }

  // Remove quotes around the entire string
  name = name.replace(/^["'](.*)["']$/, '$1');

  // Remove trailing periods from task instructions
  name = name.replace(/\.\s*(Read the workspace specification.*)?$/i, '');

  // Clean up whitespace (no character restrictions on agent names)
  name = name.replace(/\s+/g, ' ').trim();

  // Capitalize first letter (sentence case)
  if (name.length > 0) {
    name = name.charAt(0).toUpperCase() + name.slice(1);
  }

  // Add prefix if provided
  if (options.prefix) {
    name = `${options.prefix}: ${name}`;
  }

  // Truncate if too long, but try to break at a word boundary
  if (name.length > maxLength) {
    // Find the last space before the limit
    const truncateAt = name.lastIndexOf(' ', maxLength - 3);
    if (truncateAt > maxLength * 0.5) {
      // Only use word boundary if it's not too short
      name = `${name.substring(0, truncateAt)}...`;
    } else {
      name = `${name.substring(0, maxLength - 3)}...`;
    }
  }

  return name || generateRandomAgentName();
}
