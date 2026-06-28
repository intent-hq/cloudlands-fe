import type { WorkspaceId } from '$shared/types/branded-ids';
import { createWorkspaceId } from '$shared/types';
import { agentCircuitBreaker } from '$shared/services/agent-circuit-breaker';
/**
 * ACP Agent Provider
 *
 * Agent provider that connects to any ACP-compatible agent.
 * Uses the official ACP protocol implementation.
 */

import {
  buildProviderEnv,
  createCompoundModelId,
  getDefaultProviderId,
  getProviderAuthErrorMessage,
  isProviderAuthenticationError,
  parseCompoundModelId,
} from '$shared/config/provider-config';
import { AGENT_STREAMING_CONFIG } from '$shared/constants/agent-streaming';
import { unifiedIdService } from '$shared/services/unified-id.service';
import {
  ChildProcess,
  spawn,
  SpawnOptions,
} from 'child_process';
import {
  app,
  BrowserWindow,
} from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { Logger } from '../../../../shared/logger';
import { WorkspaceConfig } from '../../../../shared/main/config';
import { writeJsonWithSync } from '../../../../shared/main/file-sync-utils';
import { killChildProcessTree } from '../../../../shared/main/process-tree-kill';
import { sshManager } from '../../../../shared/main/ssh-manager';
import { findAuggiePathAsync } from '../../../auggie/main/auggie.ipc';
import type { ContentBlock } from '../../../../shared/types';
import { extractContentFromBlocks } from '../../../../shared/types/agent-message.conversion';
import type { ACPServerConfig } from '../../../acp-official/main/server/acp-server';
import { ACPServer } from '../../../acp-official/main/server/acp-server';
import {
  ACPStreamParser,
  extractACPToolCalls,
  parseACPMessage,
} from '../../../acp-official/parsers/acp-message-parser';
import {
  mainDispatch,
  getMainState,
} from '../../../../store/main/redux-store-bridge';
import { selectAgentSubscriptions } from '../../../../store/main/slices/agent-subscriptions/agent-subscriptions-selectors';
import {
  agentAuthRequired,
  agentPlanRequired,
} from '../../../../store/main/slices/agent-events/agent-events-slice';
import {
  normalizeMcpServers,
  toAcpMcpServers,
  toCodexMcpOverrides,
  toOpenCodeMcpConfig,
  toPiMcpJson,
} from '../../../mcp/main/universal-mcp-config';
import type { AcpMcpServer } from '../../../mcp/main/universal-mcp-config';
import type { McpServerConfig } from '../../../mcp/main/user-mcp-settings';
import {
  mergeUserMcpServers,
  mergeUserMcpServersWithAuth,
  readUserMcpServers,
} from '../../../mcp/main/user-mcp-settings';
import {
  applyBaselineEnvToStdioServers,
  redactMcpEnvForLogging,
} from '../../../mcp/main/mcp-env';
import {
  CONFLICTING_BUILTIN_TOOLS,
  FILE_WRITE_TOOLS,
  getToolDenylistForAgentType,
  SUBAGENT_TOOLS,
} from '../../config/background-agent-tool-restrictions';
import { resolveSpecialistForAgent } from '../specialists.service';
import * as messageAccumulator from '../../../../store/main/slices/message-accumulator/message-accumulator-api';
import type { StatusEventData, StreamMessage, StreamToolCall } from '../../types/streaming.types';
import { ACPProviderStreaming } from './acp-provider-streaming';
import type { AgentConfig, AgentMessage, Tool } from './base-provider';
import { BaseAgentProvider } from './base-provider';
import {
  ProviderCapabilities,
  resolveProviderCapabilities,
} from './provider-capabilities';
import { trimSession } from './session-trimmer';
import { sanitizeSurrogates } from '../../../../shared/validation';
import {
  acquireProcessSlot,
  registerProcess,
  deregisterProcess,
  markProcessActive,
  markProcessIdle,
  notifyPendingWorkCleared,
} from '../agent-process-registry';

// Maximum characters to include in conversation history when sending full context.
// The 413 "Request Entity Too Large" error we hit is actually ExceedContextLength from
// the chat backend — the LLM's token context window is exceeded, not the HTTP body limit.
// The full payload includes: history XML + tool_definitions (~50-100k) + rules (~10-50k)
// + user_guidelines + workspace_guidelines + agent_memories + JSON wrapper.
// 200k for history leaves room for that ~100-200k of overhead to stay under model limits.
const MAX_HISTORY_CHARS = 200_000;

// Maximum characters for individual tool_use inputs and tool_result outputs within
// the history XML. Tool results (file contents, search results, terminal output) can be
// tens of thousands of characters each. Without per-block truncation, a single exchange
// with large tool results can dominate the entire history budget. This mirrors what the
// chat backend does with _replace_tool_result_content in chat_history_builder.py.
const MAX_TOOL_CONTENT_CHARS = 4_000;

// Maximum characters for tool names. The Anthropic API rejects tool names exceeding 200 characters
// with error: "messages.1.content.1.tool_use.name: String should have at most 200 characters"
const MAX_TOOL_NAME_CHARS = 200;

// Bounded stderr context to include when an ACP prompt response only reports a
// generic JSON-RPC error such as "Internal error" while the provider printed the
// actionable cause to stderr.
const MAX_RECENT_STDERR_ERRORS = 5;
const MAX_RECENT_STDERR_ENTRY_CHARS = 10_000;
const MAX_PROMPT_STDERR_LINES = 5;
const MAX_PROMPT_STDERR_CHARS = 1_000;

/**
 * Common text file extensions used to determine if a file attachment
 * should be inlined as text or referenced as binary.
 */
const TEXT_FILE_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.yaml',
  '.yml',
  '.xml',
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.less',
  '.md',
  '.markdown',
  '.txt',
  '.csv',
  '.log',
  '.py',
  '.rb',
  '.java',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.cs',
  '.go',
  '.rs',
  '.swift',
  '.php',
  '.pl',
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
  '.ps1',
  '.bat',
  '.cmd',
  '.sql',
  '.graphql',
  '.gql',
  '.vue',
  '.svelte',
  '.astro',
  '.env',
  '.gitignore',
  '.dockerignore',
  '.editorconfig',
  '.toml',
  '.ini',
  '.cfg',
  '.conf',
  '.properties',
] as const;

/**
 * Save a binary file attachment to the workspace metadata assets directory
 * (~/intent/workspaces/{id}/.workspace/assets/) so the agent can access it.
 * This keeps attachments out of the git repo.
 * Returns the absolute path where the file was saved, or null on failure.
 */
function saveBinaryAttachmentToWorkspace(
  workspaceId: string,
  fileName: string,
  base64Data: string,
): string | null {
  try {
    const assetsDir = WorkspaceConfig.paths.assets(workspaceId);
    if (!fs.existsSync(assetsDir)) {
      fs.mkdirSync(assetsDir, { recursive: true });
    }
    // Sanitize filename to avoid path traversal
    const safeName = path.basename(fileName);
    // Add timestamp prefix to avoid collisions
    const timestamp = Date.now().toString(36);
    const destName = `${timestamp}-${safeName}`;
    const destPath = path.join(assetsDir, destName);
    const buffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(destPath, buffer);
    logger.info('Saved binary attachment to workspace assets', {
      fileName: safeName,
      destPath,
      size: buffer.length,
    });
    return destPath;
  } catch (error) {
    logger.error('Failed to save binary attachment to workspace assets', {
      fileName,
      error: (error as Error).message,
    });
    return null;
  }
}

/**
 * Escape XML special characters in text content to prevent malformed XML.
 * Handles &, <, >, and " which commonly appear in code content.
 */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Escape a string for safe use in shell commands.
 * Uses single quotes and escapes any embedded single quotes.
 */
export function escapeShellArg(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * Safely stringify a value, catching circular references and other errors.
 */
export function safeStringify(value: unknown): string {
  try {
    if (typeof value === 'string') return value;
    const result = JSON.stringify(value);
    // JSON.stringify returns undefined for undefined, functions, symbols
    return result ?? String(value);
  } catch {
    return '[serialization error]';
  }
}

/**
 * Truncate a string from the middle, keeping the beginning and end.
 * This preserves context from both sides (e.g., function name at the start,
 * return value at the end) while cutting the bulk in the middle.
 */
function truncateMiddleContent(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  // 60 chars reserved for the "... [N characters truncated] ..." marker
  const halfBudget = Math.max(0, Math.floor((maxChars - 60) / 2));
  if (halfBudget === 0) {
    // maxChars too small for middle-truncation — just hard-truncate from the end
    return text.slice(0, Math.max(maxChars, 0));
  }
  const start = text.slice(0, halfBudget);
  const end = text.slice(-halfBudget);
  const omitted = text.length - halfBudget * 2;
  return `${start}\n... [${omitted} characters truncated] ...\n${end}`;
}

/**
 * Remove or normalize malformed content blocks before rendering history for
 * session recovery. The provider returned HTTP 400/invalidArgument for agents
 * whose persisted state contained tool_result blocks with missing/empty
 * tool_use_id, and duplicate tool_result entries for the same id. This helper
 * is deliberately narrow — it only drops blocks that cannot be safely
 * rendered — so user-visible transcript content (text, thinking, valid tool
 * uses) is preserved.
 *
 * Logs a single summary line per invocation so recovery bundles show what was
 * filtered without producing per-block log noise.
 */
export function sanitizeMessagesForHistory(messages: AgentMessage[]): AgentMessage[] {
  let droppedEmptyToolResult = 0;
  let droppedMissingToolUseId = 0;
  let droppedDuplicateToolResult = 0;
  let droppedEmptyAssistant = 0;
  const seenToolResultIds = new Set<string>();

  const sanitized: AgentMessage[] = [];
  for (const msg of messages) {
    const blocks = msg.contentBlocks;
    if (!blocks || blocks.length === 0) {
      // An assistant message with zero blocks is the exact shape that precedes
      // the repeating 400s in debug bundles — drop it so the recovery history
      // doesn't include an empty agent turn. User/error messages pass through
      // because they can legitimately be empty wrappers.
      if (msg.role === 'assistant') {
        droppedEmptyAssistant++;
        continue;
      }
      sanitized.push(msg);
      continue;
    }

    const cleanBlocks: ContentBlock[] = [];
    for (const block of blocks) {
      if (block.type === 'tool_result') {
        const toolUseId = (block.tool_use_id || '').trim();
        if (!toolUseId) {
          droppedMissingToolUseId++;
          continue;
        }
        if (seenToolResultIds.has(toolUseId)) {
          droppedDuplicateToolResult++;
          continue;
        }
        const output = block.output ?? block.content;
        const hasOutput =
          (typeof output === 'string' && output.length > 0) ||
          (typeof output === 'object' && output !== null);
        if (!hasOutput && !block.is_error && !block.isError) {
          droppedEmptyToolResult++;
          continue;
        }
        seenToolResultIds.add(toolUseId);
        cleanBlocks.push(block);
      } else {
        cleanBlocks.push(block);
      }
    }

    if (cleanBlocks.length === 0 && msg.role === 'assistant') {
      // All blocks were malformed — drop the whole assistant turn rather than
      // emit a zero-block agent_response_or_tool_uses element.
      droppedEmptyAssistant++;
      continue;
    }

    sanitized.push({ ...msg, contentBlocks: cleanBlocks });
  }

  const totalDropped =
    droppedEmptyToolResult +
    droppedMissingToolUseId +
    droppedDuplicateToolResult +
    droppedEmptyAssistant;
  if (totalDropped > 0) {
    logger.warn('Sanitized malformed persisted blocks for history recovery', {
      droppedEmptyToolResult,
      droppedMissingToolUseId,
      droppedDuplicateToolResult,
      droppedEmptyAssistant,
      inputMessageCount: messages.length,
      outputMessageCount: sanitized.length,
    });
  }

  return sanitized;
}

/**
 * Format conversation history as XML exchange format for session recovery.
 * Groups messages into exchanges (user→assistant pairs) and renders them as XML.
 * Wraps the result in <supervisor> tags with recovery context.
 * Handles size limits by including only the most recent contiguous exchanges that fit.
 *
 * @param messages - The conversation messages to format
 * @param maxChars - Maximum characters for the output (default: MAX_HISTORY_CHARS)
 * @returns XML string with supervisor wrapper and exchange blocks
 */
export function formatHistoryAsXml(
  messages: AgentMessage[],
  maxChars: number = MAX_HISTORY_CHARS,
): string {
  if (messages.length === 0) {
    return '';
  }

  // Sanitize malformed persisted tool blocks before rendering. Empty/id-less
  // tool_result blocks and duplicate tool_result ids are the exact pattern
  // observed in debug bundles where the provider returned 400/invalidArgument
  // for chat-stream. Filtering here ensures the recovery XML payload cannot
  // carry the same malformed shape forward on the next prompt.
  const sanitizedMessages = sanitizeMessagesForHistory(messages);

  // Group messages into exchanges (user message → assistant response pairs).
  // Error-role messages are appended to the current exchange's assistant slot.
  // Consecutive assistant messages each get their own exchange to avoid silent data loss.
  const exchanges: Array<{ user?: AgentMessage; assistants: AgentMessage[] }> = [];
  let currentExchange: { user?: AgentMessage; assistants: AgentMessage[] } = { assistants: [] };

  for (const msg of sanitizedMessages) {
    if (msg.role === 'user') {
      // Save any pending exchange before starting a new one
      if (currentExchange.user || currentExchange.assistants.length > 0) {
        exchanges.push(currentExchange);
        currentExchange = { assistants: [] };
      }
      currentExchange.user = msg;
    } else if (msg.role === 'assistant') {
      // If there's already an assistant and no user yet for the next exchange,
      // push the current exchange and start a new assistant-only one
      if (!currentExchange.user && currentExchange.assistants.length > 0) {
        exchanges.push(currentExchange);
        currentExchange = { assistants: [] };
      }
      currentExchange.assistants.push(msg);
    } else if (msg.role === 'error') {
      // Include error messages as part of the current exchange context
      currentExchange.assistants.push(msg);
    }
    // 'system' messages are already filtered out before this function is called
  }

  // Don't forget the last exchange
  if (currentExchange.user || currentExchange.assistants.length > 0) {
    exchanges.push(currentExchange);
  }

  // Render content blocks for a message into XML fragments
  function renderContentBlocks(blocks: ContentBlock[] | undefined, indent: string): string {
    if (!blocks) return '';
    let xml = '';
    for (const block of blocks) {
      if (block.type === 'text') {
        const text = block.text || block.content || '';
        xml += `${indent}<text>${escapeXml(text)}</text>\n`;
      } else if (block.type === 'thinking') {
        const thinking = block.text || block.content || '';
        xml += `${indent}<thinking>${escapeXml(thinking)}</thinking>\n`;
      } else if (block.type === 'tool_use') {
        const rawToolName = block.name || block.toolName || '';
        const toolName = escapeXml(
          rawToolName.length > MAX_TOOL_NAME_CHARS
            ? (logger.warn('Truncating tool name exceeding max length', {
                originalLength: rawToolName.length,
                maxLength: MAX_TOOL_NAME_CHARS,
                toolName: rawToolName.substring(0, 50) + '...',
              }),
              rawToolName.substring(0, MAX_TOOL_NAME_CHARS - 3) + '...')
            : rawToolName,
        );
        const toolUseId = escapeXml(block.tool_use_id || block.id || '');
        const rawInput = safeStringify(block.input || {});
        const inputStr = escapeXml(truncateMiddleContent(rawInput, MAX_TOOL_CONTENT_CHARS));
        xml += `${indent}<tool_use name="${toolName}" tool_use_id="${toolUseId}">\n`;
        xml += `${indent}  ${inputStr}\n`;
        xml += `${indent}</tool_use>\n`;
      } else if (block.type === 'tool_result') {
        const toolUseId = escapeXml(block.tool_use_id || '');
        const isError = block.is_error || block.isError || false;
        const content = block.output || block.content || '';
        const rawContent = safeStringify(content);
        const contentStr = escapeXml(truncateMiddleContent(rawContent, MAX_TOOL_CONTENT_CHARS));
        xml += `${indent}<tool_result tool_use_id="${toolUseId}" is_error="${isError}">\n`;
        xml += `${indent}  ${contentStr}\n`;
        xml += `${indent}</tool_result>\n`;
      }
    }
    return xml;
  }

  // Build XML for each exchange as a complete string
  const exchangeXmlStrings: string[] = [];

  for (const exchange of exchanges) {
    let exchangeXml = '<exchange>\n';

    // User request or tool results
    if (exchange.user) {
      exchangeXml += '  <user_request_or_tool_results>\n';
      exchangeXml += renderContentBlocks(exchange.user.contentBlocks, '    ');
      exchangeXml += '  </user_request_or_tool_results>\n';
    }

    // Agent response(s) or tool uses
    for (const assistant of exchange.assistants) {
      const tagName = assistant.role === 'error' ? 'error' : 'agent_response_or_tool_uses';
      exchangeXml += `  <${tagName}>\n`;
      // ProviderMessage doesn't include `error`, but the runtime objects may carry it
      const errorText = 'error' in assistant ? (assistant as { error?: string }).error : undefined;
      if (assistant.role === 'error' && typeof errorText === 'string' && errorText) {
        exchangeXml += `    <text>${escapeXml(errorText)}</text>\n`;
      }
      exchangeXml += renderContentBlocks(assistant.contentBlocks, '    ');
      exchangeXml += `  </${tagName}>\n`;
    }

    exchangeXml += '</exchange>\n';
    exchangeXmlStrings.push(exchangeXml);
  }

  // Calculate supervisor wrapper overhead
  const supervisorPreamble = `<supervisor>
The previous ACP session was lost. Below is the full conversation history from the prior session so you can continue seamlessly.
Do NOT mention session recovery to the user. Just continue naturally as if nothing happened.

`;
  const supervisorClosing = `Continue the conversation from this point. Do not mention session recovery or interruption.
</supervisor>`;
  const wrapperOverhead = supervisorPreamble.length + supervisorClosing.length;
  // Reserve space for the worst-case omission comment
  const maxOmissionComment = `<!-- ${exchangeXmlStrings.length} earlier exchanges omitted due to size limits -->\n`;

  // Build exchanges from newest to oldest, tracking cumulative size.
  // Stop at the first exchange that doesn't fit to keep history contiguous.
  let cumulativeSize = wrapperOverhead + maxOmissionComment.length;
  const includedExchanges: string[] = [];
  let omittedCount = 0;

  // Iterate from newest (end) to oldest (start)
  for (let i = exchangeXmlStrings.length - 1; i >= 0; i--) {
    const exchangeXml = exchangeXmlStrings[i];
    if (cumulativeSize + exchangeXml.length <= maxChars) {
      includedExchanges.unshift(exchangeXml); // Add to front to maintain order
      cumulativeSize += exchangeXml.length;
    } else {
      // All remaining older exchanges are omitted — don't skip past gaps
      omittedCount = i + 1;
      break;
    }
  }

  // Build final exchanges XML
  let exchangesXml = '';
  if (omittedCount > 0) {
    exchangesXml += `<!-- ${omittedCount} earlier exchanges omitted due to size limits -->\n`;
  }
  exchangesXml += includedExchanges.join('');

  // Wrap in supervisor tags with recovery context
  const supervisorXml = supervisorPreamble + exchangesXml + supervisorClosing;

  return supervisorXml;
}

// Define __dirname for ESM modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Get the global tmp directory for agent temp files.
 * Uses ~/.augment/tmp to avoid polluting git worktrees.
 */
function getGlobalTmpDir(): string {
  return path.join(os.homedir(), '.augment', 'tmp');
}

function safeJsonParse<T>(value: string | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

/**
 * Get the path to the MCP stdio server, handling both development and packaged app scenarios.
 * In packaged apps, the file is unpacked from asar to app.asar.unpacked directory.
 */
function getMcpServerPath(): string {
  // In development, __dirname is dist/features/agent/main/agent-providers
  // The server is at dist/main/mcp-stdio-server.cjs
  // Need to go up 4 levels: agent-providers -> main -> agent -> features -> dist
  const distDir = path.resolve(__dirname, '..', '..', '..', '..');
  const devPath = path.join(distDir, 'main', 'mcp-stdio-server.cjs');

  const providerLogger = new Logger('ACPProvider');

  // Always log path resolution for debugging
  providerLogger.info('MCP server path resolution starting', {
    __dirname,
    distDir,
    devPath,
    isPackaged: app.isPackaged,
  });

  // Check if we're in a packaged app (asar)
  if (app.isPackaged) {
    // In packaged app, files in asarUnpack are placed in app.asar.unpacked
    // The path will look like: .../app.asar/dist/main/mcp-stdio-server.cjs
    // But we need: .../app.asar.unpacked/dist/main/mcp-stdio-server.cjs
    const unpackedPath = devPath.replace('app.asar', 'app.asar.unpacked');

    // Log both paths for debugging
    providerLogger.info('MCP server path resolution (packaged)', {
      isPackaged: true,
      devPath,
      unpackedPath,
      devPathExists: fs.existsSync(devPath),
      unpackedPathExists: fs.existsSync(unpackedPath),
    });

    // Prefer unpacked path if it exists
    if (fs.existsSync(unpackedPath)) {
      // WORKAROUND: If the path contains spaces (e.g., "Intent by Augment.app"),
      // auggie may not handle it correctly when spawning the MCP server process.
      // Copy the server to a path without spaces as a workaround.
      if (unpackedPath.includes(' ')) {
        const safeDir = path.join(os.homedir(), '.augment', 'mcp-server');
        const safePath = path.join(safeDir, 'mcp-stdio-server.cjs');

        try {
          // Create directory if needed
          if (!fs.existsSync(safeDir)) {
            fs.mkdirSync(safeDir, { recursive: true });
          }

          // Copy the server file (always overwrite to ensure latest version)
          fs.copyFileSync(unpackedPath, safePath);

          providerLogger.info('Copied MCP server to path without spaces', {
            originalPath: unpackedPath,
            safePath,
          });

          return safePath;
        } catch (copyError) {
          providerLogger.warn('Failed to copy MCP server to safe path, using original', {
            error: copyError,
            unpackedPath,
          });
        }
      }

      providerLogger.info('Using unpacked MCP server path', { unpackedPath });
      return unpackedPath;
    }

    // Fallback to dev path (shouldn't happen in properly packaged app)
    providerLogger.warn('MCP server unpacked path not found, falling back to dev path', {
      unpackedPath,
      devPath,
    });
  } else {
    providerLogger.info('Using dev MCP server path', { devPath, exists: fs.existsSync(devPath) });
  }

  return devPath;
}

/**
 * Get the path to the intent-server.cjs bundle for remote deployment.
 * Uses the same resolution strategy as getMcpServerPath().
 */
export function getIntentServerPath(): string {
  // In development, __dirname is dist/features/agent/main/agent-providers
  // The server is at dist/features/agent/main/remote-server/intent-server.cjs
  // Need to go up 1 level: agent-providers -> main, then into remote-server
  const mainDir = path.resolve(__dirname, '..');
  const devPath = path.join(mainDir, 'remote-server', 'intent-server.cjs');

  const providerLogger = new Logger('ACPProvider');

  providerLogger.info('Intent server path resolution starting', {
    __dirname,
    mainDir,
    devPath,
    isPackaged: app.isPackaged,
  });

  if (app.isPackaged) {
    const unpackedPath = devPath.replace('app.asar', 'app.asar.unpacked');

    providerLogger.info('Intent server path resolution (packaged)', {
      isPackaged: true,
      devPath,
      unpackedPath,
      devPathExists: fs.existsSync(devPath),
      unpackedPathExists: fs.existsSync(unpackedPath),
    });

    if (fs.existsSync(unpackedPath)) {
      providerLogger.info('Using unpacked intent server path', { unpackedPath });
      return unpackedPath;
    }

    providerLogger.warn('Intent server unpacked path not found, falling back to dev path', {
      unpackedPath,
      devPath,
    });
  } else {
    providerLogger.info('Using dev intent server path', {
      devPath,
      exists: fs.existsSync(devPath),
    });
  }

  return devPath;
}

const logger = new Logger('ACPProvider');

function readPiMcpConfig(configFile: string): Record<string, unknown> {
  try {
    const content = fs.readFileSync(configFile, 'utf-8');
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch (readError) {
    const errCode = (readError as NodeJS.ErrnoException).code;
    if (errCode !== 'ENOENT') {
      logger.warn('Failed to parse existing Pi MCP config, will use workspace servers only', {
        configFile,
        error: (readError as Error).message,
      });
    }
  }

  return { mcpServers: {} };
}

/**
 * Extract pixel dimensions from a base64-encoded image by reading the binary header.
 * Supports PNG and JPEG formats. Returns null if dimensions cannot be determined.
 */
function getImageDimensionsFromBase64(
  base64Data: string,
  mimeType: string,
): { width: number; height: number } | null {
  try {
    const buf = Buffer.from(base64Data, 'base64');

    // PNG: width at bytes 16-19, height at bytes 20-23 (big-endian in IHDR chunk)
    if (mimeType === 'image/png' && buf.length >= 24) {
      const width = buf.readUInt32BE(16);
      const height = buf.readUInt32BE(20);
      if (width > 0 && height > 0 && width < 100000 && height < 100000) {
        return { width, height };
      }
    }

    // JPEG: scan for SOF0/SOF2 markers (0xFF 0xC0 or 0xFF 0xC2)
    if ((mimeType === 'image/jpeg' || mimeType === 'image/jpg') && buf.length >= 2) {
      for (let i = 0; i < buf.length - 9; i++) {
        if (
          buf[i] === 0xff &&
          (buf[i + 1] === 0xc0 || buf[i + 1] === 0xc2)
        ) {
          const height = buf.readUInt16BE(i + 5);
          const width = buf.readUInt16BE(i + 7);
          if (width > 0 && height > 0 && width < 100000 && height < 100000) {
            return { width, height };
          }
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Checks if an error message indicates the provider needs authentication
 * Uses provider-specific patterns from the provider configuration
 */
function isAuthenticationError(errorMessage: string, providerId?: string): boolean {
  // If no provider ID specified, check against the default provider
  if (!providerId) {
    return isProviderAuthenticationError(getDefaultProviderId(), errorMessage);
  }
  return isProviderAuthenticationError(providerId, errorMessage);
}

/**
 * Checks if an error indicates the model is not available (model-specific errors only)
 * Includes HTTP 404 errors which typically indicate the model endpoint doesn't exist
 * (i.e., the user doesn't have access to that model).
 */
/**
 * Classifier-safe text derived from `error.data` structured fields.
 * Only consults fields that `summarizeProviderErrorForLog` considers safe
 * (apiStatus, errorDetails.code/message/detail). `error.data.details` is the
 * raw HTTP response body (prompt echoes, tool outputs, file contents) and is
 * deliberately NEVER read here, so a sentinel in `data.details` cannot leak
 * into classifier keyword inputs or any downstream message/log payload.
 */
function classifierTextFromErrorData(errorData?: {
  apiStatus?: string;
  errorDetails?: { code?: number; message?: string; detail?: string };
}): string {
  if (!errorData) return '';
  const parts: string[] = [];
  if (typeof errorData.apiStatus === 'string') parts.push(errorData.apiStatus);
  const d = errorData.errorDetails;
  if (d) {
    if (typeof d.code === 'number') parts.push(String(d.code));
    if (typeof d.message === 'string') parts.push(d.message);
    if (typeof d.detail === 'string') parts.push(d.detail);
  }
  return parts.join(' ').toLowerCase();
}

export function isModelNotAvailableError(
  errorMessage: string,
  errorCode: number,
  errorData?: {
    httpStatus?: number;
    apiStatus?: string;
    errorDetails?: { code?: number; message?: string; detail?: string };
  },
): boolean {
  const errorLower = errorMessage.toLowerCase();
  const structuredLower = classifierTextFromErrorData(errorData);

  // Structured signal: provider-reported HTTP 404 for a model endpoint.
  if (errorData?.httpStatus === 404) return true;

  // Explicit model-related errors (check both the top-level message and the
  // safe structured error detail text so we don't regress when the provider
  // buries "model not found" in errorDetails.detail with a generic message).
  const hasModelError =
    errorLower.includes('model not found') ||
    errorLower.includes('model not available') ||
    errorLower.includes('model is not available') ||
    errorLower.includes('invalid model') ||
    errorLower.includes('unknown model') ||
    errorLower.includes('model does not exist') ||
    errorLower.includes('unsupported model') ||
    structuredLower.includes('model not found') ||
    structuredLower.includes('model not available') ||
    structuredLower.includes('model is not available') ||
    structuredLower.includes('invalid model') ||
    structuredLower.includes('unknown model') ||
    structuredLower.includes('model does not exist') ||
    structuredLower.includes('unsupported model');

  // HTTP 404 errors often indicate the model endpoint doesn't exist
  // This happens when a user doesn't have access to a specific model
  const has404Error =
    errorCode === 404 ||
    errorLower.includes('404') ||
    errorLower.includes('http error: 404') ||
    errorLower.includes('not found') ||
    structuredLower.includes('404') ||
    structuredLower.includes('http error: 404') ||
    structuredLower.includes('not found');

  return hasModelError || has404Error;
}

/**
 * Detects the "workspace MCP tool went missing" symptom — e.g. the model calls
 * `workspace_api` but the active (or session/load-resumed) session no longer has
 * the built-in workspace-mcp tools registered, even though the MCP bridge is
 * healthy. This is recoverable by recreating the session so the MCP servers and
 * their tools re-register.
 */
/** Whether (already lower-cased) text references the workspace MCP tool. */
function mentionsWorkspaceTool(text: string): boolean {
  return (
    text.includes('workspace_api') ||
    text.includes('workspace-mcp') ||
    text.includes('workspace_mcp')
  );
}

/** Whether (already lower-cased) text uses a missing-tool phrasing. */
function mentionsMissingTool(text: string): boolean {
  return (
    text.includes('not found') ||
    text.includes('unknown tool') ||
    text.includes('no such tool') ||
    text.includes('not registered') ||
    text.includes('is not available')
  );
}

/** Whether (already lower-cased) text looks like an old workspace JS API surface. */
function mentionsStaleWorkspaceApiSurface(text: string): boolean {
  return text.includes('ws.') && text.includes('is not a function');
}

export function isMissingWorkspaceToolError(
  rawError: string,
  errorData?: {
    apiStatus?: string;
    errorDetails?: { code?: number; message?: string; detail?: string };
  },
): boolean {
  const errorLower = (rawError || '').toLowerCase();
  const structuredLower = classifierTextFromErrorData(errorData);

  const matches = (text: string): boolean =>
    mentionsWorkspaceTool(text) && mentionsMissingTool(text);

  return matches(errorLower) || matches(structuredLower);
}

export function isStaleWorkspaceApiError(
  rawError: string,
  errorData?: {
    apiStatus?: string;
    errorDetails?: { code?: number; message?: string; detail?: string };
  },
): boolean {
  const errorLower = (rawError || '').toLowerCase();
  const structuredLower = classifierTextFromErrorData(errorData);

  return mentionsStaleWorkspaceApiSurface(errorLower) || mentionsStaleWorkspaceApiSurface(structuredLower);
}

/**
 * Pulls the candidate error/result text out of a tool_call / tool_call_update
 * notification so it can be classified. Handles the several shapes ACP providers
 * use (rawOutput.output, result, error, and content arrays/strings).
 */
function toolUpdateTextForClassification(update: any): string {
  if (!update) return '';
  const parts: unknown[] = [
    update.rawOutput?.output,
    update.result,
    update.error?.message,
    update.error,
    update.content?.error?.message,
    update.content?.error,
    update.content?.result,
  ];

  if (Array.isArray(update.content)) {
    for (const block of update.content) {
      if (typeof block === 'string') parts.push(block);
      else if (block && typeof block.text === 'string') parts.push(block.text);
    }
  } else if (typeof update.content === 'string') {
    parts.push(update.content);
  }

  const out: string[] = [];
  for (const part of parts) {
    if (typeof part === 'string') {
      out.push(part);
    } else if (part && typeof part === 'object') {
      try {
        out.push(JSON.stringify(part));
      } catch {
        // Ignore values that can't be serialized — best-effort classification only.
      }
    }
  }
  return out.join(' ');
}

/**
 * Extract workspace-tool IDENTITY text from a tool_call / tool_call_update using
 * only STRUCTURED fields — the tool identity (title, name, toolCallId, rawInput)
 * and the provider error (error/error.message). Arbitrary tool OUTPUT
 * (rawOutput.output, result, content) is deliberately excluded so a failed
 * unrelated tool whose output merely mentions the workspace tool cannot be
 * misidentified as the workspace tool itself.
 */
function structuredToolIdentityText(update: any): string {
  if (!update) return '';
  const parts: unknown[] = [
    update.title,
    update.name,
    update.toolCallId,
    update.rawInput,
    update.error?.message,
    update.error,
  ];
  const out: string[] = [];
  for (const part of parts) {
    if (typeof part === 'string') {
      out.push(part);
    } else if (part && typeof part === 'object') {
      try {
        out.push(JSON.stringify(part));
      } catch {
        // Ignore values that can't be serialized — best-effort classification only.
      }
    }
  }
  return out.join(' ');
}

/**
 * Returns true when a failed tool_call / tool_call_update notification indicates
 * the workspace MCP tool went missing. Only failed updates are considered.
 *
 * The workspace-tool IDENTITY must be established from a STRUCTURED signal (tool
 * identity fields or the provider error), never from arbitrary tool output. This
 * prevents an unrelated failed tool (e.g. bash/search) whose OUTPUT happens to
 * mention workspace_api from wrongly triggering session recovery. The
 * missing-tool PHRASE may still come from the structured identity, the provider
 * error, or the tool output.
 */
export function detectMissingWorkspaceToolInUpdate(update: any): boolean {
  if (!update) return false;
  const isError = update.status === 'failed' || update.isError === true;
  if (!isError) return false;

  const identityText = structuredToolIdentityText(update);
  if (!mentionsWorkspaceTool(identityText.toLowerCase())) return false;

  // Identity is established from a structured field above, so reuse
  // isMissingWorkspaceToolError for the combined phrase logic across the
  // structured identity and the (best-effort) tool output.
  const outputText = toolUpdateTextForClassification(update);
  return isMissingWorkspaceToolError(`${identityText} ${outputText}`);
}

/**
 * Returns true when a failed workspace_api call indicates the MCP tool exists but
 * its JS API surface is stale, e.g. `ws.agent.diagnostics is not a function`.
 * This has the same recovery as a missing tool: create a fresh ACP session so
 * MCP tools reconnect to the current HTTP bridge and regenerate tool metadata.
 */
export function detectStaleWorkspaceApiInUpdate(update: any): boolean {
  if (!update) return false;
  const isError = update.status === 'failed' || update.isError === true;
  if (!isError) return false;

  const identityText = structuredToolIdentityText(update);
  if (!mentionsWorkspaceTool(identityText.toLowerCase())) return false;

  const outputText = toolUpdateTextForClassification(update);
  return isStaleWorkspaceApiError(outputText);
}

/**
 * Error types that indicate session recovery should be attempted
 */
export function isSessionRecoverableError(
  rawError: string,
  errorCode: number,
  errorData?: {
    apiStatus?: string;
    errorDetails?: { code?: number; message?: string; detail?: string };
  },
): boolean {
  const errorLower = rawError.toLowerCase();
  const structuredLower = classifierTextFromErrorData(errorData);

  // Check for explicit session-related errors in either the top-level message
  // or the safe structured error detail text (since the provider may surface
  // the specific "session not found" signal in errorDetails.detail while
  // returning only a generic top-level message like "Internal error").
  const hasSessionKeyword = (text: string): boolean =>
    text.includes('session not found') ||
    text.includes('session expired') ||
    text.includes('session invalid') ||
    (text.includes('session') && text.includes('not found'));
  const isSessionError =
    hasSessionKeyword(errorLower) || hasSessionKeyword(structuredLower);

  // For -32603 (JSON-RPC internal error), only treat as session-recoverable
  // if the error message (or structured detail) mentions session. Otherwise
  // it's likely a code bug (e.g., "r.map is not a function") that won't be
  // fixed by session recovery.
  if (errorCode === -32603) {
    return (
      isSessionError ||
      errorLower.includes('session') ||
      structuredLower.includes('session')
    );
  }

  return isSessionError;
}

/**
 * Error types that indicate the conversation context is too large for the LLM.
 * The 413 "Request Entity Too Large" from auggie is actually ExceedContextLength —
 * the LLM's token context window is exceeded, not the HTTP body limit.
 * Recovery: recreate the session (resets auggie's internal context) so the next
 * message sends only truncated history via formatHistoryAsXml().
 */
export function isContextTooLargeError(
  rawError: string,
  errorCode: number,
  errorData?: {
    httpStatus?: number;
    apiStatus?: string;
    errorDetails?: { code?: number; message?: string; detail?: string };
  },
): boolean {
  // Structured signal: provider-reported HTTP 413 is definitive for this class.
  if (errorData?.httpStatus === 413) return true;

  const errorLower = rawError.toLowerCase();
  const structuredLower = classifierTextFromErrorData(errorData);
  const matches = (text: string): boolean =>
    text.includes('413') ||
    text.includes('request entity too large') ||
    text.includes('payload too large') ||
    text.includes('content too large') ||
    text.includes('body too large') ||
    (text.includes('exceed') && text.includes('context'));

  return errorCode === 413 || matches(errorLower) || matches(structuredLower);
}

/**
 * Checks if an error is a transient/retryable prompt error.
 * These are network-level failures where the LLM backend was unreachable
 * but may recover on retry (e.g., fetch failed, timeout, DNS failure).
 * Unlike session-recoverable errors, these don't require session recreation —
 * just a simple retry of the same request.
 */
export function isTransientPromptError(
  rawError: string,
  errorData?: { apiStatus?: string; httpStatus?: number },
): boolean {
  const errorLower = rawError.toLowerCase();

  // apiStatus: 'unavailable' explicitly indicates a transient backend issue
  if (errorData?.apiStatus === 'unavailable') {
    return true;
  }

  // Network-level fetch failures
  if (
    errorLower.includes('fetch failed') ||
    errorLower.includes('econnrefused') ||
    errorLower.includes('econnreset') ||
    errorLower.includes('etimedout') ||
    errorLower.includes('enotfound') ||
    errorLower.includes('enetunreach') ||
    errorLower.includes('socket hang up')
  ) {
    return true;
  }

  // Timeout errors that are NOT session-related
  if (
    (errorLower.includes('timeout') || errorLower.includes('timed out')) &&
    !errorLower.includes('session')
  ) {
    return true;
  }

  // HTTP 502/503/504 gateway errors
  if (
    errorData?.httpStatus === 502 ||
    errorData?.httpStatus === 503 ||
    errorData?.httpStatus === 504
  ) {
    return true;
  }

  // LLM special token errors — the model emitted a raw special token (e.g. <|endoftext|>)
  // which the backend rejects. This is a stochastic model failure that typically
  // succeeds on retry with a different sampling seed.
  if (
    errorLower.includes('disallowed special token') ||
    errorLower.includes('special token found')
  ) {
    return true;
  }

  return false;
}

/**
 * Checks if an error indicates the user's plan doesn't include Intent access.
 * This is returned by auggie as a 403 with ErrorCode 11 (NO_INTENT_PLAN) in error_details.
 * The error_details.code is serialized as an integer in the JSON response.
 */
function isNoIntentPlanError(errorData?: {
  errorDetails?: { code?: number };
  httpStatus?: number;
}): boolean {
  // Check errorDetails.code from the structured error data (most reliable)
  // ErrorCode 11 = NO_INTENT_PLAN in auggie's error_details.proto
  return errorData?.errorDetails?.code === 11;
}

/**
 * Checks if an error indicates the provider rejected the prompt because the
 * persisted tool history is malformed (e.g. tool_result blocks without a valid
 * tool_use_id, unmatched tool_use/tool_result pairing, or otherwise invalid
 * content blocks that auggie forwarded to chat-stream).
 *
 * Signature observed in debug bundles:
 *   { httpStatus: 400, apiStatus: 'invalidArgument',
 *     httpUrl: '.../chat-stream', message: 'HTTP error: 400 Bad Request' }
 *
 * Recovery path: recreate the ACP session and resend history via
 * formatHistoryAsXml() so the provider receives sanitized text/XML rather
 * than the malformed native tool blocks that caused the original 400.
 */
export function isInvalidToolHistoryError(
  rawError: string,
  errorData?: { apiStatus?: string; httpStatus?: number; httpUrl?: string },
): boolean {
  if (!errorData) return false;
  // Require both the HTTP 400 status and the explicit invalidArgument apiStatus
  // so we don't confuse this with unrelated 400s (auth, rate-limiting variants,
  // request validation bugs in other endpoints).
  if (errorData.httpStatus !== 400) return false;
  if (errorData.apiStatus !== 'invalidArgument') return false;
  // Only treat chat-stream 400s this way. Other endpoints returning 400 with
  // invalidArgument (e.g. session/new validation) shouldn't trigger history
  // recovery — they indicate a different class of bug.
  if (errorData.httpUrl && !errorData.httpUrl.includes('chat-stream')) return false;
  // Guard against false positives from clearly unrelated messages (e.g. auth
  // errors that happen to surface as 400). The observed provider message is
  // just "HTTP error: 400 Bad Request" so any string shape is acceptable.
  void rawError;
  return true;
}

/**
 * Derives the `rawErrorMessage` used by ACP prompt and fallback error paths
 * for keyword classification (model-not-available, session-recoverable,
 * context-too-large, transient, auth, etc.) and as the `rawError` argument
 * to `createUserFriendlyErrorMessage`.
 *
 * Returns ONLY the safe top-level `error.message`. `error.data.details` is
 * deliberately NOT consulted here because it can echo raw HTTP response body
 * content (prompt echoes, tool outputs, file contents) and must never leak
 * into classifier inputs, user-facing messages, callback errors, rejected
 * Error messages, or log payloads.
 *
 * The `fallback` argument matches the call site's existing default string
 * (e.g. `'Unknown agent error'` for the primary prompt source or
 * `'Unknown error'` for the model-fallback prompt source) so behavior is
 * unchanged when `error.message` is missing or non-string.
 */
export function deriveSafeRawErrorMessage(
  error: { message?: unknown } | null | undefined,
  fallback: string,
): string {
  const message = error?.message;
  return (typeof message === 'string' && message) || fallback;
}

function stripAnsiCodes(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, '').trim();
}

function extractFirstJsonObject(value: string): string | null {
  const start = value.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < value.length; i++) {
    const char = value[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0) {
        return value.slice(start, i + 1);
      }
    }
  }

  return null;
}

export function extractCodexAcpStderrErrorMessage(stderr: string): string | null {
  const clean = stripAnsiCodes(stderr);
  const marker = 'Unhandled error during turn:';
  const markerIndex = clean.indexOf(marker);
  if (markerIndex === -1) return null;

  const jsonText = extractFirstJsonObject(clean.slice(markerIndex + marker.length));
  if (!jsonText) return null;

  const payload = safeJsonParse<{
    error?: { message?: unknown };
    message?: unknown;
  }>(jsonText);

  const nestedMessage = payload?.error?.message;
  if (typeof nestedMessage === 'string' && nestedMessage.trim()) {
    return nestedMessage.trim();
  }

  const message = payload?.message;
  if (typeof message === 'string' && message.trim()) {
    return message.trim();
  }

  return null;
}

export function formatRecentStderrForPromptError(
  recentStderrErrors: readonly string[],
): string | undefined {
  for (let i = recentStderrErrors.length - 1; i >= 0; i--) {
    const parsed = extractCodexAcpStderrErrorMessage(recentStderrErrors[i]);
    if (parsed) return parsed;
  }

  const stderrTail = recentStderrErrors
    .flatMap((entry) => stripAnsiCodes(entry).split(/\r?\n/))
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-MAX_PROMPT_STDERR_LINES)
    .join('\n')
    .trim();

  return stderrTail ? truncateMiddleContent(stderrTail, MAX_PROMPT_STDERR_CHARS) : undefined;
}

export function derivePromptErrorSafeFallbackMessage(
  error: { message?: unknown } | null | undefined,
  recentStderrErrors: readonly string[],
): string | undefined {
  return (
    formatRecentStderrForPromptError(recentStderrErrors) ||
    (typeof error?.message === 'string' ? error.message : undefined)
  );
}

/**
 * Extracts only non-sensitive diagnostic fields from a JSON-RPC error response.
 * Used for error logging so future 400/invalidArgument failures stay actionable
 * without dumping prompt content or tool_result payloads into the log stream.
 *
 * Safe-to-log fields: code, message, httpStatus, apiStatus, httpUrl, requestId,
 * and a sanitized errorDetails { code, message, detail } shape.
 *
 * Explicitly NOT logged: data.prompt, data.details (raw HTTP body), and any
 * other unknown keys on error.data — these can embed prompt text, tool outputs,
 * or workspace file contents.
 */
export function summarizeProviderErrorForLog(error: unknown): {
  code?: number;
  message?: string;
  httpStatus?: number;
  apiStatus?: string;
  httpUrl?: string;
  requestId?: string | number;
  errorDetails?: { code?: number; message?: string; detail?: string };
} {
  if (!error || typeof error !== 'object') {
    return {};
  }
  const err = error as { code?: unknown; message?: unknown; data?: unknown };
  const data =
    err.data && typeof err.data === 'object'
      ? (err.data as {
          httpStatus?: unknown;
          apiStatus?: unknown;
          httpUrl?: unknown;
          requestId?: unknown;
          errorDetails?: unknown;
        })
      : undefined;

  const summary: ReturnType<typeof summarizeProviderErrorForLog> = {};
  if (typeof err.code === 'number') summary.code = err.code;
  if (typeof err.message === 'string') summary.message = err.message;
  if (data) {
    if (typeof data.httpStatus === 'number') summary.httpStatus = data.httpStatus;
    if (typeof data.apiStatus === 'string') summary.apiStatus = data.apiStatus;
    if (typeof data.httpUrl === 'string') summary.httpUrl = data.httpUrl;
    if (typeof data.requestId === 'string' || typeof data.requestId === 'number') {
      summary.requestId = data.requestId;
    }
    if (data.errorDetails && typeof data.errorDetails === 'object') {
      const d = data.errorDetails as {
        code?: unknown;
        message?: unknown;
        detail?: unknown;
      };
      const details: { code?: number; message?: string; detail?: string } = {};
      if (typeof d.code === 'number') details.code = d.code;
      if (typeof d.message === 'string') details.message = d.message;
      if (typeof d.detail === 'string') details.detail = d.detail;
      if (Object.keys(details).length > 0) summary.errorDetails = details;
    }
  }
  return summary;
}

/**
 * Creates a user-friendly error message from raw agent errors.
 * Helps users understand what went wrong and how to fix it.
 *
 * `rawError` is used ONLY for keyword classification (session, timeout, 429, etc.)
 * and is never surfaced verbatim to the user, because callers may source it from
 * `response.error.data.details`, which can contain raw HTTP body content (prompt
 * echoes, tool outputs, file contents). For unclassified errors the function
 * falls back to `safeFallbackMessage` (the safe top-level `response.error.message`)
 * or a generic string.
 */
export function createUserFriendlyErrorMessage(
  rawError: string,
  errorCode: number,
  currentModel?: string,
  providerId?: string,
  errorData?: {
    errorDetails?: { code?: number; detail?: string };
    httpStatus?: number;
    apiStatus?: string;
    httpUrl?: string;
  },
  workspaceId?: string,
  safeFallbackMessage?: string,
  isTerminal: boolean = false,
): string {
  const errorLower = rawError.toLowerCase();
  const safeFallback = safeFallbackMessage?.trim();

  // Provider authentication required - special case for remote environments
  if (isAuthenticationError(rawError, providerId)) {
    return 'Agent requires authentication. Please run the login command in the remote terminal.';
  }

  // 403 with no_intent_plan - user's plan doesn't include Intent access
  // Check this BEFORE session and -32603 checks since the error may be wrapped in JSON-RPC -32603
  if (isNoIntentPlanError(errorData)) {
    return 'Intent is not available on your current plan. Please contact your administrator to upgrade your plan or contact your Augment account manager';
  }

  // 400/invalidArgument from chat-stream — persisted tool history is malformed.
  // Session recovery re-sends sanitized history via formatHistoryAsXml(), so
  // surface an actionable message instead of the raw "HTTP error: 400 Bad
  // Request" that the provider returns. Check BEFORE the -32603 branch since
  // the provider wraps this as JSON-RPC -32603 with invalidArgument in data.
  //
  // `isTerminal` distinguishes the two call-site categories:
  //   - Active recovery (isTerminal=false): an automatic retry is imminent,
  //     so it's accurate to tell the user recovery is happening.
  //   - Terminal/exhausted (isTerminal=true): recovery already failed, the
  //     retry budget is spent, or we're outside the recovery path entirely.
  //     In that case the message must NOT imply an automatic retry, otherwise
  //     a failed recovery looks like active recovery to users/operators.
  if (isInvalidToolHistoryError(rawError, errorData)) {
    const detail = errorData?.errorDetails?.detail;
    const suffix = detail ? ` (${detail})` : '';
    if (isTerminal) {
      return `The previous agent history contained invalid tool blocks${suffix}. Automatic recovery was unsuccessful. Please send your message again.`;
    }
    return `The previous agent history contained invalid tool blocks${suffix}. Recovering with a fresh session...`;
  }

  // Session not found - this means the ACP session was lost/never created
  // Check this BEFORE the general "not found" check to avoid false positives
  if (
    errorLower.includes('session not found') ||
    (errorLower.includes('session') && errorLower.includes('not found'))
  ) {
    return 'The agent session was lost.';
  }

  // Session expired or invalid
  if (
    errorLower.includes('session expired') ||
    errorLower.includes('session invalid') ||
    (errorLower.includes('session') &&
      (errorLower.includes('expired') || errorLower.includes('invalid')))
  ) {
    return 'The agent session has expired.';
  }

  // 413 Request Entity Too Large - conversation context exceeded LLM token limit.
  // Session recovery will recreate the session with truncated history.
  if (isContextTooLargeError(rawError, errorCode, errorData)) {
    return 'Conversation context is too large. Recovering with trimmed history...';
  }

  // JSON-RPC internal error (-32603) - could be a session issue, a code bug,
  // or a meaningful upstream error (e.g. rate-limit, plan limit) wrapped in -32603.
  // NOTE: These messages are shown to the user only AFTER browser-side retries
  // have already been exhausted (errorBoundary.wrap retries: 2 + executeWithRecovery).
  // Do not suggest retrying — the system already did that.
  if (errorCode === -32603) {
    if (errorLower.includes('session')) {
      return 'The agent session encountered an error.';
    }
    // Special token errors — model emitted a disallowed token like <|endoftext|>.
    // By the time we reach createUserFriendlyErrorMessage, transient retries are
    // already exhausted, so give the user a clear message.
    if (
      errorLower.includes('disallowed special token') ||
      errorLower.includes('special token found')
    ) {
      return 'The model produced an invalid response. Please try again.';
    }
    // Surface the safe top-level message (e.g. response.error.message) if we have one;
    // otherwise return a generic string. `rawError` is intentionally NOT surfaced here
    // because it may be sourced from response.error.data.details (raw HTTP body).
    return safeFallback || 'The agent encountered an internal error.';
  }

  // Model-specific errors - only blame the model if the error explicitly mentions it
  if (
    errorLower.includes('model not found') ||
    errorLower.includes('model not available') ||
    errorLower.includes('invalid model') ||
    errorLower.includes('model is not available') ||
    errorLower.includes('unknown model')
  ) {
    if (currentModel) {
      return `Model "${currentModel}" is not available. Try switching to a different model.`;
    }
    return 'The selected model is not available. Try switching to a different model.';
  }

  // Generic 404 - don't assume it's the model, could be many things
  // This could be an endpoint issue, configuration problem, or network issue
  if (
    errorCode === 404 ||
    errorLower.includes('404') ||
    errorLower.includes('endpoint not found')
  ) {
    return 'The AI service endpoint could not be reached. This may be a configuration or network issue. Please check your connection and try again.';
  }

  // 401/403 - Authentication/Authorization errors
  if (
    errorCode === 401 ||
    errorCode === 403 ||
    errorLower.includes('unauthorized') ||
    errorLower.includes('forbidden')
  ) {
    return 'Authentication failed. Please check your API key or credentials.';
  }

  // 429 - Rate limiting
  if (
    errorCode === 429 ||
    errorLower.includes('rate limit') ||
    errorLower.includes('too many requests') ||
    errorLower.includes('hit your limit') ||
    errorLower.includes('quota exceeded')
  ) {
    // Record in circuit breaker to prevent runaway token burn
    if (workspaceId) {
      void Promise.resolve()
        .then(() => {
          agentCircuitBreaker.recordRateLimitError(workspaceId);
        })
        .catch(() => {
          // Circuit breaker not available — non-critical
        });
    }
    return 'Rate limit reached. Please wait a moment and try again.';
  }

  // 500+ - Server errors
  if (
    errorCode >= 500 ||
    errorLower.includes('internal server error') ||
    errorLower.includes('service unavailable')
  ) {
    return 'The AI service is temporarily unavailable. Please try again in a few moments.';
  }

  // Timeout errors
  if (errorLower.includes('timeout') || errorLower.includes('timed out')) {
    return 'The request timed out. Please try again.';
  }

  // Connection errors
  if (
    errorLower.includes('connection') ||
    errorLower.includes('network') ||
    errorLower.includes('econnrefused')
  ) {
    return 'Connection failed. Please check your network and try again.';
  }

  // Default - prefer the safe top-level provider message (e.g. response.error.message)
  // over `rawError`, which may be sourced from response.error.data.details (raw HTTP
  // body content). Truncate either value if too long.
  const maxLength = 200;
  const fallback = safeFallback || rawError;
  if (fallback.length > maxLength) {
    return `${fallback.substring(0, maxLength)}...`;
  }
  return fallback || 'The agent encountered an error.';
}

// Remote process handle type (returned by sshManager.spawnRemoteProcess)
interface RemoteProcessHandle {
  write: (data: string) => void;
  kill: () => void;
  isAlive: () => boolean;
}

/**
 * Idle timeout configuration for auggie child processes.
 *
 * Each agent spawns its own auggie process (~200-300 MB RAM). When a user has many
 * workspaces open, idle processes accumulate and consume tens of GB. This timeout
 * kills idle processes to reclaim memory. The existing respawn-on-demand path in
 * streamMessage() transparently re-launches the process when the user sends a message.
 */
const IDLE_TIMEOUT_CONFIG = {
  /** How long (ms) a process can sit idle before being killed. Default: 10 minutes. */
  IDLE_TIMEOUT_MS: 10 * 60 * 1000,
} as const;

export class ACPProvider extends BaseAgentProvider {
  private acpServer?: ACPServer;
  private sessionId?: string;
  private frontendSessionId?: string; // Track the frontend's session ID separately
  private agentProcess?: ChildProcess;
  private remoteProcess?: RemoteProcessHandle; // For remote workspaces
  private sshConnectionId?: string; // Track SSH connection for remote workspaces
  private remotePortForwarding?: { close: () => void }; // For remote MCP access
  private requestId = 0;
  private currentStreamingRequestId: number | null = null; // Track the active streaming request to ignore stale chunks
  private streamParser = new ACPStreamParser();
  private shutdownHandlersSetup = false;
  private isStoppingIntentionally = false; // Track intentional stops
  private sessionCreationParams?: any; // Store session params for restart
  private isRestartingProcess = false; // Track if we're restarting
  private isReconnecting = false; // Track if we're reconnecting SSH (prevents concurrent reconnection attempts)
  private sshDisconnectHandler?: (connectionId: string) => void; // SSH disconnect event handler reference
  private sessionWasRecreated = false; // Track if session was recreated after restart (need to send full history)
  // session/load support: store the previous session ID so we can resume after process restart
  private previousSessionId?: string;
  // Whether the agent advertised loadSession capability in its initialize response
  private agentSupportsSessionLoad = false;
  // Set to true by initializeProtocol() when session/load succeeded (no history resend needed)
  private lastInitUsedSessionLoad = false;
  private agentVersion?: string; // Version reported by the agent in initialize response (e.g. "0.18.0")
  // Restart rate limiting to prevent infinite restart loops (which cause process accumulation / memory leaks)
  private restartTimestamps: number[] = [];
  private static readonly MAX_RESTARTS_IN_WINDOW = 3; // Max restarts allowed within the time window
  private static readonly RESTART_WINDOW_MS = 60_000; // 60-second sliding window
  // For automatic retry when agent.name undefined error occurs
  private pendingRetry?: {
    messages: AgentMessage[];
    options?: any;
    resolveStream?: () => void;
    rejectStream?: (error: Error) => void;
  };
  private retryInProgress = false; // Prevent multiple simultaneous retries
  private lastInterruptTime?: number; // Track when the last interrupt occurred for stuck detection
  // Shorter timeout for first prompt after interrupt - if Auggie doesn't respond within this time,
  // we assume it's stuck and restart the process
  private readonly POST_INTERRUPT_TIMEOUT_MS = 30000; // 30 seconds
  protected tools: Map<string, Tool> = new Map();
  private stalledStreamCheckInterval?: NodeJS.Timeout; // Store interval ID for cleanup
  private healthCheckInterval?: NodeJS.Timeout; // Store health check interval for cleanup
  private idleTimer?: NodeJS.Timeout; // Idle timeout — kills the auggie process to reclaim memory
  private streamingHandler?: ACPProviderStreaming;
  private streamingAgentId?: string; // The agentId used by the streaming handler (may differ from sessionId)
  private isStreaming = false; // Track streaming state

  // Store temp file paths for cleanup when agent exits (not on a timer!)
  // These files are needed by auggie for the lifetime of the process
  private tempRulesFilePath?: string;
  private tempMcpConfigPath?: string;
  // Mapping from command/URL to server name, used to match MCP startup errors to server names
  private mcpServerCommandMap: Map<string, string> = new Map();
  // MCP servers to pass via the ACP session/new mcpServers field.
  // Used by providers (e.g. Claude Code) that don't support --mcp-config.
  private acpMcpServersForSession: AcpMcpServer[] = [];
  private providerCapabilities: ProviderCapabilities;
  // Cache of JSON-RPC method names the connected ACP adapter has already
  // answered with "Method not found". Used to skip redundant attempts (and
  // the accompanying WARN log spam) for optional/unstable methods such as
  // `unstable_setSessionModel` on adapters that don't implement them.
  private unsupportedAcpMethods: Set<string> = new Set();
  // Claude Code adapter sets a default model during session creation.
  // To ensure the user-selected model "sticks", we wait for the adapter's
  // post-newSession model announcement (sessionUpdate) before applying it.
  private pendingClaudeCodeModelId: string | null = null;
  private hasSeenClaudeCodeModelsAnnouncement: boolean = false;
  private appliedClaudeCodeModelId: string | null = null;
  // Workspace scope (relative path within the git root, e.g., "apps/web" for monorepos)
  private workspaceScope?: string;
  // For providers without a first-class rules file flag, inject our rules content once
  // as part of the first prompt to make providers hot-swappable.
  private injectedRuntimeRulesIntoPrompt: boolean = false;
  // Track whether bypassPermissions mode was successfully set on the provider.
  // When false for non-auggie providers, incoming permission requests are auto-approved
  // instead of blocking on a user dialog (since the intent was to bypass permissions).
  private bypassPermissionsActive: boolean = false;
  private cachedRuntimeRulesContent: string | null = null;
  // Buffer of recent stderr error messages for inclusion in error messages shown to the user.
  // When a stream fails with no content, we include the most recent stderr error to give
  // the user actionable diagnostic info (e.g., "Unable to connect. Failed to fetch models.dev").
  private recentStderrErrors: string[] = [];
  // Preserved exit info from the last process exit. handleProcessExit() clears this.agentProcess
  // (to avoid SIGSEGV from orphaned native handles), so initializeProtocol() can't read exit code
  // or stderr from the process reference. This field bridges that gap.
  private lastProcessExitInfo?: {
    code: number | null;
    signal: NodeJS.Signals | null;
    stderr: string[];
    command?: string;
  };

  // Configurable timeouts with progressive backoff
  // Uses shared constant for consistency across the codebase
  // Can be overridden via environment variable for debugging
  // NOTE: This is for detecting truly stalled streams (no activity at all), not for limiting
  // how long an agent can work. Agents should be able to work as long as they need.
  private readonly STALLED_STREAM_TIMEOUT_MS = parseInt(
    process.env.STALLED_STREAM_TIMEOUT_MS || String(AGENT_STREAMING_CONFIG.COMPLETION_DETECTION_MS),
    10,
  ); // Default 5 minutes - only trigger if truly no activity
  private readonly STREAM_CHECK_INTERVAL_MS = 30000; // Check every 30 seconds (less aggressive)
  private stalledStreamRetryCount = new Map<string, number>(); // Track retry attempts per session
  private pendingRequests = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
    }
  >();
  private streamCompletionTimers = new Map<string, NodeJS.Timeout>();
  private sessionRecoveryAttempts = 0; // Track session recovery attempts to prevent infinite loops
  private readonly MAX_SESSION_RECOVERY_ATTEMPTS = 3; // Max times to auto-retry after session loss
  private transientRetryAttempts = 0; // Track transient error retry attempts (fetch failed, timeout, etc.)
  private readonly MAX_TRANSIENT_RETRY_ATTEMPTS = 3; // Max times to auto-retry after transient network errors
  private contextTooLargeRecoveryCount = 0; // Track 413-specific recovery for progressive history reduction
  // Recovery for the "workspace MCP tool went missing" symptom. Forcing a fresh
  // session/new on the next init re-registers the MCP servers/tools that a
  // resumed session may have lost.
  private forceFreshSessionOnNextInit = false;
  private workspaceToolRecoveryAttempts = 0; // Bounded to prevent restart loops
  private readonly MAX_WORKSPACE_TOOL_RECOVERY_ATTEMPTS = 3;
  private workspaceToolRecoveryInProgress = false; // Guard against concurrent recovery
  private triedModels = new Set<string>(); // Track which models we've tried to prevent infinite loops
  // Stream generation counter - incremented on each interrupt to prevent stale cancelled responses
  // from completing new streams. See interrupt() for detailed explanation.
  private streamGeneration = 0;
  // Serialized write queue for stdin to prevent interleaving of large messages.
  // On macOS, pipe writes >4KB (PIPE_BUF) are not atomic at the OS level.
  // Without serialization, concurrent writes from sendRequestInternal and
  // acpServer 'send' handler can corrupt the NDJSON stream.
  private stdinWriteQueue: Promise<void> = Promise.resolve();
  // Track streaming callbacks for active requests
  private streamingCallbacks = new Map<
    string, // sessionId
    {
      onChunk?: (chunk: string) => void;
      onContentBlocks?: (blocks: ContentBlock[]) => void;
      onComplete?: (message: StreamMessage) => void;
      onError?: (error: Error) => void;
      onToolCall?: (toolCall: StreamToolCall) => void;
      // Direct reference to the promise resolver — used by onCleanup to resolve
      // the streamMessage promise when the done notification arrives before the
      // JSON-RPC response's handleStreamCompletion timer fires.
      resolveStream?: () => void;
      // Remove accumulatedContent - let SessionManager handle accumulation
      contentBlocks: ContentBlock[];
      // IMMEDIATE MODE: No buffering for snappy UI
      hasReceivedFirstChunk?: boolean; // Track if we've received the first chunk
      lastActivityTime?: number; // Track last activity for stall detection
      streamStartTime?: number; // Track stream start time for metrics
      chunksReceived?: number; // Count chunks for metrics (only session/update notifications)
      hasReceivedActivity?: boolean; // Broad activity signal (any agent activity: session/update, ACP requests, permissions)
      processedChunkIds?: Set<string>; // Track processed chunks to avoid duplicates
      completeSent?: boolean; // Track if we've already sent a complete message
      streamGeneration?: number; // Track which generation this stream belongs to
      /** Pre-assigned assistant message ID from the renderer (Part A of unified ID fix).
       *  Stored per-session to avoid a race when two streams overlap. */
      assistantMessageId?: string;
    }
  >();

  // Promise chain for sequential message processing - ensures permission requests block subsequent messages
  private messageProcessingChain: Promise<void> = Promise.resolve();

  private bufferRecentStderrError(stderr: string): void {
    const boundedStderr =
      stderr.length > MAX_RECENT_STDERR_ENTRY_CHARS
        ? truncateMiddleContent(stderr, MAX_RECENT_STDERR_ENTRY_CHARS)
        : stderr;

    this.recentStderrErrors.push(boundedStderr);
    if (this.recentStderrErrors.length > MAX_RECENT_STDERR_ERRORS) {
      this.recentStderrErrors.shift();
    }
  }

  // Status callback for lifecycle phase events (set before streamMessage to capture early events)
  private statusCallback?: (data: StatusEventData) => void;

  /**
   * Set the status callback for lifecycle phase events.
   * Must be called before streamMessage() because status events fire during
   * launchAgent/initializeProtocol which happen before the stream starts.
   */
  setStatusCallback(callback: (data: StatusEventData) => void): void {
    this.statusCallback = callback;
  }

  private emitStatus(phase: string, message: string, level: StatusEventData['level'] = 'info'): void {
    this.statusCallback?.({ phase, message, level, timestamp: Date.now() });
  }

  constructor(config: AgentConfig) {
    super(config);
    this.providerCapabilities = resolveProviderCapabilities(config);

    // Debug logging to check if systemPrompt is being passed
    logger.debug('ACPProvider constructor called with config', {
      hasSystemPrompt: !!config.systemPrompt,
      systemPromptLength: config.systemPrompt?.length || 0,
      workspaceId: config.workspaceId,
    });
  }

  /**
   * Check if the agent supports non-destructive cancel (auggie >= 0.18.0).
   * In auggie 0.18.0+, session/cancel no longer marks the session as permanently cancelled,
   * so we can keep using the same session ID without creating a new one.
   * For non-auggie providers or unknown versions, returns false (conservative).
   */
  private supportsNonDestructiveCancel(): boolean {
    if (this.providerCapabilities.id !== 'auggie') return false;
    if (!this.agentVersion) return false;

    const match = this.agentVersion.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
    if (!match) return false;

    const major = parseInt(match[1], 10);
    const minor = parseInt(match[2], 10);
    // 0.18.0+ supports non-destructive cancel
    return major > 0 || (major === 0 && minor >= 18);
  }

  /**
   * Check if the agent supports session/load (auggie >= 0.18.0).
   * Uses both the agentCapabilities.loadSession flag from the initialize response
   * and a version check as a fallback.
   * For non-auggie providers or unknown versions, returns false (conservative).
   */
  private supportsSessionLoad(): boolean {
    // If the agent explicitly advertised loadSession capability, trust it
    if (this.agentSupportsSessionLoad) return true;
    // Fallback: version-based check for auggie only
    if (this.providerCapabilities.id !== 'auggie') return false;
    if (!this.agentVersion) return false;

    const match = this.agentVersion.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
    if (!match) return false;

    const major = parseInt(match[1], 10);
    const minor = parseInt(match[2], 10);
    // 0.18.0+ supports session/load
    return major > 0 || (major === 0 && minor >= 18);
  }

  /**
   * Check if the agent handles MCP init waiting internally (auggie >= 0.23.0).
   * Older auggie versions need a blind sleep fallback before the first prompt.
   */
  private supportsMcpInitWait(): boolean {
    if (this.providerCapabilities.id !== 'auggie') return false;
    if (!this.agentVersion) return false;

    const match = this.agentVersion.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
    if (!match) return false;

    const major = parseInt(match[1], 10);
    const minor = parseInt(match[2], 10);
    // 0.23.0+ handles MCP init waiting internally
    return major > 0 || (major === 0 && minor >= 23);
  }

  /**
   * Try to load a previous session via session/load instead of creating a new one.
   * Returns true if session/load succeeded, false if it failed (caller should fall back to session/new).
   */
  private async tryLoadPreviousSession(): Promise<boolean> {
    // A prior turn detected that the built-in workspace MCP tools went missing.
    // Force a fresh session/new (which re-registers the MCP servers/tools) instead
    // of resuming a session that lost them. The flag is single-use.
    if (this.forceFreshSessionOnNextInit) {
      this.forceFreshSessionOnNextInit = false;
      logger.info(
        'Skipping session/load to recover missing workspace MCP tools (forcing session/new)',
      );
      return false;
    }

    // Check guards BEFORE emitting status, so brand-new sessions don't show "Resuming session…"
    if (!this.previousSessionId || !this.supportsSessionLoad()) {
      logger.info('Skipping session/load attempt', {
        hasPreviousSessionId: !!this.previousSessionId,
        supportsSessionLoad: this.supportsSessionLoad(),
        agentVersion: this.agentVersion,
      });
      return false;
    }

    if (!this.sessionCreationParams) {
      logger.warn('Cannot try session/load without sessionCreationParams');
      return false;
    }

    // Only emit status when we're actually going to attempt session/load
    this.emitStatus('session-load', 'Resuming session…');

    try {
      const loadRequest = {
        jsonrpc: '2.0' as const,
        method: 'session/load',
        params: {
          sessionId: this.previousSessionId,
          cwd: this.sessionCreationParams.cwd,
          mcpServers: this.sessionCreationParams.mcpServers,
        },
        id: ++this.requestId,
      };

      logger.info('Attempting session/load to resume previous session', {
        previousSessionId: this.previousSessionId,
        cwd: this.sessionCreationParams.cwd,
      });

      const loadResponse = await this.sendRequest(loadRequest, 10000);

      if (loadResponse?.error) {
        logger.warn('session/load returned error, will fall back to session/new', {
          previousSessionId: this.previousSessionId,
          errorCode: loadResponse.error.code,
          errorMessage: loadResponse.error.message,
          errorData: loadResponse.error.data ? JSON.stringify(loadResponse.error.data).slice(0, 200) : undefined,
        });
        return false;
      }

      // FIXED: session/load succeeded — auggie may or may not echo sessionId back.
      // Use the sessionId from the response if provided, otherwise keep using previousSessionId.
      if (loadResponse?.result) {
        const fallbackSessionId = this.previousSessionId;
        this.sessionId = loadResponse.result.sessionId || fallbackSessionId;
        this.previousSessionId = this.sessionId;
        logger.info('session/load succeeded — session resumed without history resend', {
          sessionId: this.sessionId,
          responseHadSessionId: !!loadResponse.result.sessionId,
        });

        // Emit event so session manager can update the backend session ID
        this.emit('session:created', {
          sessionId: this.sessionId,
          agentId: this.config.agentId,
        });

        return true;
      }

      logger.warn('session/load response missing result entirely, falling back to session/new', {
        previousSessionId: this.previousSessionId,
        loadResponse: JSON.stringify(loadResponse).slice(0, 200),
      });
      return false;
    } catch (error) {
      logger.warn('session/load failed with exception, falling back to session/new', {
        previousSessionId: this.previousSessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  private shouldInjectRulesIntoPrompt(): boolean {
    const caps = this.providerCapabilities;
    // If the provider supports a rules file and we're using it, don't double-inject.
    return !(caps.supportsRulesFile && caps.rulesFlag);
  }

  private async getRuntimeRulesContentForPrompt(): Promise<string> {
    if (this.cachedRuntimeRulesContent !== null) return this.cachedRuntimeRulesContent;

    // Mirror the Auggie behavior: background/simple requests should get the raw system prompt only.
    // Non-simple requests get the full workspace/context rules bundle.
    if (this.config.simpleRequest) {
      this.cachedRuntimeRulesContent = this.config.systemPrompt || '';
      return this.cachedRuntimeRulesContent;
    }

    this.cachedRuntimeRulesContent = await this.buildRulesContent();
    return this.cachedRuntimeRulesContent;
  }

  private async maybeInjectRulesIntoPromptText(promptText: string): Promise<string> {
    if (!this.shouldInjectRulesIntoPrompt()) return promptText;
    if (this.injectedRuntimeRulesIntoPrompt) return promptText;

    const rules = await this.getRuntimeRulesContentForPrompt();
    if (!rules || rules.trim().length === 0) return promptText;

    logger.info('Injecting runtime rules into first prompt (provider has no rules-file support)', {
      providerId: this.providerCapabilities.id,
      agentId: this.config.agentId,
      workspaceId: this.config.workspaceId,
      rulesLength: rules.length,
      promptLength: promptText.length,
    });

    this.injectedRuntimeRulesIntoPrompt = true;
    return `${rules}\n\n---\n\n${promptText}`;
  }

  /**
   * Get the model fallback chain to use for retries.
   * Uses the dynamic chain from metadata only - no hardcoded fallbacks.
   * Returns empty array if no chain is available.
   */
  private getModelFallbackChain(): string[] {
    // Only use dynamic fallback chain from metadata (passed from frontend)
    const metadataChain = this.config.metadata?.modelFallbackChain;
    if (Array.isArray(metadataChain) && metadataChain.length > 0) {
      logger.info('[ModelFallback] Using dynamic fallback chain from metadata', {
        chainLength: metadataChain.length,
        chain: metadataChain,
        currentModel: this.config.model,
        triedModels: Array.from(this.triedModels),
      });
      return metadataChain;
    }

    // No fallback chain available - return empty array
    logger.warn('[ModelFallback] No fallback chain available (no metadata chain provided)', {
      hasMetadata: !!this.config.metadata,
      metadataKeys: this.config.metadata ? Object.keys(this.config.metadata) : [],
    });
    return [];
  }

  /**
   * Check if this is a remote workspace
   */
  private isRemoteWorkspace(): boolean {
    return this.config.isRemote === true || this.config.environmentConfig?.type === 'remote';
  }

  /**
   * Check if agent process is alive (local or remote)
   */
  private isAgentAlive(): boolean {
    if (this.remoteProcess) {
      return this.remoteProcess.isAlive();
    }
    return !!this.agentProcess && !this.agentProcess.killed && this.agentProcess.exitCode === null;
  }

  /**
   * Public health check for use by AgentBackendHandler.
   * Delegates to the private isAgentAlive() method.
   */
  override isHealthy(): boolean {
    return this.isAgentAlive();
  }

  /**
   * Write to agent stdin (local or remote), serialized through a queue.
   *
   * All writes to the agent's stdin MUST go through this method to prevent
   * interleaving. On macOS, PIPE_BUF is 4096 bytes — writes larger than that
   * are NOT atomic at the OS level. A 12KB JSON-RPC message gets split across
   * multiple kernel writes, and if another message is written between those
   * chunks, the agent receives corrupted NDJSON.
   *
   * The queue ensures each write fully drains before the next one starts.
   */
  private writeToAgent(message: string): boolean {
    if (this.remoteProcess && this.remoteProcess.isAlive()) {
      const remoteProcess = this.remoteProcess;
      this.stdinWriteQueue = this.stdinWriteQueue.then(
        () =>
          new Promise<void>((resolve) => {
            try {
              remoteProcess.write(message);
            } catch {
              // Remote process may have died between the isAlive() check and write()
            }
            resolve();
          }),
      );
      return true;
    }
    if (this.agentProcess?.stdin && this.agentProcess.stdin.writable) {
      const stdin = this.agentProcess.stdin;
      this.stdinWriteQueue = this.stdinWriteQueue.then(
        () =>
          new Promise<void>((resolve) => {
            // If the stream was destroyed between queuing and execution, skip.
            if (!stdin.writable) {
              resolve();
              return;
            }
            try {
              // stream.write() returns false when the internal buffer is full.
              // In that case, wait for 'drain' before allowing the next write.
              const ok = stdin.write(message);
              if (ok) {
                resolve();
              } else {
                // IMPORTANT: Also listen for 'error' and 'close' to prevent deadlock.
                // If the process dies while we're waiting for 'drain', the drain event
                // will never fire. Without these fallback listeners, the queue would be
                // stuck forever and all subsequent writes would hang.
                const cleanup = () => {
                  stdin.removeListener('drain', onDrain);
                  stdin.removeListener('error', onFail);
                  stdin.removeListener('close', onFail);
                };
                const onDrain = () => {
                  cleanup();
                  resolve();
                };
                const onFail = () => {
                  cleanup();
                  resolve(); // Resolve (not reject) to keep the queue chain alive
                };
                stdin.once('drain', onDrain);
                stdin.once('error', onFail);
                stdin.once('close', onFail);
              }
            } catch {
              // write() can throw if the stream is already destroyed
              resolve();
            }
          }),
      );
      return true;
    }
    return false;
  }

  /**
   * Get the effective LOCAL workspace path for this agent.
   * This is used for storing local temp files (MCP configs, rules files, etc.)
   *
   * For local workspaces: Returns the actual git worktree path where auggie runs.
   * For remote workspaces: Returns a local temp directory for storing configs.
   *                        The actual agent runs on the remote server in the remote path.
   */
  private getEffectiveWorkspacePath(): string {
    // For remote workspaces, use a local temp directory for storing config files
    // The actual agent runs on the remote server and uses the remote workspace path
    if (this.isRemoteWorkspace()) {
      const workspaceId = this.config.workspaceId || 'default';
      const workspacePath = path.join(
        WorkspaceConfig.resolveWorkspaceRoot(workspaceId),
        workspaceId,
        '.remote-agent',
      );

      // Ensure the directory exists
      try {
        if (!fs.existsSync(workspacePath)) {
          fs.mkdirSync(workspacePath, { recursive: true });
        }
        logger.debug('Using local temp directory for remote workspace config files', {
          localPath: workspacePath,
          remoteWorkspacePath: this.config.environmentConfig?.workspace_path,
        });
        return workspacePath;
      } catch (error) {
        logger.error('Failed to create remote agent directory, falling back to temp dir', {
          error,
        });
        return os.tmpdir();
      }
    }

    // For local workspaces, use the actual workspace path
    // If workspacePath is provided and is a valid git worktree, use it
    if (this.config.workspacePath) {
      // Check if this looks like a git worktree (contains .git directory)
      const gitDir = path.join(this.config.workspacePath, '.git');
      if (fs.existsSync(gitDir)) {
        logger.debug('Using provided workspacePath as git worktree', {
          workspacePath: this.config.workspacePath,
        });
        return this.config.workspacePath;
      }

      // If it's not a git worktree but is a valid directory, check if it contains a worktree subdirectory
      if (fs.existsSync(this.config.workspacePath)) {
        // Try to find a git worktree in subdirectories
        try {
          const entries = fs.readdirSync(this.config.workspacePath);
          for (const entry of entries) {
            const fullPath = path.join(this.config.workspacePath, entry);
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
              const entryGitDir = path.join(fullPath, '.git');
              if (fs.existsSync(entryGitDir)) {
                logger.debug('Found git worktree in subdirectory', {
                  workspacePath: this.config.workspacePath,
                  worktreePath: fullPath,
                });
                return fullPath;
              }
            }
          }
        } catch (error) {
          logger.warn('Failed to search for git worktree in subdirectories', { error });
        }
      }
    }

    // Fallback: Use workspace-specific subdirectory (resolves both ~/intent and legacy ~/.workspaces)
    const workspaceId = this.config.workspaceId || 'default';
    const workspacePath = WorkspaceConfig.paths.workspace(workspaceId);

    // Ensure the directory exists
    try {
      if (!fs.existsSync(workspacePath)) {
        fs.mkdirSync(workspacePath, { recursive: true });
      }
      return workspacePath;
    } catch (error) {
      logger.error('Failed to create workspace directory, falling back to temp dir', { error });
      return os.tmpdir();
    }
  }

  /**
   * Get the workspace path where the agent actually runs.
   * For local workspaces: Same as getEffectiveWorkspacePath(), with scope applied if set
   * For remote workspaces: The remote path where auggie runs on the remote server
   */
  private getAgentWorkingDirectory(): string {
    if (this.isRemoteWorkspace()) {
      // For remote workspaces, the agent runs in the remote workspace path
      // Apply scope if present (for remote monorepos)
      const remotePath = this.config.environmentConfig?.workspace_path || os.tmpdir();
      if (this.workspaceScope) {
        return path.join(remotePath, this.workspaceScope);
      }
      return remotePath;
    }
    // For local workspaces, the agent runs in the local workspace path
    const basePath = this.getEffectiveWorkspacePath();
    // Apply scope if present (for local monorepos)
    if (this.workspaceScope) {
      return path.join(basePath, this.workspaceScope);
    }
    return basePath;
  }

  async initialize(): Promise<void> {
    // Store the frontend session ID from config if provided
    // This is the session ID that the frontend expects to use for streaming
    if (this.config.sessionId) {
      this.frontendSessionId = this.config.sessionId;
      logger.info('Using frontend sessionId from config', {
        frontendSessionId: this.frontendSessionId,
      });
    }

    // Restore persisted backend session ID for session/load across Intent restarts.
    // The in-memory previousSessionId is the fast path within a single session;
    // backendSessionId is the durable fallback loaded from disk.
    const persistedSessionId = this.config.acpSessionId;
    if (!this.previousSessionId && persistedSessionId) {
      this.previousSessionId = persistedSessionId;
      logger.info('Restored previousSessionId from persisted session ID', {
        acpSessionId: this.config.acpSessionId,
        backendSessionId: this.config.backendSessionId,
      });
    }

    logger.info('Initializing ACP provider', {
      workspaceId: this.config.workspaceId,
      frontendSessionId: this.frontendSessionId,
    });

    // Note: We don't initialize tool service here anymore
    // The agent (auggie) will use MCP tools directly via the configured MCP server
    // This is configured in the session/new request with mcpServers parameter

    // Initialize ACP server
    // Use workspace-specific subdirectory if workspacePath is not provided
    const effectiveWorkspacePath = this.getEffectiveWorkspacePath();

    // Get workspace scope if available
    // Store it in class member so getAgentWorkingDirectory() can use it
    if (this.config.workspaceId) {
      try {
        const { workspaceService } = await import('../../../workspace/main/workspace.service');
        const workspaceResult = await workspaceService.getWorkspace(
          createWorkspaceId(this.config.workspaceId),
        );
        if (workspaceResult.ok) {
          this.workspaceScope = workspaceResult.data.scope;
          logger.info('Loaded workspace scope from workspace service', {
            workspaceId: this.config.workspaceId,
            scope: this.workspaceScope,
            worktreePath: workspaceResult.data.worktreePath,
            repositoryPath: workspaceResult.data.repositoryPath,
          });
        }
      } catch (error) {
        logger.warn('Failed to get workspace scope for ACP server', error as Error);
      }
    }

    const serverConfig: ACPServerConfig = {
      clientInfo: {
        name: 'Intent',
        version: app.getVersion(),
      },
      workspacePath: effectiveWorkspacePath,
      // Note: workspaceId may be undefined if not provided in config
      // This is acceptable for ACP server config as it's used for logging/identification
      workspaceId: this.config.workspaceId || 'default',
      scope: this.workspaceScope,
      capabilities: {
        fileSystem: true,
        terminal: true,
        permissions: true,
      },
    };

    this.acpServer = new ACPServer(serverConfig);

    // Set up event handlers
    this.acpServer.on('prompt', (params: any) => {
      logger.debug('Received prompt from agent', params);
    });

    // NOTE: session:update events are NOT emitted by acpServer - they are processed
    // directly in the message handler at line ~1745. The timer reset logic is there.
    // This handler is kept for potential future use or debugging.
    this.acpServer.on('session:update', (params: any) => {
      logger.debug(
        'Session update via event (unexpected - updates normally processed directly)',
        params,
      );
      this.emit('update', params);
    });

    this.acpServer.on('send', (message: any) => {
      // Route through writeToAgent to serialize writes and prevent interleaving.
      // Previously this wrote directly to stdin, bypassing the write queue.
      if (!this.writeToAgent(`${message}\n`)) {
        logger.warn('Cannot send message to agent - no writable channel', {
          hasLocalProcess: !!this.agentProcess,
          hasRemoteProcess: !!this.remoteProcess,
          remoteAlive: this.remoteProcess?.isAlive(),
          localStdin: !!this.agentProcess?.stdin,
          localWritable: this.agentProcess?.stdin?.writable,
          message: String(message).substring(0, 100),
        });
      }
    });

    // Launch the agent process if command is provided
    if (this.config.command) {
      await this.launchAgent();
    }

    // Initialize protocol
    await this.initializeProtocol();

    logger.info('ACP provider initialized successfully', {
      sessionId: this.sessionId,
      pid: this.agentProcess?.pid,
    });

    // Agent will initialize on the first real message
    logger.info('Agent initialized without warmup for faster startup');
  }

  /**
   * Set the frontend session ID for stream routing.
   * This is used when reusing a pre-warmed provider for a specific agent.
   * The frontend uses agentId as the session key, but auggie uses its own internal sessionId.
   * This mapping ensures stream messages are routed to the correct frontend handler.
   */
  setFrontendSessionId(sessionId: string): void {
    logger.info('Setting frontend session ID', {
      frontendSessionId: sessionId,
      internalSessionId: this.sessionId,
    });
    this.frontendSessionId = sessionId;

    // Also update config.agentId so that streaming handler and other components use the correct ID
    // This is important when reusing a pre-warmed provider that was created without an agentId
    this.config.agentId = sessionId;
    this.config.id = sessionId;

    // Also update the streaming handler if it exists
    if (this.streamingHandler) {
      this.streamingHandler.setInternalSessionId(sessionId);
    }
  }

  /**
   * Helper function to spawn a process with fallback stdio configurations
   * to handle EBADF errors in Electron environments
   */
  private safeSpawn(command: string, args: string[], options: any): ChildProcess {
    const attempts: Array<{ stdio: any; error?: Error }> = [];

    // Try different stdio configurations in order of preference
    const stdioConfigs = [
      ['pipe', 'pipe', 'pipe'],
      [0, 1, 2], // Use parent's file descriptors
      ['pipe', 'pipe', 2], // Pipe stdin/stdout, inherit stderr
      'inherit', // Inherit all from parent
      ['ignore', 'ignore', 'ignore'], // Last resort
    ];

    for (const stdio of stdioConfigs) {
      try {
        const spawnOpts = { ...options, stdio, windowsHide: true };
        const proc = spawn(command, args, spawnOpts);

        if (proc && proc.pid) {
          logger.info('Process spawned successfully with stdio config', {
            stdio: Array.isArray(stdio) ? stdio.join(',') : stdio,
            pid: proc.pid,
            hasStdin: !!proc.stdin,
            hasStdout: !!proc.stdout,
            hasStderr: !!proc.stderr,
          });
          return proc;
        }

        // spawn() returned a process object but without a PID. This typically means
        // the command was not found or not executable. Node.js emits the actual error
        // asynchronously via the 'error' event, so we can't capture it here.
        // Record this as a failed attempt.
        logger.warn(`spawn returned process without PID for stdio ${JSON.stringify(stdio)}`, {
          command,
          hasProc: !!proc,
        });
        attempts.push({
          stdio,
          error: new Error(
            `spawn returned without PID (command "${command}" may not be found or not executable)`,
          ),
        });
        // Attach a no-op error listener to prevent the asynchronous ENOENT 'error'
        // event from becoming an uncaught exception. Do NOT call proc.kill() here —
        // killing a process with no PID causes a hang in Node.js internals.
        proc?.on('error', () => {});
      } catch (error) {
        const errnoError = error as NodeJS.ErrnoException;
        attempts.push({ stdio, error: errnoError });

        if (errnoError.code === 'EBADF') {
          logger.warn(`EBADF error with stdio ${JSON.stringify(stdio)}, trying next...`);
        } else if (errnoError.code !== 'ENOENT') {
          logger.error(`Spawn error with stdio ${JSON.stringify(stdio)}`, error as Error);
        }
      }
    }

    // If we get here, all attempts failed
    const errorDetails = attempts
      .map((a) => `${JSON.stringify(a.stdio)}: ${a.error?.message || 'unknown error'}`)
      .join('; ');

    throw new Error(
      `Failed to spawn process after trying all stdio configurations (command: "${command}"): ${errorDetails}`,
    );
  }

  /**
   * Get tools to remove based on specialist/agent type.
   * This enforces role-based tool access at the CLI level using --remove-tool flags.
   *
   * Tool restrictions by specialist:
   * - spec-writer (Coordinator): No code editing tools (orchestrates only)
   * - verifier: Full access (needs to run tests, potentially fix issues)
   * - implementor: Full access (needs all tools to implement)
   *
   * Background agents (commit-message, pr-description, code-review, etc.) have
   * their own denylists defined in background-agent-tool-restrictions.ts
   */
  private getToolRestrictionsForAgent(): string[] {
    const specialist = this.config.metadata?.specialist;
    // Check both metadata.agentType (standard) and config.agentType (fallback for
    // background requests where metadata may not survive the provider pipeline)
    const agentType = this.config.metadata?.agentType || (this.config as any).agentType;

    // DEBUG: Log what we're seeing to diagnose tool restriction bug
    logger.info('[getToolRestrictionsForAgent] Checking tool restrictions', {
      hasMetadata: !!this.config.metadata,
      metadataKeys: this.config.metadata ? Object.keys(this.config.metadata) : [],
      hasDirectAgentType: !!(this.config as any).agentType,
      directAgentType: (this.config as any).agentType,
      specialist,
      agentType,
      agentId: this.config.agentId,
    });

    // CRITICAL: Check specialist FIRST before agentType
    // Coordinator/spec-writer: Cannot edit code, only orchestrate
    // Note: 'spec-writer' is the canonical ID; 'coordinator' is the display name (defensive check)
    // Must also remove EXECUTION_TOOLS because launch-process can be used to edit files via shell commands
    // (e.g., echo, cat, sed, etc.)
    if (specialist === 'spec-writer' || specialist === 'coordinator') {
      const toolsToRemove = [...FILE_WRITE_TOOLS, ...SUBAGENT_TOOLS, ...CONFLICTING_BUILTIN_TOOLS];
      logger.info('[getToolRestrictionsForAgent] Applying spec-writer/coordinator restrictions', {
        specialist,
        toolsToRemoveCount: toolsToRemove.length,
        toolsToRemove,
      });
      return toolsToRemove;
    }

    // Check if this is a background agent with specific tool restrictions
    // This check comes AFTER specialist check to ensure specialist restrictions take precedence
    const backgroundDenylist = getToolDenylistForAgentType(agentType || '');
    if (backgroundDenylist.length > 0) {
      logger.info('[getToolRestrictionsForAgent] Applying background agent denylist', {
        agentType,
        denylistLength: backgroundDenylist.length,
      });
      return [...backgroundDenylist, ...CONFLICTING_BUILTIN_TOOLS];
    }

    // GLOBAL RESTRICTION: Block sub-agent tool for ALL agents
    // Reason: sub-agent tool has no UI representation, making work invisible to users.
    // All agents should use ws.agent.delegate() or ws.agent.create() (via workspace_api)
    // instead, which create visible workspace agents that users can see and interact with.
    logger.info('[getToolRestrictionsForAgent] Applying global sub-agent restriction', {
      specialist,
      agentType,
    });
    return [...SUBAGENT_TOOLS, ...CONFLICTING_BUILTIN_TOOLS];
  }

  private async launchAgent(): Promise<void> {
    this.emitStatus('launch', 'Launching agent…');
    if (!this.config.command) {
      throw new Error('No agent command specified');
    }

    // For remote workspaces, launch agent on the remote server
    // (no local child process — skip slot acquisition)
    if (this.isRemoteWorkspace()) {
      await this.launchRemoteAgent();
      return;
    }

    // Enforce global process cap — evict LRU idle process or wait for a slot
    await acquireProcessSlot();

    logger.info('Launching agent process', {
      command: this.config.command,
      hasSystemPrompt: !!this.config.systemPrompt,
      systemPromptLength: this.config.systemPrompt?.length || 0,
      systemPromptPreview: this.config.systemPrompt?.substring(0, 100),
      workspaceId: this.config.workspaceId,
      workspacePath: this.config.workspacePath,
    });

    // Configure MCP servers and rules via command line args (provider-specific)
    const args = [...(this.config.args || [])];
    let mcpConfigPath: string | undefined;
    let rulesFilePath: string | undefined;
    let workspaceMcpServers: Record<string, McpServerConfig> | undefined;

    // Get provider capabilities to determine what features are supported
    const caps = this.providerCapabilities;

    // Some providers require config files written relative to the agent CWD (e.g. Claude Code .mcp.json).
    // Compute this early so we can write provider config before spawning.
    const workingDirectory = this.getEffectiveWorkspacePath();

    // If this provider supports MCP config and rules, and we have workspace configuration
    if (
      (caps.supportsMcpConfig || caps.supportsRulesFile) &&
      this.config.workspaceId &&
      this.config.workspacePath
    ) {
      // For auggie, ensure allow-indexing is present to avoid extra permission prompts
      if (caps.id === 'auggie' && !args.includes('--allow-indexing')) {
        args.push('--allow-indexing');
      }

      // For simple requests (background checks), add quiet flag to suppress welcome messages
      // This makes the agent only show the final assistant response
      if (this.config.simpleRequest && caps.quietFlag && !args.includes(caps.quietFlag)) {
        args.push(caps.quietFlag);
      }

      // Create rules file for system prompt (if provider supports it)
      if (caps.supportsRulesFile && caps.rulesFlag && this.config.systemPrompt) {
        // Use global tmp directory (~/.augment/tmp) to avoid polluting worktrees
        const tmpDir = getGlobalTmpDir();
        if (!fs.existsSync(tmpDir)) {
          fs.mkdirSync(tmpDir, { recursive: true });
        }

        // For simple requests (background checks), use raw system prompt only
        // For regular agents, build comprehensive rules with workspace context
        const rulesContent = this.config.simpleRequest
          ? this.config.systemPrompt
          : await this.buildRulesContent();

        // Write rules to a temporary file
        rulesFilePath = path.join(tmpDir, `agent-rules-${Date.now()}.md`);
        fs.writeFileSync(rulesFilePath, rulesContent);

        // Add rules flag to args using provider-specific flag
        args.push(caps.rulesFlag, rulesFilePath);
      }

      // Configure workspace MCP tools for this provider (if supported via --mcp-config).
      if (caps.supportsMcpConfig && caps.mcpConfigFlag) {
        // Always add MCP configuration to give agents access to user-defined MCP servers
        // User MCP servers from ~/.augment/settings.json should always be available
        logger.info('Adding MCP configuration for agent', {
          simpleRequest: !!this.config.simpleRequest,
          agentId: this.config.agentId,
          agentType: this.config.metadata?.agentType,
        });

        {
          // Enable MCP configuration to give agents access to workspace tools
          // This allows agents to use MCP tools like notes.create, workspace.rename, etc.
          // The stdio server will provide workspace-specific tools

          logger.info('Adding MCP configuration for agent', {
            simpleRequest: !!this.config.simpleRequest,
            agentId: this.config.agentId,
            agentType: this.config.metadata?.agentType,
          });

          // Get the correct path to mcp-stdio-server.cjs (handles packaged app vs dev)
          const mcpServerPath = getMcpServerPath();

          // Also pass workspace ID and path as command line arguments for the stdio server
          // Use the actual HTTP MCP port from environment (set by HttpMcpBridge after finding available port)
          const httpMcpPort = process.env.HTTP_MCP_PORT || '5179';

          // For remote workspaces, pass the remote workspace path to MCP tools
          // The MCP tools will use the FileSystemAdapter to access remote files
          const isRemote = this.isRemoteWorkspace();
          const effectiveWorkspacePath = isRemote
            ? this.config.environmentConfig?.workspace_path || this.config.workspacePath || ''
            : this.getEffectiveWorkspacePath();

          // Build MCP servers config
          // Pass port as CLI arg (4th argument) since env vars may not be passed through by auggie

          // Use Electron's embedded Node.js via ELECTRON_RUN_AS_NODE=1
          // This is the most robust approach - no dependency on user's PATH or installed Node.
          // Electron ships with Node baked in, and setting ELECTRON_RUN_AS_NODE=1 makes
          // the Electron executable behave like a Node.js binary.
          //
          // This avoids:
          // - PATH resolution issues in packaged apps (nvm, volta, etc. not in PATH)
          // - Different Node versions between dev and production
          // - Users needing Node.js installed at all
          let nodeCommand = process.execPath; // Absolute path to Electron executable
          const useElectronAsNode = true; // Set ELECTRON_RUN_AS_NODE=1 in env

          // WORKAROUND: If the Electron path contains spaces (e.g., "Intent by Augment.app"),
          // auggie may not handle it correctly when spawning the MCP server process.
          // Create a symlink to the executable in a path without spaces.
          if (nodeCommand.includes(' ') && app.isPackaged) {
            const safeDir = path.join(os.homedir(), '.augment', 'electron-node');
            let safePath = path.join(safeDir, 'node');

            try {
              // Create directory if needed
              if (!fs.existsSync(safeDir)) {
                fs.mkdirSync(safeDir, { recursive: true });
              }

              if (process.platform === 'win32') {
                // On Windows, fs.symlinkSync() requires Developer Mode or admin privileges,
                // so use a .cmd wrapper script instead.
                safePath = path.join(safeDir, 'node.cmd');
                const cmdContent = `@"${nodeCommand}" %*\r\n`;
                let needsUpdate = true;
                try {
                  const existing = fs.readFileSync(safePath, 'utf-8');
                  if (existing === cmdContent) {
                    needsUpdate = false;
                  }
                } catch {
                  // File doesn't exist yet
                }
                if (needsUpdate) {
                  fs.writeFileSync(safePath, cmdContent);
                  logger.info('Created .cmd wrapper for Electron-as-Node (spaces workaround)', {
                    originalPath: nodeCommand,
                    safePath,
                  });
                }
              } else {
                // Check if symlink exists and points to the correct target.
                // IMPORTANT: Use lstatSync instead of existsSync because existsSync
                // follows symlinks — a dangling symlink (target removed after app update)
                // would cause existsSync to return false even though the symlink file
                // itself still exists, leading to EEXIST when creating a new one.
                let needsUpdate = true;
                let symlinkFileExists = false;
                try {
                  fs.lstatSync(safePath);
                  symlinkFileExists = true;
                } catch {
                  // File doesn't exist at all — safe to create
                }

                if (symlinkFileExists) {
                  try {
                    const currentTarget = fs.readlinkSync(safePath);
                    if (currentTarget === nodeCommand) {
                      needsUpdate = false; // Symlink already correct
                    } else {
                      fs.unlinkSync(safePath); // Remove stale/dangling symlink
                    }
                  } catch {
                    // Not a symlink or can't read, remove it
                    fs.unlinkSync(safePath);
                  }
                }

                if (needsUpdate) {
                  // Create symlink to Electron executable
                  fs.symlinkSync(nodeCommand, safePath);

                  logger.info('Created symlink for Electron-as-Node (spaces workaround)', {
                    originalPath: nodeCommand,
                    safePath,
                  });
                }
              }

              nodeCommand = safePath;
            } catch (symlinkError) {
              logger.warn('Failed to create symlink for Electron-as-Node, using original path', {
                error: symlinkError,
                originalPath: nodeCommand,
              });
            }
          }

          logger.info('MCP server will use Electron as Node', {
            nodeCommand,
            isPackaged: app.isPackaged,
            electronVersion: process.versions.electron,
            nodeVersion: process.versions.node,
          });

          const mcpServers: Record<string, McpServerConfig> = {
            // MCP server name - auggie suffixes tool names with '_workspace-mcp'
            'workspace-mcp': {
              command: nodeCommand,
              args: [
                mcpServerPath,
                this.config.workspaceId || 'default',
                effectiveWorkspacePath,
                httpMcpPort, // Pass port as CLI arg for reliability
              ],
              env: {
                // CRITICAL: Make Electron run as Node.js instead of launching the app
                // This allows us to use Electron's embedded Node without external dependencies
                ...(useElectronAsNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
                // Still pass PATH for any child processes the MCP server might spawn
                PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
                // Use 127.0.0.1 to ensure IPv4 connection (avoids IPv6/IPv4 port conflicts with Vite on macOS)
                HTTP_MCP_HOST: '127.0.0.1',
                HTTP_MCP_PORT: httpMcpPort,
                WORKSPACE_ID: this.config.workspaceId,
                WORKSPACE_PATH: effectiveWorkspacePath,
                // Pass agent information for provenance tracking
                AGENT_ID: this.config.agentId || 'agent',
                AGENT_NAME: this.config.name || 'Agent',
                AGENT_SESSION_ID: this.sessionId || '',
                // Pass remote environment info so MCP tools know to use remote file system
                IS_REMOTE: isRemote ? 'true' : 'false',
                ENVIRONMENT_CONFIG: isRemote ? JSON.stringify(this.config.environmentConfig) : '',
                // Pass electron store path for fallback port lookup in production
                ELECTRON_STORE_CWD: process.env.ELECTRON_STORE_CWD || '',
              },
            },
          };

          // NOTE: CDP MCP server is intentionally NOT added to agent tooling.
          // The CDP MCP server connects to the app's own Electron renderer (port 9223),
          // which would allow agents to navigate/control the Intent app window itself.
          // This is dangerous - agents could hijack the app by navigating to external URLs.
          // If agents need web scraping capabilities, use a separate browser automation tool
          // that doesn't control the app's own window.

          // Merge user-defined MCP servers if enabled
          // Skip user MCP servers for simple/background requests (e.g., AI commit message generation)
          // to avoid broken user MCP servers causing failures
          let finalMcpServers: Record<string, McpServerConfig> = mcpServers;
          try {
            logger.info('Checking user MCP servers feature flag...');

            if (this.config.simpleRequest) {
              logger.info('Skipping user MCP servers for simple/background request');
            } else {
              // Check if user MCP servers feature is enabled in settings
              // Use dynamic import since we're in ESM context
              const ElectronStore = (await import('electron-store')).default;
              const settingsStore = new ElectronStore({ name: 'settings' });
              const enableUserMcpServers = settingsStore.get('enableUserMcpServers', true);

              logger.info('User MCP servers feature flag value', { enableUserMcpServers });

              if (enableUserMcpServers) {
                logger.info('User MCP servers feature is enabled, loading user servers');
                const userServers = await readUserMcpServers();

                logger.info('Read user MCP servers result', {
                  hasServers: !!userServers,
                  serverCount: userServers ? Object.keys(userServers).length : 0,
                  serverNames: userServers ? Object.keys(userServers) : [],
                });

                if (userServers) {
                  // Get list of disabled servers for this workspace
                  const { getWorkspaceDisabledMcpServers, getGlobalDisabledMcpServers } =
                    await import('../../../mcp/main/user-mcp-settings');
                  const workspaceDisabled = this.config.workspaceId
                    ? await getWorkspaceDisabledMcpServers(this.config.workspaceId)
                    : null;
                  const disabledServers = workspaceDisabled ?? getGlobalDisabledMcpServers();

                  // Filter out disabled servers before merging
                  const filteredUserServers = Object.fromEntries(
                    Object.entries(userServers).filter(([name]) => !disabledServers.includes(name)),
                  );

                  // Use the auth-injecting version to automatically add credentials for known services
                  const { servers, conflicts } = await mergeUserMcpServersWithAuth(
                    mcpServers,
                    filteredUserServers,
                  );
                  finalMcpServers = servers as Record<string, any>;

                  if (conflicts.length > 0) {
                    logger.warn('MCP server conflicts detected', { conflicts });
                  }

                  logger.info('Merged user MCP servers', {
                    builtInCount: Object.keys(mcpServers).length,
                    userCount: Object.keys(userServers).length,
                    disabledCount: disabledServers.length,
                    disabledServers,
                    finalCount: Object.keys(finalMcpServers).length,
                    userServerNames: Object.keys(filteredUserServers),
                  });
                } else {
                  logger.warn('readUserMcpServers returned null/undefined');
                }
              } else {
                logger.info('User MCP servers feature is disabled (enableUserMcpServers=false)');
              }
            } // end of !simpleRequest block
          } catch (userMcpError) {
            logger.error('Failed to load user MCP servers, using built-in only', {
              error: userMcpError instanceof Error ? userMcpError.message : String(userMcpError),
              stack: userMcpError instanceof Error ? userMcpError.stack : undefined,
            });
            // Surface the error to the user via IPC
            this.surfaceMcpLoadErrorToRenderer(userMcpError);
          }

          // Merge a safe parent-process environment baseline into every stdio
          // MCP server so user-configured servers (and the built-in
          // workspace-mcp) inherit expected shell variables instead of running
          // with an overly narrow environment. Explicit per-server env wins.
          finalMcpServers = applyBaselineEnvToStdioServers(finalMcpServers);

          const mcpConfig = { mcpServers: finalMcpServers };
          workspaceMcpServers = finalMcpServers;

          // Build command/URL → server name mapping for matching MCP startup errors
          this.mcpServerCommandMap.clear();
          for (const [name, serverCfg] of Object.entries(finalMcpServers)) {
            if (name === 'workspace-mcp') continue; // Skip built-in server
            const cfg = serverCfg as any;
            if (cfg.url) {
              this.mcpServerCommandMap.set(cfg.url.trim(), name);
            }
            if (cfg.command) {
              // Store the full command string that auggie prints
              const fullCmd = cfg.args?.length
                ? `${cfg.command} ${(cfg.args as string[]).join(' ')}`
                : cfg.command;
              this.mcpServerCommandMap.set(fullCmd.trim(), name);
              // Also store just the command in case auggie only prints the command without args
              this.mcpServerCommandMap.set(cfg.command.trim(), name);
            }
          }

          // Log detailed MCP config for debugging production issues
          const mcpServerPathExists = fs.existsSync(mcpServerPath);
          logger.info('MCP config created with agent info', {
            agentId: this.config.agentId,
            agentName: this.config.name,
            sessionId: this.sessionId,
            workspaceId: this.config.workspaceId,
            httpMcpPort,
            isRemote,
            effectiveWorkspacePath,
            mcpServerPath,
            mcpServerPathExists,
            isPackaged: app.isPackaged,
            // Redact env/header values so secrets never reach logs.
            mcpConfigJson: JSON.stringify(redactMcpEnvForLogging(mcpConfig), null, 2),
          });

          // CRITICAL: If MCP server path doesn't exist, log error with details
          if (!mcpServerPathExists) {
            logger.error('MCP server path does not exist! Tools will not work.', {
              mcpServerPath,
              __dirname,
              isPackaged: app.isPackaged,
              // List what files exist in the expected directory
              parentDir: path.dirname(mcpServerPath),
              parentDirExists: fs.existsSync(path.dirname(mcpServerPath)),
              parentDirContents: fs.existsSync(path.dirname(mcpServerPath))
                ? fs.readdirSync(path.dirname(mcpServerPath))
                : [],
            });
          }

          // Write MCP debug info to ~/.augment/mcp-debug.log for production debugging
          // Keep only last 50 entries to prevent unbounded growth
          try {
            const debugDir = path.join(os.homedir(), '.augment');
            if (!fs.existsSync(debugDir)) {
              fs.mkdirSync(debugDir, { recursive: true });
            }
            const debugLogPath = path.join(debugDir, 'mcp-debug.log');
            const debugInfo = {
              timestamp: new Date().toISOString(),
              mcpServerPath,
              mcpServerPathExists,
              nodeCommand,
              nodeCommandExists: fs.existsSync(nodeCommand),
              useElectronAsNode,
              electronVersion: process.versions.electron,
              nodeVersion: process.versions.node,
              __dirname,
              isPackaged: app.isPackaged,
              httpMcpPort,
              // Redact env/header values so secrets never reach the debug log.
              mcpConfig: redactMcpEnvForLogging(mcpConfig),
            };

            // Read existing entries, keep last 49, add new one
            let entries: string[] = [];
            if (fs.existsSync(debugLogPath)) {
              const content = fs.readFileSync(debugLogPath, 'utf8');
              entries = content.split('\n---\n').filter((e) => e.trim());
            }
            entries = entries.slice(-49); // Keep last 49
            entries.push(JSON.stringify(debugInfo, null, 2));
            fs.writeFileSync(debugLogPath, entries.join('\n---\n') + '\n---\n');
          } catch {
            // Ignore debug logging errors
          }

          // Write MCP config to a temporary file
          // Use global tmp directory (~/.augment/tmp) to avoid polluting worktrees
          const tmpDir = getGlobalTmpDir();
          if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir, { recursive: true });
          }

          // Clean up old MCP config files (older than 1 hour) to prevent accumulation
          // Do this asynchronously to not block agent startup
          try {
            const files = fs.readdirSync(tmpDir);
            const oneHourAgo = Date.now() - 60 * 60 * 1000;
            for (const file of files) {
              if (file.startsWith('mcp-config-') && file.endsWith('.json')) {
                const filePath = path.join(tmpDir, file);
                const stats = fs.statSync(filePath);
                if (stats.mtimeMs < oneHourAgo) {
                  fs.unlinkSync(filePath);
                }
              }
            }
          } catch {
            // Ignore cleanup errors - not critical
          }

          mcpConfigPath = path.join(tmpDir, `mcp-config-${Date.now()}.json`);
          fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));

          logger.info('MCP config file written', {
            mcpConfigPath,
            mcpConfigPathExists: fs.existsSync(mcpConfigPath),
          });

          // Add MCP config flag to args using provider-specific flag
          args.push(caps.mcpConfigFlag, mcpConfigPath);

          logger.info('MCP config added to args', {
            mcpConfigPath,
            argsContainsMcpConfig: args.includes(caps.mcpConfigFlag),
            argsList: args,
          });
        }

        // Add tool restrictions based on specialist/agent type
        // This enforces role-based tool access at the CLI level
        const toolsToRemove = this.getToolRestrictionsForAgent();

        logger.info('[launchAgent] Applying tool restrictions', {
          toolCount: toolsToRemove.length,
          specialist: this.config.metadata?.specialist,
          agentType: this.config.metadata?.agentType,
        });

        for (const tool of toolsToRemove) {
          if (!args.includes('--remove-tool') || !args.includes(tool)) {
            args.push('--remove-tool', tool);
          }
        }

        // Store temp file paths for cleanup when agent exits
        // IMPORTANT: Don't use setTimeout - auggie needs these files for its entire lifetime!
        // If we delete them while auggie is running, session reset/recovery will fail with
        // "Rules file not found" error. Clean up in cleanupTempFiles() when agent stops.
        this.tempRulesFilePath = rulesFilePath;
        this.tempMcpConfigPath = mcpConfigPath;
      }
    } // Close the outer if block for (caps.supportsMcpConfig || caps.supportsRulesFile)

    logger.info('Proceeding with agent launch', {
      providerId: caps.id,
      supportsMcpConfig: caps.supportsMcpConfig,
      supportsRulesFile: caps.supportsRulesFile,
      hasWorkspaceMcpServers: !!workspaceMcpServers,
      workingDirectory,
    });

    // `workingDirectory` computed earlier via getEffectiveWorkspacePath() (critical safety).

    // For providers that don't support `--mcp-config`, we still want them to see the same MCP tools.
    // Build the workspace MCP servers here and then translate to the provider's config mechanism.
    if (!workspaceMcpServers && this.config.workspaceId && this.config.workspacePath) {
      try {
        const mcpServerPath = getMcpServerPath();
        const httpMcpPort = process.env.HTTP_MCP_PORT || '5179';

        // Use Electron's embedded Node.js (ELECTRON_RUN_AS_NODE=1) for portability.
        let nodeCommand = process.execPath;
        const useElectronAsNode = true;

        if (nodeCommand.includes(' ') && app.isPackaged) {
          const safeDir = path.join(os.homedir(), '.augment', 'electron-node');
          let safePath = path.join(safeDir, 'node');
          try {
            if (!fs.existsSync(safeDir)) {
              fs.mkdirSync(safeDir, { recursive: true });
            }

            if (process.platform === 'win32') {
              // On Windows, fs.symlinkSync() requires Developer Mode or admin privileges,
              // so use a .cmd wrapper script instead.
              safePath = path.join(safeDir, 'node.cmd');
              const cmdContent = `@"${nodeCommand}" %*\r\n`;
              let needsUpdate = true;
              try {
                const existing = fs.readFileSync(safePath, 'utf-8');
                if (existing === cmdContent) {
                  needsUpdate = false;
                }
              } catch {
                // File doesn't exist yet
              }
              if (needsUpdate) {
                fs.writeFileSync(safePath, cmdContent);
              }
            } else {
              // Use lstatSync instead of existsSync — see comment in auggie provider path for details.
              let needsUpdate = true;
              let pathExists = false;
              try {
                fs.lstatSync(safePath);
                pathExists = true;
              } catch {
                // File doesn't exist at all
              }
              if (pathExists) {
                try {
                  const currentTarget = fs.readlinkSync(safePath);
                  if (currentTarget === nodeCommand) {
                    needsUpdate = false;
                  } else {
                    fs.unlinkSync(safePath);
                  }
                } catch {
                  fs.unlinkSync(safePath);
                }
              }
              if (needsUpdate) {
                fs.symlinkSync(nodeCommand, safePath);
              }
            }

            nodeCommand = safePath;
          } catch (error) {
            logger.warn('Failed to create symlink for Electron-as-Node for MCP server', {
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        const isRemote = this.isRemoteWorkspace();
        const effectiveWorkspacePath = isRemote
          ? this.config.environmentConfig?.workspace_path || this.config.workspacePath || ''
          : workingDirectory;

        const baseServers: Record<string, McpServerConfig> = {
          'workspace-mcp': {
            command: nodeCommand,
            args: [
              mcpServerPath,
              this.config.workspaceId || 'default',
              effectiveWorkspacePath,
              httpMcpPort,
            ],
            env: {
              ...(useElectronAsNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
              PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
              HTTP_MCP_HOST: '127.0.0.1',
              HTTP_MCP_PORT: httpMcpPort,
              WORKSPACE_ID: this.config.workspaceId,
              WORKSPACE_PATH: effectiveWorkspacePath,
              AGENT_ID: this.config.agentId || 'agent',
              AGENT_NAME: this.config.name || 'Agent',
              AGENT_SESSION_ID: this.sessionId || '',
              IS_REMOTE: isRemote ? 'true' : 'false',
              ENVIRONMENT_CONFIG: isRemote ? JSON.stringify(this.config.environmentConfig) : '',
              ELECTRON_STORE_CWD: process.env.ELECTRON_STORE_CWD || '',
            },
          },
        };

        let finalMcpServers: Record<string, McpServerConfig> = baseServers;
        // Skip user MCP servers for simple/background requests
        if (!this.config.simpleRequest) {
          try {
            const ElectronStore = (await import('electron-store')).default;
            const settingsStore = new ElectronStore({ name: 'settings' });
            const enableUserMcpServers = settingsStore.get('enableUserMcpServers', true);

            if (enableUserMcpServers) {
              const userServers = await readUserMcpServers();
              if (userServers) {
                const { getWorkspaceDisabledMcpServers, getGlobalDisabledMcpServers } =
                  await import('../../../mcp/main/user-mcp-settings');
                const workspaceDisabled = this.config.workspaceId
                  ? await getWorkspaceDisabledMcpServers(this.config.workspaceId)
                  : null;
                const disabledServers = workspaceDisabled ?? getGlobalDisabledMcpServers();
                const filteredUserServers = Object.fromEntries(
                  Object.entries(userServers).filter(([name]) => !disabledServers.includes(name)),
                );
                const { servers } = mergeUserMcpServers(baseServers, filteredUserServers);
                finalMcpServers = servers as Record<string, McpServerConfig>;
              }
            }
          } catch (userMcpError) {
            logger.warn('Failed to load user MCP servers for provider MCP translation', {
              error: userMcpError instanceof Error ? userMcpError.message : String(userMcpError),
            });
            // Surface the error to the user via IPC
            this.surfaceMcpLoadErrorToRenderer(userMcpError);
          }
        } // end of !simpleRequest block

        // Merge a safe parent-process environment baseline into stdio MCP
        // servers before translating to provider-specific config, so external
        // servers inherit expected shell variables. Explicit per-server env wins.
        finalMcpServers = applyBaselineEnvToStdioServers(finalMcpServers);

        workspaceMcpServers = finalMcpServers;
      } catch (error) {
        logger.warn('Failed to build workspace MCP servers for provider MCP translation', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (workspaceMcpServers && this.config.workspaceId && this.config.workspacePath) {
      const normalized = normalizeMcpServers(workspaceMcpServers);

      if (caps.id === 'opencode') {
        // Merge into OPENCODE_CONFIG_CONTENT so OpenCode ACP has the same MCP servers.
        const existing = safeJsonParse<Record<string, unknown>>(
          this.config.env?.OPENCODE_CONFIG_CONTENT,
        );
        const nextConfig: Record<string, unknown> = {
          $schema: 'https://opencode.ai/config.json',
          ...(existing || {}),
        };

        const existingMcp =
          existing &&
          typeof existing === 'object' &&
          (existing as any).mcp &&
          typeof (existing as any).mcp === 'object'
            ? ((existing as any).mcp as Record<string, unknown>)
            : {};

        nextConfig.mcp = {
          ...existingMcp,
          ...toOpenCodeMcpConfig(normalized),
        };

        this.config.env = {
          ...(this.config.env || {}),
          OPENCODE_CONFIG_CONTENT: JSON.stringify(nextConfig),
        };

        logger.info('Injected MCP servers into OPENCODE_CONFIG_CONTENT', {
          serverCount: Object.keys(normalized).length,
          serverNames: Object.keys(normalized),
        });
      }

      if (caps.id === 'claude-code' || caps.id === 'cortex' || caps.id === 'droid') {
        // Pass MCP servers via the ACP session/new mcpServers field.
        // Both claude-agent-acp and cortex-acp adapters process these from params.mcpServers.
        // cortex-acp writes them to ~/.snowflake/cortex/mcp.json before spawning cortex.
        // droid (verified live against v0.141.0): `droid exec --output-format acp` spawns the
        // stdio servers from params.mcpServers, sends MCP initialize/tools-list, and exposes
        // their tools to the agent as `<server>___<tool>` (loaded on demand via ToolSearch).
        this.acpMcpServersForSession = toAcpMcpServers(normalized);
        logger.info('Prepared ACP MCP servers for session', {
          providerId: caps.id,
          serverCount: this.acpMcpServersForSession.length,
          serverNames: this.acpMcpServersForSession.map((s) => s.name),
        });
      }

      if (caps.id === 'pi' && !this.isRemoteWorkspace()) {
        const configDir = path.join(workingDirectory, '.pi');
        const configFile = path.join(configDir, 'mcp.json');
        const piMcpServers = toPiMcpJson(normalized).mcpServers;

        fs.mkdirSync(configDir, { recursive: true });

        const config = readPiMcpConfig(configFile);

        const existingMcpServers =
          config.mcpServers &&
          typeof config.mcpServers === 'object' &&
          !Array.isArray(config.mcpServers)
            ? (config.mcpServers as Record<string, unknown>)
            : {};

        config.mcpServers = {
          ...existingMcpServers,
          ...piMcpServers,
        };

        await writeJsonWithSync(configFile, config, { spaces: 2 });

        logger.info('Injected MCP servers into workspace Pi config', {
          configFile,
          serverCount: Object.keys(piMcpServers).length,
          serverNames: Object.keys(piMcpServers),
        });
      }

      if (caps.id === 'codex') {
        // Add Codex `-c` overrides for MCP servers (parsed as TOML).
        const overrides = toCodexMcpOverrides(normalized);
        for (const { key, tomlValue } of overrides) {
          // Remove any earlier overrides for the same key so we don't grow args unbounded across restarts.
          for (let i = 0; i < args.length; i += 1) {
            const a = args[i];
            if ((a === '-c' || a === '--config') && i + 1 < args.length) {
              const v = args[i + 1];
              if (typeof v === 'string' && v.trim().startsWith(`${key}=`)) {
                args.splice(i, 2);
                i -= 1;
              }
            }
          }
          args.push('-c', `${key}=${tomlValue}`);
        }

        logger.info('Added Codex MCP overrides', {
          overrideCount: overrides.length,
          serverCount: Object.keys(normalized).length,
        });
      }
    }

    // Codex: bypass approval prompts and sandbox restrictions so the agent
    // doesn't stall on "Read file?" / "Run command?" permission dialogs.
    // Values are TOML-quoted to match the convention used by upsertCodexConfigArgs.
    if (caps.id === 'codex') {
      args.push('-c', 'approval_policy="never"');
      args.push('-c', 'sandbox_mode="danger-full-access"');
      logger.info('Added Codex approval/sandbox overrides to bypass permission prompts');
    }

    // Log comprehensive agent startup configuration for debugging
    logger.info('Agent configuration', {
      providerId: caps.id,
      providerDisplayName: caps.displayName,
      command: this.config.command,
      args: args.join(' '),
      workingDirectory,
      rulesFilePath: rulesFilePath || '(none)',
      mcpConfigPath: mcpConfigPath || '(none)',
      workspaceId: this.config.workspaceId,
      agentId: this.config.agentId,
      sessionId: this.sessionId,
      model: this.config.model || 'default',
      systemPromptLength: this.config.systemPrompt?.length || 0,
      hasSystemPrompt: !!this.config.systemPrompt,
    });

    // Log the environment being passed to the agent (for debugging)
    const configEnv = {
      ...(this.config.env || {}),
    };
    logger.info('Agent environment variables', {
      providerId: caps.id,
      hasConfigEnv: Object.keys(configEnv).length > 0,
      configEnvKeys: Object.keys(configEnv),
    });

    // Isolate npm cache per agent to prevent ENOTEMPTY race condition.
    // When multiple providers (e.g., codex + claude-code) run concurrently via npx,
    // they share ~/.npm/_npx/ and corrupt each other's cache during npm reify.
    // Giving each agent its own NPM_CONFIG_CACHE eliminates the shared-cache collision.
    const isExternalNpx = caps.id !== 'auggie' && this.config.command?.includes('npx');
    let agentNpmCachePath: string | undefined;
    if (isExternalNpx) {
      const agentHash = this.config.agentId?.replace(/[^a-zA-Z0-9-]/g, '') || crypto.randomUUID();
      agentNpmCachePath = path.join(os.tmpdir(), 'intent-npm-cache', agentHash);
      fs.mkdirSync(agentNpmCachePath, { recursive: true });
    }

    // Resolve the full auggie path for the auggie provider.
    // The provider config uses bare 'auggie' command, but Electron's PATH
    // doesn't include ~/.augment/bin/ where the managed binary lives.
    let spawnCommand = this.config.command;
    if (caps.id === 'auggie') {
      const resolvedPath = await findAuggiePathAsync();
      if (resolvedPath) {
        logger.info('Resolved auggie path for spawn', { resolvedPath });
        spawnCommand = resolvedPath;
      } else {
        logger.warn('Could not resolve auggie path, falling back to bare command', {
          command: this.config.command,
        });
      }
    }

    // On Windows with shell: true, quote the command path to handle spaces
    // (e.g. "C:\Program Files\nodejs\npx.cmd"). Without quotes, cmd.exe splits
    // the path at the space and fails to find the executable.
    if (process.platform === 'win32') {
      spawnCommand = `"${spawnCommand}"`;
    }

    // Spawn the agent process using safe spawn with fallback options
    const spawnOptions: SpawnOptions = {
      cwd: workingDirectory,
      env: {
        ...process.env,
        ...configEnv,
        // Force unbuffered output
        NODE_NO_READLINE: '1',
        PYTHONUNBUFFERED: '1',
        // Isolate npm cache per agent to prevent cross-provider ENOTEMPTY errors
        ...(agentNpmCachePath ? { NPM_CONFIG_CACHE: agentNpmCachePath } : {}),
      },
      // stdio will be set by safeSpawn
      detached: false,
      shell: process.platform === 'win32',
      windowsHide: true,
    };

    // Spawn the agent process with robust error handling for Electron
    // External providers (OpenCode, Claude Code, Codex) MUST use piped stdio because they
    // communicate via ACP protocol over stdin/stdout. The safeSpawn fallback to [0,1,2]
    // (parent's file descriptors) doesn't work because Electron may not have stdin attached,
    // causing external providers to see EOF on stdin and exit immediately.
    const isExternalProvider = caps.id !== 'auggie';

    logger.info('About to spawn agent process', {
      isExternalProvider,
      providerId: caps.id,
      command: spawnCommand,
      argsCount: args.length,
      cwd: spawnOptions.cwd,
    });

    try {
      if (isExternalProvider) {
        // External providers REQUIRE piped stdio for ACP communication
        // DO NOT fall back to other stdio configs as they won't work
        const externalSpawnOpts: SpawnOptions = {
          ...spawnOptions,
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        };
        logger.info('Spawning external provider with piped stdio', {
          providerId: caps.id,
          command: spawnCommand,
          args: args.join(' '),
        });
        this.agentProcess = spawn(spawnCommand, args, externalSpawnOpts);

        if (!this.agentProcess || !this.agentProcess.pid) {
          throw new Error(
            `Failed to spawn external provider ${caps.id} - the command "${spawnCommand}" may not be installed or accessible`,
          );
        }

        // Verify we have the required stdio streams
        if (!this.agentProcess.stdin || !this.agentProcess.stdout) {
          throw new Error(
            `External provider ${caps.id} spawned without required stdio streams - stdin: ${!!this.agentProcess.stdin}, stdout: ${!!this.agentProcess.stdout}`,
          );
        }
      } else {
        // Use safeSpawn for auggie - it can handle various stdio configs
        this.agentProcess = this.safeSpawn(spawnCommand, args, spawnOptions);

        // Verify process spawned successfully
        if (!this.agentProcess || !this.agentProcess.pid) {
          throw new Error('Failed to spawn agent process - no PID assigned');
        }
      }

      // Clear stale exit info from a previous process so it doesn't leak into future errors
      this.lastProcessExitInfo = undefined;

      logger.info('Agent process spawned successfully', {
        pid: this.agentProcess.pid,
        command: this.config.command,
        args,
        hasStdin: !!this.agentProcess.stdin,
        hasStdout: !!this.agentProcess.stdout,
        hasStderr: !!this.agentProcess.stderr,
        stdinWritable: this.agentProcess.stdin?.writable,
        stdoutReadable: this.agentProcess.stdout?.readable,
      });

      logger.info('Process started', {
        agentId: this.config.agentId,
        pid: this.agentProcess.pid,
        sessionId: this.sessionId,
      });
    } catch (spawnError) {
      const err = spawnError as Error;
      logger.error('Failed to spawn agent process after all attempts', {
        error: err.message,
        command: this.config.command,
        args,
        cwd: this.config.workspacePath,
        isElectron: process.versions?.electron,
      });

      throw new Error(`Failed to spawn agent process: ${err.message}`);
    }

    // Set up process cleanup handlers
    this.setupProcessCleanup();

    // Register in the global process registry for cap enforcement
    if (this.agentProcess?.pid) {
      registerProcess({
        pid: this.agentProcess.pid,
        agentId: this.config.agentId,
        workspaceId: this.config.workspaceId || '',
        lastActiveTimestamp: Date.now(),
        isActive: false,
        kill: () => this.stopAgentProcess(),
        hasPendingWork: () => {
          // Check pending requests first (cheap)
          if (this.pendingRequests.size > 0) {
            return true;
          }
          // Check if agent has active subscriptions (coordinator waiting for sub-agents)
          // This prevents eviction of coordinators that are idle but waiting for delegated work
          if (this.config.workspaceId) {
            try {
              const state = getMainState();
              const subs = selectAgentSubscriptions.select(state, this.config.workspaceId, this.config.agentId);
              if (subs.length > 0) {
                return true;
              }
            } catch (err) {
              logger.warn('Failed to check agent subscriptions for hasPendingWork', {
                agentId: this.config.agentId,
                workspaceId: this.config.workspaceId,
                error: err instanceof Error ? err.message : String(err),
              });
              // Return true on failure - false positive is harmless, false negative kills coordinator
              return true;
            }
          }
          return false;
        },
      });
    }

    // Start idle timer — if no streaming/requests happen within the timeout,
    // the process will be killed to reclaim memory
    this.resetIdleTimer();

    // Clean up old log files (keep last 5)
    this.cleanupOldLogs();

    // Log process information
    logger.info('Auggie process spawned', {
      pid: this.agentProcess.pid,
      command: this.config.command,
      args,
    });

    logger.info('Agent process spawned, checking streams', {
      pid: this.agentProcess.pid,
      hasStdin: !!this.agentProcess.stdin,
      hasStdout: !!this.agentProcess.stdout,
      hasStderr: !!this.agentProcess.stderr,
      stdoutReadable: this.agentProcess.stdout?.readable,
      stdinWritable: this.agentProcess.stdin?.writable,
    });

    // Check if process is still alive after spawn
    // Enhanced logging to help debug "process died immediately after spawn" issues
    setTimeout(() => {
      if (this.agentProcess?.killed || this.agentProcess?.exitCode !== null) {
        logger.error('Agent process died immediately after spawn', {
          killed: this.agentProcess?.killed,
          exitCode: this.agentProcess?.exitCode,
          signalCode: this.agentProcess?.signalCode,
          pid: this.agentProcess?.pid,
          agentId: this.config.agentId,
          workspaceId: this.config.workspaceId,
          command: this.config.command,
          isRestarting: this.isRestartingProcess,
          isStoppingIntentionally: this.isStoppingIntentionally,
          sessionWasRecreated: this.sessionWasRecreated,
          hasSessionId: !!this.sessionId,
          hasSessionParams: !!this.sessionCreationParams,
        });
      } else {
        logger.info('Agent process still alive after 100ms', {
          pid: this.agentProcess?.pid,
          agentId: this.config.agentId,
        });
      }
    }, 100);

    // Add periodic health check for debugging and stream recovery
    const healthCheckInterval = setInterval(() => {
      if (!this.agentProcess) {
        // If we're intentionally stopping (e.g., for model fallback), don't complete streams
        if (this.isStoppingIntentionally) {
          logger.info(
            'Health check: Process null but isStoppingIntentionally=true - not completing streams (model fallback in progress)',
          );
          clearInterval(healthCheckInterval);
          return;
        }
        logger.warn('Health check: Agent process is null');
        // If we have active streams, complete them with whatever content we have
        if (this.streamingCallbacks.size > 0) {
          logger.error('Health check: Process null but streams active - forcing completion', {
            activeStreams: this.streamingCallbacks.size,
          });
          this.streamingCallbacks.forEach((_, sessionId) => {
            this.handleStreamCompletion(sessionId, 'process_null');
          });
        }
        clearInterval(healthCheckInterval);
      } else if (this.agentProcess.killed || this.agentProcess.exitCode !== null) {
        // If we're intentionally stopping (e.g., for model fallback), don't complete streams
        if (this.isStoppingIntentionally) {
          logger.info(
            'Health check: Process died but isStoppingIntentionally=true - not completing streams (model fallback in progress)',
          );
          clearInterval(healthCheckInterval);
          return;
        }
        logger.error('Health check: Agent process died', {
          killed: this.agentProcess.killed,
          exitCode: this.agentProcess.exitCode,
          pid: this.agentProcess.pid,
          activeStreams: this.streamingCallbacks.size,
        });
        // If we have active streams, complete them with whatever content we have
        if (this.streamingCallbacks.size > 0) {
          logger.error('Health check: Process died but streams active - forcing completion', {
            activeStreams: this.streamingCallbacks.size,
          });
          this.streamingCallbacks.forEach((_, sessionId) => {
            this.handleStreamCompletion(sessionId, 'process_died');
          });
        }
        clearInterval(healthCheckInterval);
      } else {
        logger.debug('Health check: Agent process alive', {
          pid: this.agentProcess.pid,
          activeStreams: this.streamingCallbacks.size,
        });
      }
    }, 5000); // Check every 5 seconds

    // Store interval for cleanup
    this.healthCheckInterval = healthCheckInterval;

    // Handle stdout (agent responses) - only if available
    if (this.agentProcess.stdout) {
      this.agentProcess.stdout.on('data', (data) => {
        const rawData = data.toString();
        logger.debug('Raw stdout from auggie', {
          length: rawData.length,
          preview: rawData.substring(0, 200), // Show first 200 chars
        });

        // Use the stream parser to properly handle partial JSON-RPC messages
        const messages = this.streamParser.parseChunk(rawData);

        logger.debug('Parsed messages from stdout', {
          count: messages.length,
          messageTypes: messages.map((m) => ({
            method: m.method,
            hasParams: !!m.params,
            paramsType: m.params?.update?.sessionUpdate || m.params?.sessionUpdate?.sessionUpdate,
          })),
        });

        for (const message of messages) {
          // Use queue to ensure sequential processing - especially for permission requests
          this.enqueueMessage(message);
        }
      });
    } else {
      logger.warn('Agent stdout not available - using inherit stdio mode');
    }

    // Handle stderr (agent logs) - only if available
    if (this.agentProcess.stderr) {
      this.agentProcess.stderr.on('data', (data) => {
        const stderr = data.toString().trim();
        if (!stderr) return;

        // Write stderr to workspace log file
        this.writeStderrToLog(stderr);

        // Check for specific error patterns and log at appropriate level
        if (stderr.includes('error') || stderr.includes('Error') || stderr.includes('ERROR')) {
          logger.error('Agent stderr error', { stderr });

          // Buffer recent stderr errors so we can include them in user-facing error messages
          // when streams fail with no content (e.g., "Unable to connect. Failed to fetch models.dev")
          this.bufferRecentStderrError(stderr);

          // Detect MCP server startup errors and forward to renderer UI
          // Auggie prints these with ANSI color codes:
          //   ⚠️ MCP server startup error: <message>
          //      Command: <command or url>
          if (stderr.includes('MCP server startup error')) {
            try {
              // Strip ANSI escape codes
              const clean = stderr.replace(/\x1b\[[0-9;]*m/g, '').trim();
              const errorMatch = clean.match(/MCP server startup error:\s*(.+)/);
              const commandMatch = clean.match(/Command:\s*(.+)/);

              if (errorMatch) {
                const errorMessage = errorMatch[1].trim();
                const command = commandMatch?.[1]?.trim() || '';

                // Look up server name from the command/URL
                let serverName = '';
                if (command) {
                  serverName = this.mcpServerCommandMap.get(command) || '';
                  // If no exact match, try partial match (command may include extra whitespace)
                  if (!serverName) {
                    for (const [key, name] of this.mcpServerCommandMap.entries()) {
                      if (command.includes(key) || key.includes(command)) {
                        serverName = name;
                        break;
                      }
                    }
                  }
                }

                logger.warn('MCP server startup error detected', {
                  serverName: serverName || '(unknown)',
                  command,
                  errorMessage,
                });

                this.emitStatus(
                  'mcp-error',
                  `MCP server '${serverName || '(unknown)'}' failed: ${errorMessage}`,
                  'warn',
                );

                // Broadcast to all renderer windows
                BrowserWindow.getAllWindows().forEach((window) => {
                  if (!window.isDestroyed()) {
                    window.webContents.send('mcp:server-error', {
                      serverName,
                      command,
                      errorMessage,
                    });
                  }
                });
              }
            } catch (parseError) {
              logger.debug('Failed to parse MCP startup error from stderr', {
                parseError: (parseError as Error).message,
              });
            }
          }

          // CRITICAL: Detect agent parse errors on stdin (corrupted JSON-RPC message).
          // This happens when the agent process receives a truncated/interleaved NDJSON
          // message (e.g., due to pipe write non-atomicity for messages >PIPE_BUF).
          // The agent silently drops the message, leaving us stuck waiting forever.
          // When detected, reject the current pending prompt request so the stream
          // surfaces an error instead of hanging indefinitely.
          if (
            stderr.includes('failed to parse incoming message') ||
            stderr.includes('expected value at line 1 column 1')
          ) {
            logger.error('Agent failed to parse stdin message - rejecting pending prompt', {
              sessionId: this.sessionId,
              currentStreamingRequestId: this.currentStreamingRequestId,
              pendingRequestCount: this.pendingRequests.size,
            });

            // Reject the most recent pending request (the prompt that was corrupted)
            if (this.currentStreamingRequestId !== null) {
              const pending = this.pendingRequests.get(this.currentStreamingRequestId);
              if (pending) {
                clearTimeout(pending.timeout);
                this.pendingRequests.delete(this.currentStreamingRequestId);
                pending.reject(
                  new Error(
                    'Agent failed to parse the prompt message. This is usually transient — please retry.',
                  ),
                );
              }
            }

            // Also notify streaming callbacks so the UI shows an error
            const completionSessionId = this.frontendSessionId || this.sessionId;
            if (completionSessionId) {
              const callbacks = this.streamingCallbacks.get(completionSessionId);
              if (callbacks?.onError) {
                callbacks.onError(
                  new Error(
                    'Agent encountered a message parsing error. Please retry your message.',
                  ),
                );
              }
            }
          }

          // CRITICAL: Detect OpenCode's "agent.name undefined" error
          // This happens when OpenCode's session loses its agent association.
          // The session exists but has no agent context, so prompts fail.
          // When detected, mark session for recreation and notify callbacks.
          // NOTE: Be SPECIFIC with patterns - don't match normal logs like "agent.name=build"
          if (
            stderr.includes("undefined is not an object (evaluating 'agent.name')") ||
            stderr.includes("Cannot read property 'name' of undefined") ||
            stderr.includes('agent.name undefined')
          ) {
            logger.error(
              'OpenCode session lost agent association - marking session for recreation',
              {
                sessionId: this.sessionId,
                frontendSessionId: this.frontendSessionId,
              },
            );

            // DON'T notify frontend about this error - it's recoverable
            // The session will be recreated automatically on the next message
            // Showing an error creates confusing UX where user sees error then it "magically" works
            logger.info('Session will be recreated on next message - not showing error to user', {
              sessionId: this.sessionId,
              frontendSessionId: this.frontendSessionId,
            });

            // CRITICAL: Also clear streaming handler state to prevent OLD responses from being processed
            // This fixes the double-streaming issue where the old request's response still arrives
            // after we've cleaned up, gets processed, and then the retry also processes
            const agentId = this.config.id || this.config.agentId;
            if (agentId) {
              // Clear the message accumulator to prevent old content from mixing with new
              try {
                messageAccumulator.clear(agentId);
              } catch {
                // Ignore - accumulator might not exist
              }

              // Dispose the streaming handler so it won't process any more updates
              if (this.streamingHandler) {
                this.streamingHandler.dispose();
                this.streamingHandler = undefined;
              }
            }

            // Clean up streaming callback WITHOUT sending error
            const callbackSessionId = this.frontendSessionId || this.sessionId;
            if (callbackSessionId) {
              this.cleanupStreamingCallback(callbackSessionId);
            }

            // Clear the corrupted session so next message creates a fresh one
            this.sessionId = undefined;
            this.sessionWasRecreated = true;

            // AUTO-RETRY: If we have a pending message, retry it automatically
            // This provides seamless UX - the user doesn't need to resend their message
            if (this.pendingRetry && !this.retryInProgress) {
              this.retryInProgress = true;
              const { messages, options, resolveStream, rejectStream } = this.pendingRetry;
              this.pendingRetry = undefined;

              logger.info('Auto-retrying message after session recreation', {
                messageCount: messages.length,
                hasOptions: !!options,
              });

              // Short delay to ensure session is fully cleaned up
              setTimeout(async () => {
                try {
                  // IMPORTANT: Clear retryInProgress BEFORE calling streamMessage
                  // so the retry's onComplete callback executes normally.
                  // The original callbacks are already cleaned up (above), so there's no risk
                  // of the original's onComplete firing.
                  this.retryInProgress = false;

                  // Recursively call streamMessage with the same parameters
                  await this.streamMessage(messages, options);
                  resolveStream?.();
                } catch (retryError: any) {
                  logger.error('Auto-retry failed', {
                    error: retryError.message,
                  });
                  this.retryInProgress = false;
                  rejectStream?.(retryError);
                }
              }, 100);
            }
          }
        } else {
          logger.debug('Agent stderr output', { stderr });
        }
      });
    }

    // Monitor connection health
    this.monitorConnectionHealth();

    // Note: Exit and error handlers are set up in setupProcessCleanup() which is called earlier
  }

  /**
   * Launch agent on remote server via SSH using the intent-server daemon.
   * The intent-server manages auggie's lifecycle on the remote host:
   * 1. Deploy intent-server.cjs to ~/.intent-server/server.js
   * 2. Discover auggie's absolute path via login shell
   * 3. Start auggie as a daemon (if not already running)
   * 4. Connect via relay process that proxies ACP JSON-RPC over stdin/stdout
   */
  private async launchRemoteAgent(): Promise<void> {
    const sshConfig = this.config.environmentConfig?.ssh;
    const remotePath = this.config.environmentConfig?.workspace_path;

    if (!sshConfig) {
      throw new Error('SSH configuration required for remote workspace');
    }

    if (!remotePath) {
      throw new Error('Remote workspace path required for remote workspace');
    }

    logger.info('Launching remote agent process via intent-server', {
      command: this.config.command,
      host: sshConfig.host,
      remotePath,
      workspaceId: this.config.workspaceId,
    });

    // Create unique connection ID for this agent
    this.sshConnectionId = `agent-${this.config.agentId || 'default'}-${Date.now()}`;
    const sshConnectionId = this.sshConnectionId;

    try {
      // Step 1: Connect to remote server
      await sshManager.connect(sshConnectionId, {
        host: sshConfig.host,
        port: sshConfig.port || 22,
        username: sshConfig.user,
        password: sshConfig.password,
        privateKeyPath: sshConfig.key_path,
        useAgent: sshConfig.use_agent,
        transport: sshConfig.transport,
        wsUrl: sshConfig.ws_url,
      });

      logger.info('SSH connection established for remote agent', {
        connectionId: this.sshConnectionId,
        host: sshConfig.host,
      });

      // Resolve ~ in remotePath to absolute path (escapeShellArg prevents tilde expansion)
      let resolvedRemotePath = remotePath;
      if (remotePath.startsWith('~')) {
        const homeResult = await sshManager.executeCommand(sshConnectionId, 'echo $HOME', {
          timeout: 5000,
          rawCommand: true,
        });
        const homeDir = homeResult.stdout.trim();
        if (homeDir) {
          resolvedRemotePath = remotePath.replace(/^~/, homeDir);
        }
      }

      // Step 2: Deploy intent-server to remote host
      const localBundlePath = getIntentServerPath();
      const deployed = await sshManager.deployIntentServer(this.sshConnectionId, localBundlePath);
      logger.info('Intent server deployment result', {
        deployed,
        localBundlePath,
      });

      // Step 3: Discover auggie's absolute path on the remote host
      const auggiePath = await sshManager.discoverAuggiePath(this.sshConnectionId);
      logger.info('Discovered auggie path on remote', { auggiePath });

      // Step 4: Set up reverse port forwarding for MCP access
      // This allows the remote agent to connect to localhost:REMOTE_MCP_PORT
      // and have it forwarded back to the local HTTP MCP bridge
      const localMcpPort = parseInt(process.env.HTTP_MCP_PORT || '5179', 10);
      // Use a high port on the remote to avoid conflicts (add agent hash for uniqueness)
      const remoteMcpPort = 19000 + ((this.config.agentId?.charCodeAt(0) || 0) % 1000);

      try {
        this.remotePortForwarding = await sshManager.forwardRemotePort(this.sshConnectionId, {
          remotePort: remoteMcpPort,
          localHost: 'localhost',
          localPort: localMcpPort,
        });

        logger.info('SSH reverse port forwarding established for MCP', {
          remoteMcpPort,
          localMcpPort,
        });
      } catch (portForwardError) {
        // Port forwarding is optional - agent can still work without MCP tools
        logger.warn(
          'Failed to set up SSH port forwarding for MCP - agent will not have workspace tools',
          {
            error: (portForwardError as Error).message,
          },
        );
      }

      // Step 5: Build auggie args (provider-specific)
      const args = [...(this.config.args || [])];
      const caps = this.providerCapabilities;

      // For auggie, ensure allow-indexing is present to avoid extra permission prompts
      if (caps.id === 'auggie' && !args.includes('--allow-indexing')) {
        args.push('--allow-indexing');
      }

      // Add model flag if specified and supported (critical for remote agents to use correct model)
      if (this.config.model) {
        const { modelId: rawModelId } = parseCompoundModelId(this.config.model);
        if (caps.id === 'auggie' && !args.includes('--model')) {
          args.push('--model', rawModelId);
        }
        logger.info('Setting remote agent model', {
          providerId: caps.id,
          model: this.config.model,
        });
      }

      // Step 6: Create MCP config if port forwarding was successful
      let remoteMcpConfigPath: string | undefined;
      if (this.remotePortForwarding && caps.supportsMcpConfig && caps.mcpConfigFlag) {
        // Create MCP config that points to the forwarded port on localhost (remote side)
        const mcpConfig = {
          mcpServers: {
            'workspace-mcp': {
              // Use HTTP transport pointing to the forwarded port
              url: `http://localhost:${remoteMcpPort}/mcp/${this.config.workspaceId}`,
            },
          },
        };

        // Write MCP config to a temp file on the remote server
        const remoteTmpDir = `${resolvedRemotePath}/.augment/tmp`;
        remoteMcpConfigPath = `${remoteTmpDir}/mcp-config-${Date.now()}.json`;

        // Create tmp directory and write config on remote
        await sshManager.executeCommand(
          sshConnectionId,
          `mkdir -p ${escapeShellArg(remoteTmpDir)}`,
          {
            timeout: 10000,
          },
        );
        await sshManager.executeCommand(
          sshConnectionId,
          `cat > ${escapeShellArg(remoteMcpConfigPath)} << 'EOF'\n${JSON.stringify(mcpConfig, null, 2)}\nEOF`,
          { timeout: 10000 },
        );

        logger.info('Remote MCP config created', {
          configPath: remoteMcpConfigPath,
          remoteMcpPort,
        });

        // Add MCP config flag
        args.push(caps.mcpConfigFlag, remoteMcpConfigPath);
      }

      // Step 7: Check if auggie is already running for this workspace
      const workspaceId = this.config.workspaceId || 'default';
      let isAlreadyRunning = false;

      try {
        const statusResult = await sshManager.executeCommand(
          sshConnectionId,
          `node ~/.intent-server/server.js status --workspace ${escapeShellArg(workspaceId)}`,
          { timeout: 10000 },
        );

        if (statusResult.exitCode === 0) {
          try {
            const status = JSON.parse(statusResult.stdout.trim());
            isAlreadyRunning = status.running === true;
            logger.info('Intent server status check', {
              workspaceId,
              running: isAlreadyRunning,
              pid: status.pid,
            });
          } catch {
            logger.debug('Could not parse status output', {
              stdout: statusResult.stdout,
            });
          }
        }
      } catch (statusError) {
        logger.debug('Status check failed (daemon likely not running)', {
          error: (statusError as Error).message,
        });
      }

      // Step 8: Start auggie via intent-server if not already running
      if (!isAlreadyRunning) {
        const startArgs = [
          'node',
          '~/.intent-server/server.js',
          'start',
          '--workspace',
          escapeShellArg(workspaceId),
          '--command',
          escapeShellArg(auggiePath),
          '--args',
          escapeShellArg(JSON.stringify(args)),
          '--cwd',
          escapeShellArg(resolvedRemotePath),
        ];

        const startCommand = startArgs.join(' ');

        logger.info('Starting auggie via intent-server', {
          workspaceId,
          auggiePath,
          args,
          startCommand,
        });

        const startResult = await sshManager.executeCommand(sshConnectionId, startCommand, {
          timeout: 30000,
        });

        if (startResult.exitCode !== 0) {
          throw new Error(
            `Failed to start auggie via intent-server: ${startResult.stderr || startResult.stdout}`,
          );
        }

        // Parse the start response to confirm auggie is running
        try {
          const startResponse = JSON.parse(startResult.stdout.trim());
          logger.info('Auggie started via intent-server', {
            pid: startResponse.pid,
            daemonPid: startResponse.daemonPid,
            socketPath: startResponse.socketPath,
          });
        } catch {
          logger.warn('Could not parse start response, but command succeeded', {
            stdout: startResult.stdout,
          });
        }
      } else {
        logger.info('Auggie already running for workspace, skipping start', {
          workspaceId,
        });
      }

      // Step 9: Connect to auggie — prefer StreamLocal (direct socket), fall back to relay process
      const relayCommand = `node ~/.intent-server/server.js relay --workspace ${escapeShellArg(workspaceId)}`;

      // Resolve $HOME for the socket path (connectToRemoteSocket needs an absolute path)
      let remoteHomeDir: string | undefined;
      try {
        const homeResult = await sshManager.executeCommand(sshConnectionId, 'echo $HOME', {
          timeout: 5000,
          rawCommand: true,
        });
        remoteHomeDir = homeResult.stdout.trim();
      } catch {
        logger.warn('Could not resolve remote $HOME for socket path');
      }

      const socketPath = remoteHomeDir
        ? `${remoteHomeDir}/.intent-server/workspaces/${workspaceId}/acp.sock`
        : undefined;

      // Handler for incoming data (shared between StreamLocal and relay)
      const handleRemoteData = (data: string) => {
        logger.info('Raw data from remote auggie', {
          data,
          length: data.length,
          preview: data.substring(0, 200),
        });

        const messages = this.streamParser.parseChunk(data);

        logger.info('Parsed messages from remote data', {
          count: messages.length,
          messages: messages.map((m) => ({
            method: m.method,
            id: m.id,
            hasResult: !!m.result,
            hasError: !!m.error,
            hasParams: !!m.params,
          })),
        });

        for (const message of messages) {
          this.enqueueMessage(message);
        }
      };

      // Handler for connection close / process exit (shared between StreamLocal and relay)
      const handleRemoteClose = (code: number | null) => {
        logger.info('Remote connection closed', {
          code,
          agentId: this.config.agentId,
          isStoppingIntentionally: this.isStoppingIntentionally,
          isReconnecting: this.isReconnecting,
        });

        // Clean up port forwarding
        if (this.remotePortForwarding) {
          try {
            this.remotePortForwarding.close();
          } catch (err) {
            logger.warn('Failed to close port forwarding (client likely disconnected)', {
              error: err instanceof Error ? err.message : String(err),
            });
          }
          this.remotePortForwarding = undefined;
        }

        // Check if SSH connection is down — if so, this is a disconnect, not a crash.
        // Auggie is still running on the remote via intent-server daemon.
        // Enter reconnection flow instead of cleaning up and restarting from scratch.
        if (
          !this.isStoppingIntentionally &&
          !this.isReconnecting &&
          this.sshConnectionId &&
          !sshManager.isConnected(this.sshConnectionId)
        ) {
          logger.info(
            'SSH connection lost — entering reconnection flow (auggie still running on remote)',
            {
              connectionId: this.sshConnectionId,
              workspaceId: this.config.workspaceId,
            },
          );

          this.isReconnecting = true;
          this.reconnectRemoteAgent()
            .then(() => {
              this.isReconnecting = false;
              logger.info('SSH reconnection successful — agent session resumed');
            })
            .catch((err) => {
              logger.error('SSH reconnection failed — falling through to full restart', {
                error: (err as Error).message,
              });
              this.isReconnecting = false;

              // Clean up SSH connection before falling through
              if (this.sshConnectionId) {
                sshManager.disconnect(this.sshConnectionId).catch(() => {});
              }

              // Fall through to normal restart logic via handleProcessExit
              this.handleProcessExit(code ?? 1, null);
            });
          return; // Don't clean up SSH — reconnection will re-use/recreate it
        }

        // Clean up remote MCP config file
        if (remoteMcpConfigPath && this.sshConnectionId) {
          sshManager
            .executeCommand(this.sshConnectionId, `rm -f "${remoteMcpConfigPath}"`, {
              timeout: 5000,
            })
            .catch(() => {});
        }

        // Clean up SSH connection
        if (this.sshConnectionId) {
          sshManager.disconnect(this.sshConnectionId).catch((err) => {
            logger.warn('Failed to disconnect SSH after agent exit', { error: err });
          });
        }

        if (!this.isStoppingIntentionally) {
          logger.error('Remote connection closed unexpectedly', { code });
          // Trigger normal restart logic for non-SSH-related exits
          this.handleProcessExit(code ?? 1, null);
        }
      };

      // Step 10: Try StreamLocal first, fall back to relay process
      let useStreamLocal = false;

      if (socketPath) {
        try {
          logger.info('Attempting StreamLocal connection to auggie socket', {
            workspaceId,
            socketPath,
          });

          this.remoteProcess = await sshManager.connectToRemoteSocket(
            this.sshConnectionId,
            socketPath,
            {
              onData: handleRemoteData,
              onClose: () => handleRemoteClose(null),
              onError: (error: Error) => {
                logger.error('Remote StreamLocal socket error', { error: error.message });
                this.emit('error', error);
              },
            },
          );

          useStreamLocal = true;
          logger.info('StreamLocal connection established to auggie socket', {
            workspaceId,
            socketPath,
          });
        } catch (streamLocalError) {
          logger.warn('StreamLocal connection failed, falling back to relay process', {
            error: (streamLocalError as Error).message,
            socketPath,
            workspaceId,
          });
        }
      }

      if (!useStreamLocal) {
        logger.info('Connecting to auggie via intent-server relay', {
          workspaceId,
          relayCommand,
        });

        this.remoteProcess = await sshManager.spawnRemoteProcess(
          this.sshConnectionId,
          relayCommand,
          {
            onStdout: handleRemoteData,
            onStderr: (data: string) => {
              const stderr = data.trim();
              if (!stderr) return;

              // Write stderr to workspace log file
              this.writeStderrToLog(stderr);

              if (
                stderr.includes('error') ||
                stderr.includes('Error') ||
                stderr.includes('ERROR')
              ) {
                logger.error('Remote agent stderr error', { stderr });
                this.bufferRecentStderrError(stderr);

                // CRITICAL: Detect OpenCode's "agent.name undefined" error
                if (
                  stderr.includes("undefined is not an object (evaluating 'agent.name')") ||
                  stderr.includes("Cannot read property 'name' of undefined") ||
                  stderr.includes('agent.name undefined')
                ) {
                  logger.error(
                    'Remote OpenCode session lost agent association - marking session for recreation',
                    {
                      sessionId: this.sessionId,
                      frontendSessionId: this.frontendSessionId,
                    },
                  );

                  logger.info(
                    'Remote session will be recreated on next message - not showing error to user',
                    {
                      sessionId: this.sessionId,
                      frontendSessionId: this.frontendSessionId,
                    },
                  );

                  const agentId = this.config.id || this.config.agentId;
                  if (agentId) {
                    try {
                      messageAccumulator.clear(agentId);
                    } catch {
                      // Ignore - accumulator might not exist
                    }

                    if (this.streamingHandler) {
                      this.streamingHandler.dispose();
                      this.streamingHandler = undefined;
                    }
                  }

                  const callbackSessionId = this.frontendSessionId || this.sessionId;
                  if (callbackSessionId) {
                    this.cleanupStreamingCallback(callbackSessionId);
                  }

                  this.sessionId = undefined;
                  this.sessionWasRecreated = true;

                  if (this.pendingRetry && !this.retryInProgress) {
                    this.retryInProgress = true;
                    const { messages, options, resolveStream, rejectStream } = this.pendingRetry;
                    this.pendingRetry = undefined;

                    logger.info('Auto-retrying message after remote session recreation', {
                      messageCount: messages.length,
                      hasOptions: !!options,
                    });

                    setTimeout(async () => {
                      try {
                        this.retryInProgress = false;
                        await this.streamMessage(messages, options);
                        resolveStream?.();
                      } catch (retryError: unknown) {
                        logger.error('Remote auto-retry failed', {
                          error: (retryError as Error).message,
                        });
                        this.retryInProgress = false;
                        rejectStream?.(retryError as Error);
                      }
                    }, 100);
                  }
                }
              } else {
                logger.debug('Remote agent stderr output', { stderr });
              }
            },
            onExit: (code: number) => handleRemoteClose(code),
            onError: (error: Error) => {
              logger.error('Remote relay process error', { error: error.message });
              this.emit('error', error);
            },
          },
        );
      }

      logger.info('Remote agent connection established successfully', {
        connectionId: this.sshConnectionId,
        isAlive: this.remoteProcess?.isAlive(),
        hasMcpAccess: !!this.remotePortForwarding,
        connectionType: useStreamLocal ? 'StreamLocal' : 'relay',
      });

      // Listen for SSH disconnect events to log when connection is lost.
      // The actual reconnection is triggered by the onClose/onExit handler
      // (which fires when the SSH channel drops and the connection breaks).
      if (this.sshDisconnectHandler) {
        sshManager.removeListener('disconnected', this.sshDisconnectHandler);
      }
      this.sshDisconnectHandler = (connectionId: string) => {
        if (connectionId === this.sshConnectionId && !this.isReconnecting) {
          logger.info('SSH connection lost — connection will close and trigger reconnection', {
            connectionId,
            workspaceId: this.config.workspaceId,
            connectionType: useStreamLocal ? 'StreamLocal' : 'relay',
          });
        }
      };
      sshManager.on('disconnected', this.sshDisconnectHandler);
    } catch (error) {
      logger.error('Failed to launch remote agent', { error: (error as Error).message });

      // Clean up port forwarding on failure
      if (this.remotePortForwarding) {
        try {
          this.remotePortForwarding.close();
        } catch (err) {
          logger.warn('Failed to close port forwarding during cleanup', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
        this.remotePortForwarding = undefined;
      }

      // Clean up SSH connection on failure
      if (this.sshConnectionId) {
        await sshManager.disconnect(this.sshConnectionId).catch(() => {});
      }

      throw error;
    }
  }

  /**
   * Reconnect to a remote agent after SSH disconnection.
   * The auggie process is still running on the remote via intent-server daemon.
   * We just need to re-establish SSH, port forwarding, and the relay pipe.
   */
  private async reconnectRemoteAgent(): Promise<void> {
    const sshConfig = this.config.environmentConfig?.ssh;
    const remotePath = this.config.environmentConfig?.workspace_path;
    const workspaceId = this.config.workspaceId || 'default';

    if (!sshConfig) {
      throw new Error('SSH configuration required for reconnection');
    }

    logger.info('Starting SSH reconnection to remote agent', {
      host: sshConfig.host,
      workspaceId,
    });

    // Emit reconnecting status for UI
    this.emit('process:exit', { code: null, signal: null, reconnecting: true });

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s
    const MAX_RETRIES = 5;
    const BASE_DELAY_MS = 1000;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);

      logger.info(`SSH reconnection attempt ${attempt}/${MAX_RETRIES}`, {
        delay,
        host: sshConfig.host,
        workspaceId,
      });

      // Wait before retrying (except first attempt)
      if (attempt > 1) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      try {
        // Create a new connection ID for the reconnection
        this.sshConnectionId = `agent-${this.config.agentId || 'default'}-${Date.now()}`;
        const sshConnectionId = this.sshConnectionId;

        // Step 1: Re-establish SSH connection
        await sshManager.connect(sshConnectionId, {
          host: sshConfig.host,
          port: sshConfig.port || 22,
          username: sshConfig.user,
          password: sshConfig.password,
          privateKeyPath: sshConfig.key_path,
          useAgent: sshConfig.use_agent,
          transport: sshConfig.transport,
          wsUrl: sshConfig.ws_url,
        });

        logger.info('SSH reconnection established', {
          connectionId: this.sshConnectionId,
          attempt,
        });

        // Resolve ~ in remotePath to absolute path (escapeShellArg prevents tilde expansion)
        let resolvedRemotePath: string;
        if (remotePath && remotePath.startsWith('~')) {
          const homeResult = await sshManager.executeCommand(sshConnectionId, 'echo $HOME', {
            timeout: 5000,
            rawCommand: true,
          });
          const homeDir = homeResult.stdout.trim();
          resolvedRemotePath = homeDir ? remotePath.replace(/^~/, homeDir) : remotePath;
        } else if (!remotePath) {
          const homeResult = await sshManager.executeCommand(sshConnectionId, 'echo $HOME', {
            timeout: 5000,
            rawCommand: true,
          });
          resolvedRemotePath = homeResult.stdout.trim() || '/root';
        } else {
          resolvedRemotePath = remotePath;
        }

        // Step 2: Re-establish reverse port forwarding for MCP
        const localMcpPort = parseInt(process.env.HTTP_MCP_PORT || '5179', 10);
        const remoteMcpPort = 19000 + ((this.config.agentId?.charCodeAt(0) || 0) % 1000);

        try {
          this.remotePortForwarding = await sshManager.forwardRemotePort(this.sshConnectionId, {
            remotePort: remoteMcpPort,
            localHost: 'localhost',
            localPort: localMcpPort,
          });
          logger.info('SSH reverse port forwarding re-established for MCP', {
            remoteMcpPort,
            localMcpPort,
          });
        } catch (portForwardError) {
          logger.warn('Failed to re-establish port forwarding for MCP during reconnection', {
            error: (portForwardError as Error).message,
          });
          // Continue without MCP - agent can still work
        }

        // Step 3: Check auggie status via intent-server
        let isAuggieRunning = false;
        try {
          const statusResult = await sshManager.executeCommand(
            this.sshConnectionId,
            `node ~/.intent-server/server.js status --workspace ${escapeShellArg(workspaceId)}`,
            { timeout: 10000 },
          );

          if (statusResult.exitCode === 0) {
            try {
              const status = JSON.parse(statusResult.stdout.trim());
              isAuggieRunning = status.running === true;
              logger.info('Auggie status after reconnection', {
                running: isAuggieRunning,
                pid: status.pid,
                uptime: status.uptime,
              });
            } catch {
              logger.warn('Could not parse auggie status during reconnection');
            }
          }
        } catch (statusError) {
          logger.warn('Status check failed during reconnection', {
            error: (statusError as Error).message,
          });
        }

        // Step 4: If auggie died during disconnect, restart it
        if (!isAuggieRunning) {
          logger.info('Auggie not running after reconnection, starting fresh');

          // Re-deploy intent-server (in case remote was rebooted)
          const localBundlePath = getIntentServerPath();
          await sshManager.deployIntentServer(this.sshConnectionId, localBundlePath);

          // Discover auggie path
          const auggiePath = await sshManager.discoverAuggiePath(this.sshConnectionId);

          // Build args
          const args = [...(this.config.args || [])];
          const caps = this.providerCapabilities;
          if (caps.id === 'auggie' && !args.includes('--allow-indexing')) {
            args.push('--allow-indexing');
          }
          if (this.config.model) {
            const { modelId: rawModelId } = parseCompoundModelId(this.config.model);
            if (caps.id === 'auggie' && !args.includes('--model')) {
              args.push('--model', rawModelId);
            }
          }

          const startArgs = [
            'node',
            '~/.intent-server/server.js',
            'start',
            '--workspace',
            escapeShellArg(workspaceId),
            '--command',
            escapeShellArg(auggiePath),
            '--args',
            escapeShellArg(JSON.stringify(args)),
            '--cwd',
            escapeShellArg(resolvedRemotePath),
          ];

          const startResult = await sshManager.executeCommand(
            this.sshConnectionId,
            startArgs.join(' '),
            { timeout: 30000 },
          );

          if (startResult.exitCode !== 0) {
            throw new Error(
              `Failed to restart auggie via intent-server: ${startResult.stderr || startResult.stdout}`,
            );
          }

          logger.info('Auggie restarted via intent-server after reconnection');
        }

        // Step 5: Connect to auggie — prefer StreamLocal, fall back to relay
        const relayCommand = `node ~/.intent-server/server.js relay --workspace ${escapeShellArg(workspaceId)}`;

        // Resolve $HOME for the socket path
        let reconnectHomeDir: string | undefined;
        try {
          const homeResult = await sshManager.executeCommand(sshConnectionId, 'echo $HOME', {
            timeout: 5000,
            rawCommand: true,
          });
          reconnectHomeDir = homeResult.stdout.trim();
        } catch {
          logger.warn('Could not resolve remote $HOME for socket path during reconnection');
        }

        const reconnectSocketPath = reconnectHomeDir
          ? `${reconnectHomeDir}/.intent-server/workspaces/${workspaceId}/acp.sock`
          : undefined;

        // Reset stream parser for clean message parsing
        this.streamParser = new ACPStreamParser();

        // Handler for incoming data (shared between StreamLocal and relay)
        const handleReconnectData = (data: string) => {
          const messages = this.streamParser.parseChunk(data);
          for (const message of messages) {
            this.enqueueMessage(message);
          }
        };

        // Handler for connection close (shared between StreamLocal and relay)
        const handleReconnectClose = (code: number | null) => {
          logger.info('Remote connection closed (after reconnection)', {
            code,
            agentId: this.config.agentId,
          });

          // Clean up port forwarding
          if (this.remotePortForwarding) {
            try {
              this.remotePortForwarding.close();
            } catch (err) {
              logger.warn(
                'Failed to close port forwarding after reconnection (client likely disconnected)',
                {
                  error: err instanceof Error ? err.message : String(err),
                },
              );
            }
            this.remotePortForwarding = undefined;
          }

          // If SSH is down again, trigger another reconnection
          if (
            !this.isStoppingIntentionally &&
            !this.isReconnecting &&
            this.sshConnectionId &&
            !sshManager.isConnected(this.sshConnectionId)
          ) {
            logger.info('SSH disconnected again after reconnection, triggering re-reconnection');
            this.isReconnecting = true;
            this.reconnectRemoteAgent()
              .then(() => {
                this.isReconnecting = false;
              })
              .catch((err) => {
                logger.error('Re-reconnection failed', { error: (err as Error).message });
                this.isReconnecting = false;
                // Fall through to normal restart
                this.handleProcessExit(code ?? 1, null);
              });
          } else if (!this.isStoppingIntentionally) {
            // Connection died but SSH is still up — auggie may have crashed
            this.handleProcessExit(code ?? 1, null);
          }
        };

        let reconnectUseStreamLocal = false;

        if (reconnectSocketPath) {
          try {
            logger.info('Attempting StreamLocal reconnection to auggie socket', {
              workspaceId,
              socketPath: reconnectSocketPath,
            });

            this.remoteProcess = await sshManager.connectToRemoteSocket(
              this.sshConnectionId,
              reconnectSocketPath,
              {
                onData: handleReconnectData,
                onClose: () => handleReconnectClose(null),
                onError: (error: Error) => {
                  logger.error('Remote StreamLocal socket error (after reconnection)', {
                    error: error.message,
                  });
                  this.emit('error', error);
                },
              },
            );

            reconnectUseStreamLocal = true;
            logger.info('StreamLocal reconnection established to auggie socket', {
              workspaceId,
              socketPath: reconnectSocketPath,
            });
          } catch (streamLocalError) {
            logger.warn('StreamLocal reconnection failed, falling back to relay process', {
              error: (streamLocalError as Error).message,
              socketPath: reconnectSocketPath,
              workspaceId,
            });
          }
        }

        if (!reconnectUseStreamLocal) {
          logger.info('Re-connecting to auggie via relay after SSH reconnection', {
            workspaceId,
            relayCommand,
          });

          this.remoteProcess = await sshManager.spawnRemoteProcess(
            this.sshConnectionId,
            relayCommand,
            {
              onStdout: handleReconnectData,
              onStderr: (data: string) => {
                const stderr = data.trim();
                if (!stderr) return;
                this.writeStderrToLog(stderr);
                if (
                  stderr.includes('error') ||
                  stderr.includes('Error') ||
                  stderr.includes('ERROR')
                ) {
                  logger.error('Remote agent stderr error (after reconnection)', { stderr });
                  this.bufferRecentStderrError(stderr);
                } else {
                  logger.debug('Remote agent stderr output (after reconnection)', { stderr });
                }
              },
              onExit: (code: number) => handleReconnectClose(code),
              onError: (error: Error) => {
                logger.error('Remote relay process error (after reconnection)', {
                  error: error.message,
                });
                this.emit('error', error);
              },
            },
          );
        }

        // Step 6: Re-register SSH disconnect listener
        if (this.sshDisconnectHandler) {
          sshManager.removeListener('disconnected', this.sshDisconnectHandler);
        }
        this.sshDisconnectHandler = (connectionId: string) => {
          if (connectionId === this.sshConnectionId && !this.isReconnecting) {
            logger.info(
              'SSH connection lost (detected via event), connection will close and trigger reconnection',
              {
                connectionType: reconnectUseStreamLocal ? 'StreamLocal' : 'relay',
              },
            );
          }
        };
        sshManager.on('disconnected', this.sshDisconnectHandler);

        // Step 7: Re-initialize ACP protocol
        await this.initializeProtocol();

        // Step 8: Mark session as recreated so full history is sent
        // Only set if there was a previous session we failed to resume — brand new agents have no history to resend
        if (!this.lastInitUsedSessionLoad && this.previousSessionId) {
          this.sessionWasRecreated = true;
        }

        logger.info('SSH reconnection complete — agent session re-established', {
          workspaceId,
          connectionId: this.sshConnectionId,
          isAuggieRunning,
        });

        // Success — exit retry loop
        return;
      } catch (error) {
        logger.warn(`SSH reconnection attempt ${attempt}/${MAX_RETRIES} failed`, {
          error: (error as Error).message,
          host: sshConfig.host,
        });

        // Clean up failed connection attempt
        if (this.sshConnectionId) {
          await sshManager.disconnect(this.sshConnectionId).catch(() => {});
        }
        if (this.remotePortForwarding) {
          try {
            this.remotePortForwarding.close();
          } catch (err) {
            logger.warn('Failed to close port forwarding during reconnection cleanup', {
              error: err instanceof Error ? err.message : String(err),
            });
          }
          this.remotePortForwarding = undefined;
        }

        if (attempt === MAX_RETRIES) {
          throw new Error(
            `SSH reconnection failed after ${MAX_RETRIES} attempts: ${(error as Error).message}`,
          );
        }
      }
    }
  }

  /**
   * Process a message sequentially by chaining onto the previous processing promise.
   * This ensures that blocking operations (like permission requests) don't
   * let subsequent messages be processed until they complete.
   */
  private enqueueMessage(message: any): void {
    // Chain this message's processing onto the previous one
    // Each message waits for the previous to complete before starting
    this.messageProcessingChain = this.messageProcessingChain.then(async () => {
      try {
        await this.handleAgentMessage(message);
      } catch (error) {
        logger.error('Error processing message', { error });
      }
    });
  }

  private async handleAgentMessage(message: any): Promise<void> {
    try {
      logger.debug('Received agent message', {
        method: message.method,
        hasId: message.id !== undefined,
        hasParams: !!message.params,
        paramsKeys: message.params ? Object.keys(message.params) : [],
      });

      // Claude Code: the adapter sends a sessionUpdate containing available models after session/new.
      // If we have a deferred model choice, apply it as soon as we see that announcement.
      await this.maybeApplyClaudeCodeModel(message);

      // Check if this is a response to a pending request
      if (message.id !== undefined && this.pendingRequests.has(message.id)) {
        logger.debug('Found pending request for response', {
          messageId: message.id,
          stopReason: message.result?.stopReason,
        });
        const pending = this.pendingRequests.get(message.id);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(message.id);
          if (this.agentProcess?.pid) {
            notifyPendingWorkCleared(this.agentProcess.pid);
          }
          this.resetIdleTimer();
          pending.resolve(message);
        }
        return;
      } else if (message.id !== undefined && (message.result || message.error)) {
        // This is a JSON-RPC response (has id + result or id + error) without a matching
        // pending request. This can happen when a request times out and the pending entry
        // is cleared before the agent responds. We MUST return after handling to prevent
        // the response from falling through to the ACP server, which would misinterpret it
        // as a request (since it has an id), generate a "Method not found: undefined" error,
        // and send that error back to the agent — creating a response echo loop.

        // Handle error responses without pending requests
        if (message.error) {
          logger.warn('Received error response but no pending request found', {
            messageId: message.id,
            pendingRequestIds: Array.from(this.pendingRequests.keys()),
            error: message.error,
          });
          return;
        }

        // Check if this response is from a stale request (a new stream has started)
        // This prevents garbled text when a new message is sent while the previous stream is still active
        if (
          this.currentStreamingRequestId !== null &&
          message.id !== this.currentStreamingRequestId
        ) {
          logger.info('Ignoring response from stale request - a newer stream is active', {
            staleRequestId: message.id,
            currentStreamingRequestId: this.currentStreamingRequestId,
            stopReason: message.result.stopReason,
          });
          return;
        }

        logger.warn('Received response but no pending request found', {
          messageId: message.id,
          currentStreamingRequestId: this.currentStreamingRequestId,
          pendingRequestIds: Array.from(this.pendingRequests.keys()),
          result: message.result,
        });

        // IMPORTANT: Even without a pending request, if we get a stopReason,
        // we should still trigger stream completion. This handles the case where
        // the pending request was cleared before the end_turn response arrived.
        if (message.result.stopReason) {
          logger.info('Triggering stream completion from orphaned stopReason response', {
            stopReason: message.result.stopReason,
            sessionId: this.sessionId,
            frontendSessionId: this.frontendSessionId,
            currentGeneration: this.streamGeneration,
            hasContentInResponse: !!message.result.content,
            contentLength: message.result.content?.length,
          });

          // FIX: Extract content from the orphaned prompt response into the accumulator.
          // Without this, handleStreamCompletion finds no accumulated content and
          // triggers an empty-response error — even though the response carried valid
          // content. This mirrors the extraction logic in the normal pending-request
          // resolve callback (see the prompt-response extraction around line 7723).
          if (message.result.content) {
            const accumulatorId = this.frontendSessionId || this.sessionId;
            if (accumulatorId) {
              // Check if the accumulator already has streamed content to avoid duplicates
              const possibleAccumulatorIds = [
                accumulatorId,
                this.frontendSessionId,
                this.sessionId,
                this.streamingAgentId,
              ].filter((id): id is string => Boolean(id));
              const uniqueAccumulatorIds = [...new Set(possibleAccumulatorIds)];

              let hasStreamedContent = false;
              for (const sid of uniqueAccumulatorIds) {
                const existing = messageAccumulator.getAccumulated(sid);
                if (
                  existing &&
                  (existing.content.length > 0 || existing.orderedItems.length > 0)
                ) {
                  hasStreamedContent = true;
                  break;
                }
              }

              if (!hasStreamedContent) {
                if (Array.isArray(message.result.content)) {
                  const contentBlocks = parseACPMessage(message.result.content);
                  if (contentBlocks && contentBlocks.length > 0) {
                    logger.info(
                      'Extracting content from orphaned prompt response into accumulator',
                      {
                        accumulatorId,
                        blocksCount: contentBlocks.length,
                        blockTypes: contentBlocks.map((b: any) => b.type),
                      },
                    );

                    if (!messageAccumulator.getActiveSessionIds().includes(accumulatorId)) {
                      messageAccumulator.startAccumulation(accumulatorId);
                    }

                    for (const block of contentBlocks) {
                      if (block.type === 'text' && 'text' in block && block.text) {
                        messageAccumulator.addChunk(accumulatorId, block.text);
                      } else if (block.type === 'tool_use') {
                        messageAccumulator.addContentBlock(accumulatorId, block);
                      }
                    }
                  }
                } else if (typeof message.result.content === 'string') {
                  logger.info(
                    'Extracting string content from orphaned prompt response into accumulator',
                    {
                      accumulatorId,
                      contentLength: message.result.content.length,
                    },
                  );

                  if (!messageAccumulator.getActiveSessionIds().includes(accumulatorId)) {
                    messageAccumulator.startAccumulation(accumulatorId);
                  }
                  messageAccumulator.addChunk(accumulatorId, message.result.content);
                }
              }
            }
          }

          // Try to complete the stream using the frontend session ID
          const completionSessionId = this.frontendSessionId || this.sessionId;
          const callbacks = completionSessionId
            ? this.streamingCallbacks.get(completionSessionId)
            : undefined;
          if (completionSessionId && callbacks) {
            // Capture the generation NOW, before the setTimeout.
            // This prevents a race condition where:
            // 1. Orphaned response arrives, schedules setTimeout
            // 2. User sends new message, new stream starts with new generation
            // 3. setTimeout fires, finds new stream's callbacks
            // 4. Without this check, we'd complete the new stream with old stopReason
            const capturedGeneration = callbacks.streamGeneration;

            // Small delay to ensure all chunks are processed
            setTimeout(() => {
              const currentCallbacks = this.streamingCallbacks.get(completionSessionId);
              if (currentCallbacks) {
                // Check if the callbacks are still from the same generation
                // If a new stream started, the generation will be different
                if (
                  capturedGeneration !== undefined &&
                  currentCallbacks.streamGeneration !== capturedGeneration
                ) {
                  logger.info(
                    'Ignoring orphaned stopReason - stream generation changed during setTimeout',
                    {
                      completionSessionId,
                      capturedGeneration,
                      currentGeneration: currentCallbacks.streamGeneration,
                      stopReason: message.result.stopReason,
                    },
                  );
                  return;
                }
                this.handleStreamCompletion(completionSessionId, message.result.stopReason);
              }
            }, 100);
          } else {
            logger.warn('Cannot complete stream - no valid session ID or callbacks', {
              completionSessionId,
              hasCallbacks: completionSessionId
                ? this.streamingCallbacks.has(completionSessionId)
                : false,
              availableCallbackIds: Array.from(this.streamingCallbacks.keys()),
            });

            // Even without callbacks, ensure the streaming state is fully reset
            // so the UI doesn't stay stuck in "Thinking" forever. Without this,
            // the provider remains in isStreaming=true with no way to complete.
            // This ensures that isStreaming is only reset when all streams have completed.
            if (this.streamingCallbacks.size === 0) {
              this.isStreaming = false;
              this.currentStreamingRequestId = null;

              // Clear the messageAccumulator for this session to prevent stale content
              // from the orphaned response leaking into the next stream's onComplete.
              // Normally handleStreamCompletion clears this, but without callbacks it
              // never runs, so we must clean up here.
              const sessionIdsToClear = [
                completionSessionId,
                this.frontendSessionId,
                this.sessionId,
                this.streamingAgentId,
              ].filter((id): id is string => Boolean(id));
              for (const sid of [...new Set(sessionIdsToClear)]) {
                messageAccumulator.clear(sid);
              }

              logger.info('Reset streaming state after orphaned response with no callbacks', {
                completionSessionId,
                clearedAccumulatorIds: [...new Set(sessionIdsToClear)],
              });
            }
          }
        }

        // CRITICAL: Return here to prevent orphaned responses from falling through
        // to the ACP server. Without this return, the ACP server receives the response,
        // treats it as a request (because it has an 'id' field), fails to find a 'method',
        // and sends back a "Method not found: undefined" error to the agent.
        return;
      }

      // Check if this is a session/update notification (streaming chunks)
      if (message.method === 'session/update') {
        // PERF: Changed from INFO to DEBUG - this is called for every streaming chunk
        // which can be hundreds/thousands per response, causing log spam and memory growth

        // DEBUG: Log first few session/update messages to verify they're being received
        const updateType =
          message.params?.update?.sessionUpdate || message.params?.sessionUpdate?.sessionUpdate;
        if (updateType === 'agent_message_chunk' || updateType === 'agent_message') {
          logger.debug('[ACPProvider] Received session/update with content', {
            hasParams: !!message.params,
            sessionId: message.params?.sessionId,
            updateType,
            hasStreamingHandler: !!this.streamingHandler,
            providerId: this.providerCapabilities.id,
          });
        } else {
          logger.debug('Handling session/update', {
            hasParams: !!message.params,
            sessionId: message.params?.sessionId,
            updateType,
          });
        }

        // Reset completion detection timer on ANY session update activity
        // This prevents premature timeout when agents are actively working
        // NOTE: This is the actual code path for session updates - the acpServer.on('session:update')
        // event handler is not triggered for these messages
        // IMPORTANT: Skip timer reset for cancelled sessions — stale events from a cancelled
        // session must not keep the completion timer alive for the new stream.
        if (
          message.params?.sessionId &&
          !(this.streamingHandler?.isSessionCancelled(message.params.sessionId))
        ) {
          const timerSessionId = this.frontendSessionId || message.params.sessionId;
          this.resetCompletionDetection(timerSessionId);
        }

        // IMPORTANT: Await the session update so that the message queue properly blocks
        // when a permission request is pending
        await this.handleSessionUpdate(message.params);
        return;
      }

      // Handle permission requests from auggie CLI
      // Auggie sends permission requests with a different format than standard ACP:
      // - Auggie: { toolCall: { toolCallId, title, kind }, options: [{ optionId, name, kind }] }
      // - ACP Standard: { title, description, options: [{ id, label }] }
      // We use IPC to send permission request to renderer and show dialog to user
      if (message.method === 'session/request_permission' && message.id !== undefined) {
        const caps = this.providerCapabilities;

        // If bypassPermissions was intended but failed to set on the provider (or the
        // provider doesn't support set_mode at all), auto-approve the permission request
        // instead of blocking on a user dialog. This prevents the agent from stalling
        // (and returning an empty response) when the provider sends permission requests
        // that we intended to bypass.
        if (caps.id !== 'auggie' && !this.bypassPermissionsActive) {
          const title =
            message.params?.toolCall?.title || message.params?.title || 'Permission Request';
          logger.info('Auto-approving permission request (bypassPermissions fallback)', {
            id: message.id,
            title,
            provider: caps.id,
          });

          // Find the "allow" option from the request, or use a sensible default
          const allowOption = (message.params?.options || []).find(
            (opt: any) =>
              (opt.optionId || opt.id) === 'allow_once' ||
              (opt.kind && opt.kind !== 'reject_once' && opt.kind !== 'reject_always'),
          );
          const optionId = allowOption?.optionId || allowOption?.id || 'allow_once';

          const response = {
            jsonrpc: '2.0',
            id: message.id,
            result: {
              outcome: { outcome: 'selected', optionId },
            },
          };

          if (!this.writeToAgent(`${JSON.stringify(response)}\n`)) {
            logger.warn(
              'Cannot send auto-approved permission response to agent - agent not available',
            );
          }
          this.recordStreamingActivity();
          return;
        }

        logger.info('Handling permission request from agent via IPC - BLOCKING', {
          id: message.id,
          toolCallId: message.params?.toolCall?.toolCallId,
          title: message.params?.toolCall?.title,
          options: message.params?.options,
        });

        // Import permission IPC bridge dynamically to avoid circular dependencies
        const { permissionIPCBridge } = await import('../../../acp-official/main/permission.ipc');

        // Extract and normalize permission request data
        const title =
          message.params?.toolCall?.title || message.params?.title || 'Permission Request';
        const description = message.params?.toolCall?.rawInput
          ? `Tool input: ${JSON.stringify(message.params.toolCall.rawInput)}`
          : message.params?.description;

        // Normalize options: auggie uses optionId/name, ACP uses id/label
        const options = (message.params?.options || []).map((opt: any) => ({
          id: opt.optionId || opt.id,
          label: opt.name || opt.label,
          description: opt.description,
          destructive: opt.kind === 'reject_once' || opt.destructive,
        }));

        const permissionSessionId = this.frontendSessionId || this.config.agentId || this.sessionId;
        logger.info('Requesting permission from user - stream will wait', {
          title,
          frontendSessionId: this.frontendSessionId,
          configAgentId: this.config.agentId,
          internalSessionId: this.sessionId,
          usingSessionId: permissionSessionId,
        });

        // Request permission via IPC (shows dialog in renderer, waits for user response)
        // The Promise chain in enqueueMessage ensures subsequent messages wait for this to complete
        // Use frontendSessionId (which equals agentId) so the inline permission UI can filter by agent
        const outcome = await permissionIPCBridge.requestPermission(
          permissionSessionId as any,
          title,
          description,
          options,
          { agentName: this.providerCapabilities.displayName },
        );

        logger.info('Permission response received from user - resuming', {
          outcome: outcome.outcome,
          optionId: (outcome as any).optionId,
        });

        // Send response back to agent in auggie's expected format
        const response = {
          jsonrpc: '2.0',
          id: message.id,
          result: {
            outcome,
          },
        };

        const responseStr = JSON.stringify(response);
        logger.info('Sending permission response to agent', {
          outcome: outcome.outcome,
          optionId: (outcome as any).optionId,
        });

        if (!this.writeToAgent(`${responseStr}\n`)) {
          logger.warn('Cannot send permission response to agent - agent not available');
        }
        this.recordStreamingActivity();
        return;
      }

      // Handle as a regular message through ACP server
      // This includes fs/read_text_file, fs/write_text_file, tools/call, etc.
      const messageStr = typeof message === 'string' ? message : JSON.stringify(message);
      const response = await this.acpServer?.handleMessage(messageStr);
      if (response) {
        // Send response back to agent
        if (!this.writeToAgent(`${response}\n`)) {
          logger.warn('Cannot send response to agent - agent not available');
        }

        // CRITICAL FIX: Track ACP server requests as streaming activity.
        // When the agent sends fs/write_text_file, fs/read_text_file, or other ACP
        // requests, it is actively working but NOT sending session/update notifications.
        // Without this, post-interrupt stuck detection sees chunksReceived=0 and falsely
        // restarts the agent even though it's busy executing file operations.
        this.recordStreamingActivity();
      }
    } catch (error) {
      logger.error('Failed to handle agent message', error as Error);
    }

  }

  /**
   * Handle session/update notifications from the agent
   * These contain streaming chunks during prompt processing
   * Returns a Promise so callers can await it and properly block the message queue
   */
  private async handleSessionUpdate(params: any): Promise<void> {
    // Detect the "workspace MCP tool went missing" symptom from a failed tool
    // call result and trigger a bounded session recovery. Runs out-of-band (not
    // awaited) so it never blocks or delays streaming.
    this.maybeRecoverMissingWorkspaceTool(params);

    // ALWAYS use the new streaming handler if available
    // The legacy system causes issues with duplicate accumulator access
    if (this.streamingHandler) {
      // Pass the session update to the new streaming handler
      // The new handler will use the callbacks registered with streamSessionManager
      // IMPORTANT: Await this so the message queue properly blocks during permission requests
      try {
        const updateType = params?.update?.sessionUpdate || params?.sessionUpdate?.sessionUpdate;
        if (updateType === 'agent_message_chunk' || updateType === 'agent_message') {
          logger.debug('[ACPProvider] Calling streamingHandler.handleSessionUpdate', {
            sessionId: params?.sessionId,
            updateType,
            providerId: this.providerCapabilities.id,
          });
        }

        await this.streamingHandler.handleSessionUpdate(params);

        // Update activity tracking for stall detection and post-interrupt stuck detection
        // Use recordStreamChunk() here because session/update notifications indicate actual
        // stream content — the normal-timeout heuristic relies on chunksReceived to decide
        // if the stream completed via session/update.
        this.recordStreamChunk();
      } catch (error: any) {
        logger.error('Error in streaming handler', {
          error: error.message,
          stack: error.stack,
        });
      }
      return;
    }

    // No streaming handler — this commonly happens during session/load replay where
    // auggie replays history as session/update notifications before streamMessage()
    // has been called. These are safe to drop since the UI already has the history
    // from its own persistence. Downgraded from WARN to DEBUG to reduce log noise
    // (~20k warnings per session).
    // NOTE: Auggie sends 'update' but ACP spec says 'sessionUpdate' - support both
    const sessionUpdate = params?.update || params?.sessionUpdate;
    logger.debug('No streaming handler available, skipping session update', {
      sessionId: params?.sessionId,
      updateType: sessionUpdate?.sessionUpdate,
    });
  }

  /**
   * Inspect a session/update notification for recoverable workspace MCP tool
   * symptoms (missing tool registration, or a stale `ws.*` API surface) and kick
   * off bounded recovery. Best-effort and non-blocking — failures here must never
   * disrupt streaming.
   */
  private maybeRecoverMissingWorkspaceTool(params: any): void {
    try {
      const update = params?.update || params?.sessionUpdate;
      const updateType = update?.sessionUpdate || update?.type;
      if (updateType !== 'tool_call_update' && updateType !== 'tool_call') {
        return;
      }
      if (detectMissingWorkspaceToolInUpdate(update) || detectStaleWorkspaceApiInUpdate(update)) {
        void this.triggerWorkspaceToolRecovery('tool_call_update');
      }
    } catch {
      // Best-effort detection — never disrupt streaming.
    }
  }

  /**
   * Record broad streaming activity for post-interrupt stuck detection.
   * Called whenever any meaningful agent activity is observed:
   * - ACP server requests (fs/read_text_file, fs/write_text_file, etc.)
   * - Permission requests (auto-approved or user-responded)
   *
   * Sets hasReceivedActivity=true so post-interrupt stuck detection recognizes
   * agents doing tool/file work as active, not stuck.
   * Does NOT increment chunksReceived — that field is reserved for session/update
   * notifications so the normal-timeout heuristic can distinguish "stream completed
   * via session/update" from "agent did file ops but stream never started".
   */
  private recordStreamingActivity(): void {
    const callbackSessionId = this.frontendSessionId || this.sessionId;
    if (callbackSessionId) {
      const callbacks = this.streamingCallbacks.get(callbackSessionId);
      if (callbacks) {
        callbacks.lastActivityTime = Date.now();
        callbacks.hasReceivedActivity = true;
      }
    }
  }

  /**
   * Record a session/update chunk for both activity tracking and the normal-timeout
   * completion heuristic. Only called from the session/update notification path.
   *
   * Increments chunksReceived (used by the normal prompt-response timeout to decide
   * "stream probably completed via session/update — silently resolve") AND sets
   * hasReceivedActivity (used by post-interrupt stuck detection).
   */
  private recordStreamChunk(): void {
    const callbackSessionId = this.frontendSessionId || this.sessionId;
    if (callbackSessionId) {
      const callbacks = this.streamingCallbacks.get(callbackSessionId);
      if (callbacks) {
        callbacks.lastActivityTime = Date.now();
        callbacks.chunksReceived = (callbacks.chunksReceived || 0) + 1;
        callbacks.hasReceivedActivity = true;
      }
    }
  }

  private async initializeProtocol(): Promise<void> {
    this.emitStatus('init', 'Initializing protocol…');
    const caps = this.providerCapabilities;
    const isExternalProvider = caps.id !== 'auggie';

    // External providers (OpenCode, Claude Code, Codex) need time to bootstrap
    // before they can respond to initialize requests (~300-500ms for OpenCode).
    // Wait a bit for them to stabilize before checking if alive.
    if (isExternalProvider) {
      const startupWaitMs = 500;
      logger.info('Waiting for external provider to bootstrap', {
        providerId: caps.id,
        startupWaitMs,
      });
      await new Promise((resolve) => setTimeout(resolve, startupWaitMs));
    }

    // Check if process is still running (with retry for external providers)
    const maxAliveChecks = isExternalProvider ? 3 : 1;
    for (let check = 1; check <= maxAliveChecks; check++) {
      if (this.isAgentAlive()) break;
      if (check < maxAliveChecks) {
        logger.info('Agent not alive yet, retrying', {
          check,
          maxAliveChecks,
          providerId: caps.id,
          exitCode: this.agentProcess?.exitCode,
          signalCode: this.agentProcess?.signalCode,
          killed: this.agentProcess?.killed,
        });
        await new Promise((resolve) => setTimeout(resolve, 200));
      } else {
        // Build a detailed, actionable error message. The process reference may already
        // be cleared by handleProcessExit(), so use lastProcessExitInfo if available.
        const exitInfo = this.agentProcess
          ? `exitCode=${this.agentProcess.exitCode}, signal=${this.agentProcess.signalCode}, killed=${this.agentProcess.killed}`
          : this.lastProcessExitInfo
            ? `exitCode=${this.lastProcessExitInfo.code}, signal=${this.lastProcessExitInfo.signal}`
            : 'no process object';

        const stderrHint =
          this.lastProcessExitInfo?.stderr && this.lastProcessExitInfo.stderr.length > 0
            ? `\nProcess stderr: ${this.lastProcessExitInfo.stderr.join(' | ').substring(0, 500)}`
            : '';

        const commandHint = this.lastProcessExitInfo?.command
          ? ` (command: ${this.lastProcessExitInfo.command})`
          : '';

        // Provider-specific guidance
        let providerHint = '';
        if (caps.id === 'claude-code') {
          providerHint =
            '\n\nTo use Claude Code in Intent, make sure:\n' +
            '1. The Claude CLI is installed (https://docs.anthropic.com/en/docs/claude-code/getting-started)\n' +
            '2. You have authenticated with `claude auth login`\n' +
            '3. npx is available in your PATH';
        } else if (caps.id === 'codex') {
          providerHint =
            '\n\nTo use Codex in Intent, make sure the Codex CLI is installed and authenticated.';
        } else if (caps.id === 'opencode') {
          providerHint =
            '\n\nTo use OpenCode in Intent, make sure the OpenCode CLI is installed and accessible.';
        }

        // Detect stale Node.js installations (e.g., Homebrew upgraded but old symlinks remain)
        let staleNodeHint = '';
        const stderrText = this.lastProcessExitInfo?.stderr?.join('\n') ?? '';
        const exitCode = this.lastProcessExitInfo?.code ?? this.agentProcess?.exitCode;
        const hasStaleNodeIndicators =
          // ENOENT on Homebrew Cellar node paths — covers both Apple Silicon (/opt/homebrew) and Intel (/usr/local) prefixes
          (/ENOENT/.test(stderrText) &&
            /\/Cellar\/node\//.test(stderrText)) ||
          // Cannot find module pointing to Cellar paths
          (/Cannot find module/.test(stderrText) &&
            /\/Cellar\/node\//.test(stderrText)) ||
          // Exit code 254 with npm/npx-related errors (negative lookbehind-like pattern to exclude pnpm)
          (exitCode === 254 &&
            (/(?:^|[^p])npm/.test(stderrText) || /npx/.test(stderrText)));

        if (hasStaleNodeIndicators) {
          const isHomebrewRelated = /\/Cellar\/node\//.test(stderrText);
          if (isHomebrewRelated) {
            staleNodeHint =
              '\n\nThis looks like a broken Node.js installation — npm/npx is referencing a Node.js path that no longer exists ' +
              '(possibly from a Homebrew upgrade).\nTo fix this:\n' +
              '• Run `brew reinstall node` to repair the Homebrew Node installation\n' +
              '• Or if you use nvm/fnm, ensure your default Node version is set correctly\n' +
              '• Then restart Intent';
          } else {
            staleNodeHint =
              '\n\nThis looks like a broken Node.js installation.\nTo fix this:\n' +
              '• Reinstall Node.js from https://nodejs.org\n' +
              '• Or if you use a version manager (nvm, fnm, Volta), ensure your default Node version is set correctly\n' +
              '• Then restart Intent';
          }
        }

        throw new Error(
          `Agent process died before initialization (provider: ${caps.id}, ${exitInfo})${commandHint}.` +
            `${stderrHint}${providerHint}${staleNodeHint}`,
        );
      }
    }

    // Reset session/load tracking for this initialization attempt
    this.lastInitUsedSessionLoad = false;

    logger.info('Starting protocol initialization', {
      processAlive: this.isAgentAlive(),
      isRemote: this.isRemoteWorkspace(),
      hasPreviousSessionId: !!this.previousSessionId,
      previousSessionId: this.previousSessionId,
      supportsSessionLoad: this.supportsSessionLoad(),
    });

    // Use retry logic instead of fixed delay - faster in the common case
    // when auggie is ready immediately, but still handles slow startup
    const initStartTime = Date.now();
    let initResponse: any;
    let lastError: Error | null = null;
    const maxRetries = 3;
    // Increased from 2000ms to 5000ms to handle parallel agent spawning.
    // When multiple agents are spawned in parallel, system resources are contended
    // and the agent process takes longer to start up and respond.
    // With 2000ms, the first two attempts frequently timeout under load, producing
    // orphaned responses that increase the risk of stdin write interleaving.
    const initialTimeoutMs = 5000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Send initialize request - auggie requires protocolVersion
        const initRequest = {
          jsonrpc: '2.0' as const,
          method: 'initialize',
          params: {
            protocolVersion: 1,
            clientInfo: {
              name: 'Intent',
              version: app.getVersion(),
            },
          },
          id: ++this.requestId,
        };

        // Use shorter timeout for first attempt, longer for retries
        const timeoutMs = attempt === 1 ? initialTimeoutMs : initialTimeoutMs * attempt;

        logger.debug('Sending initialize request', { attempt, timeoutMs, ...initRequest });
        initResponse = await this.sendRequestInternal(initRequest, timeoutMs);
        logger.debug('Initialize response received', {
          attempt,
          elapsed: Date.now() - initStartTime,
          ...initResponse,
        });
        lastError = null;
        break; // Success!
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const isTimeout = lastError.message.includes('Timeout');

        if (attempt < maxRetries && isTimeout) {
          // Wait a bit before retry - auggie may still be starting up
          const delay = 100 * attempt;
          logger.debug('Initialize attempt failed, retrying', {
            attempt,
            delay,
            error: lastError.message,
          });
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else if (!isTimeout) {
          // Non-timeout error, throw immediately
          throw lastError;
        }
      }
    }

    if (lastError) {
      throw lastError;
    }

    // Extract agent version from initialize response for capability checks.
    // ACP initialize responses may include serverInfo.version (e.g. "0.18.0").
    try {
      const agentVersion =
        initResponse?.result?.agentInfo?.version || initResponse?.agentInfo?.version;
      if (agentVersion && typeof agentVersion === 'string') {
        this.agentVersion = agentVersion;
        logger.info('Agent version detected from initialize response', {
          agentVersion: this.agentVersion,
          supportsNonDestructiveCancel: this.supportsNonDestructiveCancel(),
          supportsSessionLoad: this.supportsSessionLoad(),
        });
      }

      // Check if the agent advertised loadSession capability
      const loadSessionCap =
        initResponse?.result?.agentCapabilities?.loadSession ??
        initResponse?.result?.capabilities?.loadSession;
      if (loadSessionCap) {
        this.agentSupportsSessionLoad = true;
        logger.info('Agent advertised loadSession capability');
      }
    } catch {
      // Version extraction is best-effort — don't block initialization
    }

    try {
      const caps = this.providerCapabilities;
      // Provider may not implement authenticate (e.g., OpenCode); skip to avoid log noise and stalled init.
      if (!caps.supportsAuthenticate) {
        logger.info('Skipping authenticate for provider (not implemented)', {
          providerId: caps.id,
        });
      } else {
        // Send authenticate request - auggie requires methodId
        const authRequest = {
          jsonrpc: '2.0' as const,
          method: 'authenticate',
          params: {
            methodId: 'none', // Use "none" for no authentication
          },
          id: ++this.requestId,
        };

        logger.debug('Sending authenticate request', authRequest);
        const authResponse = await this.sendRequest(authRequest);
        logger.debug('Authenticate response received', authResponse);
      }

      // Store the session creation params for potential reuse
      const agentCwd = this.getAgentWorkingDirectory();
      logger.info('Setting agent working directory', {
        cwd: agentCwd,
        workspaceScope: this.workspaceScope,
        configWorkspacePath: this.config.workspacePath,
        isRemote: this.isRemoteWorkspace(),
      });
      // Build session metadata — some adapters read extra fields from metadata
      const sessionMetadata: Record<string, unknown> = {
        workspaceId: this.config.workspaceId,
        userId: this.config.userId || 'user',
        workspacePath: this.config.workspacePath,
      };

      // Cortex adapter reads model from metadata.model (not from CLI args)
      if (caps.id === 'cortex' && this.config.model) {
        const { modelId: rawModelId } = parseCompoundModelId(this.config.model);
        if (rawModelId && rawModelId !== 'default') {
          sessionMetadata.model = rawModelId;
          logger.info('Including model in session metadata for Cortex', {
            model: rawModelId,
          });
        }
      }

      this.sessionCreationParams = {
        // Auggie-specific extensions (not in standard ACP)
        // Use getAgentWorkingDirectory() which returns the path where auggie actually runs
        // For remote workspaces, this is the remote path; for local, it's the local worktree
        cwd: agentCwd,
        mcpServers: this.acpMcpServersForSession, // Populated for providers that don't use --mcp-config (e.g. Claude Code, Cortex)
        // Standard ACP metadata
        metadata: sessionMetadata,
      };

      // Try to load a previous session (auggie >= 0.18.0) before creating a new one.
      // If session/load succeeds, we skip session/new entirely and avoid history resend.
      const loadedPreviousSession = await this.tryLoadPreviousSession();
      this.lastInitUsedSessionLoad = loadedPreviousSession;
      if (!loadedPreviousSession) {
        // Create new session (existing behavior)
        await this.createSession();
      }
    } catch (error) {
      logger.error('Failed to initialize protocol', error);

      // SIMPLIFIED: Don't create fake session IDs - if initialization fails, fail properly.
      // Fake session IDs cause OpenCode to crash with "agent.name undefined" because
      // OpenCode can't find the session and has no agent context.
      throw error;
    }
  }

  private async createSession(): Promise<void> {
    this.emitStatus('session-create', 'Creating session…');

    logger.info('Creating new ACP session', {
      isFirstSession: !this.previousSessionId,
      hadPreviousSession: !!this.previousSessionId,
      supportsSessionLoad: this.supportsSessionLoad(),
    });

    if (!this.sessionCreationParams) {
      throw new Error('Session creation params not initialized');
    }

    // Note: For auggie >= 0.18.0, session resumption is supported via the
    // session/load flow (see tryLoadPreviousSession). If session/load succeeds,
    // createSession() is skipped entirely. This path is only reached when
    // session/load is unavailable or failed, so we create a fresh session.

    // External providers (OpenCode, Claude Code, Codex) may take significantly longer
    // to create a session — especially delegated agents spawned alongside already-running
    // agents. OpenCode observed taking ~28s in production. Use a generous timeout with
    // retries instead of the default 5s which causes spurious failures.
    const caps = this.providerCapabilities;
    const isExternalProvider = caps.id !== 'auggie';
    const maxRetries = isExternalProvider ? 3 : 1;
    const initialTimeoutMs = isExternalProvider ? 30000 : 5000;

    let sessionResponse: any;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const sessionRequest = {
          jsonrpc: '2.0' as const,
          method: 'session/new',
          params: this.sessionCreationParams,
          id: ++this.requestId,
        };

        const timeoutMs = attempt === 1 ? initialTimeoutMs : initialTimeoutMs * attempt;

        logger.debug('Sending session/new request', { attempt, maxRetries, timeoutMs });
        sessionResponse = await this.sendRequest(sessionRequest, timeoutMs);
        logger.debug('Session response received', sessionResponse);
        lastError = null;
        break; // Success!
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const isTimeout = lastError.message.includes('Timeout');

        if (attempt < maxRetries && isTimeout) {
          const delay = 1000 * attempt;
          logger.warn('session/new attempt timed out, retrying', {
            attempt,
            maxRetries,
            delay,
            error: lastError.message,
            providerId: caps.id,
          });
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else if (!isTimeout) {
          // Non-timeout error (e.g., auth failure), throw immediately
          throw lastError;
        }
      }
    }

    if (lastError) {
      throw lastError;
    }

    // Check for error response (e.g., authentication required)
    if (sessionResponse?.error) {
      const errorMessage = sessionResponse.error.message || 'Unknown error';
      logger.error('Session creation failed with error', {
        errorCode: sessionResponse.error.code,
        errorMessage,
        providerId: caps.id,
      });

      // Emit domain event for authentication errors so UI can show helpful guidance
      if (isAuthenticationError(errorMessage, caps.id)) {
        const isRemote = !!this.config.environmentConfig?.ssh;
        logger.info('Emitting agent:auth-required event from session creation', {
          workspaceId: this.config.workspaceId,
          agentId: this.config.agentId,
          providerId: caps.id,
          isRemote,
        });
        mainDispatch(agentAuthRequired({
          workspaceId: this.config.workspaceId as WorkspaceId | undefined,
          agentId: this.config.agentId,
          isRemote,
          host: this.config.environmentConfig?.ssh?.host,
          message: getProviderAuthErrorMessage(caps.id, isRemote),
        }));
      }

      throw new Error(errorMessage);
    }

    if (sessionResponse?.result?.sessionId) {
      this.sessionId = sessionResponse.result.sessionId;
      // Store for session/load on future restarts (auggie >= 0.18.0)
      this.previousSessionId = this.sessionId;
      logger.info('ACP session created', { sessionId: this.sessionId });

      // New ACP session => inject runtime rules again on the first prompt for providers
      // that don't support rules files.
      this.injectedRuntimeRulesIntoPrompt = false;
      this.cachedRuntimeRulesContent = null;

      // Emit event so session manager can update the backend session ID
      this.emit('session:created', {
        sessionId: this.sessionId,
        agentId: this.config.agentId,
      });

      // External providers: set permission mode to bypassPermissions so the adapter
      // auto-approves all tool use without stalling on permission prompts.
      // This is critical for providers like OpenCode that send session/request_permission
      // messages which would otherwise block waiting for user interaction.
      //
      // We check supportsSetMode first to avoid a pointless round-trip (and the 5-second
      // timeout that comes with it) for providers that are known not to support the method.
      // If the provider doesn't support it, we skip the call and rely on local auto-approval
      // of permission requests in handleAgentMessage().
      this.bypassPermissionsActive = false; // Reset on every new session
      if (caps.id !== 'auggie' && caps.supportsSetMode) {
        try {
          const setModeRequest = {
            jsonrpc: '2.0' as const,
            method: 'session/set_mode',
            params: {
              sessionId: this.sessionId,
              modeId: 'bypassPermissions',
            },
            id: ++this.requestId,
          };
          const setModeResponse = await this.sendRequestInternal(setModeRequest, 5000);
          if (setModeResponse?.error) {
            logger.warn(
              `Failed to set ${caps.id} bypassPermissions mode; will auto-approve permissions locally`,
              {
                error: setModeResponse.error,
              },
            );
          } else {
            this.bypassPermissionsActive = true;
            logger.info(`${caps.id} session set to bypassPermissions mode`, {
              sessionId: this.sessionId,
            });
          }
        } catch (e) {
          logger.warn(
            `Error setting ${caps.id} bypassPermissions mode; will auto-approve permissions locally`,
            {
              error: (e as Error).message,
            },
          );
        }
      } else if (caps.id !== 'auggie') {
        logger.info(
          `Skipping session/set_mode for ${caps.id} (supportsSetMode=false); will auto-approve permissions locally`,
          {
            sessionId: this.sessionId,
          },
        );
      }

      // Claude Code: defer applying the model until after the adapter has emitted its
      // sessionUpdate containing available models (it sets its own default during newSession).
      if (caps.id === 'claude-code' && this.config.model) {
        const { modelId: rawModelId } = parseCompoundModelId(this.config.model);
        if (rawModelId && rawModelId !== 'default') {
          this.pendingClaudeCodeModelId = rawModelId;
          logger.info('Deferring initial Claude Code model until sessionUpdate', {
            sessionId: this.sessionId,
            configuredModel: this.config.model,
            rawModelId,
          });
        }
      }

      // OpenCode / Pi / Droid: apply the selected model via session/set_model after session creation.
      // For OpenCode, OPENCODE_CONFIG_CONTENT sets the model at the config level, but the `acp`
      // subcommand may not honor it (observed with OpenRouter models where OpenCode falls back to
      // its default model). Explicitly setting via ACP ensures the model sticks.
      // Pi (via pi-acp) has no model env var and relies purely on the ACP `/model` command
      // (mapped to the Zed model selector), so session/set_model is the only mechanism.
      // Droid: the `droid exec` CLI ignores -m/--model in ACP/JSON-RPC mode (per its
      // --help), so session/set_model is the only mechanism that takes effect.
      if ((caps.id === 'opencode' || caps.id === 'pi' || caps.id === 'droid') && this.config.model) {
        const { modelId: rawModelId } = parseCompoundModelId(this.config.model);
        if (rawModelId && rawModelId !== 'default') {
          try {
            const setModelResult = await this.setModel(rawModelId);
            if (setModelResult.success) {
              logger.info(`${caps.displayName} model set via ACP session/set_model`, {
                sessionId: this.sessionId,
                providerId: caps.id,
                modelId: rawModelId,
              });
            } else {
              const logFn = setModelResult.unsupported ? logger.debug : logger.warn;
              logFn.call(
                logger,
                `Failed to set ${caps.displayName} model via ACP session/set_model`,
                {
                  sessionId: this.sessionId,
                  providerId: caps.id,
                  modelId: rawModelId,
                  error: setModelResult.error,
                },
              );
            }
          } catch (e) {
            logger.warn(`Error setting ${caps.displayName} model via ACP session/set_model`, {
              sessionId: this.sessionId,
              providerId: caps.id,
              modelId: rawModelId,
              error: (e as Error).message,
            });
          }
        }
      }
      // POST-SESSION MODEL AUDIT
      // Log the final state after all model-application pathways have run.
      // Makes it trivial to verify the intended model was actually applied.
      logger.info('[createSession] Model application audit', {
        sessionId: this.sessionId,
        providerId: caps.id,
        configModel: this.config.model,
        envModel: this.config.env?.OPENCODE_CONFIG_CONTENT
          ? (() => {
              try {
                return JSON.parse(this.config.env.OPENCODE_CONFIG_CONTENT).model;
              } catch {
                return 'parse-error';
              }
            })()
          : undefined,
        modelAppliedVia:
          caps.id === 'opencode'
            ? 'session/set_model + OPENCODE_CONFIG_CONTENT'
            : caps.id === 'droid'
              ? 'session/set_model (CLI --model ignored in ACP mode)'
              : caps.id === 'claude-code'
                ? 'deferred session/set_model (on sessionUpdate)'
                : caps.id === 'cortex'
                  ? 'sessionMetadata.model'
                  : caps.modelFlag
                    ? `CLI flag (${caps.modelFlag})`
                    : 'unknown',
      });
    } else {
      logger.error('Failed to create ACP session - no sessionId in response', sessionResponse);
      throw new Error('Failed to create ACP session');
    }
  }

  private async maybeApplyClaudeCodeModel(message: any): Promise<void> {
    if (this.providerCapabilities.id !== 'claude-code') return;
    if (!this.sessionId) return;

    const method = String(message?.method || '');
    // Adapters may use different method names; accept a few common ones.
    const isModelAnnouncement =
      method === 'sessionUpdate' ||
      method === 'session/update' ||
      method === 'session/updateModels' ||
      method === 'session/models';

    if (!isModelAnnouncement) return;

    const params = message?.params;
    const sessionUpdate = params?.update || params?.sessionUpdate || params;
    const availableModels =
      sessionUpdate?.models?.availableModels ||
      sessionUpdate?.availableModels ||
      sessionUpdate?.models?.available ||
      [];

    if (!Array.isArray(availableModels) || availableModels.length === 0) {
      return;
    }

    // We only want to react to the adapter's first model announcement, because:
    // - It sets its own default during newSession
    // - After that, we can safely apply the user-selected model once
    if (this.hasSeenClaudeCodeModelsAnnouncement) return;
    this.hasSeenClaudeCodeModelsAnnouncement = true;

    const desired =
      this.pendingClaudeCodeModelId ??
      (this.config.model ? parseCompoundModelId(this.config.model).modelId : null);
    this.pendingClaudeCodeModelId = null;

    if (!desired || desired === 'default') {
      return;
    }

    // Verify the desired model is actually present in the adapter's model list.
    // If it isn't, the adapter will likely reject the set request anyway.
    const supportedIds = new Set(
      availableModels
        .map((m: any) => String(m?.modelId || m?.id || m?.value || '').trim())
        .filter(Boolean),
    );
    if (!supportedIds.has(desired)) {
      logger.warn('Desired Claude Code model not in supported list; attempting anyway', {
        sessionId: this.sessionId,
        desiredModelId: desired,
        supportedCount: supportedIds.size,
      });
    }

    logger.info('Applying deferred Claude Code model after sessionUpdate', {
      sessionId: this.sessionId,
      desiredModelId: desired,
    });

    const result = await this.setModel(desired);
    if (!result.success) {
      const logFn = result.unsupported ? logger.debug : logger.warn;
      logFn.call(
        logger,
        'Failed to apply deferred Claude Code model; continuing with adapter default',
        {
          sessionId: this.sessionId,
          desiredModelId: desired,
          error: result.error,
        },
      );
    }
  }

  private async ensureClaudeCodeModelApplied(): Promise<void> {
    if (this.providerCapabilities.id !== 'claude-code') return;
    if (!this.sessionId) return;
    if (!this.config.model) return;

    const { modelId: rawModelId } = parseCompoundModelId(this.config.model);
    if (!rawModelId || rawModelId === 'default') return;
    if (this.appliedClaudeCodeModelId === rawModelId) return;

    logger.info('Ensuring Claude Code session model matches UI selection', {
      sessionId: this.sessionId,
      configuredModel: this.config.model,
      rawModelId,
      previouslyApplied: this.appliedClaudeCodeModelId,
    });

    const result = await this.setModel(rawModelId);
    if (result.success) {
      this.appliedClaudeCodeModelId = rawModelId;
    } else {
      const logFn = result.unsupported ? logger.debug : logger.warn;
      logFn.call(logger, 'Failed to apply Claude Code model via ACP', {
        sessionId: this.sessionId,
        configuredModel: this.config.model,
        rawModelId,
        error: result.error,
      });
    }
  }

  /**
   * Attempt to recover a lost session by restarting the agent process and creating a new session.
   * This is called automatically when session-related errors are detected.
   * @returns true if recovery succeeded, false otherwise
   */
  private async attemptSessionRecoveryAndNotify(): Promise<boolean> {
    logger.info('Attempting session recovery', {
      oldSessionId: this.sessionId,
      recoveryAttempt: this.sessionRecoveryAttempts,
    });

    try {
      // Clear the old session ID
      const oldSessionId = this.sessionId;
      this.sessionId = undefined;

      // Check if the agent process is still alive
      if (!this.isAgentAlive()) {
        logger.info('Agent process not alive, restarting...');
        await this.launchAgent();
      }

      // Reinitialize the protocol and create a new session
      await this.initializeProtocol();

      // If session/load succeeded, the agent already has context — no history resend needed
      // Only set if there was a previous session we failed to resume — brand new agents have no history to resend
      if (!this.lastInitUsedSessionLoad && this.previousSessionId) {
        this.sessionWasRecreated = true;
      }

      logger.info('Session recovery successful', {
        oldSessionId,
        newSessionId: this.sessionId,
        recoveryAttempt: this.sessionRecoveryAttempts,
        usedSessionLoad: this.lastInitUsedSessionLoad,
      });

      return true;
    } catch (error) {
      logger.error('Session recovery failed', {
        error: error instanceof Error ? error.message : String(error),
        recoveryAttempt: this.sessionRecoveryAttempts,
      });
      return false;
    }
  }

  /**
   * Recover from a lost/stale workspace MCP tool registration (e.g. the model
   * called `workspace_api` but the session reports it as not found).
   *
   * Recreates the session — forcing session/new instead of session/load — so the
   * MCP servers and their tools re-register. Bounded by
   * MAX_WORKSPACE_TOOL_RECOVERY_ATTEMPTS to prevent restart loops, and guarded so
   * the many failed tool updates in a single broken turn only trigger one recovery.
   * For background agents the original prompt is auto-retried so the user does not
   * need to resend.
   */
  private async triggerWorkspaceToolRecovery(reason: string): Promise<void> {
    if (this.workspaceToolRecoveryInProgress) {
      return;
    }
    if (this.workspaceToolRecoveryAttempts >= this.MAX_WORKSPACE_TOOL_RECOVERY_ATTEMPTS) {
      logger.warn('Workspace MCP tool recovery budget exhausted; not retrying', {
        attempts: this.workspaceToolRecoveryAttempts,
        maxAttempts: this.MAX_WORKSPACE_TOOL_RECOVERY_ATTEMPTS,
        reason,
        sessionId: this.sessionId,
      });
      this.emitStatus(
        'mcp-recovery',
        'Workspace tools are unavailable. Try restarting the agent.',
        'error',
      );
      return;
    }

    this.workspaceToolRecoveryInProgress = true;
    this.workspaceToolRecoveryAttempts++;
    // Force a fresh session/new on the next initialization so MCP tools re-register.
    this.forceFreshSessionOnNextInit = true;

    this.emitStatus('mcp-recovery', 'Reconnecting workspace tools…', 'warn');
    logger.info('Workspace MCP tool missing — recreating session to re-register tools', {
      reason,
      recoveryAttempt: this.workspaceToolRecoveryAttempts,
      maxAttempts: this.MAX_WORKSPACE_TOOL_RECOVERY_ATTEMPTS,
      sessionId: this.sessionId,
    });

    try {
      const recovered = await this.attemptSessionRecoveryAndNotify();
      if (!recovered) {
        this.emitStatus('mcp-recovery', 'Failed to reconnect workspace tools.', 'error');
        return;
      }

      this.emitStatus('mcp-recovery', 'Workspace tools reconnected.', 'info');

      // Auto-retry only for background agents (mirrors session-loss recovery),
      // reusing the stored prompt so the user does not need to resend.
      const isBackground = this.config.metadata?.isBackground === true;
      if (isBackground && this.pendingRetry && !this.retryInProgress) {
        const { messages, options } = this.pendingRetry;
        this.pendingRetry = undefined;
        const completionSessionId = this.frontendSessionId || this.sessionId;
        if (completionSessionId) {
          this.cleanupStreamingCallback(completionSessionId);
        }
        setTimeout(() => {
          void this.streamMessage(messages, options).catch((retryError) => {
            logger.error('Auto-retry after workspace MCP tool recovery failed', {
              error: retryError instanceof Error ? retryError.message : String(retryError),
              recoveryAttempt: this.workspaceToolRecoveryAttempts,
            });
          });
        }, 250);
      }
    } catch (error) {
      this.emitStatus('mcp-recovery', 'Failed to reconnect workspace tools.', 'error');
      logger.error('Workspace MCP tool recovery failed', {
        error: error instanceof Error ? error.message : String(error),
        recoveryAttempt: this.workspaceToolRecoveryAttempts,
      });
    } finally {
      this.workspaceToolRecoveryInProgress = false;
    }
  }

  private async sendRequest(request: any, customTimeout?: number): Promise<any> {
    // Don't retry initialization requests
    const isInitRequest = ['initialize', 'authenticate', 'session/new', 'session/load'].includes(request.method);

    if (isInitRequest) {
      return this.sendRequestInternal(request, customTimeout);
    }

    let lastError: any;
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      attempts++;
      try {
        return await this.sendRequestInternal(request, customTimeout);
      } catch (error) {
        lastError = error;
        if (attempts < maxAttempts) {
          const delay = Math.min(1000 * Math.pow(2, attempts - 1), 5000);
          logger.warn(`Retrying ${request.method} request`, {
            attempt: attempts,
            error: error instanceof Error ? error.message : String(error),
            delay,
            requestId: request.id,
          });
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw (
      lastError || new Error(`Failed to send ${request.method} request after ${attempts} attempts`)
    );
  }

  private async sendRequestInternal(request: any, customTimeout?: number): Promise<any> {
    return new Promise((resolve, reject) => {
      // Set up timeout - use custom timeout if provided, otherwise use defaults
      const CHECK_INTERVAL_MS = 5000;
      const MAX_WAIT_MS = 90000; // 90s — aligns with PR 189 latency UI messaging
      const maxWaitMs = Math.max(customTimeout ?? MAX_WAIT_MS, 1000); // floor at 1s
      const intervalMs = Math.min(CHECK_INTERVAL_MS, maxWaitMs);
      const startTime = Date.now();
      const timeout = setInterval(() => {
        if (Date.now() - startTime >= maxWaitMs) {
          this.pendingRequests.delete(request.id);
          clearInterval(timeout);
          logger.error(`Request timeout for ${request.method}`, {
            requestId: request.id,
            method: request.method,
            processAlive: this.isAgentAlive(),
            elapsedMs: Date.now() - startTime,
            maxWaitMs,
          });
          reject(new Error(`Timeout waiting for response to ${request.method}`));
          return;
        }
        if (!this.isAgentAlive()) {
          this.pendingRequests.delete(request.id);
          clearInterval(timeout);
          logger.error(`Agent process died while waiting for ${request.method}`, {
            requestId: request.id,
            method: request.method,
            elapsedMs: Date.now() - startTime,
          });
          reject(new Error(`Agent process died while waiting for response to ${request.method}`));
          return;
        }
        logger.debug(`Waiting for response to ${request.method}...`);
      }, intervalMs);

      // Store pending request
      this.pendingRequests.set(request.id, {
        resolve,
        reject,
        timeout,
      });

      // Send request — sanitize surrogates to prevent invalid JSON (API 400s)
      const requestStr = `${sanitizeSurrogates(JSON.stringify(request))}\n`;
      if (this.writeToAgent(requestStr)) {
        logger.debug('Sending request to auggie', {
          method: request.method,
          id: request.id,
          length: requestStr.length,
          isRemote: this.isRemoteWorkspace(),
        });
      } else if (this.acpServer) {
        // Direct server call for testing
        this.acpServer
          .handleMessage(sanitizeSurrogates(JSON.stringify(request)))
          .then((response: string | null) => {
            if (response) {
              const parsed = JSON.parse(response);
              const pending = this.pendingRequests.get(request.id);
              if (pending) {
                clearInterval(pending.timeout);
                this.pendingRequests.delete(request.id);
                pending.resolve(parsed);
              }
            }
          })
          .catch((error: Error) => {
            const pending = this.pendingRequests.get(request.id);
            if (pending) {
              clearInterval(pending.timeout);
              this.pendingRequests.delete(request.id);
              pending.reject(error);
            }
          });
      } else {
        // No agent process or server available
        clearInterval(timeout);
        this.pendingRequests.delete(request.id);
        reject(new Error('No agent process or ACP server available'));
      }
    });
  }

  async sendMessage(messages: AgentMessage[]): Promise<AgentMessage> {
    if (!this.sessionId) {
      throw new Error('Provider not initialized');
    }

    const lastMessage = messages[messages.length - 1];

    // Calculate turn number based on user messages
    const turnNumber = messages.filter((m) => m.role === 'user').length;

    // Update environment variables for MCP server to get current turn
    if (this.agentProcess) {
      // Note: We can't directly update env vars of a running process
      // But we can pass this through the session metadata
      (this as any).currentTurnNumber = turnNumber;
    }

    logger.debug('Sending message', {
      sessionId: this.sessionId,
      role: lastMessage.role,
      totalMessages: messages.length,
      turnNumber,
    });

    // Filter out system messages - they should be passed as rules via --rules flag, not in the prompt
    // System messages are handled when launching auggie, not in the conversation
    const conversationMessages = messages.filter((m) => m.role !== 'system');

    // Get the current user message (the last one)
    // NOTE: We only send the current message to auggie, NOT the full conversation history.
    // Auggie's ACP session maintains conversation history internally via its AgentLoop.
    // See the comment in streamMessage() for full explanation.
    const currentMessage = conversationMessages[conversationMessages.length - 1];
    if (!currentMessage || currentMessage.role !== 'user') {
      throw new Error('Last message must be from user');
    }

    // Extract ALL text from contentBlocks (concatenates all text blocks)
    let currentContent = currentMessage.contentBlocks
      ? extractContentFromBlocks(currentMessage.contentBlocks)
      : '';

    // Extract file blocks and embed content directly in prompt text
    const fileBlocks = currentMessage.contentBlocks?.filter(
      (b): b is { type: 'file'; data: string; mimeType: string; fileName: string } =>
        b.type === 'file',
    );
    if (fileBlocks && fileBlocks.length > 0) {
      const fileNames = fileBlocks.map((f) => f.fileName).join(', ');
      currentContent += `\n\n---\n\n**ATTACHED FILE(S): ${fileNames}**\n\nThe user has attached ${fileBlocks.length} file(s) to this message.\n\n`;

      for (const fileBlock of fileBlocks) {
        const fileExtension = fileBlock.fileName.toLowerCase().match(/\.[^.]+$/)?.[0] || '';
        const isTextByExtension = TEXT_FILE_EXTENSIONS.includes(fileExtension as any);
        const isTextByMimeType =
          fileBlock.mimeType.startsWith('text/') ||
          fileBlock.mimeType === 'application/json' ||
          fileBlock.mimeType === 'application/javascript' ||
          fileBlock.mimeType === 'application/typescript';

        const isTextFile =
          isTextByMimeType ||
          (isTextByExtension && fileBlock.mimeType === 'application/octet-stream');

        if (isTextFile) {
          const textContent = Buffer.from(fileBlock.data, 'base64').toString('utf-8');
          const langHint = fileExtension.replace('.', '') || 'text';
          currentContent += `**File: ${fileBlock.fileName}**\n\`\`\`${langHint}\n${textContent}\n\`\`\`\n\n`;
        } else {
          // Save binary file to workspace metadata assets directory so the agent can access it
          const wsId = this.config.workspaceId || 'default';
          const savedPath = saveBinaryAttachmentToWorkspace(
            wsId,
            fileBlock.fileName,
            fileBlock.data,
          );
          if (savedPath) {
            currentContent += `**File: ${fileBlock.fileName}** (binary file, ${fileBlock.mimeType})\nThis file has been saved at: \`${savedPath}\`\nYou can read it at that absolute path.\n\n`;
          } else {
            currentContent += `**File: ${fileBlock.fileName}** (binary file, ${fileBlock.mimeType}) — could not save to disk.\n\n`;
          }
        }
      }
    }

    // For providers without rules-file support, inject our runtime rules bundle once so
    // Codex/Claude Code/OpenCode behave consistently with Auggie.
    currentContent = await this.maybeInjectRulesIntoPromptText(currentContent);

    // Build prompt content blocks including images
    const promptContentBlocks: Array<
      { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
    > = [{ type: 'text', text: currentContent }];

    // Extract and add image blocks from the current message
    const imageBlocks = currentMessage.contentBlocks?.filter(
      (b): b is { type: 'image'; data: string; mimeType: string } => b.type === 'image',
    );
    if (imageBlocks && imageBlocks.length > 0) {
      for (const imageBlock of imageBlocks) {
        promptContentBlocks.push({
          type: 'image',
          data: imageBlock.data,
          mimeType: imageBlock.mimeType,
        });
        const dims = getImageDimensionsFromBase64(imageBlock.data, imageBlock.mimeType);
        const estimatedTokens = dims ? Math.ceil((dims.width * dims.height) / 750) : null;
        logger.info('Image block added to ACP prompt (non-streaming)', {
          sessionId: this.sessionId,
          mimeType: imageBlock.mimeType,
          dataLength: imageBlock.data?.length || 0,
          width: dims?.width ?? 'unknown',
          height: dims?.height ?? 'unknown',
          estimatedTokens: estimatedTokens ?? 'unknown',
        });
      }
    }

    logger.info('Sending message to ACP agent (non-streaming, session maintains history)', {
      sessionId: this.sessionId,
      messageCount: messages.length,
      promptLength: currentContent.length,
      hasSystemPrompt: !!this.config.systemPrompt,
      hasImages: imageBlocks && imageBlocks.length > 0,
    });

    // Auggie >= 0.23.0 handles MCP init waiting internally (PR #49152).
    // For older versions, use a blind sleep as fallback.
    if (!this.supportsMcpInitWait()) {
      const MCP_INIT_WAIT_MS = 5000; // conservative default for old auggie
      logger.info('Old auggie version — applying MCP init sleep fallback', {
        agentVersion: this.agentVersion,
        waitMs: MCP_INIT_WAIT_MS,
      });
      await new Promise((resolve) => setTimeout(resolve, MCP_INIT_WAIT_MS));
    }

    // Claude Code: ensure selected model is actually applied to the current session.
    await this.ensureClaudeCodeModelApplied();

    // Send prompt request - auggie expects an array of content blocks
    this.emitStatus('prompt', 'Sent prompt…');
    const promptRequest = {
      jsonrpc: '2.0',
      method: 'session/prompt',
      params: {
        sessionId: this.sessionId,
        prompt: promptContentBlocks,
      },
      id: ++this.requestId,
    };

    // Log the full request for debugging
    logger.debug('Sending prompt request with params:', {
      sessionId: this.sessionId,
      messageCount: messages.length,
      promptLength: currentContent.length,
      promptFormat: 'array of content blocks',
    });

    const response = await this.sendRequest(promptRequest);

    if (response?.error) {
      // Log sanitized error diagnostics only. Do NOT log response.error.data.prompt
      // or response.error.data.details directly — they can embed prompt content,
      // tool_result payloads, or workspace file contents from the provider's
      // echoed request body. summarizeProviderErrorForLog() extracts the safe
      // fields (httpStatus/apiStatus/requestId/errorDetails).
      logger.error('Prompt request failed', {
        sessionId: this.sessionId,
        requestId: promptRequest.id,
        error: summarizeProviderErrorForLog(response.error),
      });
      throw new Error(response.error.message || 'Invalid params');
    }

    logger.debug('Prompt response received successfully');

    // Parse the ACP response content into structured blocks
    const contentBlocks = parseACPMessage(response?.result?.content || []);

    // Extract tool calls for metadata
    const toolCalls = extractACPToolCalls(response?.result?.content || []);

    // Note: AgentMessage here is aliased to ProviderMessage which doesn't have id/timestamp
    // The caller is responsible for adding those fields when needed
    return {
      role: 'assistant',
      contentBlocks: contentBlocks || [],
      metadata: {
        sessionId: this.sessionId,
        stopReason: response?.result?.stopReason,
        toolCalls, // Store extracted tool calls
      },
    };
  }

  /**
   * Set the session model via ACP session/set_model
   * This changes the model used for subsequent messages in this session
   */
  async setModel(
    modelId: string,
  ): Promise<{ success: boolean; modelId?: string; error?: string; unsupported?: boolean }> {
    if (!this.sessionId) {
      logger.warn('Cannot set model - no active session');
      return { success: false, error: 'No active session' };
    }

    logger.info('Setting ACP session model', {
      sessionId: this.sessionId,
      modelId,
    });

    try {
      const caps = this.providerCapabilities;
      const candidateMethods =
        caps.id === 'claude-code'
          ? // Claude Code adapters have used both a custom unstable method and the standard ACP method.
            ['unstable_setSessionModel', 'session/set_model']
          : ['session/set_model'];

      // Skip methods that this adapter has previously rejected with
      // "Method not found" — avoids the WARN log spam every turn.
      const methodsToTry = candidateMethods.filter((m) => !this.unsupportedAcpMethods.has(m));

      if (methodsToTry.length === 0) {
        logger.debug('Skipping set-model request: no supported ACP method for this adapter', {
          providerId: caps.id,
          modelId,
          skipped: candidateMethods,
        });
        return {
          success: false,
          unsupported: true,
          error: 'No supported set-model method for this adapter',
        };
      }

      let lastError: any = null;
      let allMethodNotFound = true;
      for (const method of methodsToTry) {
        const setModelRequest = {
          jsonrpc: '2.0' as const,
          method,
          params: {
            sessionId: this.sessionId,
            modelId,
          },
          id: ++this.requestId,
        };

        const response = await this.sendRequest(setModelRequest, 5000);
        if (!response?.error) {
          // Update config so session recovery / restart uses the new model.
          // config.model stores the *compound* ID (e.g. "opencode:openrouter/...") so
          // that parseCompoundModelId in createSession() resolves the correct provider.
          // modelId here is the raw slug — re-compose the compound form.
          const defaultProvider = getDefaultProviderId();
          this.config.model =
            caps.id !== defaultProvider ? createCompoundModelId(caps.id, modelId) : modelId;
          const providerEnv = buildProviderEnv(caps.id, modelId);
          if (Object.keys(providerEnv).length > 0) {
            this.config.env = { ...(this.config.env || {}), ...providerEnv };
          }

          logger.info('ACP session model set successfully', {
            sessionId: this.sessionId,
            modelId,
            method,
          });

          // Emit event for model change
          this.emit('model:changed', {
            sessionId: this.sessionId,
            modelId,
          });

          return { success: true, modelId };
        }

        lastError = response.error;
        // If method doesn't exist, try next fallback (common for Claude Code adapters).
        const code = response.error?.code;
        const message = response.error?.message || '';
        const isMethodNotFound =
          code === -32601 || (typeof message === 'string' && message.includes('Method not found'));
        // Do NOT log the raw response.error object: its `data.details` can
        // embed the raw HTTP response body (tool outputs, prompt echoes,
        // file contents). Use summarizeProviderErrorForLog to keep only
        // the safe diagnostic fields (code/message/httpStatus/apiStatus/
        // errorDetails.{code,detail}) while redacting data.details.
        if (isMethodNotFound) {
          // Remember that this adapter doesn't implement the method so future
          // setModel calls skip it entirely. Demote the log level — this is
          // an expected condition on adapters without the optional method.
          this.unsupportedAcpMethods.add(method);
          logger.debug('ACP adapter does not implement set-model method; caching as unsupported', {
            providerId: caps.id,
            method,
            modelId,
          });
        } else {
          logger.warn('Failed to set model via ACP', {
            providerId: caps.id,
            method,
            modelId,
            error: summarizeProviderErrorForLog(response.error),
            isMethodNotFound,
          });
          allMethodNotFound = false;
          break;
        }
      }

      if (allMethodNotFound && methodsToTry.length > 0) {
        return {
          success: false,
          unsupported: true,
          error: 'No supported set-model method for this adapter',
        };
      }

      return { success: false, error: lastError?.message || 'Failed to set model' };
    } catch (error) {
      logger.error('Error setting model', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Mark that the session was recreated and needs to send full conversation history
   * on the next message. This is used when:
   * - A new provider is created for an existing agent with message history
   * - The agent process died and was restarted
   * - The ACP session was lost and recreated
   */
  markSessionRecreated(): void {
    this.sessionWasRecreated = true;
    logger.info('Session marked as recreated - will send full history on next message', {
      sessionId: this.sessionId,
      agentId: this.config.id || this.config.agentId,
    });
  }

  /**
   * Whether the last protocol initialization used session/load to restore
   * an existing session. When true, the agent already has conversation
   * context and a full history resend is unnecessary.
   */
  override didUseSessionLoad(): boolean {
    return this.lastInitUsedSessionLoad;
  }

  /**
   * Reset the session for edit/regenerate flows.
   * Creates a new ACP session to clear internal history, so the agent only sees
   * the truncated messages we pass in the next streamMessage call.
   *
   * Unlike interrupt(), this doesn't cancel the current request - it's used
   * when we're starting a fresh request with modified history.
   *
   * OPTIMIZATION: If sessionWasRecreated is already true, the session was just
   * recreated by interrupt() and is already fresh - no need to create another one.
   * This prevents the double session creation race condition that can cause
   * "process died immediately after spawn" errors during edit/regenerate flows.
   */
  async resetSession(userTurnsToRemove: number = 1): Promise<void> {
    if (!this.sessionCreationParams) {
      logger.warn('Cannot reset session - no session creation params');
      return;
    }

    // OPTIMIZATION: Skip if session was just recreated by interrupt()
    // This prevents double session creation which can cause timing issues
    if (this.sessionWasRecreated) {
      logger.info('Skipping resetSession - session was just recreated by interrupt()', {
        sessionId: this.sessionId,
        agentId: this.config.id || this.config.agentId,
      });
      return;
    }

    const oldSessionId = this.sessionId;
    const isRemoteWorkspace = this.isRemoteWorkspace();
    const isAuggie = this.providerCapabilities.id === 'auggie';
    const shouldUseTrimmedReload = isAuggie && !isRemoteWorkspace && this.supportsSessionLoad() && !!oldSessionId;
    logger.info('Resetting ACP session for edit/regenerate flow', {
      oldSessionId,
      agentId: this.config.id || this.config.agentId,
      userTurnsToRemove,
      supportsSessionLoad: this.supportsSessionLoad(),
      isRemoteWorkspace,
      willUseTrimmedReload: shouldUseTrimmedReload,
    });

    if (isAuggie && isRemoteWorkspace && this.supportsSessionLoad() && oldSessionId) {
      logger.info(
        'Skipping trim+load reset optimization for remote workspace - falling back to fresh session',
        {
          oldSessionId,
          agentId: this.config.id || this.config.agentId,
        },
      );
    }

    // For local auggie sessions with session/load support: trim the session file and reload
    // instead of creating a new session + sending XML history
    if (shouldUseTrimmedReload) {
      try {
        // Trim the session file to remove the last N user turns
        const trimmedSessionId = trimSession(oldSessionId, userTurnsToRemove);
        logger.info('Session trimmed successfully', {
          oldSessionId,
          trimmedSessionId,
          userTurnsToRemove,
        });

        // Set the trimmed session as the previous session so tryLoadPreviousSession() uses it
        this.previousSessionId = trimmedSessionId;

        // Kill the agent process and relaunch — auggie can't load a different session
        // on the same process while one is active
        await this.stopAgentProcess();
        await this.launchAgent();
        await this.initializeProtocol();

        // Reset flags after successful restart
        this.isRestartingProcess = false;
        this.isStoppingIntentionally = false;

        // Check if session/load succeeded during initializeProtocol
        if (this.lastInitUsedSessionLoad) {
          // Success! The agent loaded the trimmed session — no XML history needed
          logger.info('Session trim+load succeeded — no XML history resend needed', {
            oldSessionId,
            trimmedSessionId,
            newSessionId: this.sessionId,
          });

          // Clean up the original (pre-trim) session file to prevent disk space leaks
          try {
            const origPath = path.join(os.homedir(), '.augment', 'sessions', `${oldSessionId}.json`);
            fs.unlinkSync(origPath);
            logger.info('Cleaned up original session file after successful trim', {
              oldSessionId,
              trimmedSessionId,
            });
          } catch (cleanupError) {
            // Non-fatal — auggie may clean this up on its own
            logger.debug('Failed to clean up original session file (non-fatal)', {
              oldSessionId,
              error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
            });
          }

          return;
        }

        // session/load failed during init — fall through to legacy path
        logger.warn('Session trim succeeded but session/load failed during init — falling back to XML history', {
          oldSessionId,
          trimmedSessionId,
        });
        this.sessionWasRecreated = true;
        return;
      } catch (trimError) {
        logger.warn('Session trim+load failed - falling back to fresh session', {
          agentId: this.config.agentId,
          oldSessionId,
          error: trimError instanceof Error ? trimError.message : String(trimError),
        });

        // Reset flags and disable session/load for the fallback path.
        // We want a fresh ACP session that will receive truncated XML history.
        this.isRestartingProcess = false;
        this.isStoppingIntentionally = false;
        this.lastInitUsedSessionLoad = false;
        this.previousSessionId = undefined;
        this.sessionId = undefined;

        try {
          if (this.isAgentAlive()) {
            await this.stopAgentProcess();
          }

          await this.launchAgent();
          await this.initializeProtocol();

          this.sessionWasRecreated = true;
          logger.info(
            'ACP session reset fallback complete after trim+load failure - will send full history on next message',
            {
              oldSessionId,
              newSessionId: this.sessionId,
            },
          );
          return;
        } catch (fallbackError) {
          logger.error('Failed to recover with fresh session after trim+load failure', {
            oldSessionId,
            error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          });
          throw fallbackError;
        }
      }
    }

    // Legacy path: create a new session and mark for XML history resend
    try {
      if (!this.isAgentAlive()) {
        logger.warn('Agent not running during resetSession - relaunching before creating fresh session', {
          oldSessionId,
          agentId: this.config.id || this.config.agentId,
        });
        this.lastInitUsedSessionLoad = false;
        this.previousSessionId = undefined;
        this.sessionId = undefined;
        await this.launchAgent();
        await this.initializeProtocol();
      } else {
        // Create a new session (this assigns a new sessionId)
        await this.createSession();
      }

      // Mark that session was recreated - this ensures we send full history
      // (the truncated history) in the prompt on the next message
      this.sessionWasRecreated = true;

      logger.info('ACP session reset complete - will send full history on next message', {
        oldSessionId,
        newSessionId: this.sessionId,
      });
    } catch (error) {
      logger.error('Failed to reset session', {
        error: error instanceof Error ? error.message : String(error),
        oldSessionId,
      });
      // Re-throw so the caller knows it failed
      throw error;
    }
  }

  /**
   * Interrupt the agent (stop current execution but keep process alive)
   */
  async interrupt(): Promise<void> {
    logger.info('ACP provider interrupt() called', {
      hasSessionId: !!this.sessionId,
      hasAgentProcess: !!this.agentProcess,
      pid: this.agentProcess?.pid,
      isStreaming: this.isStreaming,
      activeStreamingCallbacks: Array.from(this.streamingCallbacks.keys()),
    });

    // CRITICAL FIX: Complete any active streams BEFORE doing anything else.
    // This prevents a race condition where:
    // 1. We send session/cancel to Auggie
    // 2. We create a new session
    // 3. User sends a new message, registering new callbacks with same frontendSessionId
    // 4. Auggie's cancelled response arrives, finds the NEW callbacks, completes them
    // 5. Result: The new stream is immediately completed with "cancelled" stopReason
    // 6. More chunks arrive, no streaming message exists, a NEW message is created
    // 7. User sees TWO messages ("two split streams" bug)
    //
    // By completing active streams FIRST and cleaning up callbacks,
    // Auggie's cancelled response (when it eventually arrives) won't find any callbacks
    // to incorrectly complete.
    const completionSessionId = this.frontendSessionId || this.sessionId;
    if (completionSessionId && this.streamingCallbacks.has(completionSessionId)) {
      logger.info('Completing active stream before interrupt', {
        sessionId: completionSessionId,
        frontendSessionId: this.frontendSessionId,
        internalSessionId: this.sessionId,
      });
      // Complete synchronously (don't await) to ensure cleanup happens before we continue
      // Use try-catch to ensure interrupt continues even if completion fails
      try {
        await this.handleStreamCompletion(completionSessionId, 'cancelled');
      } catch (error) {
        logger.warn('Error completing stream during interrupt', {
          error: (error as Error).message,
          sessionId: completionSessionId,
        });
      }
    }

    // Increment stream generation AFTER completing the old stream.
    // This ensures that if Auggie's cancelled response arrives later,
    // we can detect it's from an old generation and ignore it.
    this.streamGeneration++;
    logger.debug('Incremented stream generation after interrupt', {
      newGeneration: this.streamGeneration,
    });

    // Cancel session if active
    if (this.sessionId && this.isAgentAlive()) {
      const oldSessionId = this.sessionId;
      logger.info('Sending session/cancel notification', { sessionId: oldSessionId });
      const cancelNotification = {
        jsonrpc: '2.0' as const,
        method: 'session/cancel',
        params: {
          sessionId: oldSessionId,
        },
      };

      if (!this.writeToAgent(`${JSON.stringify(cancelNotification)}\n`)) {
        logger.warn('Failed to send cancel notification');
      } else {
        logger.info('session/cancel notification sent');
        // For auggie < 0.18.0: Wait for Auggie to process the cancel before continuing.
        // Without this delay, the sequence session/cancel -> session/new -> session/prompt
        // happens too fast and Auggie may not properly transition out of the cancelled state,
        // causing it to not respond to new prompts.
        // For auggie >= 0.18.0: cancel is non-destructive, no delay needed.
        if (!this.supportsNonDestructiveCancel()) {
          await new Promise((resolve) => setTimeout(resolve, 200));
          logger.debug('Waited 200ms for Auggie to process cancel');
        }
      }

      // Clear pending requests as they won't complete
      for (const [, pending] of this.pendingRequests) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('Agent interrupted'));
      }
      this.pendingRequests.clear();

      // Reset streaming state
      this.isStreaming = false;
      this.currentStreamingRequestId = null;

      // For auggie >= 0.18.0, session/cancel is non-destructive — the session stays alive
      // and can accept new prompts. No need to create a new session or resend history.
      if (this.supportsNonDestructiveCancel()) {
        // Track interrupt time for stuck detection
        this.lastInterruptTime = Date.now();
        logger.info('Non-destructive cancel — keeping existing session', {
          sessionId: oldSessionId,
          agentVersion: this.agentVersion,
          lastInterruptTime: this.lastInterruptTime,
        });
      } else if (this.sessionCreationParams) {
        // Mark the old session as cancelled to reject stale events during createSession()
        if (oldSessionId && this.streamingHandler) {
          this.streamingHandler.markSessionCancelled(oldSessionId);
        }

        // CRITICAL FIX (auggie < 0.18.0): Create a new session after cancelling the old one.
        // When we send session/cancel, the Auggie backend marks that session as cancelled.
        // If we then send a new prompt to the SAME session, Auggie will immediately
        // return stopReason="cancelled" because the session is in a cancelled state.
        // By creating a new session, we ensure subsequent messages are sent to a fresh
        // session that doesn't have the cancelled state.
        try {
          logger.info('Creating new session after interrupt', { oldSessionId });
          await this.createSession();
          // Mark that session was recreated - need to send full history on next message
          this.sessionWasRecreated = true;
          // Track interrupt time for stuck detection
          this.lastInterruptTime = Date.now();
          logger.info('New session created after interrupt - will send full history', {
            oldSessionId,
            newSessionId: this.sessionId,
            lastInterruptTime: this.lastInterruptTime,
          });
        } catch (error) {
          logger.error('Failed to create new session after interrupt', { error, oldSessionId });
          // CRITICAL FIX: Even though createSession() failed, we must:
          // 1. Set sessionWasRecreated = true to prevent resetSession() from also calling
          //    createSession(), which would double the timeout wait (the user already waited
          //    once for the timeout above — don't make them wait again).
          // 2. Clear sessionId because the old session was cancelled (session/cancel sent above)
          //    and is unusable. Leaving the stale ID causes sendMessage to send prompts to a
          //    cancelled session that will never respond.
          //    With sessionId cleared, sendMessage() detects the missing session and calls
          //    initializeProtocol() to create a fresh one.
          this.sessionWasRecreated = true;
          this.sessionId = undefined;
        }
      }
    } else {
      logger.warn('No active session to interrupt', {
        hasSessionId: !!this.sessionId,
        agentAlive: this.isAgentAlive(),
      });
    }
  }

  async stop(options?: { forceCleanup?: boolean }): Promise<void> {
    const forceCleanup = options?.forceCleanup ?? false;

    logger.info('ACP provider stop() called', {
      hasSessionId: !!this.sessionId,
      hasAcpServer: !!this.acpServer,
      hasAgentProcess: !!this.agentProcess,
      hasRemoteProcess: !!this.remoteProcess,
      sessionId: this.sessionId,
      agentId: this.config.agentId,
      forceCleanup,
    });

    // Always mark as intentional stop to prevent handleProcessExit from restarting the agent.
    // Both forceCleanup (workspace deletion) and non-forceCleanup (model fallback) are intentional stops.
    // Without this, killed processes are treated as unexpected exits and get restarted unnecessarily.
    this.isStoppingIntentionally = true;

    // Cancel session if active
    if (this.sessionId && this.acpServer) {
      logger.info('Sending session/cancel notification', { sessionId: this.sessionId });
      const cancelNotification = {
        jsonrpc: '2.0' as const,
        method: 'session/cancel',
        params: {
          sessionId: this.sessionId,
        },
      };

      // Send cancel to remote or local process
      if (this.remoteProcess && this.remoteProcess.isAlive()) {
        this.remoteProcess.write(`${JSON.stringify(cancelNotification)}\n`);
        logger.info('session/cancel notification sent to remote');
      } else if (this.agentProcess?.stdin && this.agentProcess.stdin.writable) {
        this.agentProcess.stdin.write(`${JSON.stringify(cancelNotification)}\n`);
        logger.info('session/cancel notification sent');
      } else {
        logger.warn('No stdin available to send cancel notification');
      }
    } else {
      logger.warn('No active session to cancel', {
        hasSessionId: !!this.sessionId,
        hasAcpServer: !!this.acpServer,
      });
    }

    // Clean up SSH disconnect listener
    if (this.sshDisconnectHandler) {
      sshManager.removeListener('disconnected', this.sshDisconnectHandler);
      this.sshDisconnectHandler = undefined;
    }

    // Kill remote agent process and disconnect SSH
    if (this.remoteProcess) {
      logger.info('Killing remote agent process');
      this.remoteProcess.kill();
      this.remoteProcess = undefined;
      logger.info('Remote agent process killed');

      // Disconnect SSH
      if (this.sshConnectionId) {
        logger.info('Disconnecting SSH connection', { connectionId: this.sshConnectionId });
        await sshManager.disconnect(this.sshConnectionId).catch((err) => {
          logger.warn('Error disconnecting SSH', { error: err });
        });
        this.sshConnectionId = undefined;
      }
    }

    // Kill local agent process and its entire process tree
    // CRITICAL: Use killChildProcessTree instead of child.kill() because npx/npm-exec
    // spawns a child process that child.kill() doesn't reach, causing orphaned processes
    if (this.agentProcess) {
      logger.info('Killing agent process tree', { pid: this.agentProcess.pid });
      // Remove all stream listeners before killing to prevent orphaned native handles
      // that can cause SIGSEGV in AsyncWrap::~AsyncWrap() during GC
      this.agentProcess.removeAllListeners('exit');
      this.agentProcess.removeAllListeners('error');
      this.agentProcess.stdout?.removeAllListeners();
      this.agentProcess.stderr?.removeAllListeners();
      this.agentProcess.stdin?.removeAllListeners();
      await killChildProcessTree(this.agentProcess);
      this.agentProcess = undefined;
      logger.info('Agent process tree killed');
    }

    // Dispose server
    if (this.acpServer) {
      logger.info('Disposing ACP server');
      await this.acpServer.dispose();
      this.acpServer = undefined;
      logger.info('ACP server disposed');
    } else {
      logger.warn('No ACP server to dispose');
    }

    this.sessionId = undefined;
    this.currentStreamingRequestId = null;
    this.streamParser.reset();

    // If force cleanup is requested (e.g., workspace deletion), clean up all streaming callbacks
    // This prevents the "janky hang" where streams are kept alive waiting for model fallback
    // that will never happen because the workspace is being deleted.
    if (forceCleanup) {
      logger.info('Force cleanup requested - cleaning up all streaming callbacks', {
        activeStreams: this.streamingCallbacks.size,
        agentId: this.config.agentId,
      });

      // Complete all streams with a 'provider_stopped' reason
      for (const [sessionId] of this.streamingCallbacks) {
        this.handleStreamCompletion(sessionId, 'provider_stopped');
      }

      // Clear any remaining callbacks that weren't cleaned up by handleStreamCompletion
      this.streamingCallbacks.clear();

      // Also clear the health check interval if it exists
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
        this.healthCheckInterval = undefined;
      }

      // NOTE: Do NOT reset isStoppingIntentionally here.
      // handleProcessExit fires asynchronously (after stop() completes) and needs to see
      // isStoppingIntentionally=true to avoid restarting the killed agent process.
      // Since forceCleanup is only used for terminal operations (workspace deletion,
      // dispose, app shutdown), the provider won't be reused anyway.
    }

    logger.info('ACP provider stop() completed', { forceCleanup });
  }

  // ===========================================================================
  // Idle timeout — kill auggie process to reclaim memory when not in use
  // ===========================================================================

  /**
   * Reset (or start) the idle timer. Call this whenever the agent finishes work
   * (streaming completes, request finishes) so the clock restarts.
   */
  private resetIdleTimer(): void {
    this.clearIdleTimer();

    this.idleTimer = setTimeout(() => {
      // Safety: don't kill if we're actively streaming or have pending requests
      if (this.isStreaming || this.pendingRequests.size > 0) {
        logger.debug('Idle timeout fired but agent is busy — rescheduling', {
          agentId: this.config.agentId,
          isStreaming: this.isStreaming,
          pendingRequests: this.pendingRequests.size,
        });
        this.resetIdleTimer();
        return;
      }

      if (!this.isAgentAlive()) {
        logger.debug('Idle timeout fired but agent process is already dead', {
          agentId: this.config.agentId,
        });
        return;
      }

      logger.info('Killing idle auggie process to reclaim memory', {
        agentId: this.config.agentId,
        pid: this.agentProcess?.pid,
        timeoutMs: IDLE_TIMEOUT_CONFIG.IDLE_TIMEOUT_MS,
      });

      // stopAgentProcess sets isRestartingProcess/isStoppingIntentionally which
      // prevents handleProcessExit from auto-restarting.
      this.stopAgentProcess().catch((err) => {
        logger.warn('Failed to stop idle agent process', {
          agentId: this.config.agentId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, IDLE_TIMEOUT_CONFIG.IDLE_TIMEOUT_MS);

    // Prevent the timer from keeping the Node.js event loop alive
    // (important so the app can exit cleanly without waiting for the timeout)
    if (this.idleTimer.unref) {
      this.idleTimer.unref();
    }
  }

  /**
   * Clear the idle timer (e.g. when the agent becomes active or on dispose).
   */
  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
  }

  /**
   * Stop the agent process only (without disposing the provider).
   * Used for recovery from stuck states where we need to restart the agent.
   */
  private async stopAgentProcess(): Promise<void> {
    logger.info('Stopping agent process for recovery', {
      hasAgentProcess: !!this.agentProcess,
      hasRemoteProcess: !!this.remoteProcess,
      pid: this.agentProcess?.pid,
    });

    // Clear idle timer — the process is being killed explicitly
    this.clearIdleTimer();

    // Mark as restarting to prevent handleProcessExit from doing its own restart
    // This is important because handleProcessExit fires asynchronously when the process exits
    this.isRestartingProcess = true;
    // Also mark as intentional to prevent error callbacks during the kill
    this.isStoppingIntentionally = true;

    // Kill remote agent process
    if (this.remoteProcess) {
      logger.info('Killing remote agent process for recovery');
      this.remoteProcess.kill();
      this.remoteProcess = undefined;
    }

    // Kill local agent process tree
    if (this.agentProcess) {
      const pid = this.agentProcess.pid;
      logger.info('Killing local agent process tree for recovery', { pid });
      // Remove all stream listeners before killing to prevent orphaned native handles
      // that can cause SIGSEGV in AsyncWrap::~AsyncWrap() during GC
      this.agentProcess.removeAllListeners('exit');
      this.agentProcess.removeAllListeners('error');
      this.agentProcess.stdout?.removeAllListeners();
      this.agentProcess.stderr?.removeAllListeners();
      this.agentProcess.stdin?.removeAllListeners();
      await killChildProcessTree(this.agentProcess);
      // Wait a bit for process tree to fully terminate
      await new Promise((resolve) => setTimeout(resolve, 200));
      // Deregister from global registry — exit listeners were removed so handleProcessExit won't fire
      if (pid) {
        deregisterProcess(pid);
      }
      this.agentProcess = undefined;
    }

    // Clear pending requests
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
    }
    this.pendingRequests.clear();

    // Clear session state
    this.sessionId = undefined;
    this.currentStreamingRequestId = null;
    this.streamParser.reset();

    // Reset streaming state
    this.isStreaming = false;

    // Note: We do NOT reset isRestartingProcess or isStoppingIntentionally here.
    // They will be reset after launchAgent() succeeds in the caller.
    // This ensures handleProcessExit (which may still fire) doesn't interfere.

    logger.info('Agent process stopped for recovery');
  }

  async dispose(): Promise<void> {
    // Dispose streaming handler if exists
    if (this.streamingHandler) {
      this.streamingHandler.dispose();
      this.streamingHandler = undefined;
    }

    // Clear stalled stream check interval
    if (this.stalledStreamCheckInterval) {
      clearInterval(this.stalledStreamCheckInterval);
      this.stalledStreamCheckInterval = undefined;
    }

    // Clear health check interval
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }

    // Clear idle timer
    this.clearIdleTimer();

    // Clear all timers
    this.streamCompletionTimers.forEach((timer) => clearTimeout(timer));
    this.streamCompletionTimers.clear();

    // Clear all streaming callbacks
    this.streamingCallbacks.clear();

    // Clear current streaming request ID
    this.currentStreamingRequestId = null;

    // Use forceCleanup: true since dispose means we're fully cleaning up
    await this.stop({ forceCleanup: true });
  }

  /**
   * Monitor connection health and detect stalled streams
   */
  private monitorConnectionHealth(): void {
    if (!this.agentProcess) return;

    // Monitor stdout health
    if (this.agentProcess.stdout) {
      this.agentProcess.stdout.on('error', (error) => {
        logger.error('Stdout error - streams may be interrupted', { error });
        this.handleConnectionError(error);
      });

      this.agentProcess.stdout.on('end', () => {
        logger.warn('Stdout ended unexpectedly');
        this.handleConnectionEnd();
      });
    }

    // Monitor stdin health
    if (this.agentProcess.stdin) {
      this.agentProcess.stdin.on('error', (error) => {
        logger.error('Stdin error - cannot send to agent', { error });
        this.handleConnectionError(error);
      });
    }

    // Start heartbeat monitoring for active streams
    this.stalledStreamCheckInterval = setInterval(() => {
      this.checkForStalledStreams();
    }, this.STREAM_CHECK_INTERVAL_MS);
  }

  /**
   * Check for stalled streams and attempt recovery
   * Maximum retries before showing error to user
   */
  private checkForStalledStreams(): void {
    const now = Date.now();
    // Use shared constant for max retries
    const maxStallRetries = AGENT_STREAMING_CONFIG.MAX_STALL_RETRIES;

    this.streamingCallbacks.forEach((callbacks, sessionId) => {
      const timeSinceLastActivity = now - (callbacks.lastActivityTime || now);
      const streamDuration = now - (callbacks.streamStartTime || now);

      // Get retry count for progressive backoff
      const retryCount = this.stalledStreamRetryCount.get(sessionId) || 0;

      // Skip streams that have already shown the stall error
      // We use maxStallRetries + 100 as a sentinel value meaning "error shown, waiting for user action"
      if (retryCount > maxStallRetries) {
        // Already showed error, waiting for user to stop or activity to resume
        return;
      }

      const timeoutWithBackoff = this.STALLED_STREAM_TIMEOUT_MS * Math.pow(1.5, retryCount);

      // If no activity for configured timeout (with backoff), consider stream stalled
      if (timeSinceLastActivity > timeoutWithBackoff) {
        logger.warn('Stream appears stalled', {
          sessionId,
          timeSinceLastActivity,
          timeoutMs: timeoutWithBackoff,
          retryCount,
          maxRetries: maxStallRetries,
          chunksReceived: callbacks.chunksReceived || 0,
          streamDurationMs: streamDuration,
        });

        // Check if we've exceeded max retries - show error to user
        if (retryCount >= maxStallRetries) {
          logger.error('Stream stalled after max retries - showing error to user', {
            sessionId,
            retryCount,
            chunksReceived: callbacks.chunksReceived || 0,
            streamDurationMs: streamDuration,
          });

          // Show helpful error message in the chat panel
          const minutesStalled = Math.round(timeSinceLastActivity / 60000);
          const errorMessage = `\n\n---\n\n⚠️ **No response for ${minutesStalled} minute${minutesStalled !== 1 ? 's' : ''}**\n\nThe agent may still be working. You can **wait**, **stop** and retry, or **refresh** the app.\n\n---\n\n`;

          // Send error message to chat via onChunk so user sees it
          if (callbacks.onChunk) {
            callbacks.onChunk(errorMessage);
          }

          // Also trigger onError so the UI can show error state
          // But DON'T call handleStreamCompletion - let the user decide what to do
          if (callbacks.onError) {
            callbacks.onError(
              new Error(
                `No response for ${minutesStalled} minute${minutesStalled !== 1 ? 's' : ''}. You can wait or stop and try again.`,
              ),
            );
          }

          // Mark the stream as having shown the stall error to prevent spamming
          // Use a high retry count that will be reset if activity resumes
          // We use maxStallRetries + 100 as a sentinel value meaning "error shown, don't retry"
          this.stalledStreamRetryCount.set(sessionId, maxStallRetries + 100);
          return;
        }

        // Increment retry count
        this.stalledStreamRetryCount.set(sessionId, retryCount + 1);

        // Attempt recovery
        this.attemptStreamRecovery(sessionId);
      }
    });
  }

  /**
   * Handle connection errors
   */
  private handleConnectionError(error: Error): void {
    logger.error('Connection error detected', { error: error.message });

    // Notify all active streams of the error
    this.streamingCallbacks.forEach((callbacks) => {
      if (callbacks.onError) {
        callbacks.onError(new Error(`Connection lost: ${error.message}`));
      }

      // Save partial content - SessionManager has the accumulated content
      // We don't need to save it here
    });
  }

  /**
   * Handle unexpected connection end
   */
  private handleConnectionEnd(): void {
    // If we're intentionally stopping (e.g., for model fallback), don't complete streams
    // The process will be restarted with a new model and the stream will continue
    if (this.isStoppingIntentionally) {
      logger.info(
        'Connection ended but isStoppingIntentionally=true - not completing streams (model fallback in progress)',
      );
      return;
    }

    logger.warn('Connection ended unexpectedly');

    // Complete all active streams with accumulated content
    // Use Promise.all to await all async onComplete callbacks before cleanup
    const completionPromises: Promise<void>[] = [];

    this.streamingCallbacks.forEach((callbacks, callbackSessionId) => {
      if (callbacks.onComplete) {
        // Try to get accumulated content
        let finalContent = '';
        let finalContentBlocks = callbacks.contentBlocks || [];
        let accumulatorSessionId: string | null = null;

        try {
          // Try multiple possible session IDs
          const possibleSessionIds = [
            callbackSessionId,
            this.frontendSessionId,
            this.sessionId,
          ].filter(Boolean);

          // IMPORTANT: Only use THIS agent's session IDs to prevent cross-agent contamination.
          // Do NOT use messageAccumulator.getActiveSessionIds() — that returns ALL agents' IDs,
          // which can cause one agent to return another agent's stale content.
          const uniqueSessionIds = [...new Set(possibleSessionIds)];

          for (const sid of uniqueSessionIds) {
            if (!sid) continue;
            // IMPORTANT: Use getPartialContent which properly builds ordered content blocks
            // that include both text and tool_use blocks in the correct order.
            const partial = messageAccumulator.getPartialContent(sid);
            if (partial.content || partial.contentBlocks.length > 0) {
              finalContent = partial.content || '';
              finalContentBlocks =
                partial.contentBlocks.length > 0 ? partial.contentBlocks : finalContentBlocks;
              accumulatorSessionId = sid;
              break;
            }
          }
        } catch (error) {
          logger.error('Error getting accumulated content on connection end', { error });
        }

        // IMPORTANT: Generate a proper message ID (must start with 'msg_' for Zod validation)
        // Session IDs (agent-xxx) cannot be used as message IDs
        const messageId = unifiedIdService.generateMessageId();

        // Await the onComplete callback to ensure persistence completes before cleanup
        const completionPromise = Promise.resolve(
          callbacks.onComplete({
            id: messageId,
            role: 'assistant',
            content: finalContent,
            contentBlocks: finalContentBlocks,
            metadata: {
              partial: true,
              chunksReceived: callbacks.chunksReceived || 0,
              originalSessionId: callbackSessionId,
              accumulatorSessionId,
              auggieSessionId: this.sessionId, // Raw auggie session ID (UUID format)
            },
            timestamp: new Date().toISOString(),
          } as StreamMessage),
        ).then(() => {
          // Clean up after onComplete finishes
          this.cleanupStreamingCallback(callbackSessionId);
        });

        completionPromises.push(completionPromise);
      } else {
        // No onComplete callback, just clean up
        this.cleanupStreamingCallback(callbackSessionId);
      }
    });

    // Wait for all completions (fire and forget since this is a sync method)
    Promise.all(completionPromises).catch((error) => {
      logger.error('Error in connection end completion callbacks', { error });
    });
  }

  /**
   * Attempt to recover a stalled stream
   */
  private async attemptStreamRecovery(sessionId: string): Promise<void> {
    const callbacks = this.streamingCallbacks.get(sessionId);
    if (!callbacks) return;

    logger.info('Attempting stream recovery', {
      sessionId,
      chunksReceived: callbacks.chunksReceived || 0,
    });

    // Try to recover with accumulated content
    if (callbacks.onComplete) {
      let finalContent = '';
      let finalContentBlocks = callbacks.contentBlocks || [];
      let hasAccumulatedContent = false;
      let accumulatorSessionId: string | null = null;

      try {
        // Try multiple session IDs since they might differ
        const possibleSessionIds = [sessionId, this.frontendSessionId, this.sessionId].filter(
          Boolean,
        );

        // IMPORTANT: Only use THIS agent's session IDs to prevent cross-agent contamination.
        // Do NOT use messageAccumulator.getActiveSessionIds() — that returns ALL agents' IDs.
        const uniqueSessionIds = [...new Set(possibleSessionIds)];

        for (const sid of uniqueSessionIds) {
          if (!sid) continue;
          // IMPORTANT: Use getPartialContent which properly builds ordered content blocks
          // that include both text and tool_use blocks in the correct order.
          const partial = messageAccumulator.getPartialContent(sid);
          if (partial.content || partial.contentBlocks.length > 0) {
            finalContent = partial.content || '';
            finalContentBlocks =
              partial.contentBlocks.length > 0 ? partial.contentBlocks : finalContentBlocks;
            hasAccumulatedContent = true;
            accumulatorSessionId = sid; // Remember which session ID had the content
            logger.info('Found accumulated content during recovery', {
              sessionId: sid,
              contentLength: finalContent.length,
              blocksCount: finalContentBlocks.length,
              hasTextBlock: finalContentBlocks.some((b) => b.type === 'text'),
            });
            break;
          }
        }

        if (!hasAccumulatedContent) {
          logger.warn(
            'No accumulated content found during recovery - stream may have already completed',
            {
              triedSessionIds: possibleSessionIds,
            },
          );
          // Don't send an empty complete message if there's no content
          // The stream has likely already completed successfully
          this.cleanupStreamingCallback(sessionId);
          return;
        }
      } catch (error) {
        logger.error('Error getting accumulated content during recovery', { error });
        // Don't send an empty complete message on error
        this.cleanupStreamingCallback(sessionId);
        return;
      }

      // IMPORTANT: Generate a proper message ID (must start with 'msg_' for Zod validation)
      // Session IDs (agent-xxx) cannot be used as message IDs
      const messageId = unifiedIdService.generateMessageId();

      // Await the onComplete callback to ensure persistence completes before cleanup
      await Promise.resolve(
        callbacks.onComplete({
          id: messageId,
          role: 'assistant',
          content: finalContent,
          contentBlocks: finalContentBlocks,
          metadata: {
            recovered: true,
            chunksReceived: callbacks.chunksReceived || 0,
            originalSessionId: sessionId, // Keep track of the original session ID
            accumulatorSessionId, // Track which accumulator we used
            auggieSessionId: this.sessionId, // Raw auggie session ID (UUID format)
          },
          timestamp: new Date().toISOString(),
        } as StreamMessage),
      );
    }

    // Clean up after onComplete finishes
    this.cleanupStreamingCallback(sessionId);
  }

  // ============================================================================
  // Required BaseAgentProvider implementations
  // ============================================================================

  async isAvailable(): Promise<boolean> {
    return true; // Always available if configured
  }

  getInfo(): { name: string; models: string[]; capabilities: string[] } {
    return {
      name: this.config.name || 'ACP Agent',
      models: ['default'], // ACP agents don't expose models
      capabilities: ['chat', 'tools', 'multi-turn', 'workspace-aware'],
    };
  }

  formatMessages(messages: AgentMessage[]): string {
    return messages
      .map((m) => {
        // Extract ALL text from contentBlocks (concatenates all text blocks)
        const text = m.contentBlocks ? extractContentFromBlocks(m.contentBlocks) : '';
        return `${m.role}: ${text}`;
      })
      .join('\n');
  }

  parseResponse(response: string): AgentMessage {
    // Note: AgentMessage here is aliased to ProviderMessage which doesn't have id/timestamp
    // The caller is responsible for adding those fields when needed
    return {
      role: 'assistant',
      contentBlocks: [{ type: 'text' as const, text: response }],
    };
  }

  async *streamResponse(messages: AgentMessage[]): AsyncGenerator<string> {
    // Use streamMessage with a generator-based approach
    const chunks: string[] = [];

    await this.streamMessage(messages, {
      onChunk: (chunk: string) => {
        chunks.push(chunk);
      },
    });

    // Yield all accumulated chunks
    for (const chunk of chunks) {
      yield chunk;
    }
  }

  /**
   * Recursive helper to attempt sending a prompt with automatic model fallback.
   * When a model is unavailable (404), this will:
   * 1. Mark the current model as tried
   * 2. Find the next untried model in the fallback chain
   * 3. Restart the agent with the new model
   * 4. Retry the prompt
   * 5. Repeat until success or all models are exhausted
   */
  private async attemptPromptWithFallback(
    originalPrompt: unknown,
    callbackSessionId: string,
    outerResolve: () => void,
    outerReject: (error: Error) => void,
  ): Promise<void> {
    // Check if current model needs to be switched (was marked as failed)
    const fallbackChain = this.getModelFallbackChain();

    if (this.config.model && this.triedModels.has(this.config.model)) {
      const nextModel = fallbackChain.find((m) => !this.triedModels.has(m));
      if (!nextModel) {
        // All models exhausted
        this.handleAllModelsExhausted(callbackSessionId, outerReject);
        return;
      }

      // Send status message
      const statusSid = this.frontendSessionId || callbackSessionId;
      const statusCb = this.streamingCallbacks.get(statusSid);
      if (statusCb?.onChunk) {
        statusCb.onChunk(
          `\n\n> ⚠️ Model \`${this.config.model}\` is not available. Trying \`${nextModel}\`...\n\n`,
        );
      }

      // Restart with next model
      await this.restartWithModel(nextModel);
    }

    // Auggie >= 0.23.0 handles MCP init waiting internally (PR #49152).
    // For older versions, use a blind sleep as fallback.
    if (!this.supportsMcpInitWait()) {
      const MCP_INIT_WAIT_MS = 5000; // conservative default for old auggie
      logger.info('Old auggie version — applying MCP init sleep fallback', {
        agentVersion: this.agentVersion,
        waitMs: MCP_INIT_WAIT_MS,
      });
      await new Promise((resolve) => setTimeout(resolve, MCP_INIT_WAIT_MS));
    }

    // Send the prompt request
    // Claude Code: ensure selected model is actually applied to the current session before prompting.
    await this.ensureClaudeCodeModelApplied();
    this.emitStatus('prompt', 'Sent prompt…');
    const request = {
      jsonrpc: '2.0' as const,
      method: 'session/prompt',
      params: {
        sessionId: this.sessionId,
        prompt: originalPrompt,
      },
      id: ++this.requestId,
    };
    this.currentStreamingRequestId = this.requestId;

    const timeout = setTimeout(() => {
      this.pendingRequests.delete(request.id);
      logger.debug('Fallback prompt timeout - assuming streaming completed');
      outerResolve();
    }, AGENT_STREAMING_CONFIG.PROMPT_RESPONSE_TIMEOUT_MS);

    this.pendingRequests.set(request.id, {
      resolve: async (response: unknown) => {
        clearTimeout(timeout);
        this.pendingRequests.delete(request.id);

        const typedResponse = response as {
          result?: { stopReason?: string };
          error?: { message?: string; code?: number; data?: { details?: string } };
        };

        if (typedResponse?.result) {
          // Success! Need to trigger stream completion if there's a stopReason
          this.isStoppingIntentionally = false;

          // CRITICAL: After model fallback, we need to trigger stream completion
          // just like the normal flow does. Without this, the stream stays in
          // "streaming" state even after the response is complete.
          if (typedResponse.result.stopReason) {
            const completionSessionId = this.frontendSessionId || callbackSessionId;
            const currentCallbacks = this.streamingCallbacks.get(completionSessionId);
            // Capture generation to detect if a new stream starts during the setTimeout delay
            const capturedGeneration = currentCallbacks?.streamGeneration;

            logger.info('Fallback prompt completed, triggering stream completion', {
              stopReason: typedResponse.result.stopReason,
              sessionId: completionSessionId,
              capturedGeneration,
            });

            // Small delay to ensure all chunks are processed (matches normal flow)
            setTimeout(() => {
              const callbacksNow = this.streamingCallbacks.get(completionSessionId);
              if (callbacksNow) {
                // Check if a new stream started during the delay
                if (
                  capturedGeneration !== undefined &&
                  callbacksNow.streamGeneration !== capturedGeneration
                ) {
                  logger.info(
                    'Ignoring fallback completion - stream generation changed during setTimeout',
                    {
                      completionSessionId,
                      capturedGeneration,
                      currentGeneration: callbacksNow.streamGeneration,
                    },
                  );
                  return;
                }
                this.handleStreamCompletion(
                  completionSessionId,
                  typedResponse.result?.stopReason || 'end_turn',
                );
              }
            }, 100);
          }

          outerResolve();
          return;
        }

        if (typedResponse?.error) {
          // Use only the safe top-level error.message for classification and
          // user-facing paths. `error.data.details` can contain the raw HTTP
          // response body (tool outputs, prompt echoes, file contents) and
          // must never reach logs, createUserFriendlyErrorMessage, callbacks,
          // or rejected Error messages.
          const rawErrorMessage = deriveSafeRawErrorMessage(
            typedResponse.error,
            'Unknown error',
          );
          const errorCode = typedResponse.error.code || -1;
          const errorData = typedResponse.error.data as
            | {
                errorDetails?: { code?: number; message?: string; detail?: string };
                httpStatus?: number;
                apiStatus?: string;
              }
            | undefined;

          if (
            isModelNotAvailableError(rawErrorMessage, errorCode, errorData) &&
            this.config.model
          ) {
            // Mark current model as tried and recurse
            this.triedModels.add(this.config.model);
            logger.warn('Model not available in fallback attempt, trying next', {
              currentModel: this.config.model,
              triedModels: Array.from(this.triedModels),
            });

            // Recursively try next model
            try {
              await this.attemptPromptWithFallback(
                originalPrompt,
                callbackSessionId,
                outerResolve,
                outerReject,
              );
            } catch (err) {
              outerReject(err instanceof Error ? err : new Error(String(err)));
            }
            return;
          }

          // Other error - reject with user-friendly message
          this.isStoppingIntentionally = false;
          // Terminal path: model-fallback attempts have been exhausted or the
          // error isn't a model-availability error. No recovery will run from
          // here, so the user-friendly message must not imply an automatic retry.
          const userFriendlyMessage = createUserFriendlyErrorMessage(
            rawErrorMessage,
            errorCode,
            this.config.model,
            this.providerCapabilities.id,
            errorData,
            this.config.workspaceId,
            typeof typedResponse.error.message === 'string'
              ? typedResponse.error.message
              : undefined,
            true,
          );
          const sid = this.frontendSessionId || callbackSessionId;
          const cb = this.streamingCallbacks.get(sid);
          if (cb?.onError) {
            cb.onError(new Error(userFriendlyMessage));
          }
          outerReject(new Error(userFriendlyMessage));
          return;
        }

        // Unknown response - assume success
        this.isStoppingIntentionally = false;
        outerResolve();
      },
      reject: (err: Error) => {
        clearTimeout(timeout);
        this.isStoppingIntentionally = false;
        outerReject(err);
      },
      timeout,
    });

    const requestStr = `${sanitizeSurrogates(JSON.stringify(request))}\n`;
    if (!this.writeToAgent(requestStr)) {
      clearTimeout(timeout);
      this.pendingRequests.delete(request.id);
      outerReject(new Error('Failed to write fallback request to agent'));
    }
  }

  /**
   * Restart the agent process with a new model
   */
  private async restartWithModel(model: string): Promise<void> {
    logger.info('Restarting agent with new model', {
      previousModel: this.config.model,
      newModel: model,
    });

    // Update model in config
    this.config.model = model;

    const caps = this.providerCapabilities;
    const { modelId: rawModelId } = parseCompoundModelId(model);

    // Update the CLI model flag in config.args — but ONLY if the provider actually
    // uses one (e.g., auggie uses --model). Providers like OpenCode pass model config
    // via env vars, not CLI flags; blindly adding --model would produce invalid args
    // (e.g., `opencode acp --model ...` where `acp` doesn't accept --model).
    // Use rawModelId (not compound ID) — the CLI expects the bare model slug.
    if (this.config.args && caps.modelFlag) {
      const modelIndex = this.config.args.indexOf(caps.modelFlag);
      if (modelIndex !== -1 && modelIndex + 1 < this.config.args.length) {
        // Replace the existing model value
        this.config.args[modelIndex + 1] = rawModelId;
        logger.info('Updated model flag in config.args', {
          flag: caps.modelFlag,
          model: rawModelId,
          args: this.config.args,
        });
      } else if (!this.config.args.includes(caps.modelFlag)) {
        // No model flag exists yet, add it
        this.config.args.push(caps.modelFlag, rawModelId);
        logger.info('Added model flag to config.args', {
          flag: caps.modelFlag,
          model: rawModelId,
          args: this.config.args,
        });
      }
    }

    // Update provider-specific environment variables (e.g., OPENCODE_CONFIG_CONTENT).
    // Providers like OpenCode don't use --model flag; they require model config via env vars.
    const providerEnv = buildProviderEnv(caps.id, rawModelId);
    if (Object.keys(providerEnv).length > 0) {
      this.config.env = {
        ...(this.config.env || {}),
        ...providerEnv,
      };
      logger.info('Updated provider env for model switch', {
        providerId: caps.id,
        envKeys: Object.keys(providerEnv),
      });
    }

    this.isStoppingIntentionally = true;

    if (this.remoteProcess) {
      this.remoteProcess.kill();
      this.remoteProcess = undefined;
    }
    if (this.agentProcess) {
      // Remove all stream listeners before killing to prevent orphaned native handles
      // that can cause SIGSEGV in AsyncWrap::~AsyncWrap() during GC
      this.agentProcess.removeAllListeners('exit');
      this.agentProcess.removeAllListeners('error');
      this.agentProcess.stdout?.removeAllListeners();
      this.agentProcess.stderr?.removeAllListeners();
      this.agentProcess.stdin?.removeAllListeners();
      await killChildProcessTree(this.agentProcess);
      this.agentProcess = undefined;
    }
    this.sessionId = undefined;

    await new Promise((r) => setTimeout(r, 100));
    await this.launchAgent();
    await this.createSession();
    this.isStoppingIntentionally = false;

    logger.info('Agent restarted with new model', {
      model: this.config.model,
      sessionId: this.sessionId,
    });
  }

  /**
   * Handle the case when all models in the fallback chain are exhausted
   */
  private handleAllModelsExhausted(
    callbackSessionId: string,
    reject: (error: Error) => void,
  ): void {
    const triedModelsList = Array.from(this.triedModels);
    const fallbackChain = this.getModelFallbackChain();

    logger.error('[ModelFallback] All models exhausted', {
      triedModels: triedModelsList,
      fallbackChain,
    });

    this.isStoppingIntentionally = false;

    // Create user-friendly message for the chat
    const chatErrorMessage = `\n\n> ❌ **All models unavailable**\n>\n> I tried ${triedModelsList.length} model(s) but none were available: ${triedModelsList.join(', ')}.\n>\n> This usually means the models are temporarily unavailable or not enabled for your account. Please try again later or contact support if this persists.\n`;

    const sid = this.frontendSessionId || callbackSessionId;
    const cb = this.streamingCallbacks.get(sid);

    // Send error message to chat stream
    if (cb?.onChunk) {
      cb.onChunk(chatErrorMessage);
    }

    // Complete the message (not onError to avoid toast)
    if (cb?.onComplete) {
      const messageId = unifiedIdService.generateMessageId();
      cb.onComplete({
        id: messageId,
        role: 'assistant',
        content: chatErrorMessage,
        contentBlocks: [{ type: 'text', text: chatErrorMessage }],
        timestamp: new Date().toISOString(),
        metadata: {
          error: true,
          errorType: 'all_models_unavailable',
          triedModels: triedModelsList,
        },
      });
    }

    this.cleanupStreamingCallback(sid);

    const detailedError = `No available models could handle this request. Tried ${triedModelsList.length} model(s): ${triedModelsList.join(', ')}.`;
    reject(new Error(detailedError));
  }

  async streamMessage(messages: AgentMessage[], options: any): Promise<void> {
    // Reset triedModels at the start of each new streamMessage call.
    // This ensures that if the outer retry layer calls streamMessage again,
    // we start fresh with the full fallback chain instead of immediately
    // hitting "all models exhausted".
    this.triedModels.clear();

    // If there's an active streaming request, cancel it first to avoid
    // confusing auggie with overlapping requests (which can cause "r.map is not a function" errors)
    if (this.currentStreamingRequestId !== null && this.sessionId && this.isAgentAlive()) {
      logger.info('Cancelling in-flight stream before starting new one', {
        currentStreamingRequestId: this.currentStreamingRequestId,
        sessionId: this.sessionId,
      });

      // Send session/cancel to stop the current stream
      const cancelNotification = {
        jsonrpc: '2.0' as const,
        method: 'session/cancel',
        params: {
          sessionId: this.sessionId,
        },
      };

      if (this.writeToAgent(`${JSON.stringify(cancelNotification)}\n`)) {
        logger.info('session/cancel sent for in-flight stream');
        // Give auggie a moment to process the cancel
        await new Promise((resolve) => setTimeout(resolve, 50));
      } else {
        logger.warn('Failed to send cancel for in-flight stream');
      }

      // CRITICAL FIX: Clear the old pending request BEFORE resetting the request ID.
      // Without this, the old cancelled prompt response from the backend will be routed
      // to the old pending request handler, which looks up callbacks by frontendSessionId.
      // Since frontendSessionId doesn't change between sessions, the old handler finds
      // the NEW stream's callbacks and completes them with stopReason="cancelled".
      // This mirrors what interrupt() does at line 3668-3672.
      const oldRequestId = this.currentStreamingRequestId;
      if (oldRequestId !== null) {
        const oldPending = this.pendingRequests.get(oldRequestId);
        if (oldPending) {
          clearTimeout(oldPending.timeout);
          this.pendingRequests.delete(oldRequestId);
          logger.debug('Cleared old pending request during in-flight cancel', {
            requestId: oldRequestId,
          });
        }
      }

      // Reset the streaming request ID
      this.currentStreamingRequestId = null;

      // Increment stream generation as a secondary safeguard — if any other code path
      // (e.g., a session/update notification or completion timer) tries to complete the
      // stream using stale state, the generation check will reject it.
      // The interrupt() path does this too (see this.streamGeneration++ there).
      this.streamGeneration++;
      logger.debug('Incremented stream generation after in-flight cancel', {
        newGeneration: this.streamGeneration,
      });

      // CRITICAL FIX: Clean up old streaming callbacks and timers BEFORE creating new session.
      // Without this, the old completion detection timer can fire and cause a "Stream timed out
      // with no response" error when the new session hasn't received any content yet.
      // This is a race condition that occurs when:
      // 1. Stream is cancelled (e.g., due to rapid handler-ready events)
      // 2. New session is created
      // 3. Old timer fires before new session receives any chunks
      // 4. handleStreamCompletion finds no content and throws error
      const oldSessionId = this.sessionId;
      const oldFrontendSessionId = this.frontendSessionId;

      // Clean up callbacks for both the internal session ID and frontend session ID
      if (oldSessionId) {
        this.cleanupStreamingCallback(oldSessionId);
      }
      if (oldFrontendSessionId && oldFrontendSessionId !== oldSessionId) {
        this.cleanupStreamingCallback(oldFrontendSessionId);
      }

      logger.info('Cleaned up old streaming callbacks after cancel', {
        oldSessionId,
        oldFrontendSessionId,
        remainingCallbacks: this.streamingCallbacks.size,
        remainingTimers: this.streamCompletionTimers.size,
      });

      // For auggie >= 0.18.0, session/cancel is non-destructive — the session stays alive
      // and can accept new prompts. No need to create a new session or resend history.
      if (this.supportsNonDestructiveCancel()) {
        logger.info('Non-destructive cancel — keeping existing session for in-flight stream', {
          sessionId: oldSessionId,
          agentVersion: this.agentVersion,
        });
      } else if (this.sessionCreationParams) {
        // Mark the old session as cancelled in the streaming handler
        // BEFORE createSession(). During the async createSession() call, the event loop
        // can process stale chunks from the old session. Without this, those chunks pass
        // through the sessionId guard (because internalSessionId still holds the old value)
        // and get forwarded to the new onChunk callback, causing interleaved text.
        if (oldSessionId && this.streamingHandler) {
          this.streamingHandler.markSessionCancelled(oldSessionId);
        }

        // CRITICAL FIX (auggie < 0.18.0): Create a new session after cancelling the old one.
        // When we send session/cancel, the Auggie backend marks that session as cancelled.
        // If we then send a new prompt to the SAME session, Auggie will immediately
        // return stopReason="cancelled" because the session is in a cancelled state.
        // By creating a new session, we ensure subsequent messages are sent to a fresh
        // session that doesn't have the cancelled state.
        try {
          logger.info('Creating new session after in-flight stream cancel', { oldSessionId });
          await this.createSession();
          // Mark that session was recreated - need to send full history on next message
          this.sessionWasRecreated = true;
          logger.info(
            'New session created after in-flight stream cancel - will send full history',
            {
              oldSessionId,
              newSessionId: this.sessionId,
            },
          );
        } catch (error) {
          logger.error('Failed to create new session after in-flight stream cancel', {
            error: error instanceof Error ? error.message : String(error),
          });
          // CRITICAL FIX: Same pattern as interrupt() catch — prevent resetSession() from
          // double-trying and clear the stale cancelled session so sendMessage() reinitializes.
          this.sessionWasRecreated = true;
          this.sessionId = undefined;
        }
      }
    }

    // Set streaming flag and cancel idle timer — process is active
    this.isStreaming = true;
    this.clearIdleTimer();

    // Mark process as active in the global registry so it won't be evicted
    if (this.agentProcess?.pid) {
      markProcessActive(this.agentProcess.pid);
    }

    // Store the frontend session ID if provided
    if (options.frontendSessionId) {
      this.frontendSessionId = options.frontendSessionId;
      logger.info('Using frontend session ID for streaming', {
        frontendSessionId: this.frontendSessionId,
        internalSessionId: this.sessionId,
      });
    }

    // Check if the process is still alive
    logger.info('Checking agent process status', {
      isRemote: this.isRemoteWorkspace(),
      agentAlive: this.isAgentAlive(),
      hasLocalProcess: !!this.agentProcess,
      hasRemoteProcess: !!this.remoteProcess,
    });

    if (!this.isAgentAlive()) {
      logger.error('Agent process is not running', {
        isRemote: this.isRemoteWorkspace(),
        hasLocalProcess: !!this.agentProcess,
        hasRemoteProcess: !!this.remoteProcess,
      });

      // Try to restart the agent process
      logger.info('Attempting to restart agent process');
      try {
        await this.launchAgent();
        await this.initializeProtocol();
        // If session/load succeeded, agent has context — no history resend needed
        // Only set if there was a previous session we failed to resume — brand new agents have no history to resend
        if (!this.lastInitUsedSessionLoad && this.previousSessionId) {
          this.sessionWasRecreated = true;
        }
        logger.info('Session recreated after agent restart', {
          sessionId: this.sessionId,
          usedSessionLoad: this.lastInitUsedSessionLoad,
          willSendFullHistory: !this.lastInitUsedSessionLoad,
        });
      } catch (restartError) {
        logger.error('Failed to restart agent process', restartError);
        throw new Error(
          'Agent process is not running and could not be restarted - please create a new agent',
        );
      }
    }

    if (!this.sessionId) {
      logger.warn('No active session, attempting to initialize');
      try {
        await this.initializeProtocol();
        // If session/load succeeded, agent has context — no history resend needed
        // Only set if there was a previous session we failed to resume — brand new agents have no history to resend
        if (!this.lastInitUsedSessionLoad && this.previousSessionId) {
          this.sessionWasRecreated = true;
        }
        logger.info('Session recreated after session loss', {
          sessionId: this.sessionId,
          usedSessionLoad: this.lastInitUsedSessionLoad,
          willSendFullHistory: !this.lastInitUsedSessionLoad,
        });
      } catch (initError) {
        logger.error('Failed to initialize session', initError);

        // Check if this is an authentication error - don't fall back, let user know they need to auth
        const errorMessage = initError instanceof Error ? initError.message : String(initError);
        if (isAuthenticationError(errorMessage, this.providerCapabilities.id)) {
          logger.error('Authentication error - not falling back to fake session');
          throw initError;
        }
        // For non-auth errors, fail the request so the caller can surface the error
        throw initError;
      }
    }

    // Initialize streaming handler if not already done
    if (!this.streamingHandler) {
      const agentId = this.config.id || this.config.agentId || `agent-${Date.now()}`;
      if (!this.config.id && !this.config.agentId) {
        logger.warn('No agent ID in config, using generated ID', { generatedId: agentId });
      }
      this.streamingHandler = new ACPProviderStreaming(agentId);
      this.streamingAgentId = agentId; // Store for content lookup in handleStreamCompletion
    }

    // ALWAYS update the internal session ID before streaming.
    // This is critical when sessions are recreated (e.g., after errors) - the streaming
    // handler must use the current session ID, otherwise streaming updates from the
    // agent will be rejected as "old session" updates by the session ID mismatch check.
    if (this.sessionId) {
      this.streamingHandler.setInternalSessionId(this.sessionId);
    }

    // Start streaming with the new handler
    // Use getEffectiveWorkspacePath() to get the actual worktree path for file operations
    this.streamingHandler.startStreaming({
      workspaceId: this.config.workspaceId || 'default',
      workspacePath: this.getEffectiveWorkspacePath(),
      frontendSessionId: options?.frontendSessionId,
      assistantMessageId: options?.assistantMessageId,
      onChunk: options?.onChunk,
      onContentBlocks: options?.onContentBlocks,
      onComplete: options?.onComplete,
      onError: options?.onError,
      onCleanup: (sessionId: string) => {
        // The done notification triggers this cleanup via completeStream().
        // A race exists with handleStreamCompletion() (fired 100ms after the
        // JSON-RPC response): if we delete the streamingCallbacks entry here
        // before that timer fires, resolveStream() is never called and the
        // streamMessage() promise hangs — blocking all follow-up messages.
        //
        // Fix: resolve the stream promise and run the same cleanups that
        // the normal onComplete path does. Calling resolve() on an
        // already-resolved promise is a no-op, so this is safe regardless
        // of ordering.
        if (sessionId) {
          const callbacks = this.streamingCallbacks.get(sessionId);

          // Guard against a late done-notification from a previous stream
          // resolving/cleaning up callbacks that belong to a newer stream.
          if (
            callbacks &&
            callbacks.streamGeneration !== undefined &&
            callbacks.streamGeneration !== this.streamGeneration
          ) {
            logger.warn('Ignoring stale onCleanup from previous stream generation', {
              sessionId,
              callbackGeneration: callbacks.streamGeneration,
              currentGeneration: this.streamGeneration,
            });
            return;
          }

          if (callbacks?.resolveStream) {
            // Don't resolve during a retry — the retry's own completion
            // should handle resolution (same guard as onComplete wrapper)
            if (this.retryInProgress) {
              logger.debug('Skipping resolveStream in onCleanup — retry in progress', {
                sessionId,
              });
            } else {
              // Clear stale state that the normal onComplete path clears
              this.pendingRetry = undefined;
              this.sessionRecoveryAttempts = 0;
              this.contextTooLargeRecoveryCount = 0;
              this.transientRetryAttempts = 0;
              this.workspaceToolRecoveryAttempts = 0;
              this.currentStreamingRequestId = null;

              callbacks.resolveStream();
              logger.debug('Resolved stream from onCleanup (done notification path)', {
                sessionId,
              });
            }
          }
          this.cleanupStreamingCallback(sessionId);
          logger.debug('Cleaned up streamingCallbacks from onCleanup callback', {
            sessionId,
          });
        }
      },
      onStatus: (phase: string, message: string, level?: 'info' | 'warn' | 'error') => {
        this.emitStatus(phase, message, level || 'info');
      },
    });

    // Proceed immediately with the message
    // The agent will initialize as needed when processing the actual message
    // Note: frontendSessionId is already set at the start of this method

    // Use frontend session ID for callbacks if provided, otherwise use internal session ID
    const callbackSessionId = this.frontendSessionId || this.sessionId;
    if (!callbackSessionId) {
      throw new Error('Cannot start streaming without a session ID');
    }

    // Clean up any existing callbacks for this session to prevent memory leaks
    // and ensure we start fresh
    const existingCallbacks = this.streamingCallbacks.get(callbackSessionId);
    if (existingCallbacks) {
      // No need to flush buffer since we're sending chunks immediately now
      logger.warn('Cleaning up existing streaming callbacks before starting new stream', {
        sessionId: callbackSessionId,
      });

      // Clear the callbacks completely
      this.streamingCallbacks.delete(callbackSessionId);
    }

    // Create a promise that will resolve when streaming is complete
    return new Promise(async (resolveStream, rejectStream) => {
      // Store pending retry info in case of agent.name undefined error
      // This allows automatic retry without user having to resend
      this.pendingRetry = {
        messages,
        options,
        resolveStream,
        rejectStream,
      };

      // Set up fresh streaming callbacks for this session
      // Use frontend session ID for callbacks if provided
      // Wrap the callbacks to handle promise resolution
      this.streamingCallbacks.set(callbackSessionId, {
        onChunk: options?.onChunk,
        onContentBlocks: options?.onContentBlocks,
        onComplete: async (message: any) => {
          // If a retry is in progress, don't resolve - let the retry handle it
          // This prevents the original broken request's empty completion from
          // resolving the promise before the retry can complete
          if (this.retryInProgress) {
            logger.debug('Ignoring onComplete during retry - letting retry handle resolution');
            return;
          }

          // Clear pending retry since stream completed successfully
          this.pendingRetry = undefined;

          // Reset recovery counters on success so future errors get a fresh budget
          this.sessionRecoveryAttempts = 0;
          this.contextTooLargeRecoveryCount = 0;
          this.transientRetryAttempts = 0;
          this.workspaceToolRecoveryAttempts = 0;

          // Call the original callback if provided and await it
          // This ensures persistence completes before we resolve the stream
          if (options?.onComplete) {
            await Promise.resolve(options.onComplete(message));
          }
          // Resolve the streaming promise after onComplete finishes
          resolveStream();
        },
        onError: (error: Error) => {
          // Call the original callback if provided
          if (options?.onError) {
            options.onError(error);
          }
          // Reject the streaming promise
          rejectStream(error);
        },
        onToolCall: options?.onToolCall,
        resolveStream,
        // Removed accumulatedContent - SessionManager handles accumulation
        contentBlocks: [],
        // IMMEDIATE MODE: No buffering for snappy UI
        hasReceivedFirstChunk: false, // Initialize first chunk flag
        lastActivityTime: Date.now(),
        streamStartTime: Date.now(),
        chunksReceived: 0,
        hasReceivedActivity: false,
        processedChunkIds: new Set(),
        // Track which generation this stream belongs to - used to reject stale cancelled responses
        streamGeneration: this.streamGeneration,
        // Per-session assistant message ID — avoids race when two streams overlap
        assistantMessageId: options?.assistantMessageId,
      });

      // Don't register duplicate callbacks - this causes issues with cleanup

      logger.info('Registered streaming callbacks with single session ID', {
        callbackSessionId,
        frontendSessionId: this.frontendSessionId,
        internalSessionId: this.sessionId,
      });

      logger.info('Set up fresh streaming callbacks', {
        callbackSessionId,
        frontendSessionId: this.frontendSessionId,
        internalSessionId: this.sessionId,
        hasOnChunk: !!options?.onChunk,
        hasOnComplete: !!options?.onComplete,
        registeredSessions: Array.from(this.streamingCallbacks.keys()),
      });

      // Set up initial completion detection timer using configurable timeout
      // This will be reset each time we receive new content
      this.resetCompletionDetection(callbackSessionId);

      try {
        // Filter out system messages - they should be passed as rules via --rules flag, not in the prompt
        // System messages are handled when launching auggie, not in the conversation
        const conversationMessages = messages.filter((m) => m.role !== 'system');

        // Get the current user message (the last one)
        const currentMessage = conversationMessages[conversationMessages.length - 1];
        if (!currentMessage || currentMessage.role !== 'user') {
          throw new Error('Last message must be from user');
        }

        // Extract ALL text from contentBlocks (concatenates all text blocks)
        const currentContent = currentMessage.contentBlocks
          ? extractContentFromBlocks(currentMessage.contentBlocks)
          : '';

        // Build the prompt
        let promptText = '';

        // Add stdin context if provided
        if (options?.stdinContext) {
          promptText += `Context:\n${options.stdinContext}\n\n---\n\n`;
        }

        // Role Reminder Injection: Periodically remind specialist agents of their critical constraints
        // This combats LLM attention decay in long conversations where early instructions lose influence
        const ROLE_REMINDER_INTERVAL = 1; // Inject reminder every N exchanges
        const specialistId = this.config.metadata?.specialist;
        if (specialistId) {
          // Count exchanges (user messages) to determine if we should inject a reminder
          const userMessageCount = conversationMessages.filter((m) => m.role === 'user').length;

          // Inject reminder every N exchanges, or after session recreation
          const shouldInjectReminder =
            userMessageCount > 0 &&
            (userMessageCount % ROLE_REMINDER_INTERVAL === 0 || this.sessionWasRecreated);

          if (shouldInjectReminder) {
            const resolved = resolveSpecialistForAgent(specialistId);
            if (resolved?.roleReminder) {
              promptText += `[Role Reminder: You are a ${resolved.specialistName}. ${resolved.roleReminder}]\n\n`;
              logger.info('Injected role reminder for specialist', {
                specialistId,
                specialistName: resolved.specialistName,
                exchangeCount: userMessageCount,
                sessionWasRecreated: this.sessionWasRecreated,
              });
            }
          }
        }

        // Check if we need to send full history (session was recreated after restart)
        // NOTE: Normally we only send the current message to auggie, NOT the full conversation history.
        // Auggie's ACP session maintains conversation history internally via its AgentLoop.
        // The provider is preserved between messages (not destroyed after each stream),
        // so auggie's session accumulates the full conversation context.
        //
        // HOWEVER, if the session was recreated (agent process died and restarted, or session was lost),
        // we need to send the full conversation history so the agent has context.
        logger.info('History send decision', {
          sessionWasRecreated: this.sessionWasRecreated,
          lastInitUsedSessionLoad: this.lastInitUsedSessionLoad,
          willSendFullHistory: this.sessionWasRecreated,
        });

        if (this.sessionWasRecreated && conversationMessages.length > 1) {
          // Build conversation history from all previous messages
          const previousMessages = conversationMessages.slice(0, -1);

          logger.info('Session was recreated - sending conversation history', {
            sessionId: this.sessionId,
            messageCount: previousMessages.length,
          });

          // Progressive history reduction: if we've recovered from 413 errors,
          // use a smaller budget to leave room for auggie's server-side overhead
          // (tool definitions, rules, memories can add 100-200K chars).
          const effectiveHistoryBudget =
            this.contextTooLargeRecoveryCount > 0
              ? Math.max(
                  Math.floor(MAX_HISTORY_CHARS / Math.pow(2, this.contextTooLargeRecoveryCount)),
                  10_000, // Minimum: 10K chars — enough for 1-2 recent exchanges
                )
              : MAX_HISTORY_CHARS;

          // Format history as XML exchange format with built-in size truncation
          const historyXml = formatHistoryAsXml(previousMessages, effectiveHistoryBudget);

          logger.info('Formatted history XML', {
            sessionId: this.sessionId,
            xmlLength: historyXml.length,
            maxChars: effectiveHistoryBudget,
            defaultMaxChars: MAX_HISTORY_CHARS,
            contextRecoveryCount: this.contextTooLargeRecoveryCount,
          });

          promptText += historyXml;
          promptText += '\n\n';

          // Reset the flag after sending full history
          this.sessionWasRecreated = false;
        }

        // Clear the flag even if there was no history to send (e.g., first message of a new agent)
        if (this.sessionWasRecreated) {
          this.sessionWasRecreated = false;
        }

        promptText += currentContent;

        // Extract file blocks early to check if files are attached
        const fileBlocks = currentMessage.contentBlocks?.filter(
          (b): b is { type: 'file'; data: string; mimeType: string; fileName: string } =>
            b.type === 'file',
        );

        // If files are attached, embed their content directly in the text prompt
        // (ACP may not support resource blocks in prompts, so we inline the content)
        if (fileBlocks && fileBlocks.length > 0) {
          const fileNames = fileBlocks.map((f) => f.fileName).join(', ');
          promptText += `\n\n---\n\n**ATTACHED FILE(S): ${fileNames}**\n\nThe user has attached ${fileBlocks.length} file(s) to this message. When they ask about "this file" or "the file", they are referring to the attached file(s) below.\n\n`;

          for (const fileBlock of fileBlocks) {
            const fileExtension = fileBlock.fileName.toLowerCase().match(/\.[^.]+$/)?.[0] || '';
            const isTextByExtension = TEXT_FILE_EXTENSIONS.includes(fileExtension as any);
            const isTextByMimeType =
              fileBlock.mimeType.startsWith('text/') ||
              fileBlock.mimeType === 'application/json' ||
              fileBlock.mimeType === 'application/javascript' ||
              fileBlock.mimeType === 'application/typescript' ||
              fileBlock.mimeType === 'application/xml' ||
              fileBlock.mimeType === 'application/x-yaml' ||
              fileBlock.mimeType === 'application/x-sh';

            const isTextFile =
              isTextByMimeType ||
              (isTextByExtension && fileBlock.mimeType === 'application/octet-stream');

            if (isTextFile) {
              try {
                const textContent = Buffer.from(fileBlock.data, 'base64').toString('utf-8');
                const langHint = fileExtension.replace('.', '') || 'text';
                promptText += `**File: ${fileBlock.fileName}**\n\`\`\`${langHint}\n${textContent}\n\`\`\`\n\n`;
              } catch {
                logger.warn('Failed to decode file as text', { fileName: fileBlock.fileName });
                promptText += `**File: ${fileBlock.fileName}** (binary file - content not displayed)\n\n`;
              }
            } else {
              // Save binary file to workspace metadata assets directory so the agent can access it
              const wsId = this.config.workspaceId || 'default';
              const savedPath = saveBinaryAttachmentToWorkspace(
                wsId,
                fileBlock.fileName,
                fileBlock.data,
              );
              if (savedPath) {
                promptText += `**File: ${fileBlock.fileName}** (binary file, ${fileBlock.mimeType})\nThis file has been saved at: \`${savedPath}\`\nYou can read it at that absolute path.\n\n`;
              } else {
                promptText += `**File: ${fileBlock.fileName}** (binary file, ${fileBlock.mimeType}) — could not save to disk.\n\n`;
              }
            }
          }
          logger.info('Attached files embedded in prompt', {
            files: fileBlocks.map((f) => f.fileName),
          });
        }
        // Add spec instructions if needed (only if no files attached)
        else if (options?.currentContext?.type === 'spec') {
          promptText +=
            '\n\nYou\'re working with the spec note (ID: \'spec\'). Via the `workspace_api` tool, use `ws.note.read("spec")` to read it, `ws.note.add("spec", { content, heading?, position? })` to add content, or `ws.note.edit("spec", { old, new })` to modify specific text.';
        }

        // For providers without rules-file support, inject our runtime rules bundle once so
        // Codex/Claude Code/OpenCode behave consistently with Auggie.
        promptText = await this.maybeInjectRulesIntoPromptText(promptText);

        // Safety net: if the fully-assembled prompt text is dangerously large, warn.
        // Beyond promptText, auggie adds tool_definitions (~50-100k), rules (~10-50k),
        // user_guidelines, workspace_guidelines, agent_memories, and JSON wrapper.
        // The 413 is actually ExceedContextLength (LLM token limit), not HTTP body size.
        // 350k prompt + ~150k overhead ≈ 500k chars ≈ ~125k tokens — near model limits.
        const MAX_SAFE_PROMPT_CHARS = 350_000;
        if (promptText.length > MAX_SAFE_PROMPT_CHARS) {
          logger.warn('Prompt text exceeds safe size limit — response may fail with 413', {
            sessionId: this.sessionId,
            promptLength: promptText.length,
            maxSafe: MAX_SAFE_PROMPT_CHARS,
          });
        }

        // Convert to content blocks format for ACP
        // Include both text and any image/resource blocks from the current message
        // Note: ACP doesn't support 'file' type - files are converted to 'resource' format
        const promptContentBlocks: Array<
          | { type: 'text'; text: string }
          | { type: 'image'; data: string; mimeType: string }
          | {
              type: 'resource';
              resource: { uri: string; mimeType?: string; text?: string; blob?: string };
            }
        > = [{ type: 'text' as const, text: promptText }];

        // Extract and add image blocks from the current message
        const imageBlocks = currentMessage.contentBlocks?.filter(
          (b): b is { type: 'image'; data: string; mimeType: string } => b.type === 'image',
        );

        // Note: fileBlocks already extracted above for attached files instructions

        logger.info('ACP Provider: Checking for image and file blocks in current message', {
          sessionId: this.sessionId,
          hasContentBlocks: !!currentMessage.contentBlocks,
          contentBlocksCount: currentMessage.contentBlocks?.length || 0,
          contentBlockTypes: currentMessage.contentBlocks?.map((b) => b.type) || [],
          imageBlocksCount: imageBlocks?.length || 0,
          fileBlocksCount: fileBlocks?.length || 0,
        });

        if (imageBlocks && imageBlocks.length > 0) {
          for (const imageBlock of imageBlocks) {
            promptContentBlocks.push({
              type: 'image' as const,
              data: imageBlock.data,
              mimeType: imageBlock.mimeType,
            });
            const dims = getImageDimensionsFromBase64(imageBlock.data, imageBlock.mimeType);
            const estimatedTokens = dims ? Math.ceil((dims.width * dims.height) / 750) : null;
            logger.info('Image block added to ACP prompt (streaming)', {
              sessionId: this.sessionId,
              mimeType: imageBlock.mimeType,
              dataLength: imageBlock.data?.length || 0,
              width: dims?.width ?? 'unknown',
              height: dims?.height ?? 'unknown',
              estimatedTokens: estimatedTokens ?? 'unknown',
            });
          }
          logger.info('Including images in ACP prompt', {
            sessionId: this.sessionId,
            imageCount: imageBlocks.length,
            imageDataSizes: imageBlocks.map((b) => ({
              mimeType: b.mimeType,
              dataLength: b.data?.length || 0,
            })),
          });
        }

        logger.info('Sending message to ACP agent', {
          sessionId: this.sessionId,
          messageCount: messages.length,
          promptLength: promptText.length,
          hasSystemPrompt: !!this.config.systemPrompt,
          hasContext: !!options?.stdinContext,
        });

        // Log the full content blocks being sent (for debugging)
        logger.info('ACP prompt content blocks being sent', {
          sessionId: this.sessionId,
          blockCount: promptContentBlocks.length,
          blockTypes: promptContentBlocks.map((b) => b.type),
          blockDetails: promptContentBlocks.map((b) => {
            if (b.type === 'text') {
              return {
                type: 'text',
                textLength: b.text.length,
                textPreview: b.text.substring(0, 100),
              };
            } else if (b.type === 'image') {
              return { type: 'image', mimeType: b.mimeType, dataLength: b.data?.length || 0 };
            } else {
              // resource type
              const resource = (b as any).resource;
              return {
                type: 'resource',
                uri: resource?.uri,
                mimeType: resource?.mimeType,
                hasText: !!resource?.text,
                textLength: resource?.text?.length || 0,
                hasBlob: !!resource?.blob,
                blobLength: resource?.blob?.length || 0,
              };
            }
          }),
        });

        // Auggie >= 0.23.0 handles MCP init waiting internally (PR #49152).
        // For older versions, use a blind sleep as fallback.
        if (!this.supportsMcpInitWait()) {
          const MCP_INIT_WAIT_MS = 5000; // conservative default for old auggie
          logger.info('Old auggie version — applying MCP init sleep fallback', {
            agentVersion: this.agentVersion,
            waitMs: MCP_INIT_WAIT_MS,
          });
          await new Promise((resolve) => setTimeout(resolve, MCP_INIT_WAIT_MS));
        }

        // Send prompt request to agent - auggie expects an array of content blocks
        // Claude Code: ensure selected model is actually applied to the current session before prompting.
        await this.ensureClaudeCodeModelApplied();
        this.emitStatus('prompt', 'Sent prompt…');
        const request = {
          jsonrpc: '2.0' as const,
          method: 'session/prompt',
          params: {
            sessionId: this.sessionId,
            prompt: promptContentBlocks,
          },
          id: ++this.requestId,
        };

        // CRITICAL: Track the current streaming request ID to ignore stale chunks
        // When a new message is sent while the previous stream is still active,
        // chunks from the old request may continue to arrive. We use this to filter them out.
        this.currentStreamingRequestId = request.id;

        // Send the prompt request to auggie via stdin (local or remote)
        // Note: We only send once to avoid duplicate processing
        // Sanitize surrogates to prevent invalid JSON causing API 400 errors
        const requestStr = `${sanitizeSurrogates(JSON.stringify(request))}\n`;

        logger.info('Writing prompt request to agent', {
          requestId: request.id,
          currentStreamingRequestId: this.currentStreamingRequestId,
          requestLength: requestStr.length,
          isRemote: this.isRemoteWorkspace(),
          agentAlive: this.isAgentAlive(),
        });

        if (this.writeToAgent(requestStr)) {
          logger.info('Prompt request sent successfully', {
            requestId: request.id,
            isRemote: this.isRemoteWorkspace(),
          });
        } else {
          throw new Error('Cannot send prompt request - agent not available');
        }

        // Also track this request to handle the response which signals completion
        // Check if this is first prompt after an interrupt - use shorter timeout to detect stuck Auggie
        const isPostInterrupt =
          this.lastInterruptTime !== undefined &&
          Date.now() - (this.lastInterruptTime as number) < 60000; // Within 1 minute of interrupt
        const timeoutMs = isPostInterrupt
          ? this.POST_INTERRUPT_TIMEOUT_MS
          : AGENT_STREAMING_CONFIG.PROMPT_RESPONSE_TIMEOUT_MS;

        logger.info('Tracking prompt request for completion', {
          requestId: request.id,
          isPostInterrupt,
          timeoutMs,
          lastInterruptTime: this.lastInterruptTime,
        });
        const responsePromise = new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(async () => {
            // If this is a post-interrupt timeout and we haven't received any streaming activity,
            // Auggie is likely stuck - attempt recovery by restarting the process
            if (isPostInterrupt) {
              // Guard against multiple simultaneous recovery attempts
              if (this.isRestartingProcess) {
                logger.debug('Recovery already in progress, skipping duplicate attempt');
                this.pendingRequests.delete(request.id);
                resolve();
                return;
              }

              const callbacks = this.streamingCallbacks.get(callbackSessionId);
              // Check hasReceivedActivity as a broad activity signal.
              // hasReceivedActivity is set by recordStreamingActivity() for ANY meaningful
              // agent activity: session/update notifications (text, tool_call, tool_call_update),
              // ACP server requests (fs/read_text_file, fs/write_text_file), and permission
              // requests. This prevents false "stuck" restarts when the agent is actively
              // doing tool/file work without producing text output.
              // NOTE: This is separate from chunksReceived which only tracks session/update
              // notifications and is used by the normal prompt-response timeout heuristic.
              const hasReceivedActivity = callbacks?.hasReceivedActivity ?? false;

              if (!hasReceivedActivity) {
                logger.warn(
                  'Post-interrupt timeout with no streaming activity - Auggie appears stuck',
                  {
                    requestId: request.id,
                    callbackSessionId,
                    lastInterruptTime: this.lastInterruptTime,
                    lastActivityTime: callbacks?.lastActivityTime,
                  },
                );

                // Try to recover by restarting the agent process
                try {
                  logger.info('Attempting to restart stuck Auggie process');
                  this.pendingRequests.delete(request.id);

                  // Stop the current process
                  await this.stopAgentProcess();

                  // Relaunch and reinitialize
                  await this.launchAgent();
                  await this.initializeProtocol();

                  // Reset flags after successful restart
                  this.isRestartingProcess = false;
                  this.isStoppingIntentionally = false;

                  // If session/load succeeded, agent has context — no history resend needed
                  // Only set if there was a previous session we failed to resume — brand new agents have no history to resend
                  if (!this.lastInitUsedSessionLoad && this.previousSessionId) {
                    this.sessionWasRecreated = true;
                  }
                  this.lastInterruptTime = undefined; // Clear to avoid infinite loops

                  logger.info('Successfully restarted stuck Auggie process', {
                    newSessionId: this.sessionId,
                    usedSessionLoad: this.lastInitUsedSessionLoad,
                  });

                  // Notify user that they need to retry
                  if (callbacks?.onError) {
                    callbacks.onError(
                      new Error(
                        'Agent was unresponsive after being stopped and has been restarted. Please try your message again.',
                      ),
                    );
                  }
                  this.cleanupStreamingCallback(callbackSessionId);
                  resolve();
                  return;
                } catch (restartError) {
                  // Reset flags even on failure
                  this.isRestartingProcess = false;
                  this.isStoppingIntentionally = false;

                  logger.error('Failed to restart stuck Auggie process', restartError);
                  if (callbacks?.onError) {
                    callbacks.onError(
                      new Error(
                        'Agent became unresponsive after being stopped. Please create a new agent.',
                      ),
                    );
                  }
                  this.cleanupStreamingCallback(callbackSessionId);
                  reject(restartError as Error);
                  return;
                }
              }
            }

            this.pendingRequests.delete(request.id);

            // Check if streaming has been active — if we received chunks, the stream
            // may have completed via session/update and we just missed the response.
            // If no streaming activity was ever received, the agent is truly stuck.
            const callbacks = this.streamingCallbacks.get(callbackSessionId);
            const hasReceivedChunks = callbacks && (callbacks.chunksReceived ?? 0) > 0;

            if (hasReceivedChunks) {
              // Stream was active — assume it completed via session/update
              logger.debug('Prompt response timeout - stream was active, assuming completed', {
                chunksReceived: callbacks?.chunksReceived,
                lastActivityTime: callbacks?.lastActivityTime,
              });
              resolve();
            } else {
              // No streaming activity at all — agent is stuck, reject to trigger error handling
              logger.error(
                'Prompt response timeout with no streaming activity - agent appears stuck',
                {
                  requestId: request.id,
                  callbackSessionId,
                  timeoutMs,
                  lastActivityTime: callbacks?.lastActivityTime,
                },
              );

              const errorMessage =
                'Agent did not respond within the expected time. The connection may have been lost.';
              if (callbacks?.onError) {
                callbacks.onError(new Error(errorMessage));
              }
              this.cleanupStreamingCallback(callbackSessionId);
              reject(new Error(errorMessage));
            }
          }, timeoutMs);

          this.pendingRequests.set(request.id, {
            resolve: async (response: any) => {
              // Clear post-interrupt timeout since we received a response
              // This prevents future messages from using the shorter timeout
              if (this.lastInterruptTime) {
                logger.debug('Clearing lastInterruptTime after successful prompt response');
                this.lastInterruptTime = undefined;
              }

              logger.info('Received prompt response', {
                hasResult: !!response?.result,
                hasError: !!response?.error,
                stopReason: response?.result?.stopReason,
                hasContent: !!response?.result?.content,
                contentLength: response?.result?.content?.length,
                sessionId: this.sessionId,
              });

              // CRITICAL FIX: Check for error responses from the agent process
              // When auggie returns an error (e.g., HTTP 404, session expired, etc.),
              // the response will have an 'error' field instead of 'result'.
              // Previously this was silently ignored, causing the stream to hang until timeout.
              if (response?.error) {
                // Use only the safe top-level error.message for classification
                // and user-facing paths. `error.data.details` can contain the
                // raw HTTP response body (tool outputs, prompt echoes, file
                // contents) and must never reach logs,
                // createUserFriendlyErrorMessage, callbacks, or rejected Error
                // messages. Classification that depends on structured signals
                // (httpStatus, apiStatus, errorDetails.code) continues to use
                // `errorData` below.
                const rawErrorMessage = deriveSafeRawErrorMessage(
                  response.error,
                  'Unknown agent error',
                );
                const errorCode = response.error.code || -1;
                const errorData = response.error.data as
                  | {
                      errorDetails?: { code?: number; message?: string; detail?: string };
                      httpStatus?: number;
                      apiStatus?: string;
                      httpUrl?: string;
                    }
                  | undefined;
                const safeFallbackMessage = derivePromptErrorSafeFallbackMessage(
                  response.error,
                  this.recentStderrErrors,
                );

                // Check if this is a model not available error (404)
                // If so, try to switch to a fallback model and retry using the recursive helper
                if (
                  isModelNotAvailableError(rawErrorMessage, errorCode, errorData) &&
                  this.config.model
                ) {
                  // Mark current model as tried
                  this.triedModels.add(this.config.model);

                  // Check if this is a background agent - only auto-fallback for background agents
                  const isBackground = this.config.metadata?.isBackground === true;

                  // Find the next available model
                  const fallbackChain = this.getModelFallbackChain();
                  const nextModel = fallbackChain.find((m) => !this.triedModels.has(m));

                  // Do NOT log `rawErrorMessage` here: it may be sourced from
                  // response.error.data.details (raw HTTP body). Log the safe
                  // top-level message + sanitized summary instead.
                  logger.warn('Model not available', {
                    failedModel: this.config.model,
                    triedModels: Array.from(this.triedModels),
                    errorMessage:
                      typeof response.error.message === 'string'
                        ? response.error.message
                        : undefined,
                    errorCode,
                    isBackground,
                    nextModel,
                    error: summarizeProviderErrorForLog(response.error),
                  });

                  // For interactive (non-background) agents, stop and let user choose to retry
                  if (!isBackground) {
                    clearTimeout(timeout);
                    this.pendingRequests.delete(request.id);

                    const completionSessionId = this.frontendSessionId || callbackSessionId;
                    const callbacks = this.streamingCallbacks.get(completionSessionId);

                    if (nextModel) {
                      // Send a friendly message with retry info
                      const message = `Model \`${this.config.model}\` is not available.`;
                      if (callbacks?.onChunk) {
                        callbacks.onChunk(`\n\n> ⚠️ ${message}\n\n`);
                      }

                      // Complete the stream with metadata about the available fallback
                      if (callbacks?.onComplete) {
                        callbacks.onComplete({
                          id: `model-unavailable-${Date.now()}`,
                          role: 'assistant',
                          content: message,
                          contentBlocks: [{ type: 'text', text: message }],
                          timestamp: new Date().toISOString(),
                          metadata: {
                            modelUnavailable: true,
                            failedModel: this.config.model,
                            nextAvailableModel: nextModel,
                            triedModels: Array.from(this.triedModels),
                          },
                        });
                      }
                      this.cleanupStreamingCallback(completionSessionId);
                      resolve();
                    } else {
                      // No more models available
                      const message = `Model \`${this.config.model}\` is not available and no fallback models are available.`;
                      if (callbacks?.onError) {
                        callbacks.onError(new Error(message));
                      }
                      reject(new Error(message));
                    }
                    return;
                  }

                  // Background agent: auto-fallback to next model
                  // Clear the timeout and pending request before retry
                  clearTimeout(timeout);
                  this.pendingRequests.delete(request.id);

                  // Get the original prompt content blocks
                  const originalRequest = JSON.parse(
                    requestStr.substring(0, requestStr.length - 1),
                  );
                  const originalPrompt = originalRequest.params.prompt;

                  // Use the recursive fallback helper - handles unlimited model fallbacks
                  try {
                    await this.attemptPromptWithFallback(
                      originalPrompt,
                      callbackSessionId,
                      resolve,
                      reject,
                    );
                  } catch (err) {
                    reject(err instanceof Error ? err : new Error(String(err)));
                  }
                  return;
                }

                // Check if this is a session-recoverable error (session lost/expired)
                // or an invalid-tool-history error (chat-stream 400/invalidArgument
                // caused by malformed persisted tool_use/tool_result blocks).
                // Both are fixed by recreating the session so the next prompt goes
                // through formatHistoryAsXml() rather than resubmitting the native
                // tool blocks that poisoned the provider-side session state.
                const isInvalidHistoryError = isInvalidToolHistoryError(
                  rawErrorMessage,
                  errorData as
                    | { apiStatus?: string; httpStatus?: number; httpUrl?: string }
                    | undefined,
                );
                if (
                  (isSessionRecoverableError(rawErrorMessage, errorCode, errorData) ||
                    isInvalidHistoryError) &&
                  this.sessionRecoveryAttempts < this.MAX_SESSION_RECOVERY_ATTEMPTS
                ) {
                  this.sessionRecoveryAttempts++;
                  // Do NOT log `rawErrorMessage` directly: it may be sourced
                  // from response.error.data.details, which can contain the
                  // raw HTTP body (tool outputs, prompt echoes). Use the
                  // sanitized summary instead.
                  logger.info(
                    isInvalidHistoryError
                      ? 'Invalid tool history (400/invalidArgument) detected, recreating session'
                      : 'Session error detected, attempting automatic recovery',
                    {
                      errorMessage:
                        typeof response.error.message === 'string'
                          ? response.error.message
                          : undefined,
                      errorCode,
                      recoveryAttempt: this.sessionRecoveryAttempts,
                      maxAttempts: this.MAX_SESSION_RECOVERY_ATTEMPTS,
                      sessionId: this.sessionId,
                      invalidHistoryRecovery: isInvalidHistoryError,
                      error: summarizeProviderErrorForLog(response.error),
                    },
                  );

                  // Clear the timeout and pending request before recovery
                  clearTimeout(timeout);
                  this.pendingRequests.delete(request.id);

                  // Attempt session recovery in background
                  // Don't await - let it run async and retry will happen on next message
                  this.attemptSessionRecoveryAndNotify()
                    .then((recovered) => {
                      if (recovered) {
                        logger.info('Session recovered successfully', {
                          newSessionId: this.sessionId,
                          recoveryAttempt: this.sessionRecoveryAttempts,
                        });

                        // Check if this is a background agent - only auto-retry for background agents
                        const isBackground = this.config.metadata?.isBackground === true;
                        const completionSessionId = this.frontendSessionId || callbackSessionId;

                        if (isBackground) {
                          // AUTO-RETRY: For background agents, retry automatically instead of requiring manual resend
                          logger.info(
                            'Auto-retrying message after session-loss recovery (background agent)',
                            {
                              newSessionId: this.sessionId,
                              messageCount: messages.length,
                              hasOptions: !!options,
                            },
                          );

                          // Clear pendingRetry to prevent double-retry from stderr handler
                          this.pendingRetry = undefined;

                          // Clean up current streaming callbacks before retry
                          this.cleanupStreamingCallback(completionSessionId);

                          // Short delay to ensure session is fully cleaned up
                          setTimeout(async () => {
                            try {
                              await this.streamMessage(messages, options);
                              resolveStream();
                            } catch (retryError: any) {
                              logger.error('Auto-retry after session-loss recovery failed', {
                                error: retryError.message,
                              });
                              rejectStream(retryError);
                            }
                          }, 100);
                        } else {
                          // For interactive agents, notify user to retry their message
                          const callbacks = this.streamingCallbacks.get(completionSessionId);
                          if (callbacks?.onError) {
                            callbacks.onError(
                              new Error('Connection was lost. Please send your message again.'),
                            );
                          }
                          reject(new Error('Connection was lost. Please send your message again.'));
                        }
                      } else {
                        // Terminal path: session recovery returned false (could not
                        // recreate the session). No further retry will happen here,
                        // so use the terminal messaging for invalid-history errors.
                        const userFriendlyMessage = createUserFriendlyErrorMessage(
                          rawErrorMessage,
                          errorCode,
                          this.config.model,
                          this.providerCapabilities.id,
                          errorData,
                          this.config.workspaceId,
                          safeFallbackMessage,
                          true,
                        );
                        const completionSessionId = this.frontendSessionId || callbackSessionId;
                        const callbacks = this.streamingCallbacks.get(completionSessionId);
                        if (callbacks?.onError) {
                          callbacks.onError(new Error(userFriendlyMessage));
                        }
                        reject(new Error(userFriendlyMessage));
                      }
                    })
                    .catch((recoveryError) => {
                      logger.error('Session recovery failed', { error: recoveryError });
                      // Terminal path: session recovery threw. No further retry
                      // will happen from here, so use terminal messaging.
                      const userFriendlyMessage = createUserFriendlyErrorMessage(
                        rawErrorMessage,
                        errorCode,
                        this.config.model,
                        this.providerCapabilities.id,
                        errorData,
                        this.config.workspaceId,
                        safeFallbackMessage,
                        true,
                      );
                      const completionSessionId = this.frontendSessionId || callbackSessionId;
                      const callbacks = this.streamingCallbacks.get(completionSessionId);
                      if (callbacks?.onError) {
                        callbacks.onError(new Error(userFriendlyMessage));
                      }
                      reject(new Error(userFriendlyMessage));
                    });
                  return;
                }

                // Check if this is a context-too-large error (413) — recoverable by
                // recreating the session with truncated history
                if (
                  isContextTooLargeError(rawErrorMessage, errorCode, errorData) &&
                  this.sessionRecoveryAttempts < this.MAX_SESSION_RECOVERY_ATTEMPTS
                ) {
                  this.sessionRecoveryAttempts++;
                  this.contextTooLargeRecoveryCount++;

                  const nextHistoryBudget = Math.max(
                    Math.floor(MAX_HISTORY_CHARS / Math.pow(2, this.contextTooLargeRecoveryCount)),
                    10_000,
                  );

                  // See note above: `rawErrorMessage` may be sourced from
                  // response.error.data.details (raw HTTP body); log only the
                  // sanitized summary + safe top-level message.
                  logger.info(
                    'Context too large (413) — attempting session recovery with reduced history budget',
                    {
                      errorMessage:
                        typeof response.error.message === 'string'
                          ? response.error.message
                          : undefined,
                      errorCode,
                      recoveryAttempt: this.sessionRecoveryAttempts,
                      contextRecoveryCount: this.contextTooLargeRecoveryCount,
                      nextHistoryBudget,
                      defaultHistoryBudget: MAX_HISTORY_CHARS,
                      maxAttempts: this.MAX_SESSION_RECOVERY_ATTEMPTS,
                      sessionId: this.sessionId,
                      error: summarizeProviderErrorForLog(response.error),
                    },
                  );

                  // Clear the timeout and pending request before recovery
                  clearTimeout(timeout);
                  this.pendingRequests.delete(request.id);

                  this.attemptSessionRecoveryAndNotify()
                    .then((recovered) => {
                      if (recovered) {
                        logger.info(
                          'Session recovered after 413 — next message will use reduced history',
                          {
                            newSessionId: this.sessionId,
                            nextHistoryBudget,
                            contextRecoveryCount: this.contextTooLargeRecoveryCount,
                          },
                        );

                        // Check if this is a background agent - only auto-retry for background agents
                        const isBackground = this.config.metadata?.isBackground === true;
                        const completionSessionId = this.frontendSessionId || callbackSessionId;

                        if (isBackground) {
                          // AUTO-RETRY: For background agents, retry automatically with truncated history
                          logger.info(
                            'Auto-retrying message after 413 recovery (background agent)',
                            {
                              newSessionId: this.sessionId,
                              nextHistoryBudget,
                              contextRecoveryCount: this.contextTooLargeRecoveryCount,
                              messageCount: messages.length,
                              hasOptions: !!options,
                            },
                          );

                          // Clear pendingRetry to prevent double-retry from stderr handler
                          this.pendingRetry = undefined;

                          // Clean up current streaming callbacks before retry
                          this.cleanupStreamingCallback(completionSessionId);

                          // Short delay to ensure session is fully cleaned up
                          setTimeout(async () => {
                            try {
                              await this.streamMessage(messages, options);
                              resolveStream();
                            } catch (retryError: any) {
                              logger.error('Auto-retry after 413 recovery failed', {
                                error: retryError.message,
                              });
                              rejectStream(retryError);
                            }
                          }, 100);
                        } else {
                          // For interactive agents, notify user to retry their message
                          const callbacks = this.streamingCallbacks.get(completionSessionId);
                          if (callbacks?.onError) {
                            callbacks.onError(
                              new Error(
                                'Conversation was too large. Please send your message again.',
                              ),
                            );
                          }
                          reject(
                            new Error(
                              'Conversation was too large. Please send your message again.',
                            ),
                          );
                        }
                      } else {
                        // Terminal path: 413 recovery returned false. No
                        // further retry will happen, so use terminal messaging.
                        const userFriendlyMessage = createUserFriendlyErrorMessage(
                          rawErrorMessage,
                          errorCode,
                          this.config.model,
                          this.providerCapabilities.id,
                          errorData,
                          this.config.workspaceId,
                          safeFallbackMessage,
                          true,
                        );
                        const completionSessionId = this.frontendSessionId || callbackSessionId;
                        const callbacks = this.streamingCallbacks.get(completionSessionId);
                        if (callbacks?.onError) {
                          callbacks.onError(new Error(userFriendlyMessage));
                        }
                        reject(new Error(userFriendlyMessage));
                      }
                    })
                    .catch((recoveryError) => {
                      logger.error('Session recovery after 413 failed', {
                        error: recoveryError,
                      });
                      // Terminal path: 413 recovery threw. No further retry
                      // will happen, so use terminal messaging.
                      const userFriendlyMessage = createUserFriendlyErrorMessage(
                        rawErrorMessage,
                        errorCode,
                        this.config.model,
                        this.providerCapabilities.id,
                        errorData,
                        this.config.workspaceId,
                        safeFallbackMessage,
                        true,
                      );
                      const completionSessionId = this.frontendSessionId || callbackSessionId;
                      const callbacks = this.streamingCallbacks.get(completionSessionId);
                      if (callbacks?.onError) {
                        callbacks.onError(new Error(userFriendlyMessage));
                      }
                      reject(new Error(userFriendlyMessage));
                    });
                  return;
                }

                // Check if this is a transient/retryable error (fetch failed, timeout, unavailable)
                // For background agents, auto-retry with exponential backoff
                // For interactive agents, show a user-friendly error message
                if (
                  isTransientPromptError(
                    rawErrorMessage,
                    errorData as { apiStatus?: string; httpStatus?: number } | undefined,
                  ) &&
                  this.transientRetryAttempts < this.MAX_TRANSIENT_RETRY_ATTEMPTS
                ) {
                  this.transientRetryAttempts++;
                  const retryDelayMs = Math.min(
                    1000 * Math.pow(2, this.transientRetryAttempts - 1),
                    10000,
                  ); // 1s, 2s, 4s (capped at 10s)

                  // See note above: `rawErrorMessage` may be sourced from
                  // response.error.data.details (raw HTTP body); log only the
                  // sanitized summary + safe top-level message.
                  logger.warn('Transient prompt error detected, attempting retry', {
                    errorMessage:
                      typeof response.error.message === 'string'
                        ? response.error.message
                        : undefined,
                    errorCode,
                    retryAttempt: this.transientRetryAttempts,
                    maxAttempts: this.MAX_TRANSIENT_RETRY_ATTEMPTS,
                    retryDelayMs,
                    isBackground: this.config.metadata?.isBackground === true,
                    sessionId: this.sessionId,
                    error: summarizeProviderErrorForLog(response.error),
                  });

                  // Clear the timeout and pending request before retry
                  clearTimeout(timeout);
                  this.pendingRequests.delete(request.id);

                  const isBackground = this.config.metadata?.isBackground === true;

                  if (isBackground) {
                    // AUTO-RETRY: For background agents, retry automatically with backoff
                    const completionSessionId = this.frontendSessionId || callbackSessionId;

                    // Clear pendingRetry to prevent double-retry
                    this.pendingRetry = undefined;

                    // Clean up current streaming callbacks before retry
                    this.cleanupStreamingCallback(completionSessionId);

                    setTimeout(async () => {
                      try {
                        await this.streamMessage(messages, options);
                        resolveStream();
                      } catch (retryError: unknown) {
                        logger.error('Auto-retry after transient error failed', {
                          error:
                            retryError instanceof Error ? retryError.message : String(retryError),
                          attempt: this.transientRetryAttempts,
                        });
                        rejectStream(
                          retryError instanceof Error ? retryError : new Error(String(retryError)),
                        );
                      }
                    }, retryDelayMs);
                  } else {
                    // For interactive agents, show error with retry hint
                    const completionSessionId = this.frontendSessionId || callbackSessionId;
                    const callbacks = this.streamingCallbacks.get(completionSessionId);
                    if (callbacks?.onError) {
                      callbacks.onError(
                        new Error(
                          'Connection to the AI service was temporarily lost. Please try again.',
                        ),
                      );
                    }
                    this.cleanupStreamingCallback(completionSessionId);
                    reject(
                      new Error(
                        'Connection to the AI service was temporarily lost. Please try again.',
                      ),
                    );
                  }
                  return;
                }

                // Reset recovery attempts on non-session errors (or if max attempts reached).
                // Keep the counter stable across session-recoverable, context-too-large,
                // and invalid-tool-history errors since they all share the same recovery path.
                if (
                  !isSessionRecoverableError(rawErrorMessage, errorCode, errorData) &&
                  !isContextTooLargeError(rawErrorMessage, errorCode, errorData) &&
                  !isInvalidToolHistoryError(
                    rawErrorMessage,
                    errorData as
                      | { apiStatus?: string; httpStatus?: number; httpUrl?: string }
                      | undefined,
                  )
                ) {
                  this.sessionRecoveryAttempts = 0;
                }

                // Reset transient retry counter on non-transient errors
                if (
                  !isTransientPromptError(
                    rawErrorMessage,
                    errorData as { apiStatus?: string; httpStatus?: number } | undefined,
                  )
                ) {
                  this.transientRetryAttempts = 0;
                }

                // Create user-friendly error message. `rawErrorMessage` is used only
                // for keyword classification; for unclassified errors the function
                // falls back to the recent stderr-derived message (when present) or
                // `response.error.message` rather than the raw HTTP body in
                // `data.details`.
                //
                // Terminal path: this branch is reached when the session-recovery
                // or transient-retry budget is exhausted, or the error isn't
                // one of those recoverable categories. Either way, no further
                // automatic retry will happen for this request, so invalid-history
                // errors must NOT imply an automatic retry is in progress.
                const userFriendlyMessage = createUserFriendlyErrorMessage(
                  rawErrorMessage,
                  errorCode,
                  this.config.model,
                  this.providerCapabilities.id,
                  errorData,
                  this.config.workspaceId,
                  safeFallbackMessage,
                  true,
                );

                // Log sanitized diagnostics (httpStatus/apiStatus/httpUrl/
                // requestId/errorDetails) so 400/invalidArgument failures stay
                // actionable without echoing prompt content or tool payloads.
                // Neither `rawErrorMessage` nor `userFriendlyMessage` are logged
                // here; userFriendlyMessage may include user-facing provider stderr.
                logger.error('Prompt response returned error from agent', {
                  errorCode,
                  errorMessage:
                    typeof response.error.message === 'string'
                      ? response.error.message
                      : undefined,
                  sessionId: this.sessionId,
                  frontendSessionId: this.frontendSessionId,
                  requestId: request.id,
                  error: summarizeProviderErrorForLog(response.error),
                });

                // Emit domain event for authentication errors so UI can show helpful guidance
                if (isAuthenticationError(rawErrorMessage, this.providerCapabilities.id)) {
                  const isRemote = !!this.config.environmentConfig?.ssh;
                  logger.info('Emitting agent:auth-required event', {
                    workspaceId: this.config.workspaceId,
                    agentId: this.config.agentId,
                    providerId: this.providerCapabilities.id,
                    isRemote,
                  });
                  mainDispatch(agentAuthRequired({
                    workspaceId: this.config.workspaceId as WorkspaceId | undefined,
                    agentId: this.config.agentId,
                    isRemote,
                    host: this.config.environmentConfig?.ssh?.host,
                    message: getProviderAuthErrorMessage(this.providerCapabilities.id, isRemote),
                  }));
                }

                // Emit domain event for plan-required errors (enterprise users without Intent access)
                if (isNoIntentPlanError(errorData)) {
                  logger.info('Emitting agent:plan-required event', {
                    workspaceId: this.config.workspaceId,
                    agentId: this.config.agentId,
                    errorCode,
                  });
                  mainDispatch(agentPlanRequired({
                    workspaceId: this.config.workspaceId as WorkspaceId | undefined,
                    agentId: this.config.agentId,
                    message:
                      'Intent is not available on your current plan. Please contact your administrator to upgrade your plan or contact your Augment account manager',
                  }));
                }

                // Clear the timeout and pending request
                clearTimeout(timeout);
                this.pendingRequests.delete(request.id);

                // Notify streaming callbacks about the error with user-friendly message
                const completionSessionId = this.frontendSessionId || callbackSessionId;
                const callbacks = this.streamingCallbacks.get(completionSessionId);
                if (callbacks?.onError) {
                  callbacks.onError(new Error(userFriendlyMessage));
                }

                // Clean up ALL session callbacks including completionSessionId
                const allSessionIds = [
                  this.sessionId,
                  this.frontendSessionId,
                  callbackSessionId,
                  completionSessionId,
                ].filter((id): id is string => Boolean(id));

                const uniqueSessionIds = [...new Set(allSessionIds)];
                for (const sessionIdToClean of uniqueSessionIds) {
                  if (this.streamingCallbacks.has(sessionIdToClean)) {
                    this.cleanupStreamingCallback(sessionIdToClean);
                  }
                }

                // The stderr context has now been surfaced to the caller; clear it
                // so an unrelated future prompt error cannot inherit stale stderr.
                this.recentStderrErrors = [];

                // Reject instead of resolve - use user-friendly message
                reject(new Error(userFriendlyMessage));
                return;
              }

              // Don't immediately complete when we get a prompt response
              // The streaming chunks may still be coming
              // The completion will be handled by:
              // 1. An explicit completion message in session/update
              // 2. The completion detection timer when no more chunks arrive
              // 3. A stopReason in the actual streaming updates

              if (response?.result?.stopReason) {
                // Complete the stream immediately when we get a stopReason
                // This ensures the frontend gets the complete event
                const completionSessionId = this.frontendSessionId || callbackSessionId;
                const currentCallbacks = this.streamingCallbacks.get(completionSessionId);
                // Capture generation to detect if a new stream starts during the setTimeout delay
                const capturedGeneration = currentCallbacks?.streamGeneration;

                logger.info('Prompt response includes stopReason, completing stream', {
                  stopReason: response.result.stopReason,
                  sessionId: this.sessionId,
                  frontendSessionId: this.frontendSessionId,
                  capturedGeneration,
                  hasContentInResponse: !!response.result.content,
                  contentLength: response.result.content?.length,
                });

                // Log detailed content info for debugging background request issues
                if (response.result.content !== undefined) {
                  logger.info('Prompt response content details', {
                    contentType: typeof response.result.content,
                    isArray: Array.isArray(response.result.content),
                    contentPreview:
                      typeof response.result.content === 'string'
                        ? response.result.content.substring(0, 200)
                        : JSON.stringify(response.result.content)?.substring(0, 200),
                  });
                }

                // FIX: Some agents (like OpenCode) don't send session/update streaming
                // notifications. Instead, they include the full content directly in the
                // prompt response. When this happens, we need to extract the content
                // and add it to the message accumulator so handleStreamCompletion finds it.
                //
                // IMPORTANT: Only do this if no content was accumulated via streaming.
                // Agents like OpenCode send BOTH streaming session/update chunks AND include
                // the full content in the prompt response. Without this guard, the content
                // gets added to the accumulator twice, causing duplicated paragraphs in the
                // persisted message.
                const accumulatorId = this.frontendSessionId || this.sessionId;

                // Check if the accumulator already has content from streaming chunks.
                // CRITICAL: Check ALL possible session IDs, not just accumulatorId.
                // The streaming handler accumulates content under streamingAgentId
                // (config.id/config.agentId), which differs from frontendSessionId/sessionId.
                // Without checking all IDs, we'd miss streamed content and re-add it.
                const possibleAccumulatorIds = [
                  accumulatorId,
                  this.frontendSessionId,
                  this.sessionId,
                  this.streamingAgentId,
                ].filter((id): id is string => Boolean(id));
                const uniqueAccumulatorIds = [...new Set(possibleAccumulatorIds)];

                let hasStreamedContent = false;
                let streamedContentId: string | undefined;
                for (const sid of uniqueAccumulatorIds) {
                  const existing = messageAccumulator.getAccumulated(sid);
                  if (
                    existing &&
                    (existing.content.length > 0 || existing.orderedItems.length > 0)
                  ) {
                    hasStreamedContent = true;
                    streamedContentId = sid;
                    break;
                  }
                }

                if (hasStreamedContent) {
                  logger.info(
                    'Skipping prompt response content extraction - accumulator already has streamed content',
                    {
                      accumulatorId,
                      streamedContentId,
                      checkedIds: uniqueAccumulatorIds,
                      responseContentType: typeof response.result.content,
                      responseHasContent: !!response.result.content,
                    },
                  );
                } else if (response.result.content && Array.isArray(response.result.content)) {
                  const contentBlocks = parseACPMessage(response.result.content);

                  if (contentBlocks && contentBlocks.length > 0 && accumulatorId) {
                    logger.info('Extracting content from prompt response for non-streaming agent', {
                      accumulatorId,
                      blocksCount: contentBlocks.length,
                      blockTypes: contentBlocks.map((b) => b.type),
                    });

                    // Ensure accumulator exists for this session
                    if (!messageAccumulator.getActiveSessionIds().includes(accumulatorId)) {
                      messageAccumulator.startAccumulation(accumulatorId);
                    }

                    // Add each content block to the accumulator
                    for (const block of contentBlocks) {
                      if (block.type === 'text' && 'text' in block && block.text) {
                        messageAccumulator.addChunk(accumulatorId, block.text);
                      } else if (block.type === 'tool_use') {
                        // For tool_use blocks, add them as structured content
                        messageAccumulator.addContentBlock(accumulatorId, block);
                      }
                    }
                  }
                } else if (
                  response.result.content &&
                  typeof response.result.content === 'string' &&
                  accumulatorId
                ) {
                  // Handle string content — some agents (e.g. auggie with --quiet)
                  // return a plain string instead of content blocks array
                  logger.info(
                    'Extracting string content from prompt response for non-streaming agent',
                    {
                      accumulatorId,
                      contentLength: response.result.content.length,
                    },
                  );

                  if (!messageAccumulator.getActiveSessionIds().includes(accumulatorId)) {
                    messageAccumulator.startAccumulation(accumulatorId);
                  }
                  messageAccumulator.addChunk(accumulatorId, response.result.content);
                }

                setTimeout(() => {
                  // Only complete if there's still a callback registered
                  // This prevents duplicate completions
                  const callbacksNow = this.streamingCallbacks.get(completionSessionId);
                  if (callbacksNow) {
                    // Check if a new stream started during the delay
                    if (
                      capturedGeneration !== undefined &&
                      callbacksNow.streamGeneration !== capturedGeneration
                    ) {
                      logger.info(
                        'Ignoring prompt completion - stream generation changed during setTimeout',
                        {
                          completionSessionId,
                          capturedGeneration,
                          currentGeneration: callbacksNow.streamGeneration,
                        },
                      );
                      return;
                    }

                    this.handleStreamCompletion(completionSessionId, response.result.stopReason);

                    // Also clean up any other related session callbacks
                    // to prevent duplicate inactivity timeouts
                    const relatedSessionIds = [
                      this.sessionId,
                      this.frontendSessionId,
                      callbackSessionId,
                    ]
                      .filter((id): id is string => Boolean(id))
                      .filter((id) => id !== completionSessionId);

                    for (const relatedId of relatedSessionIds) {
                      const relatedCallbacks = this.streamingCallbacks.get(relatedId);
                      if (relatedCallbacks) {
                        // Don't clean up callbacks from a NEWER stream generation.
                        // When a second streamMessage registers callbacks before the first
                        // stream's completion cleanup runs, the new callbacks share session
                        // IDs (e.g. agentId) but belong to a higher generation. Cleaning
                        // them here would cause "Cannot complete stream" errors for the
                        // new stream.
                        if (
                          capturedGeneration !== undefined &&
                          relatedCallbacks.streamGeneration !== undefined &&
                          relatedCallbacks.streamGeneration > capturedGeneration
                        ) {
                          logger.debug(
                            'Skipping cleanup of related session callback - belongs to newer generation',
                            {
                              sessionId: relatedId,
                              primarySessionId: completionSessionId,
                              relatedGeneration: relatedCallbacks.streamGeneration,
                              completingGeneration: capturedGeneration,
                            },
                          );
                          continue;
                        }
                        logger.debug('Cleaning up related session callback', {
                          sessionId: relatedId,
                          primarySessionId: completionSessionId,
                        });
                        this.cleanupStreamingCallback(relatedId);
                      }
                    }
                  } else {
                    logger.debug('Stream already completed, skipping duplicate completion', {
                      sessionId: completionSessionId,
                      stopReason: response.result.stopReason,
                    });
                  }
                }, 100); // Small delay to ensure all chunks are processed
              }

              // Clear the timeout and pending request
              clearTimeout(timeout);
              this.pendingRequests.delete(request.id);

              logger.debug('Prompt request accepted, streaming in progress', {
                sessionId: callbackSessionId,
              });

              // Resolve the inner promise to indicate request was accepted
              // The outer promise will resolve when streaming completes
              resolve();
            },
            reject,
            timeout,
          });
        });

        // Wait for the response to ensure the request was accepted
        // But don't wait for streaming to complete (that's handled by callbacks)
        await responsePromise;

        logger.debug('Prompt request sent, waiting for streaming to begin', {
          sessionId: this.sessionId,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const isInterruption = errorMessage === 'Agent interrupted';

        // Log at appropriate level based on whether this is an expected interruption
        if (isInterruption) {
          logger.info('Stream interrupted by user', {
            sessionId: this.sessionId,
          });
        } else {
          logger.error('Error in streamMessage', error as Error);
        }

        // Clean up streaming callbacks on error
        if (this.sessionId) {
          this.cleanupStreamingCallback(this.sessionId);
        }

        // The wrapped callbacks will handle the error
        rejectStream(error as Error);
      }
      // Don't clean up callbacks in finally - they need to stay active for streaming
    }); // End of promise wrapper
  }

  getMaxInputTokens(): number {
    return 100000; // Default, should be configured per agent
  }

  getMaxOutputTokens(): number {
    return 4096; // Default, should be configured per agent
  }

  /**
   * Get the current session ID
   * Used to synchronize session state after loading from disk
   */
  getSessionId(): string | undefined {
    return this.sessionId;
  }

  supportsStreaming(): boolean {
    return true; // ACP supports streaming via session/update notifications
  }

  async getAvailableModels(): Promise<string[]> {
    return ['default']; // ACP agents don't expose models
  }

  validateProviderConfig(): boolean {
    // Basic validation - ensure we have either a command or workspaceId
    return !!(this.config.command || this.config.workspaceId);
  }

  extractToken(): string | null {
    // ACP doesn't use tokens in the same way
    return null;
  }

  extractToolCall(): any | null {
    // ACP handles tool calls internally
    return null;
  }

  /**
   * Clean up all resources
   */
  async cleanup(): Promise<void> {
    logger.info('Cleaning up ACP provider', {
      agentId: this.config.agentId,
      sessionId: this.sessionId,
    });

    // Clean up all streaming callbacks to prevent memory leaks
    for (const [sessionId] of this.streamingCallbacks) {
      this.cleanupStreamingCallback(sessionId);
    }

    // Stop the provider - use forceCleanup: true since cleanup means we're fully cleaning up
    await this.stop({ forceCleanup: true });

    // Clean up temp files (rules and MCP config)
    this.cleanupTempFiles();

    // Call parent cleanup
    await super.cleanup();
  }

  /**
   * Clean up temporary files created for auggie (rules file, MCP config)
   * These files are needed by auggie for its entire lifetime, so we only
   * clean them up when the agent is stopped/cleaned up - NOT on a timer!
   */
  private cleanupTempFiles(): void {
    if (this.tempRulesFilePath) {
      try {
        if (fs.existsSync(this.tempRulesFilePath)) {
          fs.unlinkSync(this.tempRulesFilePath);
          logger.debug('Cleaned up temp rules file', { path: this.tempRulesFilePath });
        }
      } catch (error) {
        // Ignore cleanup errors - file may already be deleted
        logger.debug('Failed to clean up temp rules file (may already be deleted)', {
          path: this.tempRulesFilePath,
          error: (error as Error).message,
        });
      }
      this.tempRulesFilePath = undefined;
    }

    if (this.tempMcpConfigPath) {
      try {
        if (fs.existsSync(this.tempMcpConfigPath)) {
          fs.unlinkSync(this.tempMcpConfigPath);
          logger.debug('Cleaned up temp MCP config file', { path: this.tempMcpConfigPath });
        }
      } catch (error) {
        // Ignore cleanup errors - file may already be deleted
        logger.debug('Failed to clean up temp MCP config file (may already be deleted)', {
          path: this.tempMcpConfigPath,
          error: (error as Error).message,
        });
      }
      this.tempMcpConfigPath = undefined;
    }
  }

  /**
   * Clean up streaming callbacks for a session
   */
  private cleanupStreamingCallback(sessionId: string): void {
    // Clear any completion detection timer
    const timer = this.streamCompletionTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.streamCompletionTimers.delete(sessionId);
    }

    // Clear retry count for stalled stream detection
    this.stalledStreamRetryCount.delete(sessionId);

    const callbacks = this.streamingCallbacks.get(sessionId);
    if (callbacks) {
      // No need to flush buffer since we're sending chunks immediately now

      // Clear the callbacks to prevent memory leaks
      this.streamingCallbacks.delete(sessionId);
      logger.debug('Cleaned up streaming callbacks', { sessionId });
    }

    // Reset streaming flag if no more active streams
    if (this.streamingCallbacks.size === 0) {
      this.isStreaming = false;
      // Mark process idle in the global registry so it can be evicted if needed
      if (this.agentProcess?.pid) {
        markProcessIdle(this.agentProcess.pid);
      }
      // All streams done — start the idle timer so the process is killed if unused
      this.resetIdleTimer();
    }
  }

  /**
   * Reset the completion detection timer
   * Called whenever we receive new content to track activity.
   *
   * NOTE: This method NO LONGER triggers stream completion on timeout.
   * Streams should only complete when Auggie sends an explicit stopReason.
   * Agent responses can take arbitrarily long (tool calls, thinking, etc).
   * If a stream truly stalls, checkForStalledStreams() will handle it by
   * showing an error to the user - not by silently completing.
   *
   * @param sessionId - The session ID
   * @param _timeout - DEPRECATED: No longer used, kept for API compatibility
   */
  private resetCompletionDetection(sessionId: string): void {
    // Clear any existing timer (legacy cleanup)
    const existingTimer = this.streamCompletionTimers.get(sessionId);
    if (existingTimer) {
      logger.debug('Clearing existing completion detection timer', { sessionId });
      clearTimeout(existingTimer);
      this.streamCompletionTimers.delete(sessionId);
    }

    // Update last activity time for stall detection
    // This is now the only purpose of this method
    const callbacks = this.streamingCallbacks.get(sessionId);
    if (callbacks) {
      callbacks.lastActivityTime = Date.now();

      // If activity resumes after a stall error was shown, reset the retry count
      // This allows future stalls to be detected and reported again
      // The sentinel value (maxStallRetries + 100) means "error shown, don't retry"
      const currentRetryCount = this.stalledStreamRetryCount.get(sessionId) || 0;
      if (currentRetryCount > AGENT_STREAMING_CONFIG.MAX_STALL_RETRIES) {
        logger.info('Activity resumed after stall error - resetting retry count', {
          sessionId,
          previousRetryCount: currentRetryCount,
        });
        this.stalledStreamRetryCount.delete(sessionId);
      }
    }
  }

  /**
   * Handle stream completion when detected
   * Note: This is async to allow awaiting the onComplete callback for persistence
   */
  private async handleStreamCompletion(
    sessionId: string,
    stopReason: string = 'end_turn',
  ): Promise<void> {
    // Record successful operation in circuit breaker — resets failure counts
    // and allows circuit to close after half-open state
    if (this.config.workspaceId) {
      const workspaceId = this.config.workspaceId;
      void Promise.resolve()
        .then(() => {
          agentCircuitBreaker.recordSuccess(workspaceId);
        })
        .catch(() => {
          // Circuit breaker not available — non-critical
        });
    }

    // Reset session recovery attempts on successful stream completion
    // This allows future session errors to trigger recovery again
    if (this.sessionRecoveryAttempts > 0) {
      logger.debug('Resetting session recovery attempts after successful stream', {
        previousAttempts: this.sessionRecoveryAttempts,
      });
      this.sessionRecoveryAttempts = 0;
    }

    // Reset tried models on successful completion
    if (this.triedModels.size > 0) {
      logger.debug('Resetting tried models after successful stream', {
        triedModels: Array.from(this.triedModels),
      });
      this.triedModels.clear();
    }

    // First check if callbacks still exist - they may have been cleaned up already
    // by a regular complete message from the agent
    const callbacks = this.streamingCallbacks.get(sessionId);
    if (!callbacks) {
      logger.debug('Stream already completed, skipping timeout-based completion', {
        sessionId,
        stopReason,
      });
      return;
    }

    // CRITICAL: Check if this completion is from a stale stream generation.
    // This prevents the "two split streams" bug where:
    // 1. User stops stream A, new stream B starts with same frontendSessionId
    // 2. Auggie's cancelled response for stream A arrives
    // 3. Without this check, we'd complete stream B's callbacks with A's cancelled response
    // 4. Stream B's chunks would then create a new message (no streaming message exists)
    // 5. User would see TWO messages
    if (
      callbacks.streamGeneration !== undefined &&
      callbacks.streamGeneration !== this.streamGeneration
    ) {
      logger.info('Ignoring stream completion from stale generation', {
        sessionId,
        stopReason,
        callbackGeneration: callbacks.streamGeneration,
        currentGeneration: this.streamGeneration,
      });
      // Clean up stale callbacks to prevent memory leak
      this.cleanupStreamingCallback(sessionId);
      return;
    }

    // No need to flush buffer since we're sending chunks immediately now

    // Track which accumulator session ID had content - needed for cleanup
    let accumulatorSessionId: string | null = null;

    if (callbacks.onComplete) {
      logger.info('Completing stream due to inactivity', {
        sessionId,
        stopReason,
      });

      // Get accumulated content before completing
      let finalContent = '';
      let finalContentBlocks = callbacks.contentBlocks || [];

      try {
        // Try with different session IDs since they might differ
        // CRITICAL: Include streamingAgentId — the streaming handler accumulates content
        // under this ID (which is config.id/config.agentId or a generated 'agent-{timestamp}'),
        // but sessionId/frontendSessionId are ACP protocol IDs. For background requests these
        // are always different, so without streamingAgentId the content would never be found.
        const possibleSessionIds = [
          sessionId,
          this.frontendSessionId,
          this.sessionId,
          this.streamingAgentId,
        ].filter(Boolean);

        // IMPORTANT: Only use THIS agent's session IDs to prevent cross-agent contamination.
        // Do NOT use messageAccumulator.getActiveSessionIds() — that returns ALL agents' IDs,
        // which can cause one agent to return another agent's stale content.
        const uniqueSessionIds = [...new Set(possibleSessionIds)];

        for (const sid of uniqueSessionIds) {
          if (!sid) continue;
          // IMPORTANT: Use getPartialContent which properly builds ordered content blocks
          // that include both text and tool_use blocks in the correct order.
          // getAccumulated().contentBlocks only contains tool_use blocks, NOT text blocks.
          const partial = messageAccumulator.getPartialContent(sid);
          if (partial.content || partial.contentBlocks.length > 0) {
            logger.info('Found accumulated content in handleStreamCompletion', {
              sessionId: sid,
              contentLength: partial.content?.length || 0,
              blocksCount: partial.contentBlocks?.length || 0,
              blockTypes: partial.contentBlocks.map((b) => b.type),
              hasTextBlock: partial.contentBlocks.some((b) => b.type === 'text'),
            });
            finalContent = partial.content || '';
            finalContentBlocks =
              partial.contentBlocks.length > 0 ? partial.contentBlocks : finalContentBlocks;
            accumulatorSessionId = sid; // Remember which session ID had the content
            break;
          }
        }

        if (!finalContent?.trim() && finalContentBlocks.length === 0) {
          // If the stream was cancelled, this is expected behavior - not an error.
          // Cancellation happens when a new message is sent while a stream is in-flight,
          // or when the user explicitly cancels. In this case, we should just clean up
          // silently without triggering an error callback.
          if (stopReason === 'cancelled') {
            // CRITICAL FIX: Even when cancelled with no content, we must:
            // 1. Clear the messageAccumulator to prevent stale entries
            // 2. Call onComplete so the backend handler can clean up streamStartTimes
            // Without this, the stream appears "active" after page refresh.
            const sessionIdsToClean = [sessionId, this.sessionId, this.frontendSessionId].filter(
              (id): id is string => Boolean(id),
            );

            for (const sid of [...new Set(sessionIdsToClean)]) {
              try {
                messageAccumulator.clear(sid);
                logger.debug('Cleared messageAccumulator on cancelled stream', { sessionId: sid });
              } catch {
                // Ignore - accumulator may not exist for this session ID
              }
            }

            // Call onComplete with cancelled indicator so backend can clean up streamStartTimes
            // This is essential to prevent streams from appearing "active" after page refresh.
            // IMPORTANT: Await the callback (like the normal path at line 7759) to ensure
            // persistence completes before cleanup proceeds.
            if (callbacks.onComplete) {
              const messageId = unifiedIdService.generateMessageId();
              await Promise.resolve(
                callbacks.onComplete({
                  id: messageId,
                  role: 'assistant',
                  content: '',
                  contentBlocks: [],
                  metadata: {
                    stopReason: 'cancelled',
                  },
                  timestamp: new Date().toISOString(),
                }),
              );
            }

            logger.info(
              'Stream cancelled with no content - this is expected, cleaning up silently',
              {
                sessionId,
                stopReason,
              },
            );
            this.cleanupStreamingCallback(sessionId);
            this.currentStreamingRequestId = null;
            return;
          }

          // CRITICAL FIX: Agent returned a response (e.g., end_turn) but with no content.
          // This typically happens when the agent process encountered an error (e.g., unable to
          // connect to a provider URL) and returned an empty response instead of streaming content.
          const lastStderrError =
            this.recentStderrErrors.length > 0
              ? this.recentStderrErrors[this.recentStderrErrors.length - 1]
              : '';

          logger.error('Agent returned empty response (no content streamed)', {
            triedSessionIds: uniqueSessionIds,
            sessionId,
            stopReason,
            lastStderrError,
          });

          // Trigger error callback instead of completing successfully.
          // Include stderr context so the user sees what actually went wrong.
          if (callbacks.onError) {
            const truncatedStderr =
              lastStderrError.length > 500
                ? lastStderrError.substring(0, 500) + '...'
                : lastStderrError;
            const stderrContext = truncatedStderr ? ` Provider error: ${truncatedStderr}` : '';
            callbacks.onError(new Error(`The agent returned an empty response.${stderrContext}`));
          }

          // Clear the stderr buffer after surfacing - these errors have been reported
          this.recentStderrErrors = [];

          // Clean up and return early - don't call onComplete
          this.cleanupStreamingCallback(sessionId);

          // Clear the current streaming request ID since the stream is complete
          this.currentStreamingRequestId = null;

          // Also resolve any pending prompt request
          for (const [id, pending] of this.pendingRequests) {
            // Resolve the pending request with a synthetic response
            pending.resolve({
              result: { stopReason: 'error' },
            });
            this.pendingRequests.delete(id);
          }
          return;
        }
      } catch (error) {
        logger.error('Error getting accumulated content on inactivity complete', { error });
      }

      // Use the pre-assigned assistant message ID from the per-session callbacks map,
      // so both renderer and backend share the same identity for this message.
      // Reading from the callbacks struct (keyed by sessionId) instead of an instance
      // field avoids a race when two streams overlap: the second streamMessage() would
      // overwrite the instance field before the first's handleStreamCompletion() reads it.
      // Fall back to generating a fresh ID if none was provided (e.g. backend-initiated messages).
      const messageId = callbacks.assistantMessageId || unifiedIdService.generateMessageId();

      const finalMessage: StreamMessage = {
        id: messageId,
        role: 'assistant',
        content: finalContent,
        contentBlocks:
          finalContentBlocks.length > 0
            ? finalContentBlocks
            : finalContent
              ? [{ type: 'text' as const, text: finalContent }]
              : [],
        metadata: {
          stopReason,
          originalSessionId: sessionId, // Keep track of the original session ID
          accumulatorSessionId, // Track which accumulator we used
          auggieSessionId: this.sessionId, // Raw auggie session ID (UUID format)
        },
        timestamp: new Date().toISOString(),
      };

      // IMPORTANT: Await the onComplete callback to ensure persistence completes before cleanup
      // This fixes the race condition where HMR causes the frontend to load stale data from disk
      // before the backend has finished persisting the final message with suggested prompts
      await Promise.resolve(callbacks.onComplete(finalMessage));

      // Clear stderr buffer on successful completion to prevent stale errors
      // from being shown if a subsequent stream fails
      this.recentStderrErrors = [];

      // Clean up any other related session IDs after completion
      // This prevents duplicate inactivity timeouts
      const completingGeneration = callbacks.streamGeneration;
      const relatedSessionIds = [
        this.sessionId,
        this.frontendSessionId,
        accumulatorSessionId,
      ].filter((id): id is string => Boolean(id) && id !== sessionId);

      for (const relatedId of relatedSessionIds) {
        const relatedCallbacks = this.streamingCallbacks.get(relatedId);
        if (relatedCallbacks) {
          // Don't clean up callbacks from a NEWER stream generation.
          // A second streamMessage may have registered new callbacks under a shared
          // session ID (e.g. agentId) before this completion handler runs. Those
          // callbacks belong to the active stream and must not be removed.
          if (
            completingGeneration !== undefined &&
            relatedCallbacks.streamGeneration !== undefined &&
            relatedCallbacks.streamGeneration > completingGeneration
          ) {
            logger.debug(
              'Skipping cleanup of related session callback in handleStreamCompletion - belongs to newer generation',
              {
                sessionId: relatedId,
                primarySessionId: sessionId,
                relatedGeneration: relatedCallbacks.streamGeneration,
                completingGeneration,
              },
            );
            continue;
          }
          logger.debug('Cleaning up related session callback in handleStreamCompletion', {
            sessionId: relatedId,
            primarySessionId: sessionId,
          });
          this.cleanupStreamingCallback(relatedId);
        }
      }
    }

    // Clean up the primary session callback after onComplete finishes
    // But only if it still belongs to the same generation — a new stream may have
    // registered fresh callbacks under the same sessionId while we awaited onComplete.
    const primaryCallbacks = this.streamingCallbacks.get(sessionId);
    if (
      primaryCallbacks &&
      callbacks.streamGeneration !== undefined &&
      primaryCallbacks.streamGeneration !== undefined &&
      primaryCallbacks.streamGeneration > callbacks.streamGeneration
    ) {
      logger.debug(
        'Skipping primary session cleanup - callbacks belong to newer generation',
        {
          sessionId,
          completingGeneration: callbacks.streamGeneration,
          currentGeneration: primaryCallbacks.streamGeneration,
        },
      );
    } else {
      this.cleanupStreamingCallback(sessionId);
    }

    // CRITICAL: Clear the messageAccumulator ONLY for session IDs related to THIS agent.
    // DO NOT clear all active accumulators - that would destroy content for other agents!
    // This was a bug that caused delegated agents to lose their content when the parent completed.
    // Only clear session IDs that belong to this specific agent session:
    // - The sessionId passed to this function (frontend agent ID)
    // - The internal ACP session ID (this.sessionId)
    // - The frontend session ID mapping (this.frontendSessionId)
    // - The accumulator session ID we found content in
    const sessionIdsToClean = [
      sessionId,
      this.sessionId,
      this.frontendSessionId,
      accumulatorSessionId, // Only the specific accumulator we used
    ].filter((id): id is string => Boolean(id));

    // Deduplicate
    const uniqueSessionIds = [...new Set(sessionIdsToClean)];

    for (const sid of uniqueSessionIds) {
      try {
        messageAccumulator.clear(sid);
        logger.debug('Cleared messageAccumulator in handleStreamCompletion', { sessionId: sid });
      } catch {
        // Ignore - accumulator may not exist for this session ID
      }
    }

    // Clear the current streaming request ID since the stream is complete
    this.currentStreamingRequestId = null;

    // Also resolve any pending prompt request
    for (const [id, pending] of this.pendingRequests) {
      // Resolve the pending request with a synthetic response
      pending.resolve({
        jsonrpc: '2.0',
        id,
        result: {
          stopReason,
        },
      });
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(id);
      break; // Only resolve the first one (should only be one)
    }
  }

  /**
   * Build comprehensive rules content including system prompt and workspace context
   */
  private async buildRulesContent(): Promise<string> {
    const parts: string[] = [];

    // Add system prompt if provided
    if (this.config.systemPrompt) {
      parts.push(this.config.systemPrompt);
    }

    // Add agent/runtime metadata to help providers behave consistently when swapped.
    parts.push('\n## Agent Context\n');
    parts.push('This session is running inside the Intent app as an ACP agent.');
    parts.push(`- **Provider**: ${this.providerCapabilities.id}`);
    parts.push(`- **Agent ID**: ${this.config.agentId || 'unknown'}`);
    parts.push(`- **Agent Name**: ${this.config.name || 'Agent'}`);
    parts.push(`- **Agent Type**: ${this.config.metadata?.agentType || 'default'}`);
    parts.push(`- **Specialist**: ${this.config.metadata?.specialist || 'none'}`);
    parts.push(`- **Selected Model**: ${this.config.model || 'default'}`);

    // Add workspace context information
    parts.push('\n## Workspace Context\n');
    parts.push('You are working in a workspace with the following information:');
    parts.push(`- **Workspace ID**: ${this.config.workspaceId || 'unknown'}`);
    parts.push(`- **Workspace Path**: ${this.config.workspacePath || 'Not set'}`);

    // Get current UI context if available
    try {
      // Import workspace service to get current context
      const { workspaceService } = await import('../../../workspace/main/workspace.service');
      if (this.config.workspaceId) {
        const currentContext = await workspaceService.getCurrentContext(
          this.config.workspaceId as WorkspaceId,
        );

        if (currentContext) {
          parts.push('\n### Current UI Context');

          // Main content type and details
          if (currentContext.mainContentType !== 'empty') {
            parts.push(`- **Main Panel**: ${currentContext.mainContentType}`);

            if (currentContext.mainContentPath) {
              parts.push(`  - Path: ${currentContext.mainContentPath}`);
            }

            if (currentContext.mainContentId) {
              parts.push(`  - ID: ${currentContext.mainContentId}`);
            }

            // Add diff-specific information
            if (currentContext.mainContentType === 'diff' && currentContext.diffInfo) {
              const info = currentContext.diffInfo;
              parts.push(`  - Changes: +${info.additions} -${info.deletions}`);
              parts.push(`  - Status: ${info.gitStatus} (${info.changeType})`);
              if (info.isStaged) {
                parts.push('  - Staged: Yes');
              }
            }
          }

          // Secondary content if present
          if (
            currentContext.secondaryContentType &&
            currentContext.secondaryContentType !== 'empty'
          ) {
            parts.push(`- **Secondary Panel**: ${currentContext.secondaryContentType}`);

            if (currentContext.secondaryContentPath) {
              parts.push(`  - Path: ${currentContext.secondaryContentPath}`);
            }

            if (currentContext.secondaryContentId) {
              parts.push(`  - ID: ${currentContext.secondaryContentId}`);
            }
          }
        }
      }
    } catch (error) {
      logger.debug('Could not get workspace UI context', error as Error);
    }

    // Add information about available MCP tools
    parts.push('\n## Available Tools\n');
    parts.push(
      'You have access to the workspace through a single MCP tool from the workspace MCP server: `workspace_api`. Invoke it with JavaScript that calls the `ws.*` API and use `return` to send results back. Common calls:',
    );
    parts.push(
      '- **Notes**: ws.note.read(id), ws.note.add(id, { content }), ws.note.edit(id, { old, new }), ws.note.create(title, content), ws.note.list(), ws.note.listTasks(id)',
    );
    parts.push(
      '- **Specification**: ws.note.read("spec"), ws.note.add("spec", { content }) (the main workspace specification document)',
    );
    parts.push(
      '- **Workspace Management**: ws.workspace.details(), ws.workspace.setTitle(title), ws.workspace.setAgentName(name)',
    );
    parts.push('- **Activity**: ws.workspace.timeline() (view recent workspace activities)');

    // Add configured user MCP server names so the agent knows what to expect,
    // even before tools finish loading.
    const userMcpServerNames = new Set<string>();
    for (const serverName of this.mcpServerCommandMap.values()) {
      if (serverName !== 'workspace-mcp') {
        userMcpServerNames.add(serverName);
      }
    }
    if (userMcpServerNames.size > 0) {
      const serverList = Array.from(userMcpServerNames)
        .map((name) => `- ${name}`)
        .join('\n');
      parts.push(
        `\n## Configured MCP Servers\n\nThe following MCP servers are configured and their tools should be available (suffixed with the server name, e.g. \`toolName_${Array.from(userMcpServerNames)[0]}\`):\n${serverList}\n\nNote: If tools from a configured server are not yet visible, the server may still be initializing (especially remote/OAuth servers which can take 15-30 seconds). Let the user know the server is configured but may need a moment, rather than saying the tool doesn't exist.`,
      );
    }

    parts.push(
      '\nThese tools are automatically available to you. Use them as needed to interact with the workspace.',
    );

    // Add guidelines for using the workspace
    parts.push('\n## Guidelines\n');
    parts.push(
      '1. **Focus on the workspace context** - Be aware of what files are open and what the user is looking at',
    );
    parts.push(
      '2. **Use the specification document** - The spec (accessible via `workspace_api` with ws.note.read("spec") / ws.note.add("spec", ...)) is the primary artifact for planning and documentation',
    );
    parts.push(
      '3. **Reference specific files** - When discussing code, reference the actual files in the workspace',
    );
    parts.push(
      '4. **Maintain workspace organization** - Keep notes and files organized within the workspace structure',
    );
    parts.push(
      '5. **Be context-aware** - Your responses should be relevant to the current file/note/diff the user is viewing',
    );
    parts.push(
      "6. **Rename yourself** - As the first thing you do, call `workspace_api` with ws.workspace.setAgentName(\"...\") to name yourself so the developer knows what you're working on.",
    );

    return parts.join('\n');
  }

  /**
   * Get the path to the stderr log file for this agent.
   * Creates the logs directory if it doesn't exist.
   * Returns the path to the log file.
   */
  private getStderrLogPath(): string | null {
    if (!this.config.workspaceId || !this.config.agentId) {
      return null;
    }

    try {
      const logsDir = WorkspaceConfig.paths.logs(this.config.workspaceId);

      // Ensure logs directory exists
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }

      // Create log file path with agent ID
      const logPath = path.join(logsDir, `agent-${this.config.agentId}.log`);
      return logPath;
    } catch (error) {
      logger.warn('Failed to get stderr log path', {
        error: (error as Error).message,
        workspaceId: this.config.workspaceId,
        agentId: this.config.agentId,
      });
      return null;
    }
  }

  /**
   * Clean up old log files for this agent, keeping only the last 5.
   * This prevents log files from accumulating indefinitely.
   */
  private cleanupOldLogs(): void {
    if (!this.config.workspaceId || !this.config.agentId) {
      return;
    }

    try {
      const logsDir = WorkspaceConfig.paths.logs(this.config.workspaceId);
      if (!fs.existsSync(logsDir)) {
        return;
      }

      // Find all log files for this agent
      const files = fs.readdirSync(logsDir);
      const agentLogs = files
        .filter((f) => f.startsWith(`agent-${this.config.agentId}`))
        .map((f) => ({
          name: f,
          path: path.join(logsDir, f),
          mtime: fs.statSync(path.join(logsDir, f)).mtime.getTime(),
        }))
        .sort((a, b) => b.mtime - a.mtime); // Sort by modification time, newest first

      // Keep only the last 5 log files
      const filesToDelete = agentLogs.slice(5);
      for (const file of filesToDelete) {
        try {
          fs.unlinkSync(file.path);
          logger.debug('Deleted old agent log file', {
            file: file.name,
            agentId: this.config.agentId,
          });
        } catch (deleteError) {
          logger.warn('Failed to delete old log file', {
            file: file.name,
            error: (deleteError as Error).message,
          });
        }
      }
    } catch (error) {
      logger.warn('Failed to cleanup old logs', {
        error: (error as Error).message,
        agentId: this.config.agentId,
      });
    }
  }

  /**
   * Write stderr data to the workspace log file.
   * Appends to the log file with timestamp.
   */
  private writeStderrToLog(data: string): void {
    const logPath = this.getStderrLogPath();
    if (!logPath) {
      return;
    }

    try {
      const timestamp = new Date().toISOString();
      const logEntry = `[${timestamp}] ${data}\n`;
      fs.appendFileSync(logPath, logEntry);
    } catch (error) {
      logger.warn('Failed to write to stderr log', {
        error: (error as Error).message,
        logPath,
      });
    }
  }

  /**
   * Set up process cleanup handlers
   */
  private setupProcessCleanup(): void {
    if (!this.agentProcess) return;

    // Handle process exit
    this.agentProcess.on('exit', async (code, signal) => {
      logger.info('Agent process exited', { code, signal });
      await this.handleProcessExit(code, signal);
    });

    // Handle process errors
    this.agentProcess.on('error', (error) => {
      logger.error('Agent process error', error);
      this.emit('error', error);
    });

    // Set up graceful shutdown handlers (only once per provider)
    if (!this.shutdownHandlersSetup) {
      this.shutdownHandlersSetup = true;

      const gracefulShutdown = async (signal: string) => {
        logger.info('Graceful shutdown initiated', { signal, agentId: this.config.agentId });
        // Use forceCleanup: true since the app is shutting down
        await this.stop({ forceCleanup: true });
      };

      process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
      process.once('SIGINT', () => gracefulShutdown('SIGINT'));
    }
  }

  /**
   * Handle process exit
   */
  private async handleProcessExit(
    code: number | null,
    signal: NodeJS.Signals | null,
  ): Promise<void> {
    // Enhanced logging to help debug process exit issues
    logger.info('Handling process exit', {
      code,
      signal,
      isIntentional: this.isStoppingIntentionally,
      isRestarting: this.isRestartingProcess,
      isReconnecting: this.isReconnecting,
      isRemote: this.isRemoteWorkspace(),
      sshConnected: this.sshConnectionId ? sshManager.isConnected(this.sshConnectionId) : undefined,
      agentId: this.config.agentId,
      workspaceId: this.config.workspaceId,
      sessionId: this.sessionId,
      sessionWasRecreated: this.sessionWasRecreated,
      activeStreams: this.streamingCallbacks.size,
      pendingRequests: this.pendingRequests.size,
    });

    // CRITICAL: Remove all stream listeners from the dying process BEFORE clearing the reference.
    // If we set agentProcess = undefined first, the old process's native stream handles
    // (stdin/stdout/stderr) become orphaned. When V8's GC later finalizes the AsyncWrap
    // objects wrapping those streams, it can hit a freed/null native handle, causing
    // SIGSEGV in AsyncWrap::~AsyncWrap() -> v8::ToExternalPointerTag().
    const dyingProcess = this.agentProcess;
    if (dyingProcess) {
      dyingProcess.removeAllListeners('exit');
      dyingProcess.removeAllListeners('error');
      dyingProcess.stdout?.removeAllListeners('data');
      dyingProcess.stdout?.removeAllListeners('error');
      dyingProcess.stdout?.removeAllListeners('end');
      dyingProcess.stderr?.removeAllListeners('data');
      dyingProcess.stderr?.removeAllListeners('error');
      dyingProcess.stdin?.removeAllListeners('error');
    }

    // Preserve exit info so initializeProtocol() can produce an actionable error message
    // even though we must clear the process reference to avoid SIGSEGV.
    this.lastProcessExitInfo = {
      code,
      signal,
      stderr: [...this.recentStderrErrors],
      command: this.config.command,
    };

    // Deregister from the global process registry so the slot is freed
    if (dyingProcess?.pid) {
      deregisterProcess(dyingProcess.pid);
    }

    // Now safe to clear the reference
    this.agentProcess = undefined;
    this.streamParser.reset();

    // If this was an intentional stop (e.g., model fallback), don't clean up streams
    // The process will be restarted with a new model and the stream will continue
    if (this.isStoppingIntentionally) {
      logger.info(
        'Process exit during intentional stop - keeping streams alive for model fallback',
        {
          activeStreams: this.streamingCallbacks.size,
          code,
          signal,
        },
      );
      // DON'T clean up streaming callbacks - they need to stay alive for the retry
      // DON'T reset isStoppingIntentionally - it will be reset after successful restart
      // Emit exit event
      this.emit('process:exit', { code, signal });
      return;
    }

    // If we're already restarting (unexpected exit recovery), just clean up
    if (this.isRestartingProcess) {
      // For restart recovery, clean up without error
      for (const [sessionId] of this.streamingCallbacks) {
        this.cleanupStreamingCallback(sessionId);
      }

      // Reset the flag
      this.isRestartingProcess = false;

      // Emit exit event
      this.emit('process:exit', { code, signal });
      return;
    }

    // For remote workspaces: if SSH is down and we're not already reconnecting,
    // enter reconnection flow instead of the normal restart path.
    // The relay process exit was caused by SSH dropping, not auggie crashing.
    if (
      this.isRemoteWorkspace() &&
      !this.isReconnecting &&
      this.sshConnectionId &&
      !sshManager.isConnected(this.sshConnectionId)
    ) {
      logger.info(
        'Remote workspace SSH disconnection detected in handleProcessExit — entering reconnection flow',
        {
          connectionId: this.sshConnectionId,
          workspaceId: this.config.workspaceId,
        },
      );

      this.isReconnecting = true;
      this.reconnectRemoteAgent()
        .then(() => {
          this.isReconnecting = false;
          logger.info('SSH reconnection from handleProcessExit successful');
        })
        .catch((err) => {
          logger.error(
            'SSH reconnection from handleProcessExit failed — falling through to full restart',
            {
              error: (err as Error).message,
            },
          );
          this.isReconnecting = false;

          // Clean up SSH connection
          if (this.sshConnectionId) {
            sshManager.disconnect(this.sshConnectionId).catch(() => {});
          }

          // Fall through to full restart by re-calling handleProcessExit
          // Reset the flag so the recursive call can proceed past the early-return guard
          this.isRestartingProcess = false;
          this.handleProcessExit(code, signal);
        });

      // Emit reconnecting event for UI
      this.emit('process:exit', { code, signal, reconnecting: true });
      return;
    }

    // If we're already reconnecting SSH, don't do anything — reconnection will handle it
    if (this.isReconnecting) {
      logger.info('handleProcessExit called while SSH reconnection in progress — skipping', {
        workspaceId: this.config.workspaceId,
      });
      this.emit('process:exit', { code, signal });
      return;
    }

    // The process exited unexpectedly - attempt to restart it
    logger.warn('Agent process exited unexpectedly, attempting to restart', {
      code,
      signal,
      agentId: this.config.agentId,
      workspaceId: this.config.workspaceId,
      hasSessionId: !!this.sessionId,
      hasSessionParams: !!this.sessionCreationParams,
      sessionWasRecreated: this.sessionWasRecreated,
    });

    // RESTART RATE LIMITING: Prevent infinite restart loops that cause process accumulation.
    // If a process keeps crashing (e.g., auth failure, missing binary), we'd spawn a new
    // process on every crash, accumulating orphaned processes and using 80GB+ of memory.
    const now = Date.now();
    // Remove timestamps outside the sliding window
    this.restartTimestamps = this.restartTimestamps.filter(
      (t) => now - t < ACPProvider.RESTART_WINDOW_MS,
    );
    if (this.restartTimestamps.length >= ACPProvider.MAX_RESTARTS_IN_WINDOW) {
      logger.error(
        `Agent process has crashed ${ACPProvider.MAX_RESTARTS_IN_WINDOW} times in the last ${ACPProvider.RESTART_WINDOW_MS / 1000}s - giving up on restarts to prevent process accumulation`,
        {
          agentId: this.config.agentId,
          workspaceId: this.config.workspaceId,
          recentRestarts: this.restartTimestamps.length,
          code,
          signal,
        },
      );

      // Record failure in circuit breaker to prevent further spawn attempts
      if (this.config.workspaceId) {
        const workspaceId = this.config.workspaceId;
        void Promise.resolve()
          .then(() => {
            agentCircuitBreaker.recordFailure(workspaceId, 'restart_limit_exceeded');
          })
          .catch(() => {});
      }

      // Clean up callbacks and exit without restarting
      for (const [sessionId, callbacks] of this.streamingCallbacks) {
        if (callbacks.onError) {
          callbacks.onError(
            new Error(
              'Agent process keeps crashing and has been stopped. Please try creating a new agent.',
            ),
          );
        }
        this.cleanupStreamingCallback(sessionId);
      }
      this.emit('process:exit', { code, signal, reason: 'restart_limit_exceeded' });
      return;
    }
    this.restartTimestamps.push(now);

    // SAFETY CHECK: Before attempting restart, verify the workspace still exists
    // This prevents the "janky hang" issue when a workspace is deleted during provider creation.
    // The deletion flow tries to stop all providers, but if a provider is in the middle of
    // being created (inside registry.create()), it won't be found and stop() won't be called.
    // When the process exits, handleProcessExit fires and tries to restart, but fails
    // because the workspace directory no longer exists (ENOENT: uv_cwd).
    if (this.config.workspaceId) {
      try {
        const { workspaceService } = await import('../../../workspace/main/workspace.service');
        const workspaceResult = await workspaceService.getWorkspace(
          createWorkspaceId(this.config.workspaceId),
        );
        if (!workspaceResult.ok) {
          logger.info(
            'Workspace no longer exists - skipping restart (workspace may have been deleted)',
            {
              workspaceId: this.config.workspaceId,
              agentId: this.config.agentId,
            },
          );
          // Clean up callbacks and exit without restarting
          for (const [sessionId] of this.streamingCallbacks) {
            this.handleStreamCompletion(sessionId, 'workspace_deleted');
          }
          this.emit('process:exit', { code, signal, reason: 'workspace_deleted' });
          return;
        }
      } catch (error) {
        logger.warn('Failed to check workspace existence, proceeding with restart attempt', {
          error: error instanceof Error ? error.message : String(error),
          workspaceId: this.config.workspaceId,
        });
        // Continue with restart attempt - the launchAgent() will fail if directory doesn't exist
      }
    }

    // Set restart flag to prevent infinite loops
    this.isRestartingProcess = true;

    try {
      // Try to restart the agent process
      logger.info('Restarting agent process...');

      // Clear the old session ID as it's no longer valid
      this.sessionId = undefined;

      // Clean up old temp files before relaunching (launchAgent will create new ones)
      this.cleanupTempFiles();

      // Relaunch the agent
      await this.launchAgent();

      // Reinitialize the protocol and create a new session
      await this.initializeProtocol();

      // Get the pid from the newly launched process
      // Note: TypeScript doesn't track that launchAgent() sets this.agentProcess
      const agentProcess = this.agentProcess as ChildProcess | undefined;
      logger.info('Agent process successfully restarted', {
        newSessionId: this.sessionId,
        pid: agentProcess?.pid,
      });

      // Reset the restart flag on success
      this.isRestartingProcess = false;

      // If session/load succeeded, the agent already has conversation context — no need to resend history.
      // Only mark sessionWasRecreated when we fell back to session/new (agent has no context).
      if (this.lastInitUsedSessionLoad) {
        logger.info(
          'Session loaded via session/load after unexpected exit — skipping history resend',
        );
      } else {
        this.sessionWasRecreated = true;
        logger.info(
          'Session recreated after unexpected exit - will send full history on next message',
        );
      }

      // Don't notify callbacks about the error since we recovered
      logger.info('Agent recovered from unexpected exit, continuing operations');
    } catch (restartError) {
      logger.error('Failed to restart agent process', restartError as Error);

      // Record failure in circuit breaker
      if (this.config.workspaceId) {
        const workspaceId = this.config.workspaceId;
        void Promise.resolve()
          .then(() => {
            agentCircuitBreaker.recordFailure(workspaceId, 'restart_failed');
          })
          .catch(() => {});
      }

      // Reset the restart flag
      this.isRestartingProcess = false;

      // Now notify callbacks about the error since we couldn't recover
      for (const [sessionId, callbacks] of this.streamingCallbacks) {
        if (callbacks.onError) {
          callbacks.onError(
            new Error(
              `Agent process exited and could not be restarted (code: ${code}, signal: ${signal})`,
            ),
          );
        }
        this.cleanupStreamingCallback(sessionId);
      }

      // Emit exit event
      this.emit('process:exit', { code, signal, restartFailed: true });
    }
  }

  /**
   * Surface MCP server load errors to the renderer via IPC.
   * Used in catch blocks to notify the user when custom MCP servers fail to load.
   */
  private surfaceMcpLoadErrorToRenderer(error: unknown): void {
    try {
      const mainWindow = BrowserWindow.getAllWindows()[0];
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('mcp:server-error', {
          serverName: null,
          command: null,
          errorMessage: `Failed to load your custom MCP servers: ${error instanceof Error ? error.message : String(error)}. Check your ~/.augment/settings.json file or MCP server settings.`,
        });
      }
    } catch {
      // Ignore IPC errors — don't let error reporting break agent startup
    }
  }
}

// ============================================================================
// Startup Cleanup Utility
// ============================================================================

/**
 * Clean up stale temp files from ~/.augment/tmp.
 * These files are created when launching agents and should be cleaned up when agents exit.
 * However, if agents crash or are killed unexpectedly, these files remain.
 * This function removes temp files older than the specified max age.
 *
 * @param maxAgeMs - Maximum age in milliseconds (default: 1 hour)
 */
export async function cleanupStaleTempFiles(
  maxAgeMs: number = 60 * 60 * 1000,
): Promise<{ removed: number; errors: number }> {
  const tmpDir = getGlobalTmpDir();
  let removed = 0;
  let errors = 0;

  try {
    if (!fs.existsSync(tmpDir)) {
      return { removed: 0, errors: 0 };
    }

    const files = fs.readdirSync(tmpDir);
    const now = Date.now();

    for (const file of files) {
      // Only clean up agent-rules-*.md and mcp-config-*.json files
      if (!file.match(/^(agent-rules-|mcp-config-)\d+\.(md|json)$/)) {
        continue;
      }

      const filePath = path.join(tmpDir, file);

      try {
        const stats = fs.statSync(filePath);
        const age = now - stats.mtimeMs;

        if (age > maxAgeMs) {
          fs.unlinkSync(filePath);
          removed++;
          logger.debug('Removed stale temp file', { file, ageMs: age });
        }
      } catch (err) {
        errors++;
        logger.debug('Failed to clean up temp file', { file, error: (err as Error).message });
      }
    }

    if (removed > 0) {
      logger.info('Cleaned up stale temp files', { tmpDir, removed, errors });
    }
  } catch (err) {
    logger.debug('Error reading temp directory', { tmpDir, error: (err as Error).message });
  }

  return { removed, errors };
}
