/**
 * Tool Classifier
 *
 * Classifies tools into categories for consistent display.
 * This replaces the giant TOOL_CONFIGS mapping with pattern-based rules.
 */

import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
import {
  faFileLines,
  faPenToSquare,
  faTrash,
  faTerminal,
  faMagnifyingGlass,
  faGlobe,
  faFolderOpen,
  faLightbulb,
  faWrench,
  faClipboardCheck,
  faRobot,
  faDisplay,
  faBrain,
} from '@fortawesome/free-solid-svg-icons';
import { faNote } from '$lib/icons/faNote';
import { m } from '$shared/paraglide/messages.js';

export type ToolCategory =
  | 'file-read'
  | 'file-write'
  | 'file-delete'
  | 'terminal'
  | 'search'
  | 'context-engine'
  | 'api'
  | 'workspace'
  | 'note'
  | 'meta'
  | 'agent'
  | 'task'
  | 'browser'
  | 'generic';

export interface ToolDisplay {
  category: ToolCategory;
  icon: IconDefinition;
  verb: string;
  subject: string | null;
  path: string | null;
  /** Note ID for linking to notes (optional) */
  noteId?: string | null;
  /** Full file path for clickable file links (optional) */
  filePath?: string | null;
  /** Line number for file navigation (optional) */
  fileLine?: number | null;
  /** Whether the path refers to a directory (optional) */
  isDirectory?: boolean;
  /** MCP server source name, e.g. "figma", "sentry", "playwright" (optional) */
  mcpSource?: string;
}

/**
 * Parsed result metadata that can enhance the display
 */
interface ResultMetadata {
  title?: string;
  noteId?: string;
  fileName?: string;
  count?: number;
}

// Icons per category
export const CATEGORY_ICONS: Record<ToolCategory, IconDefinition> = {
  'file-read': faFileLines,
  'file-write': faPenToSquare,
  'file-delete': faTrash,
  terminal: faTerminal,
  search: faMagnifyingGlass,
  'context-engine': faBrain,
  api: faGlobe,
  workspace: faFolderOpen,
  note: faNote,
  meta: faLightbulb,
  agent: faRobot,
  task: faClipboardCheck,
  browser: faDisplay,
  generic: faWrench,
};

// Known MCP prefixes to strip from tool names (checked via case-insensitive startsWith)
const CLEAN_PREFIXES_TO_STRIP = [
  'workspace-mcp_',
  'workspace_mcp_',
  'filesystem_',
  'browser-mcp_',
  'browser_mcp_',
];

// Known MCP suffixes to strip from tool names (checked via case-insensitive endsWith)
const CLEAN_SUFFIXES_TO_STRIP = [
  '_workspace-mcp',
  '-workspace-mcp',
  '_playwright',
  '_browser_mcp',
  '_context_7',
  '_svelte',
  '_npx',
  '_sequential_thinking',
  '_figma',
  '_slack',
  '_sentry',
  '_github',
  '_linear',
  '_notion',
  '_jira',
];

// Helper functions
function cleanToolName(name: string | undefined | null): string {
  // Handle undefined or null values gracefully
  if (!name) return '';

  // Handle MCP URL formats
  const mcpMatch = name.match(/\/\/local\/mcp\/(.+)$/);
  if (mcpMatch) name = mcpMatch[1];

  // Strip MCP prefixes like "mcp__workspace-mcp__" or "mcp__some-server__"
  name = name.replace(/^mcp__[^_]+__/, '');

  // Strip common MCP server name prefixes (e.g., "workspace-mcp_read_note" → "read_note")
  const lowerForPrefix = name.toLowerCase();
  for (const prefix of CLEAN_PREFIXES_TO_STRIP) {
    if (lowerForPrefix.startsWith(prefix)) {
      name = name.slice(prefix.length);
      break;
    }
  }

  // Strip common suffixes (MCP server names appended to tool names).
  // Loop to handle garbled names with a doubled suffix, e.g.
  // "get_workspace_details_workspace-mcp_workspace-mcp".
  let stripped = true;
  while (stripped) {
    stripped = false;
    const lowerForSuffix = name.toLowerCase();
    for (const suffix of CLEAN_SUFFIXES_TO_STRIP) {
      if (lowerForSuffix.endsWith(suffix)) {
        name = name.slice(0, -suffix.length);
        stripped = true;
        break;
      }
    }
  }

  return name;
}

/**
 * Detect prose ACP titles used as tool names (e.g. auggie sub-agent tool calls like
 * "sub-agent-explore: Explore the services/ directory…" or "Deep workspace exploration").
 * These are human-readable titles, not tool identifiers, and should be rendered verbatim
 * rather than collapsed to a bare category verb by substring matching.
 */
function isProseToolName(name: string): boolean {
  const trimmed = name.trim();
  if (!/\s/.test(trimmed)) return false;
  // Colon-prefixed titles: "sub-agent-explore: Explore …"
  if (/^[A-Za-z0-9._-]+:\s/.test(trimmed)) return true;
  // Multi-word prose (3+ words); two-word names like "List processes" keep category matching
  return trimmed.split(/\s+/).length >= 3;
}

/**
 * Render a prose title verbatim (truncated), with a category inferred from keywords.
 */
function proseTitleDisplay(title: string): ToolDisplay {
  const lower = title.toLowerCase();
  const category: ToolCategory = lower.includes('agent')
    ? 'agent'
    : lower.includes('note')
      ? 'note'
      : lower.includes('workspace')
        ? 'workspace'
        : 'generic';
  return {
    category,
    icon: CATEGORY_ICONS[category],
    verb: truncate(title.trim(), 120),
    subject: null,
    path: null,
  };
}

/**
 * Known MCP server suffixes mapped to their normalized source names.
 * Suffixes are lowercase for case-insensitive matching via endsWith.
 * Order matters: longer/more-specific patterns should come first.
 */
const MCP_SUFFIX_MAP: Array<{ suffix: string; source: string }> = [
  { suffix: '_workspace-mcp', source: 'workspace-mcp' },
  { suffix: '-workspace-mcp', source: 'workspace-mcp' },
  { suffix: '_browser_mcp', source: 'browser-mcp' },
  { suffix: '_playwright', source: 'playwright' },
  { suffix: '_sequential_thinking', source: 'sequential-thinking' },
  { suffix: '_context_7', source: 'context7' },
  { suffix: '_figma', source: 'figma' },
  { suffix: '_sentry', source: 'sentry' },
  { suffix: '_github', source: 'github' },
  { suffix: '_linear', source: 'linear' },
  { suffix: '_slack', source: 'slack' },
  { suffix: '_notion', source: 'notion' },
  { suffix: '_jira', source: 'jira' },
  { suffix: '_svelte', source: 'svelte' },
  { suffix: '_npx', source: 'npx' },
];

/**
 * Known MCP server prefixes mapped to their normalized source names.
 * Prefixes are lowercase for case-insensitive matching via startsWith.
 * Note: the dynamic mcp__<server>__ prefix is handled separately with a regex.
 */
const MCP_PREFIX_MAP: Array<{ prefix: string; source: string }> = [
  { prefix: 'workspace-mcp_', source: 'workspace-mcp' },
  { prefix: 'workspace_mcp_', source: 'workspace-mcp' },
  { prefix: 'browser-mcp_', source: 'browser-mcp' },
  { prefix: 'browser_mcp_', source: 'browser-mcp' },
  { prefix: 'filesystem_', source: 'filesystem' },
];

/**
 * Tool names that are themselves MCP tools (no suffix/prefix, the whole name IS the tool).
 * Maps exact cleaned names to their MCP source.
 */
const MCP_STANDALONE_TOOLS: Record<string, string> = {
  'github-api': 'github',
  linear: 'linear',
  glean: 'glean',
};

/**
 * Built-in tool names that should never get an mcpSource.
 */
const BUILTIN_TOOLS = new Set([
  'view',
  'codebase-retrieval',
  'codebase_retrieval',
  'launch-process',
  'launch_process',
  'read-process',
  'read_process',
  'write-process',
  'write_process',
  'kill-process',
  'kill_process',
  'list-processes',
  'list_processes',
  'str-replace-editor',
  'str_replace_editor',
  'save-file',
  'save_file',
  'remove-files',
  'remove_files',
  'web-search',
  'web_search',
  'web-fetch',
  'web_fetch',
  'conversation-retrieval',
  'conversation_retrieval',
  'git-commit-retrieval',
  'git_commit_retrieval',
  'bash',
  'read',
  'edit',
  'run',
  'find',
  'grep',
]);

/**
 * Extract the MCP server source name from a raw tool name.
 * Returns the normalized lowercase source name, or undefined for built-in tools.
 *
 * Examples:
 *   "get_screenshot_figma" → "figma"
 *   "search_issues_Sentry" → "sentry"
 *   "browser_click_Playwright" → "playwright"
 *   "read_note_workspace-mcp" → "workspace-mcp"
 *   "mcp__workspace-mcp__read_note" → "workspace-mcp"
 *   "github-api" → "github"
 *   "launch-process" → undefined
 *   "view" → undefined
 */
