import { Marked } from 'marked';
import { parseTaskBlockContent } from '../../features/notes/utils/task-block-parser';

/**
 * Regular expression to match agent anchors in task items
 * Matches patterns like: <!--agent:abc123-->
 */
const AGENT_ANCHOR_REGEX = /<!--agent:([^>]+)-->/;

/**
 * Extract agent ID from content and return cleaned content
 */
function extractAgentAnchor(content: string): { content: string; agentId: string | null } {
  const match = content.match(AGENT_ANCHOR_REGEX);
  if (match) {
    return {
      content: content.replace(AGENT_ANCHOR_REGEX, '').trim(),
      agentId: match[1],
    };
  }
  return { content, agentId: null };
}

/**
 * Creates a marked instance with Tiptap task list support using proper renderer
 *
 * This function creates a marked.js instance that:
 * 1. Uses GitHub-flavored markdown (GFM) to parse task lists
 * 2. Uses a custom renderer to convert task lists to Tiptap's expected HTML format
 * 3. Preserves regular list items as standard HTML
 * 4. Handles mixed lists (containing both regular and task items) correctly
 * 5. Handles choice blocks (```choice) for interactive multiple-choice questions
 * 6. Handles agent anchors (<!--agent:id-->) to preserve delegated agent assignments
 *
 * @returns A configured marked instance that outputs Tiptap-compatible HTML
 */
