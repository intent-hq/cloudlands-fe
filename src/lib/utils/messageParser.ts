/**
 * Utilities for parsing and formatting agent messages
 * Handles mixed content like file operations, command outputs, and regular text
 *
 * ARCHITECTURE:
 * The message parsing pipeline works as follows:
 *
 * 1. Auggie CLI outputs text in streaming mode (character-by-character)
 * 2. AuggieTextParser (auggie-text-parser.ts) parses the raw text stream into:
 *    - ParsedContent[] with types: "text", "tool_use", "tool_result", "session_info", "error", "digest"
 *    - Filters out tool headers, markers, and system messages
 *    - Only emits clean, user-facing content
 * 3. toContentBlocks() converts ParsedContent to ContentBlock[] for UI rendering
 * 4. cleanAgentMessage() performs final whitespace normalization
 *
 * KEY PRINCIPLE:
 * Tool artifacts (headers, parameters, markers) should be filtered by AuggieTextParser.
 * cleanAgentMessage() should only do basic whitespace cleanup, not complex filtering.
 * If tool content is leaking into messages, fix AuggieTextParser, not cleanAgentMessage.
 */

import { Logger } from '$shared/logger';
import type { SuggestedPrompt } from '$shared/types';

const logger = new Logger('MessageParser');

export interface ParsedContent {
  type:
    | 'text'
    | 'code'
    | 'file'
    | 'command'
    | 'output'
    | 'error'
    | 'augment_code_snippet'
    | 'diff'
    | 'commit_message'
    | 'diagram'
    | 'digest'
    | 'mermaid'
    | 'patch'
    | 'reference'
    | 'cli'
    | 'agent_action';
  content: string;
  metadata?: {
    language?: string;
    fileName?: string;
    command?: string;
    lineNumbers?: boolean;
    path?: string;
    mode?: string;
    diagramData?: unknown; // Parsed DiagramPrimitive data
    patchData?: { filePath: string; diff: string; description?: string }; // Parsed patch data
    referenceData?: {
      semanticId?: string;
      filePath?: string;
      description?: string;
      snapshot?: { code: string; filePath: string; languageId?: string };
    };
    cliData?: { command: string; description?: string; cwd?: string };
    agentActionData?: { agentId: string; goal: string; description?: string };
  };
}

/**
 * Parse agent message content into structured blocks
 * Handles special Auggie formats like <augment_code_snippet> tags, diffs, and commit messages
 */
// PERF: Pre-compiled regex patterns for single-pass extraction
const SPECIAL_BLOCK_PATTERNS = {
  // XML-style augment_code_snippet with 4 backticks
  augmentSnippet:
    /<augment_code_snippet\s+path="([^"]+)"(?:\s+mode="([^"]+)")?\s*>\s*````(\w+)?\s*\n([\s\S]*?)\n\s*````\s*<\/augment_code_snippet>/g,
  // Markdown 4-backtick with path= attribute
  markdown4: /````(\w+)?\s+path=([^\s]+)(?:\s+mode=([^\s\n]+))?\s*\n([\s\S]*?)\n````/g,
  // Markdown 3-backtick with path= attribute
  markdown3: /```(\w+)?\s+path=([^\s]+)(?:\s+mode=([^\s\n]+))?\s*\n([\s\S]*?)\n```/g,
  // Diff blocks
  diff: /```diff\n([\s\S]*?)```/g,
  // Commit messages
  commit: /<COMMIT_MESSAGE>([\s\S]*?)<\/COMMIT_MESSAGE>/g,
  // Diagram blocks (```diagram or ```ws-block:diagram)
  diagram: /```(?:diagram|ws-block:diagram)\s*\n([\s\S]*?)```/g,
  // Patch blocks (```ws-block:patch)
  patch: /```ws-block:patch\s*\n([\s\S]*?)```/g,
  // Reference blocks (```ws-block:reference)
  reference: /```ws-block:reference\s*\n([\s\S]*?)```/g,
  // CLI blocks (```ws-block:cli)
  cli: /```ws-block:cli\s*\n([\s\S]*?)```/g,
  // Agent action blocks (```ws-block:agent_action)
  agentAction: /```ws-block:agent_action\s*\n([\s\S]*?)```/g,
  // Mermaid diagram blocks
  mermaid: /```mermaid\s*\n([\s\S]*?)```/g,
  // Agent digest - short summary for display
  agentDigest: /<agent_digest>([\s\S]*?)<\/agent_digest>/g,
};

