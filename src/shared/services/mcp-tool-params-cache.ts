/**
 * MCP Tool Params Cache
 *
 * A shared cache that bridges MCP tool call parameters from the HTTP MCP bridge
 * to the ACP streaming handler. When OpenCode (or similar providers) send tool_call events
 * without rawInput, the actual parameters arrive separately via the MCP HTTP bridge.
 * This cache stores those parameters so the streaming handler can enrich skeleton tool_use
 * blocks with real parameter data (note IDs, file paths, commands, etc.).
 *
 * Flow:
 * 1. http-mcp-bridge.ts stores params when a tools/call request arrives
 * 2. acp-provider-streaming.ts consumes params in emitDeferredSkeleton()
 * 3. Entries auto-expire after 5 seconds to prevent memory leaks
 *
 * Design: Stores a FIFO queue per agentId (not a single entry) because agents can
 * issue multiple MCP tool calls concurrently or in quick succession (e.g., child agents
 * calling read_note + set_agent_name simultaneously on startup).
 */

interface CachedToolParams {
  toolName: string;
  arguments: Record<string, any>;
  timestamp: number;
}

// Keyed by agentId → FIFO queue of tool call params.
const cache = new Map<string, CachedToolParams[]>();

const EXPIRY_MS = 5000;

/**
 * Strip workspace-mcp prefixes AND suffixes from a tool name for comparison.
 * Handles: workspace-mcp_read_note, read_note_workspace-mcp, workspace_mcp_read_note
 */
function cleanToolNameForMatch(name: string): string {
  return name
    .replace(/^workspace-mcp_/, '')
    .replace(/^workspace_mcp_/, '')
    .replace(/_workspace-mcp$/, '')
    .replace(/_workspace_mcp$/, '');
}

/**
 * Store MCP tool parameters for a given agent.
 * Called by http-mcp-bridge.ts when a tools/call request arrives.
 */
export function storeMcpToolParams(
  agentId: string,
  toolName: string,
  args: Record<string, any>,
): void {
  if (!cache.has(agentId)) cache.set(agentId, []);
  const queue = cache.get(agentId)!;
  queue.push({
    toolName,
    arguments: args,
    timestamp: Date.now(),
  });

  // Prune expired entries from the front of the queue
  const now = Date.now();
  while (queue.length > 0 && now - queue[0].timestamp > EXPIRY_MS) {
    queue.shift();
  }
}

/**
 * Consume (retrieve and remove) cached MCP tool parameters for a given agent.
 * Called by acp-provider-streaming.ts in emitDeferredSkeleton().
 * Returns the arguments if found and not expired, otherwise undefined.
 * Uses FIFO order when multiple entries match the same tool name.
 *
 * @param agentId The agent ID to look up
 * @param skeletonToolName The tool name from the skeleton (may have workspace-mcp_ prefix/suffix)
 */
export function consumeMcpToolParams(
  agentId: string,
  skeletonToolName: string,
): Record<string, any> | undefined {
  const queue = cache.get(agentId);
  if (!queue || queue.length === 0) return undefined;

  const cleanSkeleton = cleanToolNameForMatch(skeletonToolName);
  const now = Date.now();

  // Find first matching entry (FIFO)
  const idx = queue.findIndex((entry) => {
    // Skip expired entries
    if (now - entry.timestamp > EXPIRY_MS) return false;
    // Match by cleaned tool name
    const cleanEntry = cleanToolNameForMatch(entry.toolName);
    return cleanSkeleton === cleanEntry || skeletonToolName === entry.toolName;
  });

  if (idx === -1) {
    // Prune expired entries while we're here
    while (queue.length > 0 && now - queue[0].timestamp > EXPIRY_MS) {
      queue.shift();
    }
    if (queue.length === 0) cache.delete(agentId);
    return undefined;
  }

  // Remove and return the matched entry
  const [entry] = queue.splice(idx, 1);
  if (queue.length === 0) cache.delete(agentId);

  return entry.arguments;
}
