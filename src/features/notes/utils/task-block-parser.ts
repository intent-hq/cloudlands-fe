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
 * Result of extracting a single task block
 */
export interface TaskBlockExtractResult {
  /** The parsed task, or null if invalid */
  task: ParsedTask | null;
  /** The original full match (for replacement) */
  fullMatch: string;
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

/**
 * Regex to match @@@task / @@@tasks blocks (one task per block)
 * - Allows optional trailing whitespace after the fence name
 * - Handles both \n and \r\n line endings
 * - Captures the content inside the block
 *
 * Pattern: @@@tasks?[ \t]*\r?\n([\s\S]*?)@@@
 *
 * Note: Use AT_TASK_BLOCK_REGEX_GLOBAL for matchAll/replace operations
 * and AT_TASK_BLOCK_REGEX for .test() to avoid global regex state issues
 */
const AT_TASK_BLOCK_REGEX = /@@@tasks?[ \t]*\r?\n([\s\S]*?)@@@/;
const AT_TASK_BLOCK_REGEX_GLOBAL = /@@@tasks?[ \t]*\r?\n([\s\S]*?)@@@/g;

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
  const allTasks: ParsedTask[] = [];
  const blockResults: TaskBlockExtractResult[] = [];
  let blockCount = 0;
  let invalidBlockCount = 0;

  // Extract @@@task blocks using regex
  const atMatches = content.matchAll(AT_TASK_BLOCK_REGEX_GLOBAL);
  for (const match of atMatches) {
    blockCount++;
    const blockContent = match[1];
    const task = parseTaskBlockContent(blockContent);

    blockResults.push({
      task,
      fullMatch: match[0],
    });

    if (task) {
      allTasks.push(task);
    } else {
      invalidBlockCount++;
    }
  }

  // Replace each task block with an indexed placeholder
  // This allows proper 1:1 replacement later
  let contentWithoutBlocks = content;
  let taskIndex = 0;

  for (const result of blockResults) {
    if (result.task) {
      // Valid task - use indexed placeholder
      contentWithoutBlocks = contentWithoutBlocks.replace(
        result.fullMatch,
        `<!-- task-block-placeholder-${taskIndex} -->`,
      );
      taskIndex++;
    } else {
      // Invalid block - remove entirely with a warning comment
      contentWithoutBlocks = contentWithoutBlocks.replace(
        result.fullMatch,
        '<!-- invalid-task-block-removed -->',
      );
    }
  }

  return {
    tasks: allTasks,
    contentWithoutBlocks,
    blockCount,
    validTaskCount: allTasks.length,
    invalidBlockCount,
  };
}

/**
 * Check if content contains any @@@task blocks
 */
export function hasTaskBlocks(content: string): boolean {
  return AT_TASK_BLOCK_REGEX.test(content);
}

/**
 * @deprecated Use hasTaskBlocks instead (renamed for consistency)
 */
export function hasTasksBlocks(content: string): boolean {
  return hasTaskBlocks(content);
}
