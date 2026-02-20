import type { ContentBlock } from '$shared/types';
import { marked } from 'marked';

/**
 * Render a text block to HTML using markdown processing
 */
export function renderTextBlock(text: string): string {
  if (!text || text.trim() === '') {
    return '';
  }

  try {
    // First escape HTML to prevent XSS, then process markdown
    // This ensures user-provided HTML is escaped but markdown formatting still works
    const escapedText = escapeHtml(text);
    // Use marked.parse for block-level markdown (handles paragraphs, lists, etc.)
    const html = marked.parse(escapedText);
    return `<div class="text-block">${html}</div>`;
  } catch (error) {
    console.error('Error rendering text block:', error);
    return `<div class="text-block"><p>${escapeHtml(text)}</p></div>`;
  }
}

/**
 * Render a code block to HTML with syntax highlighting
 */
export function renderCodeBlock(code: string, language?: string): string {
  const lang = language || 'plaintext';
  const escapedCode = escapeHtml(code);

  return `<pre class="code-block" data-language="${lang}"><code class="language-${lang}">${escapedCode}</code></pre>`;
}

/**
 * Render a tool call block as a collapsible details element
 */
export function renderToolCall(
  name: string,
  input: Record<string, any>,
  toolUseId?: string,
): string {
  const cleanName = cleanToolName(name);
  // Strip internal metadata fields (e.g., _acpTitle) from exported input
  const cleanInput = Object.fromEntries(Object.entries(input).filter(([k]) => !k.startsWith('_')));
  const inputJson = JSON.stringify(cleanInput, null, 2);

  return `<details class="tool-call" data-tool-id="${toolUseId || ''}">
    <summary class="tool-call-summary">
      <span class="tool-call-name">${escapeHtml(cleanName)}</span>
    </summary>
    <div class="tool-call-details">
      <pre class="tool-input"><code>${escapeHtml(inputJson)}</code></pre>
    </div>
  </details>`;
}

/**
 * Render a tool result block
 */
export function renderToolResult(
  output: any,
  isError: boolean = false,
  toolUseId?: string,
): string {
  // Return empty string for empty results (hide completely)
  if (output === null || output === undefined || output === '' ||
      (typeof output === 'string' && output.trim() === '')) {
    return '';
  }

  const outputStr = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
  const className = isError ? 'tool-result error' : 'tool-result';

  // Use collapsible <details> element, collapsed by default
  return `<details class="${className}" data-tool-id="${toolUseId || ''}">
    <summary class="tool-result-summary">${isError ? '❌ Error' : '✅ Result'}</summary>
    <pre class="tool-output"><code>${escapeHtml(outputStr)}</code></pre>
  </details>`;
}

/**
 * Render a thinking block as a collapsible section
 */
export function renderThinkingBlock(content: string): string {
  const escapedContent = escapeHtml(content);

  return `<details class="thinking-block">
    <summary class="thinking-summary">💭 Thinking</summary>
    <div class="thinking-content">
      <p>${escapedContent}</p>
    </div>
  </details>`;
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

/**
 * Escape HTML special characters
 */
export function escapeHtml(text: string | undefined | null): string {
  // Handle undefined or null values gracefully
  if (!text) {
    return '';
  }

  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (char) => map[char]);
}

/**
 * Render a content block to HTML
 */
export function renderContentBlock(block: ContentBlock): string {
  switch (block.type) {
    case 'text':
      return renderTextBlock(block.text || block.content || '');
    case 'code':
      return renderCodeBlock(block.text || block.content || '', block.language);
    case 'tool_use':
      return renderToolCall(block.name || '', block.input || {}, block.id);
    case 'tool_result':
      return renderToolResult(block.output, block.is_error || block.isError, block.tool_use_id);
    case 'thinking':
      return renderThinkingBlock(block.text || block.content || '');
    case 'image':
      return renderImageBlock(block.data || '', block.mimeType || '');
    case 'audio':
      return renderAudioBlock(block.data || '', block.mimeType || '', block.transcript);
    case 'file':
      return renderFileBlock(block.fileName || 'file', block.mimeType || '');
    default:
      return '';
  }
}

/**
 * Render an image block
 */
function renderImageBlock(data: string, mimeType: string): string {
  const dataUrl = `data:${mimeType};base64,${data}`;
  return `<div class="image-block"><img src="${dataUrl}" alt="Image" /></div>`;
}

/**
 * Render an audio block
 */
function renderAudioBlock(data: string, mimeType: string, transcript?: string): string {
  const dataUrl = `data:${mimeType};base64,${data}`;
  const transcriptHtml = transcript
    ? `<div class="audio-transcript"><p>${escapeHtml(transcript)}</p></div>`
    : '';
  return `<div class="audio-block">
    <audio controls src="${dataUrl}"></audio>
    ${transcriptHtml}
  </div>`;
}

/**
 * Render a file block (just show filename, data is not embedded for security)
 */
function renderFileBlock(fileName: string, mimeType: string): string {
  return `<div class="file-block">
    <span class="file-icon">📎</span>
    <span class="file-name">${escapeHtml(fileName)}</span>
    <span class="file-type">(${escapeHtml(mimeType)})</span>
  </div>`;
}
