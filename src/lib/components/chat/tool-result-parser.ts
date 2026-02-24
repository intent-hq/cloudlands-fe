/**
 * Tool Result Parser
 *
 * Parses tool results into structured data for rich preview display.
 * Handles view, str-replace-editor, codebase-retrieval, save-file, and terminal tools.
 */

export type ToolResultType =
  | 'file-view'
  | 'file-edit'
  | 'file-save'
  | 'code-search'
  | 'terminal'
  | 'note-view'
  | 'note-edit'
  | 'task'
  | 'task-update'
  | 'delegate-task'
  | 'directory-listing'
  | 'agent-report'
  | 'agent-message'
  | 'agent-list'
  | 'comment-add'
  | 'comment-list'
  | 'note-list'
  | 'browser'
  | 'confirmation'
  | 'unknown';

export interface ParsedToolResult {
  type: ToolResultType;
  filePath?: string;
  fileName?: string;
  language?: string;
  content?: string;
  lineRange?: [number, number];
  // For edits
  oldContent?: string;
  newContent?: string;
  editSummary?: string;
  // For search results
  snippets?: Array<{ path: string; content: string; lineStart?: number }>;
  // For terminal
  command?: string;
  exitCode?: number;
  // For task results
  taskTitle?: string;
  taskStatus?: string;
  taskContent?: string;
  // For delegate-task
  delegatedTaskName?: string;
  agentId?: string;
  taskNoteId?: string;
  // For directory listing
  directoryPath?: string;
  files?: string[];
  // For agent report
  reportMessage?: string;
  // For agent-message
  toAgentId?: string;
  toAgentName?: string;
  messageContent?: string;
  messagePriority?: 'high' | 'normal';
  messageQueued?: boolean;
  // For comment-add
  commentMessage?: string;
  commentAnchorText?: string;
  commentId?: string;
  // For comment-list
  commentThreads?: Array<{
    threadId: string;
    targetedText?: string;
    status: string;
    commentCount: number;
    latestAuthor?: string;
    lastActivity?: string;
  }>;
  totalComments?: number;
  // For note-list
  notes?: Array<{
    id: string;
    title: string;
    tags?: string[];
  }>;
  // For agent-list
  agents?: Array<{
    name: string;
    agentId: string;
    status?: string;
  }>;
  // For browser results
  browserAction?: string;
  screenshotBase64?: string;
  screenshotUrl?: string;
  screenshotWidth?: number;
  screenshotHeight?: number;
  browserTabs?: Array<{
    tabId: string;
    url: string;
    title: string;
    mounted: boolean;
  }>;
  evaluateResult?: string;
  accessibilityTree?: string;
  // Meta
  lineCount?: number;
  truncated?: boolean;
  error?: string;
}

/**
 * Represents a parsed task in task diff displays
 */
export interface ParsedTask {
  uuid: string;
  name: string;
  state: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETE' | 'CANCELLED';
  description?: string;
}

/**
 * Counts of task changes by category
 */
export interface TaskDiffCounts {
  created: number;
  updated: number;
  deleted: number;
}

/**
 * Task changes grouped by category for diff rendering
 */
export interface TaskDiffSections {
  created: ParsedTask[];
  updated: ParsedTask[];
  deleted: ParsedTask[];
}

// Language detection from file extension
const LANGUAGE_MAP: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  cpp: 'cpp',
  c: 'c',
  cs: 'csharp',
  php: 'php',
  swift: 'swift',
  kt: 'kotlin',
  scala: 'scala',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  sql: 'sql',
  html: 'html',
  css: 'css',
  scss: 'scss',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  md: 'markdown',
  svelte: 'svelte',
  vue: 'vue',
  xml: 'xml',
  toml: 'toml',
};

export function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  return LANGUAGE_MAP[ext] || 'plaintext';
}

