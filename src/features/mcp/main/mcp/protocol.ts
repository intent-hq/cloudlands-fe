/**
 * MCP (Model Context Protocol) Protocol Types
 *
 * Defines the core types and interfaces for MCP communication
 * between agents and workspace tools.
 */

export type RequestId = string | number;

/**
 * Core MCP message types
 */
interface MCPMessage {
  jsonrpc: '2.0';
  id?: RequestId;
  method?: string;
  params?: Record<string, any>;
  result?: any;
  error?: MCPError;
}

export interface MCPRequest extends MCPMessage {
  id: RequestId;
  method: string;
  params?: Record<string, any>;
}

export interface MCPResponse extends MCPMessage {
  id: RequestId;
  result?: any;
  error?: MCPError;
}

export interface MCPNotification extends MCPMessage {
  method: string;
  params?: Record<string, any>;
}

interface MCPError {
  code: number;
  message: string;
  data?: any;
}

/**
 * Tool definition for MCP
 */
export interface Tool {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  outputSchema?: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, PropertySchema>;
  required: string[];
  additionalProperties?: boolean;
}

interface PropertySchema {
  type: string;
  description?: string;
  default?: any;
  enum?: any[];
  minimum?: number;
  maximum?: number;
  pattern?: string;
  items?: { type: string };
}

/**
 * Tool call request and result
 */
export interface ToolCall {
  name: string;
  arguments: Record<string, any>;
  context?: ToolCallContext;
}

export interface ToolCallContext {
  workspaceId: string;
  agentId?: string;
  agentName?: string;
  userId?: string;
  sessionId?: string;
  metadata?: Record<string, any>;
}

export interface ToolResult {
  content: ContentItem[];
  metadata?: Record<string, any>;
  isError?: boolean;
}

export type ContentItem =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'audio'; data: string; mimeType: string; transcript?: string | null }
  | { type: 'resource_link'; uri: string; name?: string; mimeType?: string }
  | {
      type: 'resource';
      resource: {
        uri: string;
        name?: string;
        mimeType?: string | null;
        text?: string;
        blob?: string;
        _meta?: Record<string, any>;
      };
    };

export function createResponse(id: RequestId, result: any): MCPResponse {
  return {
    jsonrpc: '2.0',
    id,
    result,
  };
}

export function createError(id: RequestId, code: number, message: string, data?: any): MCPResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
      data,
    },
  };
}

export function createNotification(method: string, params?: Record<string, any>): MCPNotification {
  return {
    jsonrpc: '2.0',
    method,
    params,
  };
}
