/**
 * Anchor Normalization Utilities
 *
 * Pure functions for normalizing comment anchor positions in markdown.
 * These functions are safe to use in both frontend and backend code.
 */

/**
 * Normalize anchor positions in markdown to prevent breaking syntax
 *
 * Rule: If an anchor starts a line (after optional whitespace), and is followed
 * by a markdown control symbol, move the anchor to after the control symbol.
 *
 * This prevents patterns like:
 * - `<!--anchor:id:start-->## Title` (breaks heading)
 * - `   <!--anchor:id:start-->- Item` (breaks list)
 * - `<!--anchor:id:start-->- [ ] Task` (breaks task list)
 *
 * And converts them to:
 * - `## <!--anchor:id:start-->Title`
 * - `   - <!--anchor:id:start-->Item`
 * - `- [ ] <!--anchor:id:start-->Task`
 *
 * Rationale: If a comment spans multiple lines, the start anchor would be on
 * a previous line where the selection began. The only time we have an anchor
 * before a control symbol is when the user selected the entire line INCLUDING
 * the control symbol, which breaks markdown syntax.
 *
 * @param markdown - The markdown content to normalize
 * @returns Normalized markdown with anchors moved after control symbols
 */
export function normalizeAnchorPositions(markdown: string): string {
  const lines = markdown.split('\n');
  const result: string[] = [];

  for (const line of lines) {
    // Pattern: (optional whitespace)(one or more anchors)(markdown control symbol)
    // Control symbols:
    // - Headings: # ## ### etc. (one or more # followed by space)
    // - Task lists: - [ ] or - [x] (dash, space, bracket, space/x, bracket, space)
    // - Unordered lists: - or * (followed by space)
    // - Ordered lists: 1. 2. etc. (number followed by period and space)
    // - Blockquotes: > (followed by space)
    // - Code blocks: ``` (three backticks)
    // Note: Task list pattern must come before unordered list pattern
    const pattern =
      /^(\s*)((?:<!--anchor:[^>]+-->\s*)+)(#{1,6}\s+|-\s+\[[x ]\]\s+|[-*]\s+|\d+\.\s+|>\s+|```)/;

    const match = line.match(pattern);

    if (match) {
      const [, leadingWhitespace, anchors, controlSymbol] = match;
      const restOfLine = line.slice(match[0].length);

      // Reconstruct: whitespace + control + anchors + rest
      result.push(`${leadingWhitespace}${controlSymbol}${anchors}${restOfLine}`);
    } else {
      // No match, keep line as-is
      result.push(line);
    }
  }

  return result.join('\n');
}