export function getFileName(filePath: string): string {
  return filePath.split('/').pop() || filePath;
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
 * Parse a tool result based on tool name and result content
 */
export function parseToolResult(
  toolName: string,
  input: Record<string, any>,
  result: unknown,
): ParsedToolResult {
  // Extract text from various result formats
  const resultText = extractResultText(result);
  const name = (toolName || '').toLowerCase();

  // ── Workspace info tools (BEFORE 'view' check to prevent view_workspace misrouting) ──
  if (
    name.includes('view_workspace') ||
    name.includes('workspace_info') ||
    name.includes('workspace_details') ||
    name.includes('workspace_metadata') ||
    name.includes('get_workspace')
  ) {
    return { type: 'confirmation' as const, content: resultText || undefined };
  }

  // View/read tools - directory listing or file view
  if (name.includes('view') || name === 'read' || name.includes('read_file')) {
    // Check if this is a directory listing
    if (input.type === 'directory' || resultText?.includes('files and directories up to')) {
      return parseDirectoryListingResult(input, resultText);
    }
    return parseViewResult(input, resultText);
  }

  // Read workspaces tool (directory listing)
  if (name.includes('read_workspaces') || name.includes('read-workspaces')) {
    return parseDirectoryListingResult(input, resultText);
  }

  // Delegate task tool
  if (name.includes('delegate') || name.includes('spawn_agent') || name.includes('spawn-agent')) {
    return parseDelegateTaskResult(input, resultText);
  }

  // ── Note update tools (BEFORE generic 'edit' to prevent edit_note/edit_note_lines misrouting) ──
  if (
    name.includes('update_note') ||
    name.includes('update-note') ||
    name.includes('set_note_content') ||
    name.includes('add_to_note') ||
    name.includes('append_to_note') ||
    name.includes('edit_note')
  ) {
    return parseNoteUpdateResult(input, resultText);
  }

  // Edit tools (str-replace-editor, generic edits)
  if (name.includes('str-replace') || name.includes('edit')) {
    return parseEditResult(input, resultText);
  }

  // Save/write tools
  if (name.includes('save') || name.includes('write')) {
    return parseSaveResult(input, resultText);
  }

  // Search/retrieval tools (including context engine tools)
  if (
    name.includes('codebase-retrieval') ||
    name.includes('codebase_retrieval') ||
    name.includes('git-commit-retrieval') ||
    name.includes('git_commit_retrieval') ||
    name.includes('search') ||
    name.includes('grep')
  ) {
    return parseSearchResult(input, resultText);
  }

  // Terminal tools (also catch tools with command input, e.g., ACP "Run" title)
  if (
    name.includes('launch-process') ||
    name.includes('read-process') ||
    name.includes('terminal') ||
    name.includes('bash') ||
    (input.command && (input.wait !== undefined || input.cwd !== undefined || input.max_wait_seconds !== undefined))
  ) {
    return parseTerminalResult(input, resultText);
  }

  // ── Git operations → terminal display ──
  if (
    name.includes('git_status') ||
    name.includes('git_stage') ||
    name.includes('git_commit') ||
    name.includes('git-status') ||
    name.includes('git-stage') ||
    name.includes('git-commit') ||
    name.includes('commit_changes') ||
    name.includes('merge_conflict')
  ) {
    return parseGitResult(name, input, resultText);
  }

  // Glob/Find tools - directory listing
  if (name.includes('glob') || name.includes('find')) {
    return parseDirectoryListingResult(input, resultText);
  }

  // Note read tools (including read_external_note)
  if (name.includes('read_note') || name.includes('read-note') || name.includes('read_external_note')) {
    return parseNoteReadResult(input, resultText);
  }

  // Task update tools (update_task_status, update_note_task_status, update_task)
  // Must be checked BEFORE update_note to avoid false matches
  if (name.includes('task') && (name.includes('update') || name.includes('status'))) {
    return parseTaskUpdateResult(input, resultText);
  }

  // Task tools (read_task, get_task, get_my_task, etc.)
  if (name.includes('task') && (name.includes('read') || name.includes('get'))) {
    return parseTaskResult(input, resultText);
  }

  // list_note_tasks — returns a compact task summary, display as note-view
  // Must be checked BEFORE the generic task catch-all below
  if (name.includes('list_note_tasks') || name.includes('list-note-tasks')) {
    return { type: 'note-view' as const, content: resultText || undefined };
  }

  // Remaining task tools (mark_as_task, create_prerequisite, convert_task_blocks)
  if (name.includes('task') || name.includes('prerequisite')) {
    return parseTaskUpdateResult(input, resultText);
  }

  // Report to parent tool
  if (name.includes('report') && name.includes('parent')) {
    return parseAgentReportResult(input, resultText);
  }

  // Agent message tools (send_message_to_agent, send_message_to_task_agent, etc.)
  if (
    (name.includes('message') && name.includes('agent')) ||
    (name.includes('send') && name.includes('agent'))
  ) {
    return parseAgentMessageResult(input, resultText);
  }

  // ── Agent creation/wake → delegate-task display with agent card ──
  if (
    name.includes('create_agent') ||
    name.includes('create-agent') ||
    name.includes('wake_or_create')
  ) {
    return parseAgentCreationResult(input, resultText);
  }

  // ── Agent status/info → agent-list with single agent ──
  if (name.includes('agent_status') || name.includes('agent-status')) {
    return parseAgentStatusResult(input, resultText);
  }

  // ── Read agent conversation → content display ──
  if (name.includes('read_agent') || name.includes('agent_conversation')) {
    return { type: 'note-view' as const, content: resultText || undefined };
  }

  // Comment tools (add_note_comment, list_note_comments, respond_to_comment_thread, etc.)
  // Must be checked BEFORE list_notes to avoid list_note_comments matching list_notes
  if (name.includes('comment')) {
    if (name.includes('list')) {
      return parseCommentListResult(input, resultText);
    }
    // add_note_comment, respond_to_comment_thread, get_comment_thread, delete_note_comment
    return parseCommentAddResult(input, resultText);
  }

  // List notes tool (including list_external_notes)
  if (name.includes('list') && name.includes('note')) {
    return parseNoteListResult(input, resultText);
  }

  // Agent list tools
  if (name.includes('list') && name.includes('agent')) {
    return parseAgentListResult(input, resultText);
  }

  // ── List sibling workspaces ──
  if (name.includes('list') && name.includes('workspace')) {
    return { type: 'confirmation' as const, content: resultText || undefined };
  }

  // Browser tools (MCP browser_exec with actions array)
  if (
    (name.includes('browser') && Array.isArray(input.actions)) ||
    name.includes('browser_exec')
  ) {
    return parseBrowserResult(input, result);
  }

  // ── Reference docs → markdown content ──
  if (name.includes('reference_doc') || name.includes('reference-doc') || name.includes('get_reference')) {
    return { type: 'note-view' as const, content: resultText || undefined };
  }

  // ── API tools (web-fetch, github, linear, glean) → content display ──
  if (
    name.includes('web-fetch') ||
    name.includes('web_fetch') ||
    name.includes('github') ||
    name.includes('linear') ||
    name.includes('glean')
  ) {
    return { type: 'confirmation' as const, content: resultText || undefined };
  }

  // ── Note creation/deletion → confirmation ──
  if ((name.includes('create') || name.includes('delete')) && name.includes('note')) {
    return { type: 'confirmation' as const, content: resultText || undefined };
  }

  // ── Note primitives (add_reference, add_cli, add_patch, add_agent_action) → note-edit ──
  if (
    name.includes('add_reference') ||
    name.includes('add_cli') ||
    name.includes('add_patch') ||
    name.includes('add_agent_action')
  ) {
    return { type: 'note-edit' as const, editSummary: resultText || 'Updated', content: resultText || undefined };
  }

  // ── Workspace/agent rename → confirmation ──
  if (
    name.includes('rename_workspace') ||
    name.includes('rename-workspace') ||
    name.includes('set_workspace_title') ||
    name.includes('set_space_title') ||
    name.includes('rename_agent') ||
    name.includes('rename-agent')
  ) {
    return { type: 'confirmation' as const, content: resultText || undefined };
  }

  // ── Assign agent → confirmation ──
  if (name.includes('assign_agent') || name.includes('assign-agent')) {
    return { type: 'confirmation' as const, content: resultText || undefined };
  }

  // ── Timeline / context / asset reads → content display ──
  if (name.includes('timeline') || name.includes('current_context') || name.includes('read_asset')) {
    return { type: 'confirmation' as const, content: resultText || undefined };
  }

  // ── Event tools (get_recent_files, get_agent_activity, etc.) → content ──
  if (
    name.includes('recent_files') ||
    name.includes('agent_activity') ||
    name.includes('workspace_summary') ||
    name.includes('directory_changes') ||
    name.includes('query_events')
  ) {
    return { type: 'confirmation' as const, content: resultText || undefined };
  }

  // ── File removal → confirmation ──
  if (
    (name.includes('remove') && (name.includes('file') || input.file_paths)) ||
    name.includes('delete_file')
  ) {
    return { type: 'confirmation' as const, content: resultText || undefined };
  }

  // ── Subscribe/unsubscribe events → confirmation ──
  if (name.includes('subscribe')) {
    return { type: 'confirmation' as const, content: resultText || undefined };
  }

  // ── Remaining agent tools (catch-all for agent-related) ──
  // NOTE: This is intentionally broad. If you add a tool with "agent" in the name
  // that needs its own display type, add a specific match ABOVE this block.
  if (name.includes('agent')) {
    return { type: 'confirmation' as const, content: resultText || undefined };
  }

  // ── Smart fallback: if we have result text, show it cleanly instead of raw input ──
  if (resultText) {
    return { type: 'confirmation' as const, content: resultText };
  }

  return { type: 'unknown', content: undefined };
}

/**
 * Parse view tool result (cat -n format)
 *
 * The view tool has two output formats:
 *
 * 1. Normal file view:
 *   "Here's the result of running `cat -n` on {path}:\n"  (header)
 *   "     1\tcode here\n"                                  (content lines)
 *   "     2\tmore code\n"
 *   ...
 *   "Total lines in file: {N}\n"                          (footer)
 *
 * 2. Regex search results:
 *   "Regex search results for pattern: {pattern} in {path}\n"  (header)
 *   "Found N matching lines:\n"                                 (header)
 *   "\n"
 *   ">     1\tmatching line\n"                                  (matching line with > prefix)
 *   "      2\tcontext line\n"                                   (context line with space prefix)
 *   "...\n"                                                     (separator between non-contiguous matches)
 */
function parseViewResult(
  input: Record<string, any>,
  result: string | null | undefined,
): ParsedToolResult {
  const filePath = input.path || '';
  const parsed: ParsedToolResult = {
    type: 'file-view',
    filePath,
    fileName: getFileName(filePath),
    language: detectLanguage(filePath),
  };

  if (!result) return parsed;

  // Extract content - view tool returns "cat -n" format
  const lines = result.split('\n');
  const contentLines: string[] = [];
  let firstLineNum: number | undefined;
  let lastLineNum: number | undefined;

  for (const line of lines) {
    // Skip header lines
    if (line.startsWith("Here's the result of running")) continue;
    if (line.startsWith('Regex search results for pattern:')) continue;
    if (line.startsWith('Search limited to lines')) continue;
    if (line.startsWith('Found ') && line.includes('matching line')) continue;

    // Skip the footer line: "Total lines in file: ..."
    if (line.startsWith('Total lines in file:')) continue;

    // Skip empty lines at the start
    if (contentLines.length === 0 && line.trim() === '') continue;

    // Handle "..." separator in regex search results
    if (line === '...') {
      contentLines.push('...');
      continue;
    }

    // Match line number format:
    // Normal: "    1\tcode here" or "   12\tcode"
    // Regex search: ">     1\tcode" or "      2\tcode" (with > or space prefix)
    // Also handle spaces instead of tabs (in case tabs are rendered as spaces)
    const match = line.match(/^[> ]?\s*(\d+)[\t ]+(.*)$/);
    if (match) {
      const lineNum = parseInt(match[1], 10);
      if (firstLineNum === undefined) firstLineNum = lineNum;
      lastLineNum = lineNum;
      contentLines.push(match[2]);
    } else if (line.trim() && contentLines.length > 0) {
      // If we've started collecting content but this line doesn't match the format,
      // it might be a line without a line number (e.g., raw content) - include it
      contentLines.push(line);
    }
  }

  parsed.content = contentLines.join('\n');
  parsed.lineCount = contentLines.length;
  if (firstLineNum !== undefined && lastLineNum !== undefined) {
    parsed.lineRange = [firstLineNum, lastLineNum];
  }

  // Check for truncation
  if (result.includes('<response clipped>') || result.includes('truncated')) {
    parsed.truncated = true;
  }

  return parsed;
}

/**
 * Parse str-replace-editor result
 */
function parseEditResult(
  input: Record<string, any>,
  result: string | null | undefined,
): ParsedToolResult {
  const filePath = input.path || '';
  const parsed: ParsedToolResult = {
    type: 'file-edit',
    filePath,
    fileName: getFileName(filePath),
    language: detectLanguage(filePath),
  };

  // Extract old/new content from input
  if (input.old_str_1) {
    parsed.oldContent = input.old_str_1;
  }
  if (input.new_str_1) {
    parsed.newContent = input.new_str_1;
  }

  // Count replacements
  const replacementCount = Object.keys(input).filter((k) => k.startsWith('old_str_')).length;
  if (replacementCount > 1) {
    parsed.editSummary = `${replacementCount} replacements`;
  }

  // Extract line range from input params or result text
  const startLine = Number(input.old_str_start_line_number_1 || input.insert_line_1);
  if (startLine > 0) {
    const endLine = Number(input.old_str_end_line_number_1) || startLine;
    parsed.lineRange = [startLine, endLine];
  }
  // Fallback: parse "new_str starts at line X and ends at line Y." from result text
  if (!parsed.lineRange && result) {
    const lineMatch = result.match(/new_str starts at line (\d+) and ends at line (\d+)/);
    if (lineMatch) {
      parsed.lineRange = [Number(lineMatch[1]), Number(lineMatch[2])];
    }
  }

  // Extract result content (usually shows edited snippet)
  if (result) {
    parsed.content = result;
  }

  return parsed;
}

/**
 * Parse save-file result
 */
function parseSaveResult(
  input: Record<string, any>,
  result: string | null | undefined,
): ParsedToolResult {
  const filePath = input.path || '';
  const parsed: ParsedToolResult = {
    type: 'file-save',
    filePath,
    fileName: getFileName(filePath),
    language: detectLanguage(filePath),
  };

  if (input.file_content) {
    parsed.content = input.file_content;
    parsed.lineCount = input.file_content.split('\n').length;
  }

  return parsed;
}

/**
 * Parse codebase-retrieval result
 */
function parseSearchResult(
  input: Record<string, any>,
  result: string | null | undefined,
): ParsedToolResult {
  const parsed: ParsedToolResult = {
    type: 'code-search',
    snippets: [],
  };

  if (!result) {
    // When result is empty but we have a query/pattern, add it as content
    // This ensures search tools always have something to display when expanded
    if (input.information_request) {
      parsed.content = `Search: ${input.information_request}`;
    } else if (input.query) {
      parsed.content = `Search: ${input.query}`;
    } else if (input.pattern) {
      parsed.content = `Search: ${input.pattern}`;
    } else if (input.glob) {
      parsed.content = `Find: ${input.glob}`;
    }
    return parsed;
  }

  // Parse "Path: ..." format from codebase-retrieval
  const pathRegex = /Path:\s*([^\n]+)/g;
  const sections = result.split(/(?=Path:)/);

  for (const section of sections) {
    const pathMatch = section.match(/^Path:\s*([^\n]+)/);
    if (pathMatch) {
      const path = pathMatch[1].trim();
      const content = section.substring(pathMatch[0].length).trim();
      if (content) {
        parsed.snippets!.push({ path, content });
      }
    }
  }

  // If no structured paths found, treat as plain content
  if (parsed.snippets!.length === 0) {
    parsed.content = result;
  }

  return parsed;
}

/**
 * Strip XML wrapper tags from terminal results.
 * ACP providers often wrap terminal output in XML like:
 *   Here are the results from executing the command.
 *   <return-code>0</return-code>
 *   <output>actual output here</output>
 *
 * Returns { output, exitCode } with the clean content extracted.
 */
function parseTerminalXml(raw: string): { output: string; exitCode?: number } {
  // Try to extract <output>...</output> content
  const outputMatch = raw.match(/<output>([\s\S]*?)<\/output>/);
  const exitCodeMatch = raw.match(/<return-code>\s*(-?\d+)\s*<\/return-code>/);

  if (outputMatch || exitCodeMatch) {
    const output = outputMatch ? outputMatch[1].replace(/^\n+|\n+$/g, '') : '';
    const exitCode = exitCodeMatch ? parseInt(exitCodeMatch[1], 10) : undefined;
    return { output, exitCode };
  }

  // No XML wrapper found — return raw content as-is
  return { output: raw };
}

/**
 * Parse terminal/launch-process result
 */
function parseTerminalResult(
  input: Record<string, any>,
  result: string | null | undefined,
): ParsedToolResult {
  const parsed: ParsedToolResult = {
    type: 'terminal',
    command: input.command,
  };

  if (result) {
    const { output, exitCode } = parseTerminalXml(result);
    parsed.content = output || undefined;
    if (exitCode !== undefined) {
      parsed.exitCode = exitCode;
    }
  }

  if (!parsed.content && input.command) {
    // When result is empty but command exists, show the command as content
    // This ensures terminal tools always have something to display when expanded
    parsed.content = `$ ${input.command}`;
  }

  return parsed;
}

/**
 * Parse update_note result
 */
function parseNoteUpdateResult(
  input: Record<string, any>,
  result: string | null | undefined,
): ParsedToolResult {
  const noteId = input.noteId || 'note';
  const parsed: ParsedToolResult = {
    type: 'note-edit',
    fileName: noteId === 'spec' ? 'Spec' : noteId,
    language: 'markdown',
  };

  // Try to extract old/new content from result (if it's JSON)
  if (result && typeof result === 'string') {
    try {
      const resultData = JSON.parse(result);
      if (resultData.oldContent !== undefined && resultData.newContent !== undefined) {
        parsed.oldContent = resultData.oldContent || '';
        parsed.newContent = resultData.newContent || '';
        return parsed;
      }
    } catch {
      // Result is not JSON - continue to extract from input
    }
  }

  // Extract content based on the type of edit operation
  // add_to_note / append_to_note: input.content is the new content added
  if (input.content) {
    // For add_to_note, show the content that was added (optionally with heading)
    if (input.heading) {
      parsed.content = `${input.heading}\n\n${input.content}`;
    } else {
      parsed.content = input.content;
    }
    return parsed;
  }

  // edit_note (str_replace style): input.old_text and input.new_text
  if (input.old_text !== undefined && input.new_text !== undefined) {
    parsed.oldContent = input.old_text || '';
    parsed.newContent = input.new_text || '';
    return parsed;
  }

  // edit_note_lines (line-based): input.new_content is the replacement
  if (input.new_content !== undefined) {
    // Show the replacement content
    parsed.content = input.new_content || '(deleted lines)';
    return parsed;
  }

  return parsed;
}

/**
 * Parse read_note result
 *
 * Format:
 *   "Note: {title}\n\n"
 *   "{image summary if any}\n\n"
 *   "   1 | line content\n"
 *   "   2 | another line\n"
 *   ...
 *   "\n\n--- Task Metadata ---\n" (optional)
 */
function parseNoteReadResult(
  input: Record<string, any>,
  result: string | null | undefined,
): ParsedToolResult {
  const noteId = input.noteId || 'note';
  const parsed: ParsedToolResult = {
    type: 'note-view',
    fileName: noteId === 'spec' ? 'Spec' : noteId,
    language: 'markdown',
  };

  if (!result) return parsed;

  const lines = result.split('\n');
  const contentLines: string[] = [];
  let inTaskMetadata = false;

  for (const line of lines) {
    // Skip "Note: {title}" header
    if (line.startsWith('Note:')) continue;

    // Skip image summary lines
    if (line.startsWith('Note: If you received images')) continue;

    // Stop at task metadata section (we could parse this later if needed)
    if (line.startsWith('--- Task Metadata ---')) {
      inTaskMetadata = true;
      continue;
    }
    if (inTaskMetadata) continue;

    // Match line number format: "   1 | content" (4-digit padded number, space, pipe, space)
    const match = line.match(/^\s*\d+\s*\|\s?(.*)$/);
    if (match) {
      contentLines.push(match[1]);
    }
  }

  parsed.content = contentLines.join('\n');
  parsed.lineCount = contentLines.length;

  return parsed;
}

/**
 * Parse task result (read_task, get_task)
 */
function parseTaskResult(
  input: Record<string, any>,
  result: string | null | undefined,
): ParsedToolResult {
  const parsed: ParsedToolResult = {
    type: 'task',
  };

  if (!result) return parsed;

  // Try to parse as JSON first
  try {
    const data = JSON.parse(result);
    parsed.taskTitle = data.title || data.name;
    parsed.taskStatus = data.status;
    parsed.taskContent = data.content || data.description;
    return parsed;
  } catch {
    // Not JSON, try to parse the text format
  }

  // Parse text format: "Task: ...\nStatus: ...\nContent: ..."
  const titleMatch = result.match(/^Task:\s*(.+?)(?:\n|$)/m);
  const statusMatch = result.match(/^Status:\s*(.+?)(?:\n|$)/m);
  const contentMatch = result.match(/^Content:\s*([\s\S]*?)(?=\n(?:Acceptance|$)|\n\n|$)/m);

  if (titleMatch) parsed.taskTitle = titleMatch[1].trim();
  if (statusMatch) parsed.taskStatus = statusMatch[1].trim();
  if (contentMatch) parsed.taskContent = contentMatch[1].trim();

  // If we couldn't parse structured data, just store as content
  if (!parsed.taskTitle && !parsed.taskStatus) {
    parsed.content = result;
  }

  return parsed;
}

/**
 * Parse directory listing result
 *
 * Format:
 *   "Here's the files and directories up to 2 levels deep in {path}, excluding hidden and generated files:\n"
 *   "- dir1/\n"
 *   "- dir2/\n"
 *   "  - subdir/\n"
 *   "  - file.ts\n"
 *   ...
 */
function parseDirectoryListingResult(
  input: Record<string, unknown>,
  result: string | null | undefined,
): ParsedToolResult {
  const directoryPath = (input.path as string) || '';
  const parsed: ParsedToolResult = {
    type: 'directory-listing',
    directoryPath,
    files: [],
  };

  if (!result) {
    // When result is empty but we have a pattern/glob, add it as content
    // This ensures find/glob tools always have something to display when expanded
    if (input.pattern && typeof input.pattern === 'string') {
      parsed.content = `Find: ${input.pattern}`;
    } else if (input.glob && typeof input.glob === 'string') {
      parsed.content = `Find: ${input.glob}`;
    }
    return parsed;
  }

  const lines = result.split('\n');
  const files: string[] = [];

  for (const line of lines) {
    // Skip header line
    if (line.includes('files and directories up to')) continue;
    if (line.includes('excluding hidden')) continue;

    // Match file/directory entries: "- name" or "  - name" (with indentation)
    const match = line.match(/^\s*-\s+(.+)$/);
    if (match) {
      files.push(match[1].trim());
    }
  }

  parsed.files = files;
  parsed.lineCount = files.length;

  return parsed;
}

/**
 * Parse delegate task result
 *
 * Format:
 *   'Task "{name}" delegated to new agent.\nAgent ID: {agentId}\nTask Note ID: {noteId}'
 */
function parseDelegateTaskResult(
  input: Record<string, unknown>,
  result: string | null | undefined,
): ParsedToolResult {
  const parsed: ParsedToolResult = {
    type: 'delegate-task',
  };

  // Get task name from input if available
  if (input.taskName) {
    parsed.delegatedTaskName = input.taskName as string;
  }
  if (input.task_name) {
    parsed.delegatedTaskName = input.task_name as string;
  }
  if (input.taskText) {
    parsed.delegatedTaskName = input.taskText as string;
  }

  if (!result) return parsed;

  // Parse task name from result: Task "{name}" delegated
  const taskMatch = result.match(/Task\s+"([^"]+)"\s+delegated/);
  if (taskMatch) {
    parsed.delegatedTaskName = taskMatch[1];
  }

  // Parse agent ID
  const agentMatch = result.match(/Agent\s*ID:\s*(\S+)/i);
  if (agentMatch) {
    parsed.agentId = agentMatch[1];
  }

  // Parse task note ID
  const noteMatch = result.match(/Task\s*Note\s*ID:\s*(\S+)/i);
  if (noteMatch) {
    parsed.taskNoteId = noteMatch[1];
  }

  // Store original content as fallback
  parsed.content = result;

  return parsed;
}

