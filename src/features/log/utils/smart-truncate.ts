/**
 * Smart Truncation Utility
 *
 * Truncates strings to a maximum length with intelligent word-boundary awareness.
 * Used for agent names, note titles, and other display primitives in the activity log.
 */

const DEFAULT_MAX_LENGTH = 16;
const MIN_LENGTH = 8; // Never truncate shorter than this

/**
 * Smartly truncate a string to a maximum length.
 *
 * - If the string fits within maxLength, return it as-is.
 * - Tries to break at a word boundary (space) to avoid cutting mid-word.
 * - Falls back to hard truncation if no good word boundary is found.
 * - Appends '…' (ellipsis) when truncated.
 *
 * @param text - The string to truncate
 * @param maxLength - Maximum length including ellipsis (default: 16)
 * @returns The truncated string
 *
 * @example
 * smartTruncate('Add dark mode CSS variables') // 'Add dark mode…'
 * smartTruncate('Create theme store with persistence') // 'Create theme…'
 * smartTruncate('Short name') // 'Short name' (no truncation)
 * smartTruncate('VeryLongSingleWordName') // 'VeryLongSingle…' (hard cut)
 */
export function smartTruncate(text: string, maxLength: number = DEFAULT_MAX_LENGTH): string {
  if (!text) return text;
  if (text.length <= maxLength) return text;

  // Reserve 1 char for the ellipsis
  const targetLength = maxLength - 1;

  // Look for the last space within the target length
  const lastSpace = text.lastIndexOf(' ', targetLength);

  // Use word boundary if it's not too short (at least MIN_LENGTH chars before the space)
  if (lastSpace >= MIN_LENGTH) {
    return text.slice(0, lastSpace) + '…';
  }

  // No good word boundary found - hard truncate
  return text.slice(0, targetLength) + '…';
}
