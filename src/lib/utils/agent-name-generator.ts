/**
 * Agent Name Generator
 *
 * Generates descriptive names for agent sessions based on their specialist role.
 * Agents are named after their specialist (e.g., "Coordinator", "Implementor")
 * with a numeric suffix when duplicates exist in the workspace (e.g., "Implementor 2").
 * For agents without a specialist, uses "Agent" as the base name.
 */

import {
  uniqueNamesGenerator,
  adjectives,
  animals,
} from 'unique-names-generator';

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
 * @deprecated Prefer generateSpecialistAgentName() which uses the specialist name + number.
 * Kept for backward compatibility in deep fallback paths.
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
 * Generate an agent name based on the specialist role, appending a number
 * if there's already an agent with that name in the workspace.
 *
 * Examples:
 *   - First "Coordinator" → "Coordinator"
 *   - Second "Coordinator" → "Coordinator 2"
 *   - Third "Coordinator" → "Coordinator 3"
 *   - No specialist → "Agent", "Agent 2", etc.
 *
 * @param baseName - The specialist display name (e.g., "Coordinator", "Implementor") or "Agent" for non-specialist agents
 * @param existingNames - Array of existing agent names in the workspace to check for conflicts
 * @returns A unique agent name based on the specialist role
 */
export function generateSpecialistAgentName(baseName: string, existingNames: string[]): string {
  const normalizedBase = baseName.trim();
  if (!normalizedBase) {
    return generateSpecialistAgentName('Agent', existingNames);
  }

  // Build a set of normalized existing names for efficient lookup
  const existingSet = new Set(existingNames.map((n) => n.trim().toLowerCase()));

  // If the base name isn't taken, use it as-is
  if (!existingSet.has(normalizedBase.toLowerCase())) {
    return normalizedBase;
  }

  // Find the next available number
  let counter = 2;
  while (existingSet.has(`${normalizedBase.toLowerCase()} ${counter}`)) {
    counter++;
  }
  return `${normalizedBase} ${counter}`;
}

/**
 * Default name for agents without a derived name.
 * Use this constant throughout the codebase for consistency.
 * @deprecated Use generateSpecialistAgentName() for new agents.
 * This constant is kept for backwards compatibility with existing code that checks for generic names.
 */
export const DEFAULT_AGENT_NAME = 'Coordinator';

// Re-export name classification functions from shared module (usable in both main and renderer)
export { isGenericAgentName, isRandomAgentName } from '$shared/utils/agent-name-utils';

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
    return 'Agent';
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

  return name || 'Agent';
}
