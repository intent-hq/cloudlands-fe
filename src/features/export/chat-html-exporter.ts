import type { AgentMessage } from '$shared/types';
import { formatDateTime } from '$lib/i18n/format';
import {
  renderContentBlock,
  escapeHtml,
} from './content-renderer';
import { getHtmlTemplate } from './html-template';

/**
 * Options for exporting chat to HTML
 */
export interface ExportOptions {
  /** Title for the exported chat */
  title: string;
  /** Optional export timestamp */
  exportedAt?: Date;
  /** Optional agent name to include in metadata */
  agentName?: string;
}

/**
 * Export a chat conversation to a self-contained HTML string
 *
 * @param messages - Array of AgentMessage objects to export
 * @param options - Export options including title and optional metadata
 * @returns A complete HTML string that can be saved as a file
 */
export function exportChatToHtml(messages: AgentMessage[], options: ExportOptions): string {
  if (!messages || messages.length === 0) {
    return getHtmlTemplate(options.title, '<p>No messages to export.</p>', options.exportedAt);
  }

  // Render all messages to HTML
  const messagesHtml = messages.map((msg) => renderMessage(msg)).join('\n');

  // Return complete HTML document
  return getHtmlTemplate(options.title, messagesHtml, options.exportedAt);
}

/**
 * Render a single message to HTML
 */
function renderMessage(message: AgentMessage): string {
  const role = message.role || 'assistant';
  const timestamp = formatDateTime(message.timestamp ?? new Date());
  const turnNumber = message.turnNumber ? `Turn ${message.turnNumber}` : '';

  // Build header metadata
  const headerParts = [role.charAt(0).toUpperCase() + role.slice(1)];
  if (turnNumber) headerParts.push(turnNumber);

  const headerMeta = headerParts.join(' • ');

  // Render content blocks
  const contentHtml = renderMessageContent(message);

  // Render tool calls if present
  const toolCallsHtml = renderToolCalls(message);

  // Render tool results if present
  const toolResultsHtml = renderToolResults(message);

  return `<div class="message ${role}">
    <div class="message-header">
      <span class="message-role">${escapeHtml(headerMeta)}</span>
      <span class="message-timestamp">${timestamp}</span>
    </div>
    <div class="message-content">
      ${contentHtml}
      ${toolCallsHtml}
      ${toolResultsHtml}
    </div>
  </div>`;
}

/**
 * Render message content blocks
 */
function renderMessageContent(message: AgentMessage): string {
  if (!message.contentBlocks || message.contentBlocks.length === 0) {
    return '';
  }

  return message.contentBlocks.map((block) => renderContentBlock(block)).join('\n');
}

/**
 * Render tool calls from message
 */
function renderToolCalls(message: AgentMessage): string {
  if (!message.toolCalls || message.toolCalls.length === 0) {
    return '';
  }

  return message.toolCalls
    .map((toolCall) => {
      const cleanName = cleanToolName(toolCall.name || '');
      const inputJson = JSON.stringify(toolCall.arguments || {}, null, 2);

      return `<details class="tool-call" data-tool-id="${toolCall.id || ''}">
        <summary class="tool-call-summary">
          <span class="tool-call-name">🔧 ${escapeHtml(cleanName)}</span>
        </summary>
        <div class="tool-call-details">
          <pre class="tool-input"><code>${escapeHtml(inputJson)}</code></pre>
        </div>
      </details>`;
    })
    .join('\n');
}

/**
 * Render tool results from message
 */
function renderToolResults(message: AgentMessage): string {
  if (!message.toolResults || message.toolResults.length === 0) {
    return '';
  }

  return message.toolResults
    .map((result) => {
      // Handle different content structures
      let content = result.content;
      let isError = false;

      // Check if content is an object with isError flag
      if (typeof content === 'object' && content !== null) {
        isError = content.isError || false;
        // If content is an object, stringify it
        if (typeof content !== 'string') {
          content = JSON.stringify(content, null, 2);
        }
      } else if (typeof content === 'string') {
        // String content - check if it looks like an error
        isError = result.isError || false;
      }

      const outputStr = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
      const className = isError ? 'tool-result error' : 'tool-result';

      return `<div class="${className}" data-tool-id="${result.toolCallId || ''}">
        <div class="tool-result-label">${isError ? '❌ Error' : '✅ Result'}</div>
        <pre class="tool-output"><code>${escapeHtml(outputStr)}</code></pre>
      </div>`;
    })
    .join('\n');
}

/**
 * Clean tool name by removing MCP server suffixes
 */
function cleanToolName(name: string | undefined | null): string {
  // Handle undefined or null values gracefully
  if (!name) {
    return '';
  }

  // Handle //local/mcp/tool_name style URLs
  const mcpUrlMatch = name.match(/^\/\/local\/mcp\/(.+)$/);
  if (mcpUrlMatch) {
    name = mcpUrlMatch[1];
  }

  // Strip common suffixes
  return name
    .replace(/_workspace-mcp$/, '')
    .replace(/-workspace-mcp$/, '')
    .replace(/_Playwright$/, '')
    .replace(/_Browser_MCP$/, '')
    .replace(/_Context_7$/, '')
    .replace(/_svelte$/, '')
    .replace(/_augment$/, '')
    .replace(/-augment$/, '')
    .replace(/_npx$/, '');
}
