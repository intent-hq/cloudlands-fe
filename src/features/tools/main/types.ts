/**
 * Tool Service Types
 */

export interface Tool {
  id: string;
  name: string;
  description: string;
  category: ToolCategory;
  enabled: boolean;
  config?: ToolConfig;
}

export enum ToolCategory {
  FILE = 'file',
  GIT = 'git',
  TERMINAL = 'terminal',
  BROWSER = 'browser',
  API = 'api',
  CUSTOM = 'custom',
  NOTE = 'note',
  WORKSPACE = 'workspace',
}

export interface ToolConfig {
  [key: string]: any;
}

export interface ToolExecution {
  toolId: string;
  input: any;
  output?: any;
  error?: string;
  startTime: Date;
  endTime?: Date;
  status: ToolExecutionStatus;
}

export enum ToolExecutionStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  SUCCESS = 'success',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
  metadata?: {
    duration?: number;
    [key: string]: any;
  };
}

export interface IToolService {
  executeTool(name: string, args: any, context: ToolContext): Promise<ToolResult>;
  getAvailableTools(): Tool[];
  registerTool(tool: ToolDefinition): void;
}

export interface ToolContext {
  workspaceId: string;
  agentId?: string;
  input: any;
  metadata?: Record<string, any>;
  executor?: {
    readFile: (path: string) => Promise<string>;
    writeFile: (path: string, content: string) => Promise<void>;
    deleteFile: (path: string) => Promise<void>;
    listFiles: (directory: string) => Promise<string[]>;
    execute: (command: string, options?: any) => Promise<any>;
  };
  permissions?: {
    readOnly?: boolean;
    maxFileSize?: number;
    deniedTools?: string[];
    allowedTools?: string[];
    deniedPaths?: string[];
    allowedPaths?: string[];
  };
}

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  category: ToolCategory;
  handler: (context: ToolContext) => Promise<ToolResult>;
  config?: ToolConfig;
  inputSchema?: any;
  permissions?: {
    requiresWrite?: boolean;
  };
}

export interface ToolAction {
  type: 'read' | 'write' | 'execute' | 'query';
  target: string;
  data?: any;
  context?: ToolContext;
}

export interface FileInfo {
  name?: string;
  path: string;
  type?: 'file' | 'directory' | 'symlink';
  content?: string;
  size?: number;
  modified?: Date;
}

export class ToolError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = 'ToolError';
  }
}

// Additional type exports for tool service
// Import Note type from shared types to avoid duplication
import type { Note } from '../../../shared/types';
export type { Note };

export interface NoteData {
  id?: string;
  title?: string;
  content: string;
  metadata?: Record<string, any>;
}

export interface WorkspaceInfo {
  id: string;
  name: string;
  path: string;
  repositoryPath?: string;
  branch?: string;
  isRemote?: boolean;
  status?: string;
  fileCount?: number;
  totalSize?: number;
  noteCount?: number;
}

// CommandResult is defined in features/tools/types.ts - import from there if needed

export interface ExecuteOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
}

export interface ToolOperation {
  id: string;
  toolId: string;
  tool: string;
  args: any;
  context: ToolContext;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startTime: Date;
  endTime?: Date;
  result?: ToolResult;
}