/**
 * Parse task update result (update_task_status, update_note_task_status, update_task)
 *
 * Result formats:
 *   - update_task_status: "Task status updated to 'done': task text..."
 *   - update_note_task_status: "Task Note status updated to 'complete'"
 *   - update_task: "Task updated at line N: "text" [status]"
 */
function parseTaskUpdateResult(
  input: Record<string, unknown>,
  result: string | null | undefined,
): ParsedToolResult {
  const parsed: ParsedToolResult = {
    type: 'task-update',
  };

  // Get task info from input - handle both single task and tasks array formats
  // Note: We intentionally don't use taskId/noteId as the title since those are UUIDs
  // The actual task name should come from the 'name' field or be extracted from the result
  if (input.taskText) {
    parsed.taskTitle = input.taskText as string;
  }
  if (input.status) {
    parsed.taskStatus = input.status as string;
  }

  // Handle update_tasks format with tasks array
  if (input.tasks && Array.isArray(input.tasks) && input.tasks.length > 0) {
    const firstTask = input.tasks[0] as Record<string, unknown>;
    // Prefer the name field over task_id (which is a UUID)
    if (firstTask.name) {
      parsed.taskTitle = firstTask.name as string;
    }
    if (firstTask.state && !parsed.taskStatus) {
      // Format state nicely (COMPLETE -> complete, IN_PROGRESS -> in progress)
      const state = (firstTask.state as string).toLowerCase().replace(/_/g, ' ');
      parsed.taskStatus = state;
    }
  }

  // Try to extract status from result message
  if (result) {
    // Match: "Task status updated to 'done':" or "Task Note status updated to 'complete'"
    const statusMatch = result.match(/status updated to ['"]?([^'":\s]+)['"]?/i);
    if (statusMatch && !parsed.taskStatus) {
      parsed.taskStatus = statusMatch[1];
    }

    // Match: "Task updated at line N: "text" [status]"
    const taskUpdateMatch = result.match(/Task updated at line \d+:.*\[([^\]]+)\]/);
    if (taskUpdateMatch && !parsed.taskStatus) {
      parsed.taskStatus = taskUpdateMatch[1];
    }

    // Extract task name and state from update_tasks result format:
    // "[x] UUID:xxx NAME:Task Name DESCRIPTION:..."
    // The format from taskDiffToMarkdown is: "[x] UUID:abc123 NAME:Task Name DESCRIPTION:..."
    const taskLineMatch = result.match(
      /\[([x\/\- ])\]\s*UUID:\S+\s+NAME:([^\n]+?)(?:\s+DESCRIPTION:|$)/,
    );
    if (taskLineMatch) {
      const stateChar = taskLineMatch[1];
      const taskName = taskLineMatch[2].trim();
      // Always prefer the actual task name from result over UUID from input
      if (taskName) {
        parsed.taskTitle = taskName;
      }
      // Map state character to status
      if (!parsed.taskStatus) {
        const stateMap: Record<string, string> = {
          x: 'complete',
          '/': 'in progress',
          '-': 'cancelled',
          ' ': 'not started',
        };
        parsed.taskStatus = stateMap[stateChar] || stateChar;
      }
    }

    parsed.content = result;
  }

  return parsed;
}

