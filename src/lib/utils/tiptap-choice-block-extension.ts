import type { Marked } from 'marked';

/**
 * Extend the marked instance to handle choice blocks
 *
 * Choice blocks use fenced code blocks with 'choice' language identifier:
 * ```choice
 * Question text?
 * ( ) Option A
 * (x) Option B
 * ```
 */
/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Generate a simple unique ID
 */

/**
 * Parse a choice option line
 * Format: ( ) Option text or (x) Option text
 * Also handles empty option text like ( ) or (x)
 */
function parseOption(line: string): { text: string; selected: boolean } | null {
  // Match options with or without text after the marker
  const match = line.match(/^\(([x ])\)\s*(.*)$/);
  if (!match) return null;

  return {
    text: match[2] || '', // Allow empty text
    selected: match[1] === 'x',
  };
}

export function addChoiceBlockSupport(markedInstance: Marked) {
  markedInstance.use({
    renderer: {
      code({ text, lang }: any): string | false {
        // Only handle choice blocks
        if (lang !== 'choice') {
          return false; // Use default renderer
        }

        // Parse the choice block content
        const lines = text.split('\n').filter((line: string) => line.trim());
        if (lines.length === 0) return false;

        // First line is the question
        const question = lines[0];

        // Remaining lines are options
        const options = lines
          .slice(1)
          .map((line: string) => {
            const parsed = parseOption(line);
            if (!parsed) return null;
            return {
              text: parsed.text,
              selected: parsed.selected,
            };
          })
          .filter(Boolean); // Remove nulls

        // Generate V2 HTML with nested structure
        const questionHtml = `<div data-type="choice-question"><p>${escapeHtml(question)}</p></div>`;

        const optionsHtml = options
          .map((opt: any) => {
            const selectedAttr = opt.selected ? 'true' : 'false';
            return `<div data-type="choice-option" data-selected="${selectedAttr}"><p>${escapeHtml(opt.text)}</p></div>`;
          })
          .join('');

        return `<div data-type="choice-block">${questionHtml}${optionsHtml}</div>`;
      },
    },
  });
}