// PERF: Combined regex for single-pass special block detection
// This finds all special blocks in one pass through the content
const COMBINED_SPECIAL_REGEX =
  /(<augment_code_snippet\s+path="[^"]+"(?:\s+mode="[^"]+")?\s*>\s*````\w*\s*\n[\s\S]*?\n\s*````\s*<\/augment_code_snippet>|````\w*\s+path=[^\s]+(?:\s+mode=[^\s\n]+)?\s*\n[\s\S]*?\n````|```\w*\s+path=[^\s]+(?:\s+mode=[^\s\n]+)?\s*\n[\s\S]*?\n```|```diff\n[\s\S]*?```|<COMMIT_MESSAGE>[\s\S]*?<\/COMMIT_MESSAGE>|```(?:diagram|ws-block:diagram)\s*\n[\s\S]*?```|```ws-block:patch\s*\n[\s\S]*?```|```ws-block:reference\s*\n[\s\S]*?```|```ws-block:cli\s*\n[\s\S]*?```|```ws-block:agent_action\s*\n[\s\S]*?```|```mermaid\s*\n[\s\S]*?```|<agent_digest>[\s\S]*?<\/agent_digest>)/g;

/**
 * Parse a single special block match into a ParsedContent
 * PERF: Avoids re-running regex on the full content
 */