/**
 * Parse report_to_parent result
 *
 * Format:
 *   'Completion report saved. Your parent agent "agent-xxx" will receive:\n\n"{report message}"'
 */
function parseAgentReportResult(
  input: Record<string, unknown>,
  result: string | null | undefined,
): ParsedToolResult {
  const parsed: ParsedToolResult = {
    type: 'agent-report',
  };

  // Get report from input if available
  if (input.report) {
    parsed.reportMessage = input.report as string;
  }
  if (input.message) {
    parsed.reportMessage = input.message as string;
  }

  if (!result) return parsed;

  // Try to extract the quoted report message from result
  // Format: ... will see this report when you finish responding:\n\n"actual report message"
  // Also handle legacy format: ... will receive:\n\n"actual report message"
  const reportMatch = result.match(/(?:will receive|will see this report[^:]*):?\s*\n\n"([^"]+)"/);
  if (reportMatch) {
    parsed.reportMessage = reportMatch[1];
  } else {
    // Fallback: try to find any quoted string (at least 10 chars to avoid matching short strings like agent IDs)
    const quotedMatch = result.match(/"([^"]{10,})"/);
    if (quotedMatch) {
      parsed.reportMessage = quotedMatch[1];
    }
  }

  // Store original as fallback
  parsed.content = result;

  return parsed;
}

