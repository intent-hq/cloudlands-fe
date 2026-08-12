/**
 * Task Block Parser
 *
 * Parses @@@task blocks that contain a single proposed task.
 * Each block has one task: the first # heading is the title, everything below is the body.
 *
 * Example input (multiple tasks = multiple blocks):
 *
 * @@@task
 * # Authentication System
 * Build JWT-based auth for the API layer.
 *
 * ## Requirements
 * - Login/logout endpoints
 * - Session management
 * @@@
 *
 * @@@tasks
 * # Database Layer
 * Set up PostgreSQL with Drizzle ORM.
 * @@@
 *
 * Output: Array of { title: string, content: string } objects
 */

/**
 * A proposed task parsed from a task block
 */
export interface ParsedTask {
  /** The task title (from the first # heading) */
  title: string;
  /** The body content (everything after the title) */
  content: string;
}

/**
 * A raw @@@task block located in content by scanTaskBlocks
 */
export interface ScannedTaskBlock {
  /** Index of the first '@' of the opening fence */
  start: number;
  /** Index just past the closing '@@@' */
  end: number;
  /** Content between the fence line and the closing '@@@' */
  body: string;
}

/**
 * Result of parsing task blocks from markdown content
 */
export interface TasksBlockParseResult {
  /** The tasks found in all @@@task blocks */
  tasks: ParsedTask[];
  /** The content with @@@task blocks replaced with linked task placeholders */
  contentWithoutBlocks: string;
  /** Number of @@@task blocks found */
  blockCount: number;
  /** Number of valid tasks extracted (may be less than blockCount if some blocks are invalid) */
  validTaskCount: number;
  /** Number of invalid blocks (missing title, empty, etc.) */
  invalidBlockCount: number;
}

const FENCE_KEYWORD = '@@@task';

/**
 * Validate the raw text after the fence keyword on a @@@task / @@@tasks line.
 *
 * Mirrors the daemon parser (intentd note_ops.rs `parse_fence_header`):
 * - An empty/whitespace-only header is valid (the bare fence, unchanged behavior)
 * - Otherwise every whitespace-separated token (after re-joining list items
 *   split around commas, e.g. `a, b` / `a ,b` / `a , b`) must be
 *   attribute-shaped: `name=value` with a non-empty ASCII-alphanumeric name
 * - Any non-attribute-shaped token makes the line NOT a fence (prose that
 *   merely mentions @@@task keeps rendering as plain text)
 * - Semantic problems on attribute-shaped tokens (unknown name, duplicate,
 *   empty value) keep the fence valid — the daemon converts with warnings,
 *   so the FE must still treat the block as a task block
 * - At most one trailing \r (CRLF) is tolerated; any other \r invalidates
 *
 * The FE does not resolve or display the attribute values; it only needs to
 * agree with the daemon on what counts as a task block opener.
 */
export function isValidTaskFenceHeader(rawHeader: string): boolean {
  const header = rawHeader.endsWith('\r') ? rawHeader.slice(0, -1) : rawHeader;
  if (header.includes('\r')) {
    return false;
  }
  const trimmed = header.trim();
  if (trimmed.length === 0) {
    return true;
  }
  const tokens = trimmed.split(/\s+/);
  const attrs: string[] = [];
  let idx = 0;
  while (idx < tokens.length) {
    let acc = tokens[idx];
    // Re-join list items split around commas: `a, b` / `a ,b` / `a , b`
    while (idx + 1 < tokens.length && (acc.endsWith(',') || tokens[idx + 1].startsWith(','))) {
      idx++;
      acc += tokens[idx];
    }
    attrs.push(acc);
    idx++;
  }
  return attrs.every((attr) => {
    const eq = attr.indexOf('=');
    if (eq === -1) {
      return false;
    }
    return /^[A-Za-z0-9]+$/.test(attr.slice(0, eq));
  });
}

/**
 * Scan content for @@@task / @@@tasks blocks.
 *
 * Mirrors the daemon scanner (intentd note_ops.rs `scan_blocks`): the fence
 * keyword must be followed by whitespace or end-of-line, the rest of the
 * fence line must be a valid header (see isValidTaskFenceHeader), and the
 * block runs to the next '@@@'. A bare fence behaves exactly as before.
 */