export const createTiptapTaskListMarked = () => {
  const markedInstance = new Marked();

  // Helper function to escape HTML entities in code blocks
  function escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Configure marked with GFM and custom renderer
  markedInstance.use({
    gfm: true,
    breaks: true,
    renderer: {
      code(token: any): string {
        // Handle legacy ```task blocks
        if (token.lang === 'task') {
          const task = parseTaskBlockContent(token.text);

          if (!task) {
            return '<div data-type="task-block" class="task-block-empty"><p>No task defined (missing # title)</p></div>';
          }

          return `<div data-type="task-block" class="task-block-pending">
      <input type="checkbox" disabled class="task-block-checkbox" />
      <span class="task-block-title-skeleton"></span>
    </div>`;
        }

        // Handle mermaid diagram blocks - convert to custom mermaid-block node
        // Use base64 encoding to preserve newlines and special characters through sanitization
        if (token.lang === 'mermaid') {
          const rawCode = token.text || '';
          const base64Code = btoa(unescape(encodeURIComponent(rawCode)));
          return `<div data-type="mermaid-block" data-mermaid-code="${base64Code}"></div>\n`;
        }

        // Generate proper <pre><code> tags for other code blocks
        // IMPORTANT: Escape HTML entities to prevent code from being interpreted as HTML
        const lang = token.lang || '';
        const code = escapeHtml(token.text || '');
        return `<pre><code${lang ? ` class="language-${lang}"` : ''}>${code}</code></pre>\n`;
      },

      // Custom image renderer to output block-level images with proper class
      image(token: any): string {
        const src = token.href || '';
        const alt = token.text || '';
        const title = token.title;
        const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
        return `<img src="${src}" alt="${escapeHtml(alt)}"${titleAttr} class="note-image max-w-full rounded-md">`;
      },

      // Custom paragraph renderer to handle image-only paragraphs
      // When a paragraph contains only an image, output just the image without <p> wrapper
      // This prevents whitespace issues when TipTap (with inline: false) extracts images
      paragraph(token: any): string {
        // Check if this paragraph contains only an image (and optional whitespace)
        const tokens = token.tokens || [];
        const nonWhitespaceTokens = tokens.filter(
          (t: any) => t.type !== 'text' || (t.text && t.text.trim() !== ''),
        );

        // If there's exactly one token and it's an image, output without <p> wrapper
        if (nonWhitespaceTokens.length === 1 && nonWhitespaceTokens[0].type === 'image') {
          const imgToken = nonWhitespaceTokens[0];
          const src = imgToken.href || '';
          const alt = imgToken.text || '';
          const title = imgToken.title;
          const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
          return `<img src="${src}" alt="${escapeHtml(alt)}"${titleAttr} class="note-image max-w-full rounded-md">\n`;
        }

        // Default paragraph rendering
        return `<p>${this.parser.parseInline(token.tokens)}</p>\n`;
      },

      list(token: any): string | false {
        // Check which items are task items (including [/] in-progress items)
        const isTaskItem = (item: any) => {
          if (item.task === true) return true;
          // Check for [/] pattern in non-task items
          const text = item.text || '';
          return /^\[\/\]\s+/.test(text);
        };

        const hasTaskItems = token.items.some(isTaskItem);
        const hasRegularItems = token.items.some((item: any) => !isTaskItem(item));

        // If we have a mix of task and regular items, split them into separate lists
        // This prevents TipTap from misinterpreting regular items inside a taskList
        if (hasTaskItems && hasRegularItems) {
          const groups: Array<{ isTask: boolean; items: any[] }> = [];
          let currentGroup: { isTask: boolean; items: any[] } | null = null;

          for (const item of token.items) {
            const itemIsTask = isTaskItem(item);
            if (!currentGroup || currentGroup.isTask !== itemIsTask) {
              currentGroup = { isTask: itemIsTask, items: [] };
              groups.push(currentGroup);
            }
            currentGroup.items.push(item);
          }

          // Render each group as its own list
          return groups
            .map((group) => {
              const listItems = group.items.map((item: any) => this.listitem(item)).join('\n');
              if (group.isTask) {
                return `<ul class="task-list not-prose pl-0" data-type="taskList">\n${listItems}\n</ul>`;
              } else {
                return `<ul>\n${listItems}\n</ul>`;
              }
            })
            .join('\n');
        }

        if (hasTaskItems) {
          // All items are task items - render as Tiptap task list
          const listItems = token.items.map((item: any) => this.listitem(item)).join('\n');
          return `<ul class="task-list not-prose pl-0" data-type="taskList">\n${listItems}\n</ul>\n`;
        }
        // Return false to use default renderer for non-task lists
        return false;
      },

      listitem(token: any): string | false {
        if (token.task === true) {
          // Render as Tiptap task item
          const isChecked = token.checked;

          // Process the tokens to get proper HTML content including nested lists
          let content = '';
          if (token.tokens && token.tokens.length > 0) {
            // Parse the tokens to get HTML - this will handle nested lists properly
            content = this.parser.parse(token.tokens);
          } else {
            // Fallback to text if no tokens
            content = token.text || '';
          }

          // Extract agent anchor if present (<!--agent:id-->)
          const { content: cleanedContent, agentId } = extractAgentAnchor(content);
          content = cleanedContent;

          // Fix for empty task items: ensure they have at least an empty paragraph
          // This prevents TipTap from failing to recognize them as taskItems
          // Empty or whitespace-only content needs a <p></p> to maintain proper structure
          if (!content || content.trim() === '' || content.trim() === '<p></p>') {
            content = '<p></p>';
          }

          // Determine status based on checked state
          // Default GFM only supports [ ] and [x], but we'll add status attribute for future extension
          const status = isChecked ? 'done' : 'todo';

          // Build attributes including optional agent ID
          const agentAttr = agentId ? ` data-delegated-agent-id="${agentId}"` : '';

          return `<li class="task-item flex items-start gap-2" data-type="taskItem" data-checked="${isChecked}" data-status="${status}"${agentAttr}><label><input type="checkbox"${isChecked ? ' checked' : ''}><span></span></label><div>${content}</div></li>`;
        } else {
          // Check if this is a [/] in-progress task (not recognized by GFM)
          // We need to manually detect [/] pattern in the text
          const text = token.text || '';
          const rawText = token.raw || '';

          const inProgressMatch =
            text.match(/^\[\/\]\s+(.*)$/) || rawText.match(/^-\s+\[\/\]\s+(.*)$/m);

          if (inProgressMatch) {
            // This is an in-progress task item
            const taskContent = inProgressMatch[1];

            // Process the content - need to parse just the task content without [/]
            let content = '';
            if (token.tokens && token.tokens.length > 0) {
              // Parse tokens but we need to strip the [/] from the first text token
              const modifiedTokens = [...token.tokens];

              // The first token is type "text" with nested tokens array
              if (modifiedTokens[0] && modifiedTokens[0].type === 'text') {
                // Modify both the outer token and nested tokens
                const nestedTokens = modifiedTokens[0].tokens ? [...modifiedTokens[0].tokens] : [];
                if (nestedTokens[0] && nestedTokens[0].type === 'text') {
                  nestedTokens[0] = {
                    ...nestedTokens[0],
                    text: nestedTokens[0].text.replace(/^\[\/\]\s+/, ''),
                    raw: nestedTokens[0].raw?.replace(/^\[\/\]\s+/, ''),
                  };
                }
                modifiedTokens[0] = {
                  ...modifiedTokens[0],
                  text: modifiedTokens[0].text.replace(/^\[\/\]\s+/, ''),
                  raw: modifiedTokens[0].raw?.replace(/^\[\/\]\s+/, ''),
                  tokens: nestedTokens,
                };
              }
              content = this.parser.parse(modifiedTokens);
            } else {
              content = `<p>${taskContent}</p>`;
            }

            // Extract agent anchor if present (<!--agent:id-->)
            const { content: cleanedContent, agentId } = extractAgentAnchor(content);
            content = cleanedContent;

            if (!content || content.trim() === '' || content.trim() === '<p></p>') {
              content = '<p></p>';
            }

            // Build attributes including optional agent ID
            const agentAttr = agentId ? ` data-delegated-agent-id="${agentId}"` : '';

            return `<li class="task-item flex items-start gap-2" data-type="taskItem" data-checked="false" data-status="in-progress"${agentAttr}><label><input type="checkbox"><span></span></label><div>${content}</div></li>`;
          }

          // Render as regular list item (use default behavior)
          let content = '';
          if (token.tokens && token.tokens.length > 0) {
            try {
              content = this.parser.parse(token.tokens);
            } catch {
              content = token.text || '';
            }
          }
          return `<li>${content}</li>`;
        }
      },
    },
  });

  // Add choice block support
  // TODO: Re-enable after fixing renderer registration
  // addChoiceBlockSupport(markedInstance);

  // Add tasks block support
  // TODO: Re-enable after fixing renderer registration
  // addTasksBlockSupport(markedInstance);

  return markedInstance;
};