/**
 * Parse send_message_to_agent / send_message_to_task_agent result
 *
 * Input has:
 * - agentId / targetAgentId: string
 * - message: string
 * - priority: 'high' | 'normal' (optional)
 *
 * Result format:
 *   'Message sent to agent {agentId}. The message will be delivered when the agent becomes idle.'
 */
function parseAgentMessageResult(
  input: Record<string, unknown>,
  result: string | null | undefined,
): ParsedToolResult {
  const parsed: ParsedToolResult = {
    type: 'agent-message',
  };

  // Get target agent ID from input
  if (input.agentId) {
    parsed.toAgentId = input.agentId as string;
  } else if (input.targetAgentId) {
    parsed.toAgentId = input.targetAgentId as string;
  }

  // Get message content from input
  if (input.message) {
    parsed.messageContent = input.message as string;
  }

  // Get priority from input
  if (input.priority === 'high' || input.priority === 'normal') {
    parsed.messagePriority = input.priority;
  }

  // Parse result to check if message was queued
  if (result) {
    parsed.messageQueued = result.includes('will be delivered') || result.includes('queued');
    parsed.content = result;
  }

  return parsed;
}

/**
 * Parse add_note_comment / respond_to_comment_thread result
 *
 * The result is JSON with:
 * - success: boolean
 * - message: string (e.g., 'Comment successfully anchored to "Section 3"')
 * - commentId: string
 * - anchored: boolean
 * - location: { line: number, anchoredText: string }
 */