export function extractMcpSource(rawName: string | undefined | null): string | undefined {
  if (!rawName) return undefined;

  // Handle MCP URL formats first
  const mcpUrlMatch = rawName.match(/\/\/local\/mcp\/(.+)$/);
  if (mcpUrlMatch) rawName = mcpUrlMatch[1];

  // Check for mcp__<server>__ prefix (dynamic extraction)
  const mcpPrefixMatch = rawName.match(/^mcp__([^_]+)__/);
  if (mcpPrefixMatch) {
    return mcpPrefixMatch[1].toLowerCase();
  }

  // Check known prefixes (case-insensitive via lowercase comparison)
  const lowerName = rawName.toLowerCase();
  for (const { prefix, source } of MCP_PREFIX_MAP) {
    if (lowerName.startsWith(prefix)) {
      return source;
    }
  }

  // Check known suffixes (case-insensitive via lowercase comparison)
  for (const { suffix, source } of MCP_SUFFIX_MAP) {
    if (lowerName.endsWith(suffix)) {
      return source;
    }
  }

  // Check standalone tool names (after stripping any URL prefix)
  if (MCP_STANDALONE_TOOLS[lowerName]) {
    return MCP_STANDALONE_TOOLS[lowerName];
  }

  // Check if it's a known built-in tool
  if (BUILTIN_TOOLS.has(lowerName)) {
    return undefined;
  }

  return undefined;
}

/**
 * Safely coerce a value to string. Returns '' for null/undefined.
 * Use this when accessing input fields from Record<string, any> before calling string methods.
 */
function safeStr(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return String(value);
}

function truncate(str: unknown, max = 50): string {
  const s = safeStr(str);
  return s.length > max ? `${s.substring(0, max)}...` : s;
}

/**
 * Extract text content from result that might be string, object, or array.
 * Handles MCP format where result might be ContentItem[] or an object with text property.
 */
function extractResultText(result: unknown): string | null {
  if (result === null || result === undefined) {
    return null;
  }

  // Already a string
  if (typeof result === 'string') {
    return result;
  }

  // Array of content items (MCP format)
  if (Array.isArray(result)) {
    const textItems = result
      .filter((item: any) => item && typeof item === 'object' && item.type === 'text' && item.text)
      .map((item: any) => item.text);
    if (textItems.length > 0) {
      return textItems.join('\n');
    }
    return null;
  }

  // Object with text property
  if (typeof result === 'object') {
    const obj = result as Record<string, any>;
    if (obj.text && typeof obj.text === 'string') {
      return obj.text;
    }
    // Object with content array
    if (Array.isArray(obj.content)) {
      return extractResultText(obj.content);
    }
  }

  return null;
}

/**
 * Format a note title for display.
 * Note titles are shown without quotes - the verb already indicates it's a note.
 */
function formatNoteTitle(title: string, maxLength: number = 25): string {
  return truncate(title, maxLength);
}

function filename(path: unknown): string {
  const p = safeStr(path);
  return p.split('/').pop() || p;
}

function dirname(path: unknown): string {
  const p = safeStr(path);
  const parts = p.split('/');
  if (parts.length <= 1) return '';
  parts.pop();
  return parts.join('/');
}

/**
 * Context Engine tool names - tools that use Augment's proprietary context engine.
 * These get special treatment with Augment branding.
 * Both hyphenated and underscore variants are included for exact matching.
 */
const CONTEXT_ENGINE_TOOLS = [
  'codebase-retrieval',
  'codebase_retrieval',
  'git-commit-retrieval',
  'git_commit_retrieval',
  'conversation-retrieval',
  'conversation_retrieval',
] as const;

/** Pre-computed underscore variants for includes() checks (avoids .replace() per call) */
const CONTEXT_ENGINE_TOOLS_UNDERSCORE = [
  'codebase_retrieval',
  'git_commit_retrieval',
  'conversation_retrieval',
];

/**
 * Check if a tool is an Augment Context Engine tool
 */
export function isContextEngineTool(toolName: string | undefined | null): boolean {
  if (!toolName) return false;
  const cleanName = cleanToolName(toolName).toLowerCase();
  return CONTEXT_ENGINE_TOOLS.some((tool) => cleanName === tool) ||
    CONTEXT_ENGINE_TOOLS_UNDERSCORE.some((tool) => cleanName.includes(tool));
}

/**
 * Get the retrieval source label for a context engine tool
 */
export function getContextEngineSource(toolName: string | undefined | null): string {
  if (!toolName) return 'Codebase';
  const cleanName = cleanToolName(toolName).toLowerCase();
  if (cleanName.includes('git') || cleanName.includes('commit')) {
    return m.chat_toolClassifier_commitHistory_label();
  }
  if (cleanName.includes('conversation')) {
    return 'Conversations';
  }
  return 'Codebase';
}

/**
 * Classify workspace_api code into a specific tool category based on the ws.* API calls.
 * Parses the code field to detect which workspace subsystem is being used.
 */
function classifyWorkspaceApiCode(code: string): ToolCategory {
  if (!code) return 'workspace';
  // Match ws.<namespace>.method() patterns
  const wsMatch = code.match(/ws\.(note|comment|task|agent|git|workspace|event|script|browser|terminal|file|pr|primitive|crossWorkspace)\./);
  if (!wsMatch) return 'workspace';
  switch (wsMatch[1]) {
    case 'note':
    case 'comment':
      return 'note';
    case 'task':
      return 'task';
    case 'agent':
      return 'agent';
    case 'git':
    case 'pr':
      return 'api';
    case 'browser':
      return 'browser';
    case 'terminal':
    case 'script':
      return 'terminal';
    case 'file':
      // Detect read vs write from method name
      if (/ws\.file\.(read|list)/.test(code)) return 'file-read';
      if (/ws\.file\.(write|mkdir|rename)/.test(code)) return 'file-write';
      if (/ws\.file\.delete/.test(code)) return 'file-delete';
      return 'workspace';
    case 'event':
    case 'workspace':
    case 'primitive':
    case 'crossWorkspace':
    default:
      return 'workspace';
  }
}

/**
 * Detect if a tool name is a pre-formatted display name and infer the actual tool type.
 * Returns the inferred tool type or null if it's an actual tool name.
 */
