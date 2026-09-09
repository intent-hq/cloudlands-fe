/**
 * Client-Safe Shared Utilities
 *
 * Common utility functions that can be used in both client and server.
 * NO Node.js-specific imports allowed here!
 */

/**
 * Strip markdown formatting from text to get plain text.
 * Removes bold (**text**), italic (*text* or _text_), and other common markdown.
 * Useful for displaying titles that may contain markdown formatting.
 *
 * @param text - The text that may contain markdown formatting
 * @returns Plain text with markdown formatting removed
 */
export function stripMarkdownFormatting(text: string): string {
  if (!text) return '';

  let result = text;

  // Remove bold: **text** or __text__
  result = result.replace(/\*\*(.+?)\*\*/g, '$1');
  result = result.replace(/__(.+?)__/g, '$1');

  // Remove italic: *text* or _text_ (single asterisk/underscore)
  // Be careful not to match already-stripped bold markers
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '$1');
  result = result.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, '$1');

  // Remove strikethrough: ~~text~~
  result = result.replace(/~~(.+?)~~/g, '$1');

  // Remove inline code: `text`
  result = result.replace(/`([^`]+)`/g, '$1');

  // Remove links: [text](url) -> text
  result = result.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  // Remove headers: # text, ## text, etc.
  result = result.replace(/^#{1,6}\s+/gm, '');

  // Clean up any remaining markdown artifacts (stray asterisks, underscores)
  // Only remove if they appear to be orphaned formatting characters
  result = result.replace(/^\*+\s*/gm, '');
  result = result.replace(/\s*\*+$/gm, '');

  // Trim whitespace
  return result.trim();
}

/**
 * Capitalize the first letter of a string
 */
export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
