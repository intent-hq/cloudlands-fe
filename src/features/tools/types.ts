/**
 * Tool Service Types
 *
 * Core type definitions for the tool service layer.
 * These types are protocol-agnostic and represent pure business logic.
 */

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
  type: 'local';

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

// IToolService is defined in main/types.ts - import from there if needed
