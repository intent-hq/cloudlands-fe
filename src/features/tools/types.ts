/**
 * Tool Service Types
 *
 * Core type definitions for the tool service layer.
 * These types are protocol-agnostic and represent pure business logic.
 */

import type { Workspace } from '../../shared/types';

// ============================================================================
// Core Types
// ============================================================================

/**
 * Execution context for tools
 */
export interface ToolContext {
  workspaceId: string;
  workspace: Workspace;
  executor: IExecutor;
  user: UserContext;
  permissions: ToolPermissions;
  sessionId?: string;
  agentId?: string;
  input?: any; // Added to match main process ToolContext
  metadata?: Record<string, any>;
}

/**
 * User context for permission checking
 */
export interface UserContext {
  id: string;
  email?: string;
  name?: string;
  tier?: 'free' | 'pro' | 'enterprise';
}

/**
 * Tool permissions configuration
 */
export interface ToolPermissions {
  allowedTools: string[];
  deniedTools: string[];
  requireConfirmation: string[];
  maxFileSize: number;
  allowedPaths: string[];
  deniedPaths: string[];
  readOnly: boolean;
}

/**
 * Executor interface for local/remote operations
 */
export interface IExecutor {
  type: 'local' | 'remote';
  config?: RemoteExecutorConfig;

  // File operations
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  deleteFile(path: string): Promise<void>;
  listFiles(directory: string): Promise<FileInfo[]>;
  fileExists(path: string): Promise<boolean>;
  getFileStats(path: string): Promise<FileStats>;

  // Command execution
  execute(command: string, options?: ExecuteOptions): Promise<CommandResult>;

  // Directory operations
  createDirectory(path: string): Promise<void>;
  deleteDirectory(path: string): Promise<void>;

  // Cleanup
  dispose(): Promise<void>;
}

/**
 * Remote executor configuration
 */
export interface RemoteExecutorConfig {
  host: string;
  port: number;
  username: string;
  privateKey?: string;
  password?: string;
  workspacePath: string;
  transport?: 'ssh' | 'websocket';
  wsUrl?: string;
}

/**
 * File information
 */
export interface FileInfo {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'symlink';
  size: number;
  modified: Date;
  permissions?: string;
}

/**
 * File statistics
 */
export interface FileStats {
  size: number;
  created: Date;
  modified: Date;
  accessed: Date;
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
  permissions: string;
}

/**
 * Command execution options
 */
export interface ExecuteOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
  maxBuffer?: number;
  shell?: string;
}

/**
 * Command execution result
 */
export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  signal?: string;
  timedOut?: boolean;
}

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * Tool definition for registration
 */
export interface ToolDefinition {
  name: string;
  description: string;
  category: ToolCategory;
  inputSchema?: any; // JSON Schema
  outputSchema?: any; // JSON Schema
  permissions?: ToolPermissionRequirements;
  examples?: ToolExample[];
}

/**
 * Tool categories
 */
export type ToolCategory = 'file' | 'note' | 'workspace' | 'git' | 'terminal' | 'search' | 'ai';

/**
 * Permission requirements for a tool
 */
export interface ToolPermissionRequirements {
  requiresWrite?: boolean;
  requiresExecute?: boolean;
  requiresNetwork?: boolean;
  maxFileSize?: number;
  allowedPaths?: string[];
}

/**
 * Tool usage example
 */
export interface ToolExample {
  description: string;
  input: any;
  output: any;
}

// ============================================================================
// Tool Operations
// ============================================================================

/**
 * Tool operation for batch execution
 */
export interface ToolOperation {
  id: string;
  tool: string;
  args: any;
  context?: Partial<ToolContext>;
}

/**
 * Tool execution result
 */
export interface ToolResult<T = any> {
  success: boolean;
  data?: T;
  error?: ToolError;
  metadata?: ToolResultMetadata;
}

/**
 * Tool error information
 */
export interface ToolError {
  code: string;
  message: string;
  details?: any;
  stack?: string;
}

/**
 * Tool result metadata
 */
export interface ToolResultMetadata {
  executionTime: number;
  bytesRead?: number;
  bytesWritten?: number;
  filesAffected?: string[];
}

// ============================================================================
// Note Types
// ============================================================================

// Import Note type from shared types to avoid duplication
import type { Note } from '../../shared/types';
export type { Note };

/**
 * Note data for creation/update
 */
export interface NoteData {
  title: string;
  content: string;
  tags?: string[];
  metadata?: Record<string, any>;
}

// ============================================================================
// Workspace Types
// ============================================================================

/**
 * Workspace information
 */
export interface WorkspaceInfo {
  id: string;
  title: string;
  path: string;
  repositoryPath?: string;
  branch?: string;
  isRemote: boolean;
  status: WorkspaceStatus;
  created: Date;
  modified: Date;
  stats?: WorkspaceStats;
}

/**
 * Workspace status
 */
export type WorkspaceStatus = 'active' | 'idle' | 'archived' | 'error';

/**
 * Workspace statistics
 */
export interface WorkspaceStats {
  fileCount: number;
  noteCount: number;
  totalSize: number;
  lastActivity: Date;
}

// IToolService is defined in main/types.ts - import from there if needed
