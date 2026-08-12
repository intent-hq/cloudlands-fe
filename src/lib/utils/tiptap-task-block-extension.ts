import type { Marked } from 'marked';
import {
  isValidTaskFenceHeader,
  parseTaskBlockContent,
  scanTaskBlocks,
} from '../../features/notes/utils/task-block-parser';

/**
 * Extend the marked instance to handle task blocks (singular)
 *
 * Syntax: @@@task ... @@@
 *
 * Each task block contains exactly one task:
 * @@@task
 * # Task Title
 * Task body content with **markdown** support.
 *
 * ## Requirements
 * - Item 1
 * - Item 2
 * @@@
 *
 * The first # heading is the task title. Everything below is the body.
 * One task per block - use multiple blocks for multiple tasks.
 * These are rendered as cards showing the proposed task before conversion.
 */

/**
 * Escape HTML special characters
 */

/**
 * Render a task block as HTML
 */
function renderTaskBlock(text: string): string {
  const task = parseTaskBlockContent(text);

  if (!task) {
    return '<div data-type="task-block" class="task-block-empty"><p>No task defined (missing # title)</p></div>';
  }

  // Task blocks are auto-converted to Task Notes, so we render them
  // to look like the final checkbox state with a skeleton loader
  return `
    <div data-type="task-block" class="task-block-pending">
      <input type="checkbox" disabled class="task-block-checkbox" />
      <span class="task-block-title-skeleton"></span>
    </div>
  `;
}

export function renderTaskBlocksAsReadableMarkdown(markdown: string): string {
  const blocks = scanTaskBlocks(markdown);
  if (blocks.length === 0) {
    return markdown;
  }

  let out = '';
  let cursor = 0;
  for (const block of blocks) {
    out += markdown.slice(cursor, block.start);
    const task = parseTaskBlockContent(block.body);
    out += task
      ? [`### ${task.title}`, task.content.trim()].filter(Boolean).join('\n\n')
      : block.body.trim();
    cursor = block.end;
  }
  out += markdown.slice(cursor);
  return out;
}

export function addTasksBlockSupport(markedInstance: Marked) {
  // Add custom tokenizer for @@@task...@@@ blocks
  markedInstance.use({
    extensions: [
      {
        name: 'taskBlock',
        level: 'block',
        start(src: string) {
          // Find the start of @@@task or @@@tasks (optional header attributes allowed)
          const match = src.match(/^@@@tasks?((?:[ \t][^\n]*)?)\r?\n/);
          return match && isValidTaskFenceHeader(match[1]) ? 0 : undefined;
        },
        tokenizer(src: string) {
          // Match @@@task...@@@ or @@@tasks...@@@; the fence line may carry
          // optional header attributes (validated like the daemon parser)
          const rule = /^(@@@tasks?((?:[ \t][^\n]*)?)\r?\n([\s\S]*?)@@@)/;
          const match = rule.exec(src);
          if (match && isValidTaskFenceHeader(match[2])) {
            return {
              type: 'taskBlock',
              raw: match[1],
              text: match[3],
              tokens: [],
            };
          }
          return undefined;
        },
        renderer(token: any): string {
          return renderTaskBlock(token.text);
        },
      },
    ],
  });
}