function parseSpecialBlock(blockText: string): ParsedContent | null {
  // Check augment_code_snippet first (most specific)
  if (blockText.startsWith('<augment_code_snippet')) {
    const match = blockText.match(
      /<augment_code_snippet\s+path="([^"]+)"(?:\s+mode="([^"]+)")?\s*>\s*````(\w+)?\s*\n([\s\S]*?)\n\s*````\s*<\/augment_code_snippet>/,
    );
    if (match) {
      return {
        type: 'augment_code_snippet',
        content: match[4].trim(),
        metadata: {
          path: match[1],
          mode: match[2] || 'EXCERPT',
          language: match[3] || 'plaintext',
        },
      };
    }
  }

  // Check 4-backtick markdown with path
  if (blockText.startsWith('````')) {
    const match = blockText.match(
      /````(\w+)?\s+path=([^\s]+)(?:\s+mode=([^\s\n]+))?\s*\n([\s\S]*?)\n````/,
    );
    if (match) {
      return {
        type: 'augment_code_snippet',
        content: match[4].trim(),
        metadata: {
          path: match[2] || '',
          mode: match[3] || 'EXCERPT',
          language: match[1] || 'plaintext',
        },
      };
    }
  }

  // Check 3-backtick markdown with path (but not diff)
  if (blockText.startsWith('```') && !blockText.startsWith('```diff')) {
    const match = blockText.match(
      /```(\w+)?\s+path=([^\s]+)(?:\s+mode=([^\s\n]+))?\s*\n([\s\S]*?)\n```/,
    );
    if (match) {
      return {
        type: 'augment_code_snippet',
        content: match[4].trim(),
        metadata: {
          path: match[2] || '',
          mode: match[3] || 'EXCERPT',
          language: match[1] || 'plaintext',
        },
      };
    }
  }

  // Check diff block
  if (blockText.startsWith('```diff')) {
    const match = blockText.match(/```diff\n([\s\S]*?)```/);
    if (match) {
      return {
        type: 'diff',
        content: match[1].trim(),
      };
    }
  }

  // Check commit message
  if (blockText.startsWith('<COMMIT_MESSAGE>')) {
    const match = blockText.match(/<COMMIT_MESSAGE>([\s\S]*?)<\/COMMIT_MESSAGE>/);
    if (match) {
      return {
        type: 'commit_message',
        content: match[1].trim(),
      };
    }
  }

  // Check patch block (```ws-block:patch)
  if (blockText.startsWith('```ws-block:patch')) {
    const match = blockText.match(/```ws-block:patch\s*\n([\s\S]*?)```/);
    if (match) {
      try {
        const jsonContent = match[1].trim();
        // Try parsing as-is first, then fall back to escaping literal newlines.
        // The diff field often contains literal newline characters (from the agent's
        // raw output) which are invalid inside JSON string values.
        let patchJson;
        try {
          patchJson = JSON.parse(jsonContent);
        } catch {
          const sanitizedJson = jsonContent
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t');
          patchJson = JSON.parse(sanitizedJson);
        }

        // Support both formats:
        // 1. Simplified: { target: { filePath, diff, description } }
        // 2. Standard PatchPrimitive: { type: 'patch', patches: [{ filePath, diff }], label }
        let filePath = '';
        let diff = '';
        let description = '';

        if (patchJson.target) {
          filePath = patchJson.target.filePath || '';
          diff = patchJson.target.diff || '';
          description = patchJson.target.description || patchJson.description || '';
        } else if (patchJson.patches && patchJson.patches.length > 0) {
          filePath = patchJson.patches[0].filePath || '';
          diff = patchJson.patches[0].diff || '';
          description = patchJson.label || patchJson.description || '';
        } else {
          // Flat format: { filePath, diff, description }
          filePath = patchJson.filePath || '';
          diff = patchJson.diff || '';
          description = patchJson.description || patchJson.label || '';
        }

        return {
          type: 'patch',
          content: diff,
          metadata: {
            path: filePath,
            patchData: { filePath, diff, description },
          },
        };
      } catch (e) {
        logger.warn('[parseSpecialBlock] Failed to parse patch JSON:', e);
        return {
          type: 'text',
          content: blockText,
        };
      }
    }
  }

  // Check reference block (```ws-block:reference)
  if (blockText.startsWith('```ws-block:reference')) {
    const match = blockText.match(/```ws-block:reference\s*\n([\s\S]*?)```/);
    if (match) {
      try {
        const jsonContent = match[1].trim();
        let refJson;
        try {
          refJson = JSON.parse(jsonContent);
        } catch {
          const sanitizedJson = jsonContent
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t');
          refJson = JSON.parse(sanitizedJson);
        }

        const semanticId = refJson.target?.semanticId || refJson.semanticId || '';
        const filePath = refJson.target?.filePath || refJson.filePath || semanticId?.split('#')[0] || '';
        const description = refJson.description || '';
        const snapshot = refJson.snapshot || undefined;

        return {
          type: 'reference',
          content: description || semanticId || filePath,
          metadata: {
            path: filePath,
            referenceData: { semanticId, filePath, description, snapshot },
          },
        };
      } catch (e) {
        logger.warn('[parseSpecialBlock] Failed to parse reference JSON:', e);
        return { type: 'text', content: blockText };
      }
    }
  }

  // Check CLI block (```ws-block:cli)
  if (blockText.startsWith('```ws-block:cli')) {
    const match = blockText.match(/```ws-block:cli\s*\n([\s\S]*?)```/);
    if (match) {
      try {
        const jsonContent = match[1].trim();
        let cliJson;
        try {
          cliJson = JSON.parse(jsonContent);
        } catch {
          const sanitizedJson = jsonContent
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t');
          cliJson = JSON.parse(sanitizedJson);
        }

        const command = cliJson.command || '';
        const description = cliJson.description || '';
        const cwd = cliJson.cwd || undefined;

        return {
          type: 'cli',
          content: command,
          metadata: {
            cliData: { command, description, cwd },
          },
        };
      } catch (e) {
        logger.warn('[parseSpecialBlock] Failed to parse CLI JSON:', e);
        return { type: 'text', content: blockText };
      }
    }
  }

  // Check agent action block (```ws-block:agent_action)
  if (blockText.startsWith('```ws-block:agent_action')) {
    const match = blockText.match(/```ws-block:agent_action\s*\n([\s\S]*?)```/);
    if (match) {
      try {
        const jsonContent = match[1].trim();
        let actionJson;
        try {
          actionJson = JSON.parse(jsonContent);
        } catch {
          const sanitizedJson = jsonContent
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t');
          actionJson = JSON.parse(sanitizedJson);
        }

        const agentId = actionJson.agentId || '';
        const goal = actionJson.goal || '';
        const description = actionJson.description || '';

        return {
          type: 'agent_action',
          content: goal,
          metadata: {
            agentActionData: { agentId, goal, description },
          },
        };
      } catch (e) {
        logger.warn('[parseSpecialBlock] Failed to parse agent action JSON:', e);
        return { type: 'text', content: blockText };
      }
    }
  }

  // Check diagram block (```diagram or ```ws-block:diagram)
  if (blockText.startsWith('```diagram') || blockText.startsWith('```ws-block:diagram')) {
    const match = blockText.match(/```(?:diagram|ws-block:diagram)\s*\n([\s\S]*?)```/);
    if (match) {
      try {
        const jsonContent = match[1].trim();
        const diagramData = JSON.parse(jsonContent);
        return {
          type: 'diagram',
          content: jsonContent,
          metadata: {
            diagramData,
          },
        };
      } catch (e) {
        logger.warn('[parseSpecialBlock] Failed to parse diagram JSON:', e);
        // Return as text if JSON parsing fails
        return {
          type: 'text',
          content: blockText,
        };
      }
    }
  }

  // Check mermaid block
  if (blockText.startsWith('```mermaid')) {
    const match = blockText.match(/```mermaid\s*\n([\s\S]*?)```/);
    if (match) {
      return {
        type: 'mermaid',
        content: match[1].trim(),
      };
    }
  }

  // Check agent digest block
  if (blockText.startsWith('<agent_digest>')) {
    const match = blockText.match(/<agent_digest>([\s\S]*?)<\/agent_digest>/);
    if (match) {
      const digestContent = match[1].trim();
      if (digestContent) {
        return {
          type: 'digest',
          content: digestContent,
        };
      }
    }
  }

  return null;
}

