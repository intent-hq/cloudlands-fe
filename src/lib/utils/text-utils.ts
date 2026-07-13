/**
 * Text utilities for extracting and processing text content
 */

// Re-export stripMarkdownFormatting from shared utils
export { stripMarkdownFormatting } from '$shared/utils-client';

/**
 * Strip `<group:Name>` and `</group>` (or `</group:Name>`) tags from text.
 * These are internal markers used for response grouping and should never be
 * shown to the user in previews, agent cards, or other plain-text contexts.
 */
const GROUP_TAG_STRIP_REGEX = /<group:[^>]+>|<\/group(?::[^>]+)?>/g;
export function stripGroupTags(text: string): string {
  if (!text) return text;
  return text.replace(GROUP_TAG_STRIP_REGEX, '').trim();
}

/**
 * Patterns that are not meaningful content (markdown artifacts, arrows, etc.)
 */
const NON_MEANINGFUL_PATTERNS = [
  /^<!--.*-->$/, // HTML comments
  /^-->$/, // Closing arrow (markdown artifact)
  /^<--$/, // Opening arrow
  /^```\w*$/, // Code fence markers
  /^---$/, // Horizontal rules
  /^\*{3,}$/, // Asterisk horizontal rules
  /^#{1,6}\s*$/, // Empty headings
  /^\s*[-*+]\s*$/, // Empty list items
  /^\s*\d+\.\s*$/, // Empty numbered list items
];

/**
 * Check if a line is meaningful content (not just artifacts or formatting)
 */
function isMeaningfulLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;

  // Check against non-meaningful patterns
  for (const pattern of NON_MEANINGFUL_PATTERNS) {
    if (pattern.test(trimmed)) return false;
  }

  return true;
}

/**
 * Get the last meaningful line of text, skipping empty lines and whitespace
 * @param text - The text to process
 * @returns The last meaningful line, or empty string if none found
 */
export function getLastMeaningfulLine(text: string): string {
  if (!text) return '';

  // Strip group tags before extracting meaningful lines
  const cleaned = stripGroupTags(text);
  if (!cleaned) return '';

  // Split into lines and work backwards
  const lines = cleaned.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (isMeaningfulLine(line)) {
      return line;
    }
  }
  return '';
}

/**
 * Get the last meaningful sentence or phrase from text
 * Useful for showing the most recent agent activity
 * @param text - The text to process
 * @returns The last sentence/phrase
 */
export function getLastSentence(text: string): string {
  if (!text) return '';

  // First get the last meaningful line
  const lastLine = getLastMeaningfulLine(text);
  if (!lastLine) return '';

  // If the line ends with punctuation, it's a complete thought
  if (/[.!?]$/.test(lastLine)) {
    // Try to find the last sentence in this line
    const sentences = lastLine.split(/(?<=[.!?])\s+/);
    return sentences[sentences.length - 1] || lastLine;
  }

  // Otherwise return the whole line (it's probably a partial/streaming thought)
  return lastLine;
}

/**
 * Extract text from agent content blocks
 * @param contentBlocks - Array of content blocks
 * @returns Concatenated text content
 */
export function extractTextFromBlocks(contentBlocks: any[]): string {
  if (!contentBlocks || !Array.isArray(contentBlocks)) return '';

  return contentBlocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text || block.content || '')
    .join(' ')
    .trim();
}

/**
 * Get summary text from agent messages for display
 * Returns the last bit of text the agent produced
 * @param messages - Array of agent messages
 * @returns Summary text or null
 */
export function getAgentSummaryText(messages: any[]): string | null {
  if (!messages || messages.length === 0) return null;

  // Find the last assistant message
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'user') continue;

    // Extract text from contentBlocks
    if (msg.contentBlocks && msg.contentBlocks.length > 0) {
      const text = extractTextFromBlocks(msg.contentBlocks);
      if (text) {
        return getLastMeaningfulLine(text);
      }

      // Check for tool_use blocks (agent is working)
      const toolBlock = msg.contentBlocks.find((block: any) => block.type === 'tool_use');
      if (toolBlock) {
        const toolName = toolBlock.name || toolBlock.toolName || 'tool';
        return `Using ${toolName}...`;
      }
    }
  }

  return null;
}
