/**
 * MCP Client for Frontend
 *
 * Provides frontend API for MCP operations
 */

import { invoke } from '$lib/electron-bridge';

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required: string[];
  };
}

export interface MCPToolResult {
  content: Array<{
    type: string;
    text?: string;
    data?: string;
    mimeType?: string;
    uri?: string;
  }>;
  isError?: boolean;
}

/**
 * Create MCP server for a workspace
 */
export async function createMCPServer(
  workspaceId: string,
  workspacePath: string,
): Promise<{ tools: MCPTool[] }> {
  const result = (await invoke('mcp:create-server', {
    workspaceId,
    workspacePath,
  })) as { success?: boolean; error?: string; data?: { tools: MCPTool[] } };

  if (!result.success) {
    throw new Error(result.error || 'Failed to create MCP server');
  }

  return result.data || { tools: [] };
}

/**
 * Transition MCP workspace servers from an optimistic workspace ID to the real ID.
 */
export async function transitionMCPWorkspace(optimisticId: string, realId: string): Promise<void> {
  const result = (await invoke('mcp:transition-workspace', {
    optimisticId,
    realId,
  })) as { success?: boolean; error?: string };

  if (!result.success) {
    throw new Error(result.error || 'Failed to transition MCP workspace');
  }
}

/**
 * List available tools for a workspace
 */
export async function listMCPTools(workspaceId: string): Promise<MCPTool[]> {
  const result = (await invoke('mcp:list-tools', {
    workspaceId,
  })) as { success?: boolean; error?: string; data?: { tools: MCPTool[] } };

  if (!result.success) {
    throw new Error(result.error || 'Failed to list MCP tools');
  }

  return result.data?.tools || [];
}

/**
 * Call a tool through MCP
 */
export async function callMCPTool(
  workspaceId: string,
  toolName: string,
  toolArguments: Record<string, any>,
): Promise<MCPToolResult> {
  const result = (await invoke('mcp:call-tool', {
    workspaceId,
    toolName,
    arguments: toolArguments,
  })) as { success?: boolean; error?: string; data?: { result: MCPToolResult } };

  if (!result.success) {
    throw new Error(result.error || 'Failed to call MCP tool');
  }

  return result.data?.result || { content: [] };
}

/**
 * Remove MCP server for a workspace
 */
export async function removeMCPServer(workspaceId: string): Promise<void> {
  const result = (await invoke('mcp:remove-server', {
    workspaceId,
  })) as { success?: boolean; error?: string };

  if (!result.success) {
    throw new Error(result.error || 'Failed to remove MCP server');
  }
}

/**
 * Extract text content from tool result
 */
export function extractTextFromResult(result: MCPToolResult): string {
  const textContent = result.content.find((item) => item.type === 'text');
  return textContent?.text || '';
}

/**
 * Check if tool result is an error
 */
export function isToolError(result: MCPToolResult): boolean {
  return result.isError === true;
}

/**
 * Format tool result for display
 */
export function formatToolResult(result: MCPToolResult): string {
  if (isToolError(result)) {
    return `Error: ${extractTextFromResult(result)}`;
  }

  const parts: string[] = [];

  for (const item of result.content) {
    if (item.type === 'text' && item.text) {
      parts.push(item.text);
    } else if (item.type === 'image' && item.data) {
      parts.push(`[Image: ${item.mimeType || 'image'}]`);
    } else if (item.type === 'resource' && item.uri) {
      parts.push(`[Resource: ${item.uri}]`);
    }
  }

  return parts.join('\n');
}