export function parseAgentMessage(content: string): ParsedContent[] {
  if (!content) return [];

  // PERF: Single-pass extraction of all special blocks
  // Instead of running 5 separate regex passes, we find all special blocks at once
  const specialBlocks: Array<{ start: number; end: number; block: ParsedContent }> = [];

  // Reset regex state
  COMBINED_SPECIAL_REGEX.lastIndex = 0;

  let match;
  while ((match = COMBINED_SPECIAL_REGEX.exec(content)) !== null) {
    const blockText = match[0];
    const parsed = parseSpecialBlock(blockText);
    if (parsed) {
      specialBlocks.push({
        start: match.index,
        end: match.index + blockText.length,
        block: parsed,
      });
    }
  }

  // PERF: Build result array directly without placeholder replacement
  // This avoids multiple string.replace() calls which are O(n) each
  if (specialBlocks.length === 0) {
    // No special blocks - process as regular content
    return processRegularContent(content);
  }

  // Sort by position (should already be sorted, but ensure)
  specialBlocks.sort((a, b) => a.start - b.start);

  const result: ParsedContent[] = [];
  let lastEnd = 0;

  for (const { start, end, block } of specialBlocks) {
    // Add text content before this special block
    if (start > lastEnd) {
      const textBefore = content.slice(lastEnd, start);
      const textBlocks = processRegularContent(textBefore);
      result.push(...textBlocks);
    }

    // Add the special block
    result.push(block);
    lastEnd = end;
  }

  // Add any remaining text after the last special block
  if (lastEnd < content.length) {
    const textAfter = content.slice(lastEnd);
    const textBlocks = processRegularContent(textAfter);
    result.push(...textBlocks);
  }

  // Merge consecutive text blocks
  return mergeConsecutiveTextBlocks(result);
}

/**
 * Process regular content (non-special blocks) into ParsedContent[]
 * PERF: Extracted to avoid code duplication and enable early returns
 */
// PERF: Pre-compiled patterns for line processing (avoid re-creating on each call)
const LINE_PATTERNS = {
  // File content with line numbers (e.g., "1→content" or "   1	content")
  fileWithLineNumbers: /^\s*\d+[→\t]/,
  // Command execution
  command: /^\$\s+(.+)$/,
  commandAlt: /^>\s+(.+)$/,
  // Error messages
  error: /^(error|Error|ERROR)[\s:]/i,
  warning: /^(warning|Warning|WARNING)[\s:]/i,
  // Common file operation outputs
  fileOperation: /^(Created|Updated|Deleted|Modified|Reading|Writing|Editing)\s+/i,
};

