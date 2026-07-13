/**
 * Permission Parser
 *
 * Converts raw permission request titles and descriptions into
 * human-friendly display text. Similar to tool-classifier.ts but
 * specifically for permission requests.
 */

export interface PermissionDisplay {
  /** Friendly question format, e.g., "Set agent name to 'Context Explorer'?" */
  question: string;
  /** Short action description, e.g., "Rename agent" */
  action: string;
  /** Key details extracted from the input */
  details: string | null;
  /** Category for styling */
  category: 'read' | 'write' | 'delete' | 'execute' | 'other';
}

/**
 * Clean up MCP tool names by removing prefixes and suffixes
 */
function cleanToolName(name: string): string {
  // Handle MCP URL formats
  const mcpMatch = name.match(/(?:\/\/local\/mcp\/|workspaces\.augmentcode\.com\/mcp\/)(.+)$/);
  if (mcpMatch) name = mcpMatch[1];

  // Strip common prefixes/suffixes
  return name
    .replace(/^mcp__/, '')
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
 * Convert snake_case or kebab-case to readable text
 */
function toReadable(str: string): string {
  return str
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase();
}

/**
 * Try to parse JSON description safely
 */
function parseDescription(description: string | null | undefined): Record<string, any> | null {
  if (!description) return null;
  try {
    return JSON.parse(description);
  } catch {
    return null;
  }
}

/**
 * Extract the most relevant value from parsed input for display
 */
function extractKeyValue(input: Record<string, any>): string | null {
  const priorityKeys = ['name', 'title', 'path', 'command', 'query', 'text', 'content', 'url'];
  for (const key of priorityKeys) {
    if (input[key] && typeof input[key] === 'string') {
      const value = input[key];
      return value.length > 50 ? value.substring(0, 47) + '...' : value;
    }
  }
  return null;
}

/**
 * Determine the category based on the tool name
 */
function categorize(name: string): PermissionDisplay['category'] {
  const lowerName = name.toLowerCase();
  if (/delete|remove|destroy/.test(lowerName)) return 'delete';
  if (/write|edit|save|create|set|update|add|modify|replace/.test(lowerName)) return 'write';
  if (/read|view|list|get|search|query/.test(lowerName)) return 'read';
  if (/run|execute|launch|process|terminal|bash|shell/.test(lowerName)) return 'execute';
  return 'other';
}

/**
 * Parse a permission request into friendly display format
 */
export function parsePermissionRequest(
  title: string,
  description?: string | null,
): PermissionDisplay {
  const cleanName = cleanToolName(title);
  const readableName = toReadable(cleanName);
  const parsedInput = parseDescription(description);
  const keyValue = parsedInput ? extractKeyValue(parsedInput) : null;
  const category = categorize(cleanName);

  // Build a friendly question
  let question = readableName.charAt(0).toUpperCase() + readableName.slice(1) + '?';
  let action = readableName.charAt(0).toUpperCase() + readableName.slice(1);
  let details: string | null = null;

  // Special cases for common patterns
  const lowerCleanName = cleanName.toLowerCase();

  if (lowerCleanName.includes('set_agent_name') || lowerCleanName.includes('set-agent-name')) {
    const name = parsedInput?.name || keyValue;
    question = name ? `Rename agent to "${name}"?` : 'Rename agent?';
    action = 'Rename agent';
    details = null; // Already shown in question
  } else if (lowerCleanName.includes('str_replace') || lowerCleanName.includes('str-replace')) {
    const path = parsedInput?.path;
    question = path ? `Edit ${path.split('/').pop()}?` : 'Edit file?';
    action = 'Edit file';
    details = path;
  } else if (lowerCleanName.includes('save_file') || lowerCleanName.includes('save-file')) {
    const path = parsedInput?.path;
    question = path ? `Save ${path.split('/').pop()}?` : 'Save file?';
    action = 'Save file';
    details = path;
  } else if (
    lowerCleanName.includes('launch_process') ||
    lowerCleanName.includes('launch-process')
  ) {
    const cmd = parsedInput?.command;
    question = 'Run command?';
    action = 'Run command';
    details = cmd ? (cmd.length > 80 ? cmd.substring(0, 77) + '...' : cmd) : null;
  } else if (lowerCleanName.includes('delete') || lowerCleanName.includes('remove')) {
    const path = parsedInput?.path || parsedInput?.file_paths?.[0];
    question = path ? `Delete ${path.split('/').pop()}?` : 'Delete?';
    action = 'Delete';
    details = path;
  } else if (lowerCleanName.includes('view') || lowerCleanName.includes('read')) {
    const path = parsedInput?.path;
    question = path ? `Read ${path.split('/').pop()}?` : 'Read file?';
    action = 'Read file';
    details = path;
  } else if (lowerCleanName.includes('create_note') || lowerCleanName.includes('create-note')) {
    const title = parsedInput?.title;
    question = title ? `Create note "${title}"?` : 'Create note?';
    action = 'Create note';
    details = null;
  } else if (lowerCleanName.includes('note')) {
    const title = parsedInput?.title;
    question = title ? `${action} "${title}"?` : `${action}?`;
    details = null;
  } else if (lowerCleanName.includes('browser') || lowerCleanName.includes('navigate')) {
    const url = parsedInput?.url;
    question = url ? `Navigate to page?` : 'Browser action?';
    action = 'Browser';
    details = url;
  } else if (lowerCleanName.includes('github') || lowerCleanName.includes('api')) {
    const path = parsedInput?.path;
    question = 'Make API request?';
    action = 'API request';
    details = path || parsedInput?.url;
  } else if (keyValue) {
    // Generic case with a key value
    details = keyValue;
  }

  return { question, action, details, category };
}
