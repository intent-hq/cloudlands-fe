import { PATTERNS, LIMITS } from '$shared/constants';
import { generateRandomAgentName } from '$lib/utils/agent-name-generator';

/**
 * Sanitize a string to create a valid agent name.
 * Replaces invalid characters with hyphens and ensures length limits.
 *
 * Valid pattern: /^[\w\s-]+$/ (word characters, spaces, hyphens)
 */
export function sanitizeAgentName(name: string): string {
  if (!name || typeof name !== 'string') {
    return generateRandomAgentName();
  }

  // Replace invalid characters with hyphens
  // Valid: word characters (\w = a-zA-Z0-9_), spaces, hyphens
  let sanitized = name.replace(/[^\w\s-]/g, '-');

  // Replace multiple consecutive hyphens with single hyphen
  sanitized = sanitized.replace(/-{2,}/g, '-');

  // Trim and remove leading/trailing hyphens
  sanitized = sanitized.trim().replace(/^-+|-+$/g, '');

  // Ensure length limit
  if (sanitized.length > LIMITS.MAX_NAME_LENGTH) {
    sanitized = sanitized.slice(0, LIMITS.MAX_NAME_LENGTH);
  }

  // If empty after sanitization, return default
  if (sanitized.length === 0) {
    return generateRandomAgentName();
  }

  return sanitized;
}

/**
 * Generate an agent name from a task title.
 * Truncates to reasonable length. If no title provided, generates a random name.
 */
export function generateAgentNameFromTask(taskTitle: string): string {
  if (!taskTitle || typeof taskTitle !== 'string') {
    return generateRandomAgentName();
  }

  // Take first 50 chars
  const truncated = taskTitle.slice(0, 50);
  const sanitized = sanitizeAgentName(truncated);

  return sanitized;
}

/**
 * Validate if a name is a valid agent name according to the pattern.
 */
export function isValidAgentName(name: string): boolean {
  if (!name || typeof name !== 'string') {
    return false;
  }

  const trimmed = name.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= LIMITS.MAX_NAME_LENGTH &&
    PATTERNS.AGENT_NAME.test(trimmed)
  );
}