function processRegularContent(content: string): ParsedContent[] {
  if (!content.trim()) return [];

  const blocks: ParsedContent[] = [];
  const lines = content.split('\n');
  let currentBlock: ParsedContent | null = null;
  let blockLines: string[] = [];

  function flushBlock() {
    if (currentBlock && blockLines.length > 0) {
      currentBlock.content = blockLines.join('\n').trim();
      if (currentBlock.content) {
        blocks.push(currentBlock);
      }
    }
    currentBlock = null;
    blockLines = [];
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    // Skip empty lines between blocks
    if (!trimmedLine && !currentBlock) {
      continue;
    }

    // Check for file content with line numbers
    if (LINE_PATTERNS.fileWithLineNumbers.test(line)) {
      if (currentBlock?.type !== 'file') {
        flushBlock();
        currentBlock = {
          type: 'file',
          content: '',
          metadata: { lineNumbers: true },
        };
      }
      blockLines.push(line);
      continue;
    }

    // Check for command execution
    const commandMatch = line.match(LINE_PATTERNS.command) || line.match(LINE_PATTERNS.commandAlt);
    if (commandMatch) {
      flushBlock();
      currentBlock = {
        type: 'command',
        content: '',
        metadata: { command: commandMatch[1] },
      };
      blockLines.push(commandMatch[1]);
      continue;
    }

    // Check for errors or warnings
    if (LINE_PATTERNS.error.test(trimmedLine)) {
      if (currentBlock?.type !== 'error') {
        flushBlock();
        currentBlock = { type: 'error', content: '' };
      }
      blockLines.push(line);
      continue;
    }

    if (LINE_PATTERNS.warning.test(trimmedLine)) {
      if (currentBlock?.type !== 'error') {
        flushBlock();
        currentBlock = { type: 'error', content: '' };
      }
      blockLines.push(line);
      continue;
    }

    // Check for code blocks (including indented code fences for list items)
    // Match ``` at start of line OR with leading whitespace (for nested code blocks in lists)
    const codeFenceMatch = line.match(/^(\s*)```(.*)$/);
    if (codeFenceMatch) {
      flushBlock();
      const indent = codeFenceMatch[1];
      const lang = codeFenceMatch[2].trim();
      currentBlock = {
        type: 'code',
        content: '',
        metadata: { language: lang || 'plaintext' },
      };

      // Find the closing ``` (with same or less indentation)
      i++;
      while (i < lines.length) {
        const closingMatch = lines[i].match(/^(\s*)```\s*$/);
        if (closingMatch) {
          // Found closing fence
          break;
        }
        blockLines.push(lines[i]);
        i++;
      }
      flushBlock();
      continue;
    }

    // Check for file operations
    if (LINE_PATTERNS.fileOperation.test(trimmedLine)) {
      if (currentBlock?.type !== 'output') {
        flushBlock();
        currentBlock = { type: 'output', content: '' };
      }
      blockLines.push(line);
      continue;
    }

    // Default to text or continue current block
    if (!currentBlock) {
      currentBlock = { type: 'text', content: '' };
    }
    blockLines.push(line);
  }

  // Flush any remaining block
  flushBlock();

  return blocks;
}

/**
 * Merge consecutive text blocks into single blocks
 * PERF: Extracted for reuse and clarity
 */
function mergeConsecutiveTextBlocks(blocks: ParsedContent[]): ParsedContent[] {
  if (blocks.length <= 1) return blocks;

  const merged: ParsedContent[] = [];
  for (const block of blocks) {
    const lastBlock = merged[merged.length - 1];
    if (lastBlock?.type === 'text' && block.type === 'text') {
      lastBlock.content += `\n\n${block.content}`;
    } else {
      merged.push(block);
    }
  }
  return merged;
}

/**
 * Format parsed content blocks into markdown
 */
export function formatParsedContent(blocks: ParsedContent[]): string {
  return blocks
    .map((block) => {
      switch (block.type) {
        case 'augment_code_snippet':
          // Format as a special code block with metadata
          return `\`\`\`${block.metadata?.language || ''}:augment-snippet:${block.metadata?.path || ''}:${block.metadata?.mode || 'EXCERPT'}\n${
            block.content
          }\n\`\`\``;

        case 'code':
          return `\`\`\`${block.metadata?.language || ''}\n${block.content}\n\`\`\``;

        case 'file':
          if (block.metadata?.fileName) {
            return `**File: ${block.metadata.fileName}**\n\`\`\`\n${block.content}\n\`\`\``;
          }
          return `\`\`\`\n${block.content}\n\`\`\``;

        case 'command':
          return `**Command:**\n\`\`\`bash\n$ ${block.metadata?.command || block.content}\n\`\`\``;

        case 'output':
          return `\`\`\`\n${block.content}\n\`\`\``;

        case 'error':
          return `> ⚠️ **Error:**\n> ${block.content.split('\n').join('\n> ')}`;

        case 'text':
        default:
          return block.content;
      }
    })
    .join('\n\n');
}

/**
 * Clean and format agent message for display
 */
export function cleanAgentMessage(content: string): string {
  if (!content) return '';

  // Remove ANSI escape codes
  let cleaned = content.replace(/\u001b\[[0-9;]*m/g, '');

  // Remove tool call blocks by splitting on robot emoji
  // The robot emoji (🤖) marks the start of actual assistant content
  const robotEmojiIndex = cleaned.indexOf('🤖');
  if (robotEmojiIndex !== -1) {
    const beforeRobot = cleaned.substring(0, robotEmojiIndex);
    const afterRobot = cleaned.substring(robotEmojiIndex).trim();

    // If there are tool calls before the robot emoji, remove that entire section
    if (beforeRobot.includes('Tool call:') || beforeRobot.includes('Tool result:')) {
      // Remove the robot emoji itself and keep the content after it
      cleaned = afterRobot.replace(/^🤖\s*/, '');
    }
  }

  // Remove logs section and everything after it
  // The "logs:" marker indicates the start of debug/system logs that shouldn't be in the message
  const logsIndex = cleaned.indexOf('\nlogs:');
  if (logsIndex !== -1) {
    cleaned = cleaned.substring(0, logsIndex);
  }

  // Normalize whitespace - primary cleanup
  // The AuggieTextParser should have already filtered out tool artifacts
  cleaned = cleaned
    // Remove trailing whitespace from each line
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    // Remove excessive blank lines (more than 2 consecutive)
    .replace(/\n{3,}/g, '\n\n')
    // Trim overall
    .trim();

  // Parse and format the content
  const parsed = parseAgentMessage(cleaned);

  // If we successfully parsed into multiple blocks, format them
  if (parsed.length > 1) {
    return formatParsedContent(parsed);
  }

  // Otherwise return the cleaned content
  return cleaned.trim();
}

/**
 * Extract tool calls from message content
 *
 * Uses Auggie CLI's standard patterns:
 * - Tool call: \x1b[90m🔧 Tool call: {name}\x1b[0m (grey ANSI)
 * - Tool result: 📋 {name} ✅/❌
 * - Parameters: Indented with 3 spaces after tool call
 */
export function extractToolCalls(content: string): Array<{
  id: string;
  name: string;
  input?: any;
  output?: string;
  error?: string;
  phase: 'start' | 'result';
}> {
  logger.debug('[extractToolCalls] Starting extraction from content length:', content.length);
  const toolCalls: Array<any> = [];
  const lines = content.split('\n');
  logger.debug('[extractToolCalls] Split into', lines.length, 'lines');

  // Auggie CLI standard patterns (from auggie-cli-chat-ui-guide.md)
  const patterns = {
    // Tool call with ANSI grey color: \x1b[90m🔧 Tool call: name\x1b[0m
    toolCallStart: /\x1b\[90m🔧\s+Tool call:\s+(.+?)\x1b\[0m/,
    // Tool call without ANSI (fallback): 🔧 Tool call: name
    toolCallStartNoAnsi: /🔧\s+Tool call:\s+(.+?)$/,
    // Tool result compact format: 📋 name ✅/❌
    toolResultCompact: /📋\s+(.+?)\s+(✅|❌)/,
    // Tool result with ANSI: \x1b[90m📋 name\x1b[0m
    toolResultStart: /\x1b\[90m📋\s+(.+?)\x1b\[0m/,
    // Tool result without ANSI (fallback): 📋 name
    toolResultStartNoAnsi: /📋\s+(.+?)$/,
    // Tool parameters: 3 spaces indentation
    toolParameter: /^ {3}(.+)$/,
    // ANSI color codes (for stripping)
    ansiColor: /\x1b\[[0-9;]*m/g,
  };

  let currentTool: any = null;
  let outputLines: string[] = [];
  let inputLines: string[] = [];
  let inCodeBlock = false;
  let codeBlockType = '';
  let collectingInput = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Check for Auggie CLI tool call start (with ANSI codes)
    let toolCallStartMatch = line.match(patterns.toolCallStart);
    // Fallback to non-ANSI version if needed
    if (!toolCallStartMatch) {
      toolCallStartMatch = trimmed.match(patterns.toolCallStartNoAnsi);
    }

    if (toolCallStartMatch) {
      logger.debug('[extractToolCalls] Found tool call start:', toolCallStartMatch[1]);
      // Save previous tool if exists
      if (currentTool) {
        if (outputLines.length > 0) {
          currentTool.output = outputLines.join('\n');
        }
        toolCalls.push(currentTool);
      }

      const toolName = toolCallStartMatch[1].trim();
      currentTool = {
        id: `tool-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
        name: toolName,
        phase: 'start' as const,
        input: {},
      };
      outputLines = [];
      inputLines = [];
      collectingInput = true;
      continue;
    }

    // Check for Auggie CLI tool result (compact format: 📋 name ✅/❌)
    let toolResultMatch = trimmed.match(patterns.toolResultCompact);

    // Fallback to detailed format with ANSI codes
    if (!toolResultMatch) {
      toolResultMatch = line.match(patterns.toolResultStart);
    }

    // Fallback to non-ANSI version
    if (!toolResultMatch) {
      toolResultMatch = trimmed.match(patterns.toolResultStartNoAnsi);
    }

    if (toolResultMatch) {
      const toolName = toolResultMatch[1].trim();
      const success = toolResultMatch[2] === '✅' || !toolResultMatch[2]; // Default to success if no status

      if (currentTool && currentTool.name === toolName) {
        // This is the result for the current tool call
        // Parse input from collected lines if we haven't already
        if (inputLines.length > 0 && Object.keys(currentTool.input || {}).length === 0) {
          currentTool.input = parseToolInput(inputLines);
        }
        // Push the "start" phase
        toolCalls.push({ ...currentTool });

        // Now create the "result" phase with same input
        currentTool = {
          id: `tool-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
          name: toolName,
          phase: 'result' as const,
          input: currentTool.input,
        };
      } else {
        // Save previous tool if exists
        if (currentTool) {
          if (inputLines.length > 0) {
            currentTool.input = parseToolInput(inputLines);
          }
          toolCalls.push(currentTool);
        }

        // Start new result-only tool call
        currentTool = {
          id: `tool-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
          name: toolName,
          phase: 'result' as const,
          input: {},
        };
      }

      outputLines = [];
      inputLines = [];
      collectingInput = false;
      continue;
    }

    // Collect input parameters (3 spaces indentation per Auggie CLI standard)
    const paramMatch = line.match(patterns.toolParameter);
    if (collectingInput && currentTool && paramMatch) {
      inputLines.push(paramMatch[1]);
      continue;
    } else if (collectingInput && trimmed && !trimmed.startsWith('...')) {
      // Non-indented line means we're done collecting input
      collectingInput = false;
    }

    // Check for code block markers
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        // End of code block
        if (currentTool && outputLines.length > 0) {
          currentTool.output = outputLines.join('\n');
          toolCalls.push(currentTool);
          currentTool = null;
          outputLines = [];
        }
        inCodeBlock = false;
        codeBlockType = '';
      } else {
        // Start of code block
        inCodeBlock = true;
        codeBlockType = line.slice(3).trim();
      }
      continue;
    }

    // If we're in a code block, collect the content
    if (inCodeBlock) {
      outputLines.push(line);
      continue;
    }

    // Note: File viewing, directory listing, and file edit patterns are now
    // handled by the AuggieTextParser which uses proper tool call markers.
    // These hacky string matching patterns have been removed in favor of
    // the standard Auggie CLI patterns (🔧 Tool call:, 📋 Tool result:, etc.)

    // Collect output lines if we have a current tool and not collecting input
    if (currentTool && !collectingInput && trimmed && !trimmed.startsWith('...')) {
      outputLines.push(line);
    }
  }

  // Save any remaining tool
  if (currentTool) {
    if (inputLines.length > 0 && currentTool.phase === 'start') {
      currentTool.input = parseToolInput(inputLines);
    }
    if (outputLines.length > 0) {
      currentTool.output = outputLines.join('\n');
    }
    toolCalls.push(currentTool);
  }

  logger.debug('[extractToolCalls] Extracted', toolCalls.length, 'tool calls:', toolCalls);
  return toolCalls;
}

/**
 * Parse tool input parameters from indented lines
 */
function parseToolInput(lines: string[]): any {
  const input: any = {};
  let currentKey: string | null = null;
  let currentValue: string[] = [];
  let inMultilineString = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check if this line starts a new parameter (has a colon near the beginning)
    // But not if we're inside a multi-line string value
    const colonIndex = line.indexOf(':');
    const potentialKey = colonIndex > 0 ? line.substring(0, colonIndex).trim() : '';

    // A line is a new parameter if:
    // 1. It has a colon within the first 30 chars
    // 2. The part before the colon looks like a parameter name (alphanumeric, underscore, dash)
    // 3. We're not currently inside a multi-line string
    const isNewParam =
      colonIndex > 0 &&
      colonIndex < 30 &&
      /^[a-zA-Z_][\w-]*$/.test(potentialKey) &&
      !inMultilineString;

    if (isNewParam) {
      // Save previous parameter if exists
      if (currentKey) {
        let value = currentValue.join('\n').trim();
        // Remove surrounding quotes if present
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
          inMultilineString = false;
        }
        input[currentKey] = value;
      }

      // Start new parameter
      currentKey = potentialKey;
      const valueStart = line.substring(colonIndex + 1).trim();
      currentValue = [valueStart];

      // Check if this starts a multi-line string (starts with quote but doesn't end with one)
      if (
        (valueStart.startsWith('"') && !valueStart.endsWith('"')) ||
        (valueStart.startsWith("'") && !valueStart.endsWith("'"))
      ) {
        inMultilineString = true;
      }
    } else if (currentKey) {
      // Continue current parameter value (multi-line)
      currentValue.push(line);

      // Check if this line ends the multi-line string
      if (inMultilineString && (line.trim().endsWith('"') || line.trim().endsWith("'"))) {
        inMultilineString = false;
      }
    }
  }

  // Save last parameter
  if (currentKey) {
    let value = currentValue.join('\n').trim();
    // Remove surrounding quotes if present
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    input[currentKey] = value;
  }

  return input;
}

/**
 * Regex to match suggested prompts block in HTML comment format.
 * Format:
 * <!-- suggested-prompts
 * Label text|Full prompt text to populate in input
 * Another label|Another full prompt
 * -->
 */
const SUGGESTED_PROMPTS_REGEX = /<!--\s*suggested-prompts\s*\n([\s\S]*?)-->/;

/**
 * Regex to match the delay prefix in a prompt line.
 * Format: delay:N| where N is an integer (case-insensitive)
 */
const DELAY_PREFIX_REGEX = /^delay:(\d+)\|(.*)$/i;

/**
 * Parse suggested prompts from message content.
 * Returns an object with the prompts array and the content with the suggestions block removed.
 *
 * Format expected:
 * <!-- suggested-prompts
 * A one-sentence prompt to send immediately
 * Another prompt sentence
 * -->
 *
 * Also supports "Label|Full prompt" syntax where the label is stripped:
 * <!-- suggested-prompts
 * Short label|Let me examine a specific component - which part would you like me to focus on?
 * -->
 *
 * Also strips "delay:N|prompt text" syntax, returning just the text:
 * <!-- suggested-prompts
 * Run tests now
 * delay:60|Check deployment status
 * Label|delay:30|Check build results
 * -->
 */
export function parseSuggestedPrompts(content: string): {
  prompts: SuggestedPrompt[];
  cleanedContent: string;
} {
  if (!content) {
    return { prompts: [], cleanedContent: content };
  }

  const match = content.match(SUGGESTED_PROMPTS_REGEX);
  if (!match) {
    return { prompts: [], cleanedContent: content };
  }

  const promptsBlock = match[1];
  const lines = promptsBlock.split('\n').filter((line) => line.trim());

  const prompts: SuggestedPrompt[] = lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line): SuggestedPrompt | null => {
      // Strip delay:N| prefix on full line (case-insensitive), returning just the text
      // This handles "delay:60|Check deployment" format
      const fullDelayMatch = line.match(DELAY_PREFIX_REGEX);
      if (fullDelayMatch) {
        const text = fullDelayMatch[2].trim();
        return text.length > 0 ? text : null;
      }

      // Support "Label|Full prompt" syntax - extract just the prompt part after the first pipe
      const pipeIndex = line.indexOf('|');
      let promptPart = line;
      if (pipeIndex !== -1) {
        promptPart = line.slice(pipeIndex + 1).trim();

        // Strip delay:N| prefix after label (handles "Label|delay:30|text" format)
        const delayMatch = promptPart.match(DELAY_PREFIX_REGEX);
        if (delayMatch) {
          const text = delayMatch[2].trim();
          return text.length > 0 ? text : null;
        }
      }

      // Return as plain string
      return promptPart.length > 0 ? promptPart : null;
    })
    .filter((prompt): prompt is SuggestedPrompt => prompt !== null);

  // Remove the suggestions block from the content
  const cleanedContent = content.replace(SUGGESTED_PROMPTS_REGEX, '').trim();

  return { prompts, cleanedContent };
}

/**
 * Check if content contains suggested prompts
 */
export function hasSuggestedPrompts(content: string): boolean {
  return SUGGESTED_PROMPTS_REGEX.test(content);
}