function detectPreFormattedToolName(
  toolName: string,
  input: Record<string, any>,
): ToolDisplay | null {
  // Check if tool name equals the input title - this could be a note operation OR workspace rename
  if (input.title && toolName.toLowerCase() === safeStr(input.title).toLowerCase()) {
    // Check if this is a workspace rename - only has title (no content, heading, status, etc.)
    const hasNoteParams =
      input.content !== undefined ||
      input.heading !== undefined ||
      input.status !== undefined ||
      input.taskText !== undefined ||
      input.lineStart !== undefined ||
      input.lineEnd !== undefined ||
      input.noteId !== undefined;

    if (!hasNoteParams) {
      // This is likely a workspace rename, not a note operation
      return {
        category: 'workspace',
        icon: CATEGORY_ICONS.workspace,
        verb: m.chat_toolClassifier_renameWorkspace_label(),
        subject: truncate(input.title, 30),
        path: null,
      };
    }

    // Infer the note operation type from the input parameters
    if (input.old_text !== undefined && input.new_text !== undefined) {
      // edit_note - str_replace style editing
      return {
        category: 'note',
        icon: CATEGORY_ICONS.note,
        verb: m.chat_toolClassifier_editNote_label(),
        subject: formatNoteTitle(input.title, 25),
        path: null,
      };
    } else if (input.start_line !== undefined && input.end_line !== undefined) {
      // edit_note_lines - line-based editing
      return {
        category: 'note',
        icon: CATEGORY_ICONS.note,
        verb: m.chat_toolClassifier_editNoteLines_label(),
        subject: `${formatNoteTitle(input.title, 15)} (${input.start_line}-${input.end_line})`,
        path: null,
      };
    } else if (
      input.content !== undefined &&
      (input.heading !== undefined || input.position !== undefined)
    ) {
      // add_to_note has both content and optional heading/position
      const heading = input.heading ? truncate(safeStr(input.heading).replace(/^#+\s*/, ''), 20) : null;
      const position = input.position && input.position !== 'end' ? input.position : null;
      const suffix = heading || position;
      return {
        category: 'note',
        icon: CATEGORY_ICONS.note,
        verb: m.chat_toolClassifier_addToNote_label(),
        subject: suffix
          ? `${formatNoteTitle(input.title, 15)} → ${suffix}`
          : formatNoteTitle(input.title, 25),
        path: null,
      };
    } else if (
      input.confirm_replacement !== undefined ||
      (input.content !== undefined && !input.heading)
    ) {
      // set_note_content has content and possibly confirm_replacement
      return {
        category: 'note',
        icon: CATEGORY_ICONS.note,
        verb: m.chat_toolClassifier_replaceNoteContent_label(),
        subject: formatNoteTitle(input.title, 25),
        path: null,
      };
    } else if (
      (input.title !== undefined || input.tags !== undefined) &&
      input.content === undefined
    ) {
      // update_note_metadata - has title/tags but no content
      return {
        category: 'note',
        icon: CATEGORY_ICONS.note,
        verb: m.chat_toolClassifier_updateNoteMetadata_label(),
        subject: formatNoteTitle(input.title, 25),
        path: null,
      };
    } else if (input.taskText !== undefined && input.status !== undefined) {
      // update_task_status - has taskText and status (task in a note)
      return {
        category: 'task',
        icon: CATEGORY_ICONS.task,
        verb: m.chat_toolClassifier_checkTask_label(),
        subject: `${truncate(input.taskText, 20)} → ${input.status}`,
        path: null,
      };
    } else if (input.status !== undefined && input.taskText === undefined) {
      // update_note_task_status - has status but not taskText (Task Note status)
      return {
        category: 'task',
        icon: CATEGORY_ICONS.task,
        verb: m.chat_toolClassifier_updateTaskStatus_label(),
        subject: `${formatNoteTitle(input.title, 20)} → ${input.status}`,
        path: null,
      };
    } else {
      // read_note - just has title (or title + optional lineStart/lineEnd for comments)
      return {
        category: 'note',
        icon: CATEGORY_ICONS.note,
        verb: m.chat_toolClassifier_readNote_label(),
        subject: formatNoteTitle(input.title, 25),
        path: null,
      };
    }
  }

  return null;
}

/**
 * Extract a file path from result text using common output patterns.
 * Handles patterns like:
 * - "Here's the result of running `cat -n` on path/to/file.ts:"
 * - "File: path/to/file.ts" at the start
 */
function extractFilePathFromResultText(text: string): string | null {
  if (!text) return null;
  // Pattern: "cat -n` on <path>:" (view tool output)
  const catMatch = text.match(/`cat -n`\s+on\s+(.+?):/);
  if (catMatch) return catMatch[1].trim();
  // Pattern: "File: <path>" at start
  const fileMatch = text.match(/^File:\s*(.+?)(?:\n|$)/);
  if (fileMatch) return fileMatch[1].trim();
  return null;
}

/**
 * Extract a note title from result text (line-numbered note content).
 * Looks for a markdown heading in the first few lines.
 */
function extractNoteTitleFromResultText(text: string): string | null {
  if (!text) return null;
  // Note content has line numbers like "   1 | # Title"
  const headingMatch = text.match(/^\s*\d+\s*\|\s*#\s+(.+?)$/m);
  if (headingMatch) return headingMatch[1].trim();
  return null;
}

/**
 * Extract metadata from a tool result for enhanced display
 */
function extractResultMetadata(result: any): ResultMetadata | null {
  if (!result) return null;

  // First, try to get text from any format (string, MCP ContentItem[], object with text)
  const resultText = extractResultText(result);

  // If result is a string, try to parse it as JSON for structured metadata
  if (typeof result === 'string') {
    try {
      const parsed = JSON.parse(result);
      const metadata = parsed?.metadata || parsed;
      return {
        title: metadata?.title || metadata?.noteTitle,
        noteId: metadata?.noteId,
        fileName: metadata?.fileName,
        count: metadata?.count,
      };
    } catch {
      // Not JSON — fall through to text-based extraction below
    }
  } else if (typeof result === 'object' && !Array.isArray(result)) {
    // Object with metadata fields (non-string, non-array)
    const metadata = result?.metadata || result;
    const structured: ResultMetadata = {};
    if (metadata?.title || metadata?.noteTitle)
      structured.title = metadata.title || metadata.noteTitle;
    if (metadata?.noteId) structured.noteId = metadata.noteId;
    if (metadata?.fileName) structured.fileName = metadata.fileName;
    if (metadata?.count !== undefined) structured.count = metadata.count;
    if (Object.keys(structured).length > 0) return structured;
  }

  // Text-based extraction from any result format
  if (resultText) {
    // Match "Note: <title>" at the start (read_note results — must be before noteId patterns
    // to avoid accidentally extracting noteId from intent links inside note content)
    const noteMatch = resultText.match(/^Note:\s*(.+?)(?:\n|$)/);
    if (noteMatch) {
      return { title: noteMatch[1].trim() };
    }

    // Extract noteId from result text patterns
    const noteContentReplaced = resultText.match(/Note content replaced:\s*([a-zA-Z0-9_-]+)/);
    if (noteContentReplaced) return { noteId: noteContentReplaced[1] };

    const intentLink = resultText.match(/intent:\/\/local\/note\/([a-zA-Z0-9_-]+)/);
    if (intentLink) return { noteId: intentLink[1] };

    const addedToNote = resultText.match(/Content added to note "([^"]+)"/);
    if (addedToNote) return { noteId: addedToNote[1] };

    const noteDeleted = resultText.match(/Note deleted:\s*([a-zA-Z0-9_-]+)/);
    if (noteDeleted) return { noteId: noteDeleted[1] };
    // Try to extract file path from result text
    const filePath = extractFilePathFromResultText(resultText);
    if (filePath) {
      return { fileName: filePath };
    }
    // Try to extract note title from line-numbered content
    const noteTitle = extractNoteTitleFromResultText(resultText);
    if (noteTitle) {
      return { title: noteTitle };
    }
  }

  return null;
}

/**
 * Classify a tool and extract display information
 */
export function classifyTool(
  toolName: string | undefined | null,
  input: Record<string, any>,
  result?: any,
): ToolDisplay {
  // Guard against null/undefined tool names (can happen with malformed content blocks)
  toolName = toolName || '';

  // Extract MCP source from the raw tool name BEFORE cleaning strips it
  const mcpSource = extractMcpSource(toolName);

  // Extract metadata from result for enhanced display
  const resultMetadata = extractResultMetadata(result);

  // Classify the tool, then attach mcpSource if detected
  const display = classifyToolInner(toolName, input, result, resultMetadata);
  if (mcpSource) display.mcpSource = mcpSource;
  return display;
}

/**
 * Inner classification logic (without mcpSource attachment)
 */
function classifyToolInner(
  toolName: string,
  input: Record<string, any>,
  result: any,
  resultMetadata: ResultMetadata | null,
): ToolDisplay {
  // workspace_api: prefer human-readable label over raw tool names
  // Also detect by input shape: if input has both `code` and `summary`, it's workspace_api
  // regardless of the tool name (which may be a human-readable title)
  const cleanedForSummary = cleanToolName(toolName);
  if (
    cleanedForSummary.toLowerCase() === 'workspace_api' ||
    (typeof input.code === 'string' && typeof input.summary === 'string')
  ) {
    const acpTitle =
      typeof input._acpTitle === 'string' ? input._acpTitle.trim() : '';
    const summary =
      typeof input.summary === 'string' ? input.summary.trim() : '';
    // Skip _acpTitle if it resolves to a raw tool name after cleaning
    // (catches all variants: mcp__*__workspace_api, //local/mcp/workspace_api, etc.)
    const isRawName = !acpTitle || cleanToolName(acpTitle).toLowerCase() === 'workspace_api';
    const label = isRawName ? summary || acpTitle : acpTitle || summary;
    if (label) {
      // Detect specific operation type from the code field for richer display
      const wsCategory = classifyWorkspaceApiCode(typeof input.code === 'string' ? input.code : '');
      return {
        category: wsCategory,
        icon: CATEGORY_ICONS[wsCategory],
        verb: label,
        subject: null,
        path: null,
      };
    }
  }

  // First check if this is a pre-formatted display name
  const preFormatted = detectPreFormattedToolName(toolName, input);
  if (preFormatted) {
    // Merge noteId from result metadata for pre-formatted names
    if (!preFormatted.noteId && (resultMetadata?.noteId || input.noteId)) {
      preFormatted.noteId = resultMetadata?.noteId || input.noteId;
    }
    return preFormatted;
  }

  const cleanedName = cleanToolName(toolName);
  const name = cleanedName.toLowerCase();
  const hasPath = !!input.path || !!input.file_path;
  const hasFilePaths = Array.isArray(input.file_paths) && input.file_paths.length > 0;
  const hasCommand = !!input.command;
  const hasQuery = !!(input.query || input.information_request);

  // File read operations
  if (
    (name.includes('view') || name.includes('read') || name === 'read') &&
    hasPath &&
    !input.content &&
    !input.file_content
  ) {
    return fileReadDisplay(name, input);
  }

  // Bare file-read tool without a path (e.g., from OpenCode/ACP with empty rawInput)
  // Also handles "read `src/file.ts`" where backtick-wrapped path is part of the name
  // Matches "read", "read_file", "read `path`", etc.
  if (
    (name === 'read' || name === 'read_file' || name.startsWith('read ')) &&
    !name.includes('terminal') &&
    !name.includes('process') &&
    !hasPath &&
    !input.content &&
    !input.file_content
  ) {
    // Extract from name like "Read `src/lib/App.svelte`" (use cleanedName to preserve case)
    const nameBacktickMatch = cleanedName.match(/^read\s+`(.+)`\s*$/i);
    if (nameBacktickMatch) {
      const extracted = nameBacktickMatch[1];
      const extractedIsDir = input.type === 'directory';
      return {
        category: 'file-read',
        icon: CATEGORY_ICONS['file-read'],
        verb: extractedIsDir
          ? m.chat_toolClassifier_listContents_label()
          : m.chat_toolClassifier_read_label(),
        subject: filename(extracted),
        path: dirname(extracted) || null,
        filePath: extracted || null,
        isDirectory: extractedIsDir,
      };
    }
    const resultPath = resultMetadata?.fileName;
    if (resultPath) {
      return {
        category: 'file-read',
        icon: CATEGORY_ICONS['file-read'],
        verb: m.chat_toolClassifier_read_label(),
        subject: filename(resultPath),
        path: dirname(resultPath) || null,
        filePath: resultPath,
      };
    }
    // Try to extract file path from ACP title (e.g., "Read `src/lib/foo.ts`", "List Contents src/lib/")
    if (typeof input._acpTitle === 'string') {
      const titleMatch = input._acpTitle.match(/^(?:Read|View|List\s+Contents?)\s+(.+)/i);
      if (titleMatch) {
        // Strip surrounding backticks from extracted path
        const candidate = titleMatch[1].trim().replace(/^`|`$/g, '');
        if (candidate.includes('.') || candidate.includes('/')) {
          const titleIsDir =
            input.type === 'directory' || /^List\s+Contents?/i.test(input._acpTitle);
          return {
            category: 'file-read',
            icon: CATEGORY_ICONS['file-read'],
            verb: titleIsDir
              ? m.chat_toolClassifier_listContents_label()
              : m.chat_toolClassifier_read_label(),
            subject: filename(candidate),
            path: dirname(candidate) || null,
            filePath: candidate || null,
            isDirectory: titleIsDir,
          };
        }
      }
    }
    return {
      category: 'file-read',
      icon: CATEGORY_ICONS['file-read'],
      verb: m.chat_toolClassifier_read_label(),
      subject: m.chat_toolClassifier_file_subject(),
      path: null,
    };
  }

  // File write/edit operations
  if (
    (name.includes('edit') ||
      name.includes('str-replace') ||
      name.includes('str_replace') ||
      name.includes('save') ||
      name.includes('write')) &&
    (hasPath || input.file_content !== undefined || input.old_str_1 !== undefined)
  ) {
    return fileWriteDisplay(name, input);
  }

  // Bare "edit" tool without a path (e.g., from OpenCode with empty rawInput)
  if (name === 'edit' && !hasPath && !input.content && !input.file_content) {
    return {
      category: 'file-write',
      icon: CATEGORY_ICONS['file-write'],
      verb: m.chat_toolClassifier_edit_label(),
      subject: m.chat_toolClassifier_file_subject(),
      path: null,
    };
  }

  // Fallback: File operations from pre-formatted ACP titles (e.g., "Edit `file.ts`", "Save path/to/file.ts")
  // ACP providers may send human-readable titles when rawInput is empty or doesn't have a path field.
  // Use cleanedName (case-preserving) for file path extraction to avoid lowercasing file names.
  if (!hasPath) {
    const writeMatch = cleanedName.match(/^(edit|save|write|create)\s+(.+)/i);
    if (writeMatch) {
      const filePart = writeMatch[2].replace(/^`|`$/g, '');
      if (filePart && (filePart.includes('.') || filePart.includes('/'))) {
        const verbLower = writeMatch[1].toLowerCase();
        const verb =
          verbLower === 'save' || verbLower === 'write' || verbLower === 'create'
            ? 'Save'
            : 'Edit';
        return {
          category: 'file-write',
          icon: CATEGORY_ICONS['file-write'],
          verb,
          subject: filename(filePart),
          path: dirname(filePart) || null,
          filePath: filePart || null,
        };
      }
    }
    const readMatch = cleanedName.match(/^(read|view)\s+(.+)/i);
    if (readMatch) {
      const filePart = readMatch[2].replace(/^`|`$/g, '');
      if (filePart && (filePart.includes('.') || filePart.includes('/'))) {
        const readIsDir = input.type === 'directory';
        return {
          category: 'file-read',
          icon: CATEGORY_ICONS['file-read'],
          verb: readIsDir
            ? m.chat_toolClassifier_listContents_label()
            : m.chat_toolClassifier_read_label(),
          subject: filename(filePart),
          path: dirname(filePart) || null,
          filePath: filePart || null,
          isDirectory: readIsDir,
        };
      }
    }
    const deleteMatch = cleanedName.match(/^(delete|remove)\s+(.+)/i);
    if (deleteMatch) {
      const filePart = deleteMatch[2].replace(/^`|`$/g, '');
      if (filePart && (filePart.includes('.') || filePart.includes('/'))) {
        return {
          category: 'file-delete',
          icon: CATEGORY_ICONS['file-delete'],
          verb: 'Delete',
          subject: filename(filePart),
          path: dirname(filePart) || null,
          filePath: filePart || null,
        };
      }
    }
  }

  // File delete operations
  if ((name.includes('remove') || name.includes('delete')) && (hasPath || hasFilePaths)) {
    return fileDeleteDisplay(name, input);
  }

  // Terminal/process operations
  // Also matches rich ACP names like "run `cd experimental/amelia && npx vitest ...`"
  if (
    name.includes('process') ||
    name.includes('bash') ||
    name.includes('terminal') ||
    name.includes('shell') ||
    name === 'run' ||
    name.startsWith('run ') ||
    name === 'launch' ||
    name.startsWith('launch ') ||
    name === 'read-terminal' ||
    name === 'read_terminal' ||
    hasCommand
  ) {
    return terminalDisplay(name, input);
  }

  // Prose ACP titles used as tool names (spaces / "sub-agent-x:" colon prefix).
  // Render verbatim before the substring category matching below collapses them
  // to a bare verb like "Workspace" or "Agent". Skipped when the input has
  // structured fields that drive a richer category-specific display.
  if (
    isProseToolName(toolName) &&
    !hasPath &&
    !hasFilePaths &&
    !hasQuery &&
    !input.pattern &&
    !input.glob &&
    input.title === undefined &&
    input.noteId === undefined &&
    input.agentId === undefined &&
    input.targetAgentId === undefined &&
    !Array.isArray(input.tasks)
  ) {
    return proseTitleDisplay(toolName);
  }

  // Diagnostics (IDE issues)
  if (name.includes('diagnostic')) {
    return {
      category: 'search',
      icon: CATEGORY_ICONS.search,
      verb: 'Check',
      subject: input.paths
        ? Array.isArray(input.paths)
          ? input.paths.length === 1
            ? filename(input.paths[0])
            : `${input.paths.length} files`
          : 'diagnostics'
        : 'diagnostics',
      path: null,
    };
  }

  // Sentry tools - detect from original name BEFORE search routing catches them
  // (Sentry tools like search_issues, find_organizations have 'search'/'query' params
  // that would otherwise match the search routing below)
  if (toolName.toLowerCase().includes('sentry')) {
    return apiDisplay(name, input);
  }

  // Augment Context Engine tools - special handling before general search
  if (isContextEngineTool(name)) {
    return contextEngineDisplay(name, input);
  }

  // API operations (external services)
  // Detect by name OR by unique input shapes (ACP titles lose the tool name,
  // e.g., "Get recent failed CI runs" instead of "github-api").
  // Must come BEFORE search routing because some API tools (Linear, Sentry) have
  // query/search params that would otherwise match the search routing.
  if (
    name.includes('github') ||
    name.includes('linear') ||
    name.includes('glean') ||
    name.includes('web-fetch') ||
    name.includes('web_fetch') ||
    name === 'fetch' ||
    (input.method && input.path && !input.file_content) ||
    // Input-shape detection for API tools with ACP human-readable titles:
    // github-api: has summary + path (API path like "/repos/...")
    (input.summary && input.path && typeof input.path === 'string' && input.path.startsWith('/')) ||
    // linear: has is_read_only + query (unique combination)
    (input.is_read_only !== undefined && input.query) ||
    // glean: has call.payload.query (nested structure unique to glean)
    (input.call?.payload?.query)
  ) {
    return apiDisplay(name, input);
  }

  // Search operations (not context engine)
  if (
    name.includes('search') ||
    name.includes('retrieval') ||
    name.includes('grep') ||
    name.includes('glob') ||
    ((name.includes('find') || name === 'find') && (!!input.pattern || !!input.glob)) ||
    hasQuery
  ) {
    return searchDisplay(name, input);
  }

  // Browser operations (Playwright, MCP browser tools, npx DevTools)
  // After cleanToolName strips _npx/_Playwright/_Browser_MCP suffixes,
  // detect browser tools by input shape (uid = npx, ref = Playwright)
  if (
    name.includes('browser') ||
    name.includes('playwright') ||
    name.includes('screenshot') ||
    name.includes('snapshot') ||
    name.includes('open-browser') ||
    name.includes('open_browser') ||
    (name.includes('navigate') && name.includes('page')) ||
    name.includes('take_screenshot') ||
    name.includes('take_snapshot') ||
    // Input-based detection for npx/Playwright tools after suffix stripping
    input.uid !== undefined ||
    (input.ref !== undefined && input.element !== undefined && !hasPath)
  ) {
    return browserDisplay(name, input);
  }

  // Workspace/note operations (check BEFORE agent to catch workspace-set-agent-name, etc.)
  if (
    name.includes('note') ||
    name.includes('workspace') ||
    name.includes('timeline') ||
    // Agent rename/title tools belong to workspace category
    (name.includes('agent') &&
      (name.includes('name') || name.includes('title') || name.includes('rename'))) ||
    // Tools with title input that aren't agent operations
    (input.title !== undefined && !name.includes('delegate'))
  ) {
    return workspaceDisplay(name, input, resultMetadata);
  }

  // Agent operations
  if (
    name.includes('agent') ||
    name.includes('delegate') ||
    (name.includes('report') && name.includes('parent')) ||
    input.agentId !== undefined ||
    input.targetAgentId !== undefined
  ) {
    return agentDisplay(name, input);
  }

  // Task operations
  if (name.includes('task')) {
    return taskDisplay(name, input, result);
  }

  // Meta operations (thinking, memory)
  if (name.includes('think') || name.includes('remember') || name.includes('sequential')) {
    return metaDisplay(name, input);
  }

  // Generic fallback
  return genericDisplay(toolName, input);
}

// Category-specific display functions

function fileReadDisplay(name: string, input: Record<string, any>): ToolDisplay {
  // Strip surrounding backticks from path (ACP titles use backtick formatting)
  let path = (input.path || input.file_path || '').replace(/^`|`$/g, '');

  // Fallback: extract file path from the original ACP title (same as fileWriteDisplay)
  if (!path && typeof input._acpTitle === 'string') {
    const titleMatch = input._acpTitle.match(
      /^(?:Edit|Save|Read|Write|Delete|View|Create)\s+(.+)/i,
    );
    if (titleMatch) {
      // Strip surrounding backticks from extracted path
      const candidate = titleMatch[1].trim().replace(/^`|`$/g, '');
      if (candidate.includes('.') || candidate.includes('/')) {
        path = candidate;
      }
    }
  }

  let subject = filename(path);
  let fileLine: number | null = null;
  if (input.view_range && Array.isArray(input.view_range)) {
    subject += `:${input.view_range[0]}-${input.view_range[1]}`;
    fileLine = input.view_range[0];
  } else if (input.offset !== undefined) {
    fileLine = input.offset;
  } else if (input.line !== undefined) {
    fileLine = input.line;
  }
  // Use "Search" when doing a regex search, "List Contents" for directory reads.
  // Only treat as directory when explicitly specified via input.type to avoid
  // misclassifying extensionless files (e.g. Dockerfile, Makefile) as directories.
  const isDirectory = input.type === 'directory';
  const verb = input.search_query_regex
    ? m.chat_toolClassifier_search_label()
    : isDirectory
      ? m.chat_toolClassifier_listContents_label()
      : m.chat_toolClassifier_read_label();
  return {
    category: 'file-read',
    icon: CATEGORY_ICONS['file-read'],
    verb,
    subject,
    path: dirname(path) || null,
    filePath: path || null,
    fileLine,
    isDirectory: isDirectory || false,
  };
}

function fileWriteDisplay(name: string, input: Record<string, any>): ToolDisplay {
  // Strip surrounding backticks from path (ACP titles use backtick formatting)
  let path = (input.path || input.file_path || '').replace(/^`|`$/g, '');

  // Fallback: extract file path from the original ACP title stored during streaming.
  // When the ACP provider sends a tool call with a human-readable title like "Edit `src/foo.ts`"
  // but rawInput doesn't contain a path field, the streaming handler stores the title in
  // _acpTitle so we can recover the file path here.
  if (!path && typeof input._acpTitle === 'string') {
    const titleMatch = input._acpTitle.match(
      /^(?:Edit|Save|Read|Write|Delete|View|Create)\s+(.+)/i,
    );
    if (titleMatch) {
      // Strip surrounding backticks from extracted path
      const candidate = titleMatch[1].trim().replace(/^`|`$/g, '');
      if (candidate.includes('.') || candidate.includes('/')) {
        path = candidate;
      }
    }
  }

  const verb = name.includes('save') || name.includes('write') ? 'Save' : 'Edit';
  let fileLine: number | null = null;
  if (input.line !== undefined) {
    fileLine = input.line;
  } else if (input.insert_line !== undefined) {
    fileLine = input.insert_line;
  }
  return {
    category: 'file-write',
    icon: CATEGORY_ICONS['file-write'],
    verb,
    subject: filename(path) || null,
    path: dirname(path) || null,
    filePath: path || null,
    fileLine,
  };
}

function fileDeleteDisplay(name: string, input: Record<string, any>): ToolDisplay {
  let subject: string;
  let path: string | null = null;
  let filePath: string | null = null;
  if (input.file_paths && Array.isArray(input.file_paths)) {
    if (input.file_paths.length === 1) {
      subject = filename(input.file_paths[0]);
      path = dirname(input.file_paths[0]) || null;
      filePath = input.file_paths[0];
    } else {
      subject = `${input.file_paths.length} files`;
    }
  } else {
    subject = filename(input.path || input.file_path || '');
    path = dirname(input.path || input.file_path || '') || null;
    filePath = input.path || input.file_path || null;
  }
  return {
    category: 'file-delete',
    icon: CATEGORY_ICONS['file-delete'],
    verb: 'Delete',
    subject,
    path,
    filePath,
  };
}

function terminalDisplay(name: string, input: Record<string, any>): ToolDisplay {
  let verb = 'Run';
  let subject: string | null = null;

  // Extract terminal ID from name like "read terminal 123", "kill terminal 5"
  const nameTerminalIdMatch = name.match(/terminal\s+(\d+)/);
  const terminalSubject = input.terminal_id
    ? `terminal ${input.terminal_id}`
    : nameTerminalIdMatch
      ? `terminal ${nameTerminalIdMatch[1]}`
      : 'terminal';

  // Match tool name patterns: both hyphenated ("read-process") and ACP titles ("read terminal 123")
  if (
    name.includes('read-process') ||
    name.includes('read_process') ||
    (name.includes('read') && (name.includes('terminal') || name.includes('process')))
  ) {
    verb = 'Read';
    subject = terminalSubject;
  } else if (
    name.includes('write-process') ||
    name.includes('write_process') ||
    (name.includes('write') && (name.includes('terminal') || name.includes('process')))
  ) {
    verb = m.chat_toolClassifier_writeTo_label();
    subject = terminalSubject;
  } else if (
    name.includes('kill-process') ||
    name.includes('kill_process') ||
    (name.includes('kill') && (name.includes('terminal') || name.includes('process')))
  ) {
    verb = 'Kill';
    subject = terminalSubject;
  } else if (
    name.includes('list-process') ||
    name.includes('list_process') ||
    (name.includes('list') && name.includes('process'))
  ) {
    verb = 'List';
    subject = 'processes';
  } else if (input.command) {
    // Prefer description as subject if available, otherwise use command (first line only)
    const cmd = safeStr(input.command);
    subject = input.description ? truncate(input.description, 50) : truncate(cmd.split('\n')[0], 80);
  } else if (input.terminal_id !== undefined && !input.command) {
    // Input-based detection: terminal_id without command is read/write/kill process
    if (input.input_text !== undefined) {
      verb = m.chat_toolClassifier_writeTo_label();
      subject = `terminal ${input.terminal_id}`;
    } else {
      verb = 'Read';
      subject = `terminal ${input.terminal_id}`;
    }
  } else if (input.description) {
    // Fallback: use description when command is missing
    subject = truncate(input.description, 50);
  } else if (typeof input._acpTitle === 'string') {
    // Fallback: extract info from the ACP human-readable title
    // e.g., "Run `cd experimental/amelia/workspaces && npx vitest run ...`"
    // Also handles: "Read terminal 123", "List processes", "Kill terminal 5"
    const titleMatch = input._acpTitle.match(/^(Run|Launch|Read|List|Kill|Write)\s+`?(.+?)`?\s*$/i);
    if (titleMatch) {
      const titleVerb = titleMatch[1].toLowerCase();
      const rest = titleMatch[2].trim();
      if (rest.length > 0) {
        if (titleVerb === 'list') {
          verb = 'List';
          subject = rest;
        } else if (titleVerb === 'read') {
          verb = 'Read';
          subject = rest;
        } else if (titleVerb === 'kill') {
          verb = 'Kill';
          subject = rest;
        } else if (titleVerb === 'write') {
          verb = m.chat_toolClassifier_writeTo_label();
          subject = rest;
        } else if (titleVerb === 'launch') {
          verb = 'Launch';
          subject = truncate(rest.split('\n')[0], 80);
        } else {
          subject = truncate(rest.split('\n')[0], 80);
        }
      }
    }
  } else {
    // Try to extract command from backtick-wrapped tool name
    // e.g., name = "run `cd experimental/amelia && npx vitest ...`"
    const backtickMatch = name.match(/^(?:run|launch)\s+`(.+)`\s*$/);
    if (backtickMatch) {
      subject = truncate(backtickMatch[1].split('\n')[0], 80);
    }
  }

  return {
    category: 'terminal',
    icon: CATEGORY_ICONS.terminal,
    verb,
    subject,
    path: null,
  };
}

function contextEngineDisplay(name: string, input: Record<string, any>): ToolDisplay {
  const verb = m.chat_toolClassifier_contextEngine_label();
  let subject: string | null = null;

  // Determine the source type
  if (name.includes('git') || name.includes('commit')) {
    subject = m.chat_toolClassifier_commitHistory_label();
  } else if (name.includes('conversation')) {
    subject = m.chat_toolClassifier_conversations_label();
  } else {
    subject = m.chat_toolClassifier_codebase_label();
  }

  // If there's a query, append a snippet of it
  const query = input.information_request || input.query;
  if (query) {
    subject = `${subject} · ${truncate(query, 60)}`;
  }

  return {
    category: 'context-engine',
    icon: CATEGORY_ICONS['context-engine'],
    verb,
    subject,
    path: null,
  };
}

function searchDisplay(name: string, input: Record<string, any>): ToolDisplay {
  let verb = 'Search';
  let subject: string | null = null;

  if (name.includes('git-commit') || name.includes('git_commit')) {
    verb = m.chat_toolClassifier_searchCommits_label();
  } else if (name.includes('web-search') || name.includes('web_search')) {
    verb = m.chat_toolClassifier_searchWeb_label();
  } else if (name.includes('glob') || name.includes('find')) {
    verb = 'Find';
  } else if (name.includes('codebase') || name.includes('retrieval')) {
    // Context engine / codebase retrieval
    verb = m.chat_toolClassifier_contextEngineSentenceCase_label();
  }

  // Priority: information_request > query > pattern > glob > description > fallback
  if (input.information_request) {
    subject = truncate(input.information_request, 300);
  } else if (input.query) {
    subject = truncate(input.query, 300);
  } else if (input.pattern) {
    subject = truncate(input.pattern, 300);
  } else if (input.glob) {
    subject = truncate(input.glob, 300);
  } else if (input.description) {
    subject = truncate(input.description, 300);
  } else if (name.includes('glob') || name.includes('find')) {
    subject = 'files';
  }

  return {
    category: 'search',
    icon: CATEGORY_ICONS.search,
    verb,
    subject,
    path: null,
  };
}

function apiDisplay(name: string, input: Record<string, any>): ToolDisplay {
  let verb = 'API';
  let subject: string | null = null;

  // Detect tool type by name OR input shape (ACP titles lose the tool name).
  // github-api: has summary + path starting with "/" (API path like "/repos/...")
  const isGitHub = name.includes('github') ||
    (input.summary && input.path && typeof input.path === 'string' && input.path.startsWith('/'));
  // linear: has is_read_only + query
  const isLinear = name.includes('linear') || (input.is_read_only !== undefined && input.query);
  // glean: has call.payload.query
  const isGlean = name.includes('glean') || !!input.call?.payload?.query;

  if (isGitHub) {
    verb = 'GitHub';
    if (input.path) {
      // Show API path: "GET /repos/owner/repo/issues"
      const method = input.method || 'GET';
      subject = `${method} ${truncate(input.path, 50)}`;
    } else if (input.summary) {
      // Fallback to summary if no path
      subject = truncate(input.summary, 60);
    }
  } else if (isLinear) {
    verb = 'Linear';
    subject = input.summary ? truncate(input.summary, 300) : null;
  } else if (isGlean) {
    verb = 'Glean';
    subject = input.call?.payload?.query ? truncate(input.call.payload.query, 300) : null;
  } else if (name.includes('sentry')) {
    verb = 'Sentry';
    // Sentry tools have various input shapes - try to find the most descriptive one
    if (input.naturalLanguageQuery) {
      subject = truncate(input.naturalLanguageQuery, 60);
    } else if (input.issueId) {
      subject = input.issueId;
    } else if (input.issueUrl) {
      subject = truncate(input.issueUrl, 50);
    } else if (input.traceId) {
      subject = `trace ${safeStr(input.traceId).substring(0, 12)}...`;
    } else if (input.organizationSlug) {
      // For tools like find_projects, find_teams - extract action from name
      const action = name
        .replace('sentry', '')
        .replace(/^[-_]+|[-_]+$/g, '')
        .replace(/[-_]/g, ' ')
        .trim();
      subject = action ? `${action} · ${input.organizationSlug}` : input.organizationSlug;
    } else {
      // Fallback: extract action from tool name for tools with minimal input
      const action = name
        .replace('sentry', '')
        .replace(/^[-_]+|[-_]+$/g, '')
        .replace(/[-_]/g, ' ')
        .trim();
      if (action) subject = action;
    }
  } else if (
    name.includes('web-fetch') ||
    name.includes('web_fetch') ||
    name === 'fetch'
  ) {
    verb = 'Fetch';
    if (input.url) {
      try {
        const url = new URL(input.url);
        // Show hostname + more of the path for clarity
        const pathPart = url.pathname !== '/' ? url.pathname : '';
        subject = truncate(url.hostname + pathPart, 60);
      } catch {
        subject = truncate(input.url, 60);
      }
    }
  } else {
    // Generic API tool - try to show method + path or any summary
    if (input.method && input.path) {
      subject = `${input.method} ${truncate(input.path, 50)}`;
    } else if (input.summary) {
      subject = truncate(input.summary, 60);
    }
  }

  return {
    category: 'api',
    icon: CATEGORY_ICONS.api,
    verb,
    subject,
    path: null,
  };
}

function agentDisplay(name: string, input: Record<string, any>): ToolDisplay {
  let verb = 'Agent';
  let subject: string | null = null;

  if (name.includes('create_agent') || name.includes('create-agent')) {
    verb = m.chat_toolClassifier_createAgent_label();
    subject = input.name ? `"${truncate(input.name, 30)}"` : null;
  } else if (name.includes('delegate')) {
    verb = 'Delegate';
    // Show task description or a friendly label instead of raw UUID
    if (input.taskDescription) {
      subject = truncate(input.taskDescription, 40);
    } else if (input.taskText) {
      subject = truncate(input.taskText, 40);
    } else if (input.task) {
      subject = truncate(input.task, 40);
    } else {
      subject = 'task';
    }
  } else if (name.includes('message') || name.includes('send')) {
    verb = m.chat_toolClassifier_messageAgent_label();
    // Show a preview of the message if available
    if (input.message) {
      subject = truncate(input.message, 40);
    } else {
      subject = null;
    }
  } else if (name.includes('status')) {
    verb = m.chat_toolClassifier_checkAgentStatus_label();
    subject = null;
  } else if (name.includes('wait')) {
    verb = m.chat_toolClassifier_waitFor_label();
    const ids = Array.isArray(input.agentIds)
      ? input.agentIds
      : input.agentIds
        ? [input.agentIds]
        : [];
    subject = ids.length === 1 ? 'agent' : `${ids.length} agents`;
  } else if (name.includes('read') && name.includes('conversation')) {
    verb = m.chat_toolClassifier_readAgentConversation_label();
    subject = null;
  } else if (name.includes('summary') || name.includes('get_agent')) {
    verb = m.chat_toolClassifier_getAgentSummary_label();
    // Try to extract agent name from input
    if (input.agentName) {
      subject = truncate(input.agentName, 30);
    } else if (input.agentId) {
      // Show a shortened agent ID
      const id = safeStr(input.agentId);
      subject = id.length > 20 ? `${id.substring(0, 8)}...` : id;
    } else {
      subject = null;
    }
  } else if (name.includes('list')) {
    verb = m.chat_toolClassifier_listAgents_label();
    subject = null;
  } else if (name.includes('report') && name.includes('parent')) {
    verb = m.chat_toolClassifier_reportToParent_label();
    // Show a preview of the report if available
    if (input.report) {
      subject = truncate(input.report, 50);
    } else {
      subject = null;
    }
  }

  return {
    category: 'agent',
    icon: CATEGORY_ICONS.agent,
    verb,
    subject,
    path: null,
  };
}

function taskDisplay(name: string, input: Record<string, any>, result?: any): ToolDisplay {
  let verb = 'Task';
  let subject: string | null = null;

  if (name.includes('get') && name.includes('my') && name.includes('task')) {
    // get_my_task - reading the agent's assigned task
    verb = m.chat_toolClassifier_getTaskAssignment_label();
    // Try to extract task title from result or _noteTitle
    const noteTitle = input._noteTitle ? truncate(input._noteTitle, 30) : null;
    subject = noteTitle;
  } else if (name.includes('view') || name.includes('list') || name === 'task') {
    // "Task" with no other qualifiers is likely viewing the task list
    verb = 'View';
    subject = 'task list';
  } else if (name.includes('add')) {
    verb = 'Add';
    if (input.tasks && Array.isArray(input.tasks) && input.tasks.length > 0) {
      const firstName = input.tasks[0]?.name;
      subject =
        input.tasks.length === 1 && firstName
          ? truncate(firstName, 40)
          : `${input.tasks.length} tasks`;
    } else {
      subject = 'task';
    }
  } else if (name.includes('update')) {
    if (input.tasks && Array.isArray(input.tasks)) {
      const count = input.tasks.length;
      // Try to get task name and state from first task
      const firstTask = input.tasks[0];
      if (count === 1 && firstTask) {
        let taskName = firstTask.name ? truncate(firstTask.name, 30) : null;
        const state = firstTask.state;

        // If task name not in input, try to extract from result
        // Result format: "[x] UUID:xxx NAME:Task Name DESCRIPTION:..."
        // Result may be string, object, or array - extract text first
        if (!taskName && result) {
          const resultText = extractResultText(result);
          if (resultText) {
            // Try the standard format first (from taskDiffToMarkdown)
            let taskLineMatch = resultText.match(
              /\[[x\/\- ]\]\s*UUID:\S+\s+NAME:([^\n]+?)(?:\s+DESCRIPTION:|$)/,
            );
            if (taskLineMatch) {
              taskName = truncate(taskLineMatch[1].trim(), 30);
            }
            // Also try matching just NAME: pattern (more lenient)
            if (!taskName) {
              taskLineMatch = resultText.match(/NAME:([^\n]+?)(?:\s+DESCRIPTION:|$)/);
              if (taskLineMatch) {
                taskName = truncate(taskLineMatch[1].trim(), 30);
              }
            }
          }
        }

        // Format state nicely (COMPLETE -> complete, IN_PROGRESS -> in progress)
        const formattedState = state ? safeStr(state).toLowerCase().replace(/_/g, ' ') : null;
        if (taskName && formattedState) {
          verb = 'Mark';
          subject = `${taskName} ${formattedState}`;
        } else if (formattedState) {
          verb = 'Mark';
          subject = taskName ? `${taskName} ${formattedState}` : formattedState;
        } else if (taskName) {
          verb = 'Update';
          subject = taskName;
        } else {
          verb = 'Update';
          subject = 'task';
        }
      } else {
        verb = 'Update';
        subject = `${count} tasks`;
      }
    } else {
      verb = 'Update';
      subject = 'task';
    }
  } else if (name.includes('reorganize')) {
    verb = 'Reorganize';
    subject = 'task list';
  }

  return {
    category: 'task',
    icon: CATEGORY_ICONS.task,
    verb,
    subject,
    path: null,
  };
}

function workspaceDisplay(
  name: string,
  input: Record<string, any>,
  resultMetadata?: ResultMetadata | null,
): ToolDisplay {
  let verb = 'Workspace';
  let subject: string | null = null;
  let category: ToolCategory = 'workspace';
  let noteId: string | null = null;

  // Helper to get the note ID for linking
  const getNoteId = (): string | null => {
    if (resultMetadata?.noteId) return resultMetadata.noteId;
    if (input.noteId) return input.noteId;
    return null;
  };

  // Helper to get the best available note title
  // Priority: result metadata title > input title > input noteId
  const getNoteTitle = (maxLen: number = 30): string | null => {
    if (resultMetadata?.title) return formatNoteTitle(resultMetadata.title, maxLen);
    if (input.title) return formatNoteTitle(input.title, maxLen);
    if (input.noteId) {
      // Special case: 'spec' is a friendly ID
      if (input.noteId === 'spec') return 'Spec';
      // Check if noteId looks like a UUID and we should hide it
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        input.noteId,
      );
      if (isUUID) return null; // Don't show UUID, better to show nothing
      return formatNoteTitle(input.noteId, maxLen);
    }
    return null;
  };

  if (name.includes('title') && name.includes('workspace')) {
    verb = m.chat_toolClassifier_renameWorkspace_label();
    subject = input.title ? truncate(input.title, 30) : null;
  } else if (
    (name.includes('name') || name.includes('rename') || name.includes('title')) &&
    name.includes('agent')
  ) {
    verb = m.chat_toolClassifier_renameAgent_label();
    subject = input.name
      ? truncate(input.name, 30)
      : input.title
        ? truncate(input.title, 30)
        : null;
  } else if (name.includes('create') && name.includes('note')) {
    category = 'note';
    verb = m.chat_toolClassifier_createNote_label();
    subject = getNoteTitle(30);
    noteId = getNoteId();
  } else if (name.includes('read') && name.includes('note')) {
    category = 'note';
    verb = m.chat_toolClassifier_readNote_label();
    subject = getNoteTitle(30);
    noteId = getNoteId();
  } else if (name.includes('task') && name.includes('status')) {
    category = 'task';
    verb = name.includes('note')
      ? m.chat_toolClassifier_updateTaskStatus_label()
      : m.chat_toolClassifier_checkTask_label();
    const noteTitle = getNoteTitle(20);
    const taskText = input.taskText ? truncate(input.taskText, 25) : null;
    const status = input.status;
    if (taskText && status) {
      subject = `${taskText} → ${status}`;
    } else if (noteTitle && status) {
      subject = `${noteTitle} → ${status}`;
    } else if (noteTitle) {
      subject = noteTitle;
    }
    noteId = getNoteId();
  } else if (name.includes('update') && name.includes('note')) {
    category = 'note';
    verb = m.chat_toolClassifier_updateNote_label();
    subject = getNoteTitle(30);
    noteId = getNoteId();
  } else if (
    (name.includes('append') && name.includes('note')) ||
    (name.includes('add') && name.includes('note'))
  ) {
    category = 'note';
    verb = m.chat_toolClassifier_addToNote_label();
    const noteTitle = getNoteTitle(20);
    const heading = input.heading ? truncate(safeStr(input.heading).replace(/^#+\s*/, ''), 20) : null;
    // Show note title as subject, heading is already visible in the expanded view
    subject = noteTitle || (heading ? `→ ${heading}` : null);
    noteId = getNoteId();
  } else if (name.includes('edit') && name.includes('note') && name.includes('line')) {
    // edit_note_lines - line-based editing
    category = 'note';
    verb = m.chat_toolClassifier_editNote_label();
    const noteTitle = getNoteTitle(25);
    subject = noteTitle;
    noteId = getNoteId();
  } else if (name.includes('edit') && name.includes('note')) {
    // edit_note - str_replace style editing
    category = 'note';
    verb = m.chat_toolClassifier_editNote_label();
    const noteTitle = getNoteTitle(25);
    subject = noteTitle;
    noteId = getNoteId();
  } else if (name.includes('set') && name.includes('note') && name.includes('content')) {
    // set_note_content - full replacement
    category = 'note';
    verb = m.chat_toolClassifier_replaceNote_label();
    const noteTitle = getNoteTitle(25);
    subject = noteTitle;
    noteId = getNoteId();
  } else if (name.includes('delete') && name.includes('note') && !name.includes('comment')) {
    category = 'note';
    verb = m.chat_toolClassifier_deleteNote_label();
    subject = getNoteTitle(30);
    // Don't set noteId for delete - the note won't exist anymore
  } else if (name.includes('comment')) {
    // Check comment BEFORE list_note to avoid list_note_comments matching "List notes"
    category = 'note';
    verb = name.includes('delete')
      ? m.chat_toolClassifier_deleteComment_label()
      : name.includes('list')
        ? m.chat_toolClassifier_listComments_label()
        : name.includes('respond')
          ? m.chat_toolClassifier_replyToComment_label()
          : m.chat_toolClassifier_addComment_label();
    const noteTitle = getNoteTitle(25);
    subject = noteTitle ? m.chat_toolClassifier_onNote_subject({ noteTitle }) : null;
    noteId = getNoteId();
  } else if (name.includes('list') && name.includes('note')) {
    category = 'note';
    verb = m.chat_toolClassifier_listNotes_label();
    subject = null;
  } else if (name.includes('timeline')) {
    verb = 'Read';
    subject = 'timeline';
  } else if (name.includes('info') || name.includes('context') || name.includes('details')) {
    verb = 'Get';
    subject = 'workspace info';
  } else if (input.title) {
    // Fallback for tools with a title input - likely a rename operation
    verb = 'Rename';
    subject = truncate(input.title, 30);
  }

  return {
    category,
    icon: CATEGORY_ICONS[category],
    verb,
    subject,
    path: null,
    noteId,
  };
}

function metaDisplay(name: string, input: Record<string, any>): ToolDisplay {
  let verb = 'Think';
  let subject: string | null = null;

  if (name.includes('remember')) {
    verb = 'Remember';
    subject = input.memory ? truncate(input.memory, 50) : null;
  } else if (name.includes('think') || name.includes('sequential')) {
    verb = 'Think';
    subject = input.thought ? truncate(input.thought, 40) : null;
  }

  return {
    category: 'meta',
    icon: CATEGORY_ICONS.meta,
    verb,
    subject,
    path: null,
  };
}

function browserDisplay(name: string, input: Record<string, any>): ToolDisplay {
  let verb = 'Browser';
  let subject: string | null = null;

  // ---- MCP browser_exec tool: input.actions is an array of action objects ----
  if (Array.isArray(input.actions) && input.actions.length > 0) {
    const primaryAction = input.actions[0];
    const actionType = primaryAction?.action;

    switch (actionType) {
      case 'screenshot':
        verb = 'Screenshot';
        subject = primaryAction.tabId || input.tabId ? 'tab' : 'page';
        break;
      case 'evaluate':
        verb = 'Evaluate';
        subject = primaryAction.expression
          ? truncate(safeStr(primaryAction.expression).split('\n')[0], 60)
          : 'script';
        break;
      case 'listTabs':
        verb = 'List';
        subject = 'browser tabs';
        break;
      case 'focusTab':
        verb = 'Focus';
        subject = 'tab';
        break;
      case 'openTab':
        verb = 'Open';
        subject = primaryAction.url ? truncate(primaryAction.url, 50) : 'new tab';
        break;
      case 'getAccessibilityTree':
        verb = 'Inspect';
        subject = 'accessibility tree';
        break;
      case 'snapshot':
        verb = 'Snapshot';
        subject = primaryAction.name ? truncate(primaryAction.name, 40) : 'page';
        break;
      case 'resetTab':
        verb = 'Reset';
        subject = 'tab';
        break;
      case 'startSession':
        verb = 'Start';
        subject = primaryAction.name ? `session "${truncate(primaryAction.name, 30)}"` : 'capture session';
        break;
      case 'endSession':
        verb = 'End';
        subject = 'capture session';
        break;
      case 'captureStep':
        verb = 'Capture';
        subject = primaryAction.stepName ? truncate(primaryAction.stepName, 40) : 'step';
        break;
      case 'startCapture':
        verb = 'Start';
        subject = 'capture';
        break;
      case 'endCapture':
        verb = 'End';
        subject = 'capture';
        break;
      case 'startTrace':
        verb = 'Start';
        subject = 'performance trace';
        break;
      case 'stopTrace':
        verb = 'Stop';
        subject = 'performance trace';
        break;
      case 'getSummary':
        verb = 'Get';
        subject = 'session summary';
        break;
      default:
        verb = 'Browser';
        subject = actionType ? safeStr(actionType) : null;
        break;
    }

    // If multiple actions, append count
    if (input.actions.length > 1) {
      subject = subject
        ? `${subject} (+${input.actions.length - 1} more)`
        : `${input.actions.length} actions`;
    }

    return {
      category: 'browser',
      icon: CATEGORY_ICONS.browser,
      verb,
      subject,
      path: null,
    };
  }

  // ---- Playwright / npx DevTools style tools (name-based detection) ----

  // Helper: get element description from various input shapes
  const getElement = () =>
    input.element ? truncate(input.element, 30) : null;

  if (name.includes('open-browser') || name.includes('open_browser')) {
    verb = 'Open';
    subject = input.url ? truncate(input.url, 40) : 'browser';
  } else if (name.includes('navigate')) {
    verb = 'Navigate';
    subject = input.url ? truncate(input.url, 40) : null;
  } else if (name.includes('click')) {
    verb = 'Click';
    subject = getElement();
  } else if (name.includes('screenshot')) {
    verb = 'Screenshot';
    subject = getElement() || 'page';
  } else if (name.includes('snapshot')) {
    verb = 'Snapshot';
    subject = 'page';
  } else if (name.includes('type') || name === 'fill' || name.includes('fill_form')) {
    verb = name === 'fill' || name.includes('fill') ? 'Fill' : 'Type';
    subject = input.text ? truncate(input.text, 30) : getElement();
  } else if (name.includes('hover')) {
    verb = 'Hover';
    subject = getElement();
  } else if (name.includes('drag')) {
    verb = 'Drag';
    subject = input.startElement ? truncate(input.startElement, 30) : null;
  } else if (name.includes('select') && name.includes('option')) {
    verb = 'Select';
    subject = input.values
      ? Array.isArray(input.values)
        ? truncate(input.values.join(', '), 30)
        : null
      : null;
  } else if (name.includes('upload') || name.includes('file_upload')) {
    verb = 'Upload';
    subject = input.filePath
      ? filename(input.filePath)
      : Array.isArray(input.paths)
        ? `${input.paths.length} file${input.paths.length > 1 ? 's' : ''}`
        : 'file';
  } else if (name.includes('press') || name.includes('key')) {
    verb = 'Press';
    subject = input.key ? input.key : null;
  } else if (name.includes('wait')) {
    verb = 'Wait';
    subject = input.text
      ? `for "${truncate(input.text, 25)}"`
      : input.time
        ? `${input.time}s`
        : null;
  } else if (name.includes('resize')) {
    verb = 'Resize';
    subject = input.width && input.height ? `${input.width}×${input.height}` : 'page';
  } else if (name.includes('close')) {
    verb = 'Close';
    subject = 'page';
  } else if (name.includes('dialog')) {
    verb = 'Handle';
    subject = input.accept ? 'accept dialog' : 'dismiss dialog';
  } else if (name.includes('evaluate') || name.includes('script')) {
    verb = 'Evaluate';
    subject = 'script';
  } else if (name.includes('console')) {
    verb = 'Read';
    subject = 'console';
  } else if (name.includes('network')) {
    verb = 'Check';
    subject = 'network';
  } else if (name.includes('emulate')) {
    verb = 'Emulate';
    subject = input.viewport
      ? `${input.viewport.width}×${input.viewport.height}`
      : input.colorScheme
        ? input.colorScheme
        : 'device';
  } else if (name.includes('performance')) {
    verb = 'Performance';
    subject = name.includes('start') ? 'start trace' : name.includes('stop') ? 'stop trace' : 'trace';
  } else if (name.includes('tab') || name.includes('page')) {
    // list_pages, select_page, new_page, close_page
    if (name.includes('list')) {
      verb = 'List';
      subject = 'pages';
    } else if (name.includes('new')) {
      verb = 'Open';
      subject = input.url ? truncate(input.url, 40) : 'new page';
    } else if (name.includes('select')) {
      verb = 'Select';
      subject = 'page';
    } else {
      verb = 'Browser';
      subject = 'page';
    }
  }

  return {
    category: 'browser',
    icon: CATEGORY_ICONS.browser,
    verb,
    subject,
    path: null,
  };
}

function genericDisplay(toolName: string, input: Record<string, any>): ToolDisplay {
  // Unrecognized tool name with a prose ACP title: show the title verbatim
  const acpTitle = typeof input._acpTitle === 'string' ? input._acpTitle.trim() : '';
  if (acpTitle && isProseToolName(acpTitle)) {
    return proseTitleDisplay(acpTitle);
  }

  const cleanName = cleanToolName(toolName);
  const formattedName = cleanName
    .replace(/-/g, ' ')
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim();

  // Split into verb (first word) and name-derived subject (rest)
  // e.g., "find organizations" → verb="Find", nameSubject="organizations"
  // e.g., "resolve library id" → verb="Resolve", nameSubject="library id"
  const words = formattedName.split(/\s+/);

  // Remove trailing duplicate word (e.g. "generate figma design figma" → "generate figma design")
  // This catches MCP server name suffixes not covered by the hardcoded list in cleanToolName
  if (words.length > 2) {
    const lastWord = words[words.length - 1];
    const earlierWords = words.slice(0, -1);
    if (earlierWords.some((w) => w === lastWord)) {
      words.pop();
    }
  }

  const verb = words[0] ? words[0].charAt(0).toUpperCase() + words[0].slice(1) : 'Run';
  const nameSubject = words.length > 1 ? words.slice(1).join(' ') : null;

  // Try to extract a useful subject from input
  let inputSubject: string | null = null;
  const priorityKeys = [
    'summary',
    'query',
    'naturalLanguageQuery',
    'information_request',
    'message',
    'text',
    'name',
    'title',
    'url',
    'path',
    'content',
  ];
  for (const key of priorityKeys) {
    if (input[key] && typeof input[key] === 'string') {
      inputSubject = truncate(input[key], 50);
      break;
    }
  }

  // Combine: prefer input-derived subject, fall back to name-derived subject
  // If we have both, show name-derived as context: "Find organizations · my-org"
  // But if one contains the other, just use the longer one to avoid duplication
  let subject: string | null;
  if (inputSubject && nameSubject) {
    const inputLower = inputSubject.toLowerCase();
    const nameLower = nameSubject.toLowerCase();
    if (inputLower.includes(nameLower) || nameLower.includes(inputLower)) {
      subject = inputSubject.length >= nameSubject.length ? inputSubject : nameSubject;
    } else {
      subject = `${nameSubject} · ${inputSubject}`;
    }
  } else {
    subject = inputSubject || nameSubject;
  }

  return {
    category: 'generic',
    icon: CATEGORY_ICONS.generic,
    verb,
    subject,
    path: null,
  };
}