function parseCommentAddResult(
  _input: Record<string, unknown>,
  result: string | null | undefined,
): ParsedToolResult {
  const parsed: ParsedToolResult = {
    type: 'comment-add',
  };

  if (!result) return parsed;

  try {
    const data = JSON.parse(result);
    if (data.message) {
      parsed.commentMessage = data.message;
    }
    if (data.commentId) {
      parsed.commentId = data.commentId;
    }
    if (data.location?.anchoredText) {
      parsed.commentAnchorText = data.location.anchoredText;
    }
  } catch {
    // If not valid JSON, just show raw content
    parsed.content = result;
  }

  return parsed;
}

/**
 * Parse list_note_comments result
 *
 * The result is JSON with:
 * - threads: Array of { threadId, noteId, targetedText, status, commentCount, latestCommentAuthor, lastActivity, ... }
 * - totalThreads: number
 * - totalComments: number
 */
function parseCommentListResult(
  _input: Record<string, unknown>,
  result: string | null | undefined,
): ParsedToolResult {
  const parsed: ParsedToolResult = {
    type: 'comment-list',
    commentThreads: [],
    totalComments: 0,
  };

  if (!result) return parsed;

  try {
    const data = JSON.parse(result);
    if (data.threads && Array.isArray(data.threads)) {
      parsed.commentThreads = data.threads.map(
        (thread: {
          threadId: string;
          targetedText?: string;
          status?: string;
          commentCount?: number;
          latestCommentAuthor?: string;
          lastActivity?: string;
        }) => ({
          threadId: thread.threadId,
          targetedText: thread.targetedText || undefined,
          status: thread.status || 'open',
          commentCount: thread.commentCount || 1,
          latestAuthor: thread.latestCommentAuthor || undefined,
          lastActivity: thread.lastActivity || undefined,
        }),
      );
    }
    if (typeof data.totalComments === 'number') {
      parsed.totalComments = data.totalComments;
    }
  } catch {
    // If not valid JSON, just show raw content
    parsed.content = result;
  }

  return parsed;
}

/**
 * Parse list_notes result
 *
 * The result is JSON array with:
 * - id: string
 * - title: string
 * - tags: string[]
 * - created_at / createdAt: string
 * - updated_at / updatedAt: string
 */
function parseNoteListResult(
  _input: Record<string, unknown>,
  result: string | null | undefined,
): ParsedToolResult {
  const parsed: ParsedToolResult = {
    type: 'note-list',
    notes: [],
  };

  if (!result) return parsed;

  try {
    const data = JSON.parse(result);
    if (Array.isArray(data)) {
      parsed.notes = data.map((note: { id: string; title?: string; tags?: string[] }) => ({
        id: note.id,
        title: note.title || 'Untitled',
        tags: note.tags || [],
      }));
    }
  } catch {
    // If not valid JSON, just show raw content
    parsed.content = result;
  }

  return parsed;
}


/**
 * Parse browser tool result (MCP browser_exec with actions array)
 *
 * The result is an ExecutionResult:
 * {
 *   success: boolean;
 *   results: ActionResult[];  // one per action
 *   error?: string;
 * }
 *
 * Each ActionResult:
 * {
 *   action: string;
 *   success: boolean;
 *   result?: unknown;  // action-specific
 *   error?: string;
 * }
 *
 * Result types by action:
 * - screenshot: { base64: string, width: number, height: number }
 * - listTabs: Array<{ tabId, url, title, mounted }>
 * - getAccessibilityTree: string (YAML)
 * - evaluate: any (raw JS value)
 * - openTab: { success: boolean, message: string }
 * - focusTab: boolean
 */