export function scanTaskBlocks(content: string): ScannedTaskBlock[] {
  const out: ScannedTaskBlock[] = [];
  let i = 0;
  for (;;) {
    const pos = content.indexOf(FENCE_KEYWORD, i);
    if (pos === -1) {
      break;
    }
    let j = pos + FENCE_KEYWORD.length;
    if (content[j] === 's') {
      j++;
    }
    // The keyword must be followed by whitespace or end-of-line
    const next = content[j];
    if (next !== undefined && next !== ' ' && next !== '\t' && next !== '\r' && next !== '\n') {
      i = pos + FENCE_KEYWORD.length;
      continue;
    }
    const lineEnd = content.indexOf('\n', j);
    if (lineEnd === -1) {
      // No newline after the fence keyword — not a block
      i = pos + FENCE_KEYWORD.length;
      continue;
    }
    if (!isValidTaskFenceHeader(content.slice(j, lineEnd))) {
      i = pos + FENCE_KEYWORD.length;
      continue;
    }
    const bodyStart = lineEnd + 1;
    const closeIdx = content.indexOf('@@@', bodyStart);
    if (closeIdx === -1) {
      break;
    }
    out.push({
      start: pos,
      end: closeIdx + 3,
      body: content.slice(bodyStart, closeIdx),
    });
    i = closeIdx + 3;
  }
  return out;
}

/**
 * Normalize line endings to \n
 */
function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Parse a single task block content into a task
 * The first # heading is the title, everything after is the body
 *
 * @param blockContent - The content inside the @@@task block (without the delimiters)
 * @returns ParsedTask if valid, null if no valid title found
 */
export function parseTaskBlockContent(blockContent: string): ParsedTask | null {
  // Normalize line endings for consistent parsing
  const normalized = normalizeLineEndings(blockContent);
  const lines = normalized.split('\n');

  let title: string | null = null;
  let contentStartIndex = 0;

  // Find the first # heading - that's the title
  // Must be exactly one # followed by space and text (not ## or ###)
  for (let i = 0; i < lines.length; i++) {
    const h1Match = lines[i].match(/^#\s+(.+)$/);
    if (h1Match) {
      const extractedTitle = h1Match[1].trim();
      // Ensure title is not empty after trimming
      if (extractedTitle.length > 0) {
        title = extractedTitle;
        contentStartIndex = i + 1;
        break;
      }
    }
  }

  // If no valid title found, this block is invalid
  if (!title) {
    return null;
  }

  // Everything after the title is the body content
  const content = lines.slice(contentStartIndex).join('\n').trim();

  return { title, content };
}

/**
 * Extract all @@@task blocks from markdown content
 * Each block is replaced with a unique placeholder that includes the task index
 *
 * @param content - The markdown content to parse
 * @returns ParseResult with tasks, cleaned content, and counts
 */
export function extractTasksBlocks(content: string): TasksBlockParseResult {
  const blocks = scanTaskBlocks(content);
  const allTasks: ParsedTask[] = [];
  let contentWithoutBlocks = '';
  let cursor = 0;
  let taskIndex = 0;
  let invalidBlockCount = 0;

  for (const block of blocks) {
    contentWithoutBlocks += content.slice(cursor, block.start);
    const task = parseTaskBlockContent(block.body);
    if (task) {
      // Valid task - use indexed placeholder
      contentWithoutBlocks += `<!-- task-block-placeholder-${taskIndex} -->`;
      allTasks.push(task);
      taskIndex++;
    } else {
      // Invalid block - remove entirely with a warning comment
      contentWithoutBlocks += '<!-- invalid-task-block-removed -->';
      invalidBlockCount++;
    }
    cursor = block.end;
  }
  contentWithoutBlocks += content.slice(cursor);

  return {
    tasks: allTasks,
    contentWithoutBlocks,
    blockCount: blocks.length,
    validTaskCount: allTasks.length,
    invalidBlockCount,
  };
}

/**
 * Check if content contains any @@@task blocks
 */
export function hasTaskBlocks(content: string): boolean {
  return scanTaskBlocks(content).length > 0;
}

/**
 * @deprecated Use hasTaskBlocks instead (renamed for consistency)
 */
export function hasTasksBlocks(content: string): boolean {
  return hasTaskBlocks(content);
}
