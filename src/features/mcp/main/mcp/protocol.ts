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
export interface MCPMessage {
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

export interface MCPError {
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

export interface PropertySchema {
  type: string;
  description?: string;
  default?: any;
  enum?: any[];
  minimum?: number;
  maximum?: number;
  pattern?: string;
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
  | { type: 'resource'; uri: string; mimeType?: string };

/**
 * Server capabilities
 */
export interface ServerCapabilities {
  tools?: ToolsCapability;
  resources?: ResourcesCapability;
  prompts?: PromptsCapability;
  logging?: LoggingCapability;
}

export interface ToolsCapability {
  listChanged?: boolean;
}

export interface ResourcesCapability {
  listChanged?: boolean;
}

export interface PromptsCapability {
  listChanged?: boolean;
}

export interface LoggingCapability {
  level?: 'debug' | 'info' | 'warning' | 'error';
}

/**
 * Initialize request/response
 */
export interface InitializeRequest extends MCPRequest {
  method: 'initialize';
  params: {
    protocolVersion: string;
    capabilities: Record<string, any>;
    clientInfo: {
      name: string;
      version: string;
    };
  };
}

export interface InitializeResponse extends MCPResponse {
  result: {
    protocolVersion: string;
    capabilities: ServerCapabilities;
    serverInfo: {
      name: string;
      version: string;
    };
  };
}

/**
 * List tools request/response
 */
export interface ListToolsRequest extends MCPRequest {
  method: 'tools/list';
  params?: {
    cursor?: string;
  };
}

export interface ListToolsResponse extends MCPResponse {
  result: {
    tools: Tool[];
    nextCursor?: string;
  };
}

/**
 * Call tool request/response
 */
export interface CallToolRequest extends MCPRequest {
  method: 'tools/call';
  params: {
    name: string;
    arguments: Record<string, any>;
  };
}

export interface CallToolResponse extends MCPResponse {
  result: {
    content: ContentItem[];
    isError?: boolean;
  };
}

/**
 * Helper functions
 */
export function createRequest(
  id: RequestId,
  method: string,
  params?: Record<string, any>,
): MCPRequest {
  return {
    jsonrpc: '2.0',
    id,
    method,
    params,
  };
}

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