function parseBrowserResult(
  input: Record<string, any>,
  result: unknown,
): ParsedToolResult {
  const parsed: ParsedToolResult = {
    type: 'browser',
  };

  // Determine the primary action from input
  if (Array.isArray(input.actions) && input.actions.length > 0) {
    parsed.browserAction = input.actions[0]?.action;
  }

  if (!result) return parsed;

  // Extract text from result - handles MCP ContentItem[], plain strings, etc.
  const resultText = extractResultText(result);
  if (!resultText) {
    // If extractResultText returns null but result exists, try as raw string
    if (typeof result === 'string') {
      parsed.content = result;
    }
    return parsed;
  }

  // BrowserExecTool UNWRAPS single-action results before returning:
  //   - screenshot: JSON.stringify({ base64, width, height })
  //   - listTabs:   JSON.stringify([ {tabId, url, title, mounted}, ... ])
  //   - evaluate:   the raw JS result as a string (e.g., "ok", "reloading")
  //   - focusTab:   "true" or "false"
  //   - openTab:    JSON.stringify({ success, message })
  //   - getAccessibilityTree: YAML string
  //   - no result:  "Action 'xxx' completed"
  // For multiple actions, it returns JSON.stringify(ActionResult[])

  // First, try to handle based on known action type + raw text
  if (parsed.browserAction) {
    const handled = parseUnwrappedBrowserAction(parsed, resultText);
    if (handled) return parsed;
  }

  // If we couldn't parse by action type, try to parse as JSON and detect structure
  let data: any;
  try {
    data = JSON.parse(resultText);
  } catch {
    // JSON parse failed — could be plain text or a truncated multi-action result
    // (ACP sidecar truncates large results with "... additional lines truncated ...")
    const trimmed = resultText.trimStart();
    if (trimmed.startsWith('[') && trimmed.includes('"action"') && trimmed.includes('"success"')) {
      // Truncated multi-action array — extract what we can with regex
      const extracted = extractFromTruncatedActions(parsed, resultText);
      if (extracted) return parsed;
    }

    // Plain text fallback
    if (parsed.browserAction === 'evaluate') {
      parsed.evaluateResult = resultText;
    } else if (parsed.browserAction === 'getAccessibilityTree') {
      parsed.accessibilityTree = resultText;
    } else {
      parsed.content = resultText;
    }
    return parsed;
  }

  // Detect unwrapped results by structure
  if (data && typeof data === 'object' && !Array.isArray(data) && (data.base64 || data.assetUrl)) {
    // Screenshot result: { base64, width, height } or { assetUrl, width, height }
    if (data.base64) {
      parsed.screenshotBase64 = data.base64;
    }
    if (data.assetUrl) {
      parsed.screenshotUrl = data.assetUrl;
    }
    parsed.screenshotWidth = data.width;
    parsed.screenshotHeight = data.height;
    parsed.browserAction = parsed.browserAction || 'screenshot';
    return parsed;
  }

  // Check if data is a wrapped ExecutionResult with results array (multi-action)
  if (Array.isArray(data)) {
    // Multi-action: ActionResult[] — each has { action, success, result?, error? }
    return parseMultiActionResults(parsed, data);
  }

  // Fallback: store as content
  parsed.content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return parsed;
}

/**
 * Try to parse an unwrapped single-action result based on the known action type.
 * Returns true if handled, false if not.
 */
function parseUnwrappedBrowserAction(parsed: ParsedToolResult, resultText: string): boolean {
  switch (parsed.browserAction) {
    case 'screenshot': {
      // JSON: { base64, width, height } or { assetUrl, width, height }
      try {
        const data = JSON.parse(resultText);
        if (data && (data.base64 || data.assetUrl)) {
          if (data.base64) parsed.screenshotBase64 = data.base64;
          if (data.assetUrl) parsed.screenshotUrl = data.assetUrl;
          parsed.screenshotWidth = data.width;
          parsed.screenshotHeight = data.height;
          return true;
        }
      } catch {
        // Not JSON — unexpected for screenshot
      }
      return false;
    }
    case 'listTabs': {
      // JSON array: [ { tabId, url, title, mounted }, ... ]
      try {
        const data = JSON.parse(resultText);
        if (Array.isArray(data) && data.length > 0 && data[0].tabId !== undefined) {
          parsed.browserTabs = data.map(
            (tab: { tabId?: string; url?: string; title?: string; mounted?: boolean }) => ({
              tabId: tab.tabId || '',
              url: tab.url || '',
              title: tab.title || '',
              mounted: tab.mounted ?? true,
            }),
          );
          return true;
        }
      } catch {
        // Not JSON
      }
      return false;
    }
    case 'evaluate': {
      // Check if this is actually a multi-action result (JSON array of ActionResults).
      // When multiple actions are sent, BrowserExecTool returns JSON.stringify(ActionResult[])
      // and the first action type is used as browserAction — so 'evaluate' might be the
      // first action in a multi-action batch.
      // ActionResult objects always have both "action" and "success" keys.
      const trimmed = resultText.trimStart();
      if (trimmed.startsWith('[') && trimmed.includes('"action"') && trimmed.includes('"success"')) {
        // Looks like a multi-action result array (valid or truncated) — don't handle here
        return false;
      }
      parsed.evaluateResult = resultText;
      return true;
    }
    case 'getAccessibilityTree': {
      // YAML string
      parsed.accessibilityTree = resultText;
      return true;
    }
    default:
      return false;
  }
}

/**
 * Parse multi-action results (array of ActionResult objects).
 */
function parseMultiActionResults(parsed: ParsedToolResult, actionResults: any[]): ParsedToolResult {
  for (const ar of actionResults) {
    if (!ar || typeof ar !== 'object') continue;

    if (ar.action === 'screenshot' && (ar.result?.base64 || ar.result?.assetUrl)) {
      if (ar.result.base64) parsed.screenshotBase64 = ar.result.base64;
      if (ar.result.assetUrl) parsed.screenshotUrl = ar.result.assetUrl;
      parsed.screenshotWidth = ar.result.width;
      parsed.screenshotHeight = ar.result.height;
    } else if (ar.action === 'listTabs' && Array.isArray(ar.result)) {
      parsed.browserTabs = ar.result.map(
        (tab: { tabId?: string; url?: string; title?: string; mounted?: boolean }) => ({
          tabId: tab.tabId || '',
          url: tab.url || '',
          title: tab.title || '',
          mounted: tab.mounted ?? true,
        }),
      );
    } else if (ar.action === 'getAccessibilityTree' && typeof ar.result === 'string') {
      parsed.accessibilityTree = ar.result;
    } else if (ar.action === 'evaluate' && ar.result !== undefined && ar.result !== null) {
      const evalText =
        typeof ar.result === 'string' ? ar.result : JSON.stringify(ar.result, null, 2);
      // Accumulate multiple evaluate results instead of overwriting
      parsed.evaluateResult =
        parsed.evaluateResult !== undefined ? parsed.evaluateResult + '\n' + evalText : evalText;
    } else if (ar.error) {
      parsed.error = ar.error;
    } else if (ar.result !== undefined && ar.result !== null && !parsed.content) {
      parsed.content =
        typeof ar.result === 'string' ? ar.result : JSON.stringify(ar.result, null, 2);
    }
  }

  return parsed;
}

/**
 * Extract structured data from a truncated multi-action result.
 * ACP sidecar truncates large results with "... additional lines truncated ...",
 * making JSON.parse fail. We use regex to extract what we can.
 * Returns true if at least one field was extracted.
 */
function extractFromTruncatedActions(parsed: ParsedToolResult, text: string): boolean {
  let foundSomething = false;

  // Extract evaluate results: "action": "evaluate" ... "result": "value"
  const evalPattern = /"action"\s*:\s*"evaluate"[\s\S]*?"result"\s*:\s*"([^"]*)"/g;
  const evaluateResults: string[] = [];
  let match;
  while ((match = evalPattern.exec(text)) !== null) {
    evaluateResults.push(match[1]);
  }
  if (evaluateResults.length > 0) {
    parsed.evaluateResult = evaluateResults.join('\n');
    foundSomething = true;
  }

  // Extract screenshot assetUrl
  const assetUrlMatch = text.match(/"assetUrl"\s*:\s*"([^"]+)"/);
  if (assetUrlMatch) {
    parsed.screenshotUrl = assetUrlMatch[1];
    foundSomething = true;
  }

  // Extract screenshot base64 (unlikely to survive truncation, but try)
  if (!parsed.screenshotUrl) {
    const base64Match = text.match(/"base64"\s*:\s*"([A-Za-z0-9+/=]{20,})"/);
    if (base64Match) {
      parsed.screenshotBase64 = base64Match[1];
      foundSomething = true;
    }
  }

  // Extract dimensions (useful even without the screenshot data)
  const widthMatch = text.match(/"width"\s*:\s*(\d+)/);
  const heightMatch = text.match(/"height"\s*:\s*(\d+)/);
  if (widthMatch) parsed.screenshotWidth = parseInt(widthMatch[1]);
  if (heightMatch) parsed.screenshotHeight = parseInt(heightMatch[1]);

  return foundSomething;
}

/**
 * Parse list-agents / list_agents result
 *
 * Format (text):
 *   "Agents in workspace:\n\n"
 *   "- AgentName (agent-uuid-here)\n"
 *   "  Status: responding\n"
 *   "- AnotherAgent (agent-uuid-here)\n"
 *   "  Status: idle\n"
 *
 * May also be JSON array of agent objects.
 */
function parseAgentListResult(
  _input: Record<string, unknown>,
  result: string | null | undefined,
): ParsedToolResult {
  const parsed: ParsedToolResult = {
    type: 'agent-list',
    agents: [],
  };

  if (!result) return parsed;

  // Try JSON first
  try {
    const data = JSON.parse(result);
    if (Array.isArray(data)) {
      parsed.agents = data
        .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
        .map((agent: { name?: string; id?: string; agentId?: string; status?: string }) => ({
          name: agent.name || 'Agent',
          agentId: agent.id || agent.agentId || '',
          status: agent.status,
        }));
      return parsed;
    }
  } catch {
    // Not JSON — parse text format
  }

  // Parse text format: "- Name (agent-id)\n  Status: status"
  const agentPattern = /[-•]\s*(.+?)\s*\(([^)]+)\)/g;
  let match;
  const agents: Array<{ name: string; agentId: string; status?: string }> = [];

  while ((match = agentPattern.exec(result)) !== null) {
    const name = match[1].trim();
    const agentId = match[2].trim();
    // Look for "Status: ..." on the next line after the match
    const afterMatch = result.slice(match.index + match[0].length);
    const statusMatch = afterMatch.match(/^\s*\n?\s*Status:\s*(.+?)(?:\n|$)/);
    agents.push({
      name,
      agentId,
      status: statusMatch ? statusMatch[1].trim() : undefined,
    });
  }

  parsed.agents = agents;

  // Store original content as fallback
  if (agents.length === 0) {
    parsed.content = result;
  }

  return parsed;
}

/**
 * Parse git tool results (git_status, git_stage, git_commit, agent_commit_changes, check_merge_conflicts)
 * Routes to terminal-type display with a synthesized command header.
 */
function parseGitResult(
  name: string,
  _input: Record<string, unknown>,
  result: string | null | undefined,
): ParsedToolResult {
  // Synthesize a display command from the tool name
  let command = 'git';
  if (name.includes('status')) command = 'git status';
  else if (name.includes('stage')) command = 'git stage';
  else if (name.includes('commit')) command = 'git commit';
  else if (name.includes('merge_conflict') || name.includes('merge-conflict')) command = 'git merge --check';

  return {
    type: 'terminal',
    command,
    content: result || undefined,
    // Detect failures via patterns that reliably indicate git errors, not arbitrary
    // substrings like "Error" which appear in normal diff/commit output.
    exitCode: result && /^(fatal|error):/mi.test(result) ? 1 : 0,
  };
}

/**
 * Parse agent creation / wake_or_create results → delegate-task display.
 * Extracts agentId and task name from the result text.
 *
 * Result format examples:
 *   "Created new agent "AgentName" for task "TaskTitle".\nAgent ID: agent-uuid\n..."
 *   "Woke existing agent "agent-uuid" for task "TaskTitle".\n..."
 *   "Agent created successfully.\n\nAgent ID: agent-uuid\nName: AgentName\n..."
 */
function parseAgentCreationResult(
  input: Record<string, unknown>,
  result: string | null | undefined,
): ParsedToolResult {
  const parsed: ParsedToolResult = {
    type: 'delegate-task',
  };

  if (!result) return parsed;

  // Extract agent ID from result
  const idMatch = result.match(/Agent ID:\s*(\S+)/i) || result.match(/agentId[":\s]*([a-f0-9-]+)/i);
  if (idMatch) {
    parsed.agentId = idMatch[1];
  }

  // Extract task name
  const taskMatch = result.match(/for task "([^"]+)"/i) || result.match(/task:\s*"?([^"\n]+)/i);
  if (taskMatch) {
    parsed.delegatedTaskName = taskMatch[1].trim();
  } else if (typeof input.name === 'string') {
    parsed.delegatedTaskName = input.name;
  } else if (typeof input.taskText === 'string') {
    parsed.delegatedTaskName = input.taskText.slice(0, 80);
  }

  // Extract task note ID
  const noteMatch = result.match(/taskNoteId[":\s]*([a-zA-Z0-9_-]+)/i);
  if (noteMatch) {
    parsed.taskNoteId = noteMatch[1];
  } else if (typeof input.taskNoteId === 'string') {
    parsed.taskNoteId = input.taskNoteId;
  }

  return parsed;
}

/**
 * Parse get_agent_status result → agent-list display with single agent.
 *
 * Result format:
 *   "Agent: AgentName\nID: agent-uuid\nStatus: responding\nMessages: 12\n..."
 */
function parseAgentStatusResult(
  input: Record<string, unknown>,
  result: string | null | undefined,
): ParsedToolResult {
  const parsed: ParsedToolResult = {
    type: 'agent-list',
    agents: [],
  };

  if (!result) return parsed;

  // Try to extract agent info from text format
  const nameMatch = result.match(/Agent:\s*(.+?)(?:\n|$)/);
  const idMatch = result.match(/ID:\s*(\S+)/);
  const statusMatch = result.match(/Status:\s*(\S+)/);

  if (nameMatch || idMatch) {
    parsed.agents = [{
      name: nameMatch ? nameMatch[1].trim() : 'Agent',
      agentId: idMatch ? idMatch[1].trim() : (typeof input.agentId === 'string' ? input.agentId : ''),
      status: statusMatch ? statusMatch[1].trim() : undefined,
    }];
  }

  // Store full content as fallback
  if (!parsed.agents?.length) {
    parsed.content = result;
  }

  return parsed;
}
