/**
 * Agent Error Tracking System for Intent App
 *
 * Captures and persists errors to help AI agents understand and debug issues.
 * Errors are saved to .augment/errors/tracked-errors.json which is gitignored.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import { app } from 'electron';
import { AppError } from '../errors';
import { Logger, LogEntry } from '../logger';
import { writeJsonAsync } from './async-utils';

export interface TrackedError {
  id: string;
  timestamp: string;
  source:
    | 'app-error'
    | 'logger'
    | 'unhandled-rejection'
    | 'uncaught-exception'
    | 'renderer'
    | 'main'
    | 'preload';
  level: 'error' | 'warning' | 'critical';
  message: string;
  code?: string;
  stack?: string;
  component?: string;
  context?: Record<string, any>;
  environment?: {
    nodeVersion?: string;
    electronVersion?: string;
    platform?: string;
    arch?: string;
    isRenderer?: boolean;
    isMain?: boolean;
  };
  workspaceId?: string;
  userId?: string;
  // Agent-specific metadata
  agentHints?: {
    possibleCauses?: string[];
    suggestedFixes?: string[];
    relatedFiles?: string[];
    searchQueries?: string[];
  };
  // Recent logs for context
  recentLogs?: LogEntry[];
}

export class AgentErrorTracker {
  private static instance: AgentErrorTracker;
  private logger: Logger;
  private errorFilePath: string = '';
  private maxErrors: number = 100;
  private errors: TrackedError[] = [];
  private isInitialized: boolean = false;
  private isEnabled: boolean = false;
  private recentLogs: LogEntry[] = [];
  private maxRecentLogs: number = 20;

  private constructor() {
    this.logger = new Logger('AgentErrorTracker');

    // Only initialize in development mode
    if (process.env.NODE_ENV !== 'development') {
      this.logger.info('Error tracking disabled in production');
      this.isEnabled = false;
      return;
    }

    this.isEnabled = true;

    // Determine the correct path based on environment
    const rootDir = this.findWorkspaceRoot();
    const errorDir = path.join(rootDir, '.augment', 'errors');
    this.errorFilePath = path.join(errorDir, 'tracked-errors.json');

    this.initialize();
  }

  private findWorkspaceRoot(): string {
    // In packaged Electron apps, use userData directory
    // This avoids trying to write to the read-only app.asar
    try {
      if (app && typeof app.getPath === 'function') {
        // Check if we're in a packaged app (app.asar in path)
        const __filename = fileURLToPath(import.meta.url);
        if (__filename.includes('app.asar') || app.isPackaged) {
          return app.getPath('userData');
        }
      }
    } catch {
      // app.getPath may throw if called too early, fall through to file-based detection
    }

    // In development, use the workspace root directory
    // In ES modules, use import.meta.url instead of __dirname
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    let currentDir = __dirname;

    // Look for package.json to identify the workspace root
    while (currentDir !== path.dirname(currentDir)) {
      const packagePath = path.join(currentDir, 'package.json');
      if (fs.existsSync(packagePath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
          if (pkg.name === 'intent') {
            return currentDir;
          }
        } catch {
          // Continue searching
        }
      }
      currentDir = path.dirname(currentDir);
    }

    // Fallback to home directory for packaged apps that couldn't detect earlier
    if (process.resourcesPath?.includes('app.asar')) {
      return path.join(os.homedir(), '.intent');
    }

    // Fallback to a reasonable default for development
    return path.join(process.cwd(), 'experimental', 'amelia', 'workspaces');
  }

  public static getInstance(): AgentErrorTracker {
    if (!AgentErrorTracker.instance) {
      AgentErrorTracker.instance = new AgentErrorTracker();
    }
    return AgentErrorTracker.instance;
  }

  private initialize(): void {
    try {
      // Ensure directory exists
      const errorDir = path.dirname(this.errorFilePath);
      if (!fs.existsSync(errorDir)) {
        fs.mkdirSync(errorDir, { recursive: true });
      }

      // Load existing errors if file exists
      if (fs.existsSync(this.errorFilePath)) {
        const content = fs.readFileSync(this.errorFilePath, 'utf-8');
        this.errors = JSON.parse(content) as TrackedError[];
        this.logger.info(`Loaded ${this.errors.length} existing errors from tracker`);
      }

      this.isInitialized = true;
      this.logger.info(`Agent error tracker initialized at ${this.errorFilePath}`);
    } catch (error) {
      this.logger.error('Failed to initialize error tracker', error);
    }
  }

  public trackError(error: Partial<TrackedError> & { message: string }): string {
    // Skip tracking if disabled
    if (!this.isEnabled) {
      return '';
    }

    if (!this.isInitialized) {
      this.logger.warn('Error tracker not initialized, skipping error tracking');
      return '';
    }

    const errorId = this.generateErrorId();
    const trackedError: TrackedError = {
      id: errorId,
      timestamp: new Date().toISOString(),
      source: error.source || 'app-error',
      level: error.level || 'error',
      message: error.message,
      code: error.code,
      stack: error.stack,
      component: error.component,
      context: error.context,
      environment: error.environment || this.captureEnvironment(),
      workspaceId: error.workspaceId,
      userId: error.userId,
      agentHints: error.agentHints || this.generateAgentHints(error),
      recentLogs: this.recentLogs.slice(-10), // Include last 10 logs
    };

    // Add to in-memory list
    this.errors.push(trackedError);

    // Trim to max size
    if (this.errors.length > this.maxErrors) {
      this.errors = this.errors.slice(-this.maxErrors);
    }

    // Save to disk
    this.saveErrors();

    this.logger.info(`Tracked error ${errorId}: ${error.message}`);
    return errorId;
  }

  public trackAppError(appError: AppError, context?: Record<string, any>): string {
    return this.trackError({
      source: 'app-error',
      level: 'error',
      message: appError.message,
      code: appError.code,
      stack: appError.stack,
      context: {
        ...appError.details,
        ...context,
      },
      agentHints: this.generateAppErrorHints(appError),
    });
  }

  public trackLogEntry(entry: LogEntry): void {
    // Add to recent logs
    this.recentLogs.push(entry);
    if (this.recentLogs.length > this.maxRecentLogs) {
      this.recentLogs.shift();
    }

    // Track if it's an error
    if (entry.level === 'ERROR' || entry.level === 'CRITICAL') {
      this.trackError({
        source: 'logger',
        level: entry.level === 'CRITICAL' ? 'critical' : 'error',
        message: entry.message,
        component: entry.category,
        context: {
          ...entry.context,
          tags: entry.tags,
        },
        stack: entry.error?.stack,
      });
    }
  }

  private generateErrorId(): string {
    return `err_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  private captureEnvironment(): TrackedError['environment'] {
    const isRenderer = typeof window !== 'undefined';
    const isMain = typeof process !== 'undefined' && !isRenderer;

    return {
      nodeVersion: typeof process !== 'undefined' ? process.version : undefined,
      electronVersion: typeof process !== 'undefined' ? process.versions?.electron : undefined,
      platform: typeof process !== 'undefined' ? process.platform : undefined,
      arch: typeof process !== 'undefined' ? process.arch : undefined,
      isRenderer,
      isMain,
    };
  }

  /**
   * Save errors to disk asynchronously
   * PERF: Converted from writeFileSync to prevent blocking main thread
   */
  private async saveErrors(): Promise<void> {
    try {
      await writeJsonAsync(this.errorFilePath, this.errors);
    } catch (error) {
      this.logger.error('Failed to save errors to disk', error);
    }
  }

  private generateAgentHints(error: Partial<TrackedError>): TrackedError['agentHints'] {
    const hints: TrackedError['agentHints'] = {
      possibleCauses: [],
      suggestedFixes: [],
      relatedFiles: [],
      searchQueries: [],
    };

    // Extract file paths from stack trace
    if (error.stack) {
      const fileMatches = error.stack.match(/at .* \((.*?):\d+:\d+\)/g) || [];
      hints.relatedFiles = fileMatches
        .map((match) => match.match(/\((.*?):\d+:\d+\)/)?.[1])
        .filter(Boolean) as string[];
    }

    // Common error patterns
    const message = error.message || '';

    if (message.includes('Cannot read property') || message.includes('Cannot read properties')) {
      hints.possibleCauses?.push('Attempting to access property on undefined or null value');
      hints.suggestedFixes?.push('Add null/undefined checks', 'Use optional chaining (?.)');
      hints.searchQueries?.push('optional chaining', 'nullish coalescing');
    }

    if (message.includes('is not a function')) {
      hints.possibleCauses?.push('Calling a non-function value as a function');
      hints.suggestedFixes?.push('Verify the value is a function before calling');
      hints.searchQueries?.push('typeof check', 'function validation');
    }

    if (message.includes('ENOENT') || message.includes('no such file')) {
      hints.possibleCauses?.push('File or directory does not exist');
      hints.suggestedFixes?.push('Verify file path', 'Create missing file/directory');
      hints.searchQueries?.push('fs.existsSync', 'file path validation');
    }

    if (message.includes('EACCES') || message.includes('permission denied')) {
      hints.possibleCauses?.push('Insufficient permissions');
      hints.suggestedFixes?.push('Check file permissions', 'Run with appropriate privileges');
      hints.searchQueries?.push('file permissions', 'chmod');
    }

    if (message.includes('workspace')) {
      hints.searchQueries?.push('workspace', 'WorkspaceService');
      hints.relatedFiles?.push(
        'src/features/workspace',
        'src/shared/services/workspace-service.ts',
      );
    }

    if (message.includes('IPC') || message.includes('ipc')) {
      hints.searchQueries?.push('IPC', 'electron IPC');
      hints.relatedFiles?.push('src/features/ipc', 'src/preload/index.ts');
    }

    return hints;
  }

  private generateAppErrorHints(appError: AppError): TrackedError['agentHints'] {
    const baseHints = this.generateAgentHints({ message: appError.message, stack: appError.stack });

    if (!baseHints) {
      return undefined;
    }

    // Add specific hints based on error type
    if (appError.code === 'WORKSPACE_NOT_FOUND') {
      baseHints.possibleCauses?.push('Space ID does not exist', 'Space was deleted');
      baseHints.suggestedFixes?.push('Verify space ID', 'Check space list');
      baseHints.relatedFiles?.push('src/shared/services/workspace-service.ts');
    }

    if (appError.code === 'FILE_NOT_FOUND') {
      baseHints.possibleCauses?.push('File was moved or deleted', 'Incorrect file path');
      baseHints.suggestedFixes?.push('Verify file exists', 'Check file path resolution');
    }

    if (appError.code === 'VALIDATION_ERROR') {
      baseHints.possibleCauses?.push('Invalid input data', 'Missing required fields');
      baseHints.suggestedFixes?.push('Check validation rules', 'Verify input data');
    }

    return baseHints;
  }

  // Query methods
  public getErrors(filter?: {
    source?: TrackedError['source'];
    level?: TrackedError['level'];
    since?: Date;
    component?: string;
    workspaceId?: string;
  }): TrackedError[] {
    let filtered = [...this.errors];

    if (filter) {
      if (filter.source) {
        filtered = filtered.filter((e) => e.source === filter.source);
      }
      if (filter.level) {
        filtered = filtered.filter((e) => e.level === filter.level);
      }
      if (filter.since) {
        filtered = filtered.filter((e) => new Date(e.timestamp) >= filter.since!);
      }
      if (filter.component) {
        filtered = filtered.filter((e) => e.component === filter.component);
      }
      if (filter.workspaceId) {
        filtered = filtered.filter((e) => e.workspaceId === filter.workspaceId);
      }
    }

    return filtered;
  }

  public getLatestErrors(count: number = 10): TrackedError[] {
    return this.errors.slice(-count);
  }

  public getErrorById(id: string): TrackedError | undefined {
    return this.errors.find((e) => e.id === id);
  }

  public clearErrors(): void {
    this.errors = [];
    this.recentLogs = [];
    this.saveErrors();
    this.logger.info('Cleared all tracked errors');
  }

  public getErrorSummary(): {
    totalErrors: number;
    bySource: Record<string, number>;
    byLevel: Record<string, number>;
    byComponent: Record<string, number>;
    recentErrors: TrackedError[];
    filePath: string;
  } {
    const bySource: Record<string, number> = {};
    const byLevel: Record<string, number> = {};
    const byComponent: Record<string, number> = {};

    for (const error of this.errors) {
      bySource[error.source] = (bySource[error.source] || 0) + 1;
      byLevel[error.level] = (byLevel[error.level] || 0) + 1;
      if (error.component) {
        byComponent[error.component] = (byComponent[error.component] || 0) + 1;
      }
    }

    return {
      totalErrors: this.errors.length,
      bySource,
      byLevel,
      byComponent,
      recentErrors: this.getLatestErrors(5),
      filePath: this.errorFilePath,
    };
  }

  public addAgentHints(errorId: string, hints: TrackedError['agentHints']): void {
    const error = this.errors.find((e) => e.id === errorId);
    if (error) {
      error.agentHints = { ...error.agentHints, ...hints };
      this.saveErrors();
    }
  }

  public getErrorFilePath(): string {
    return this.errorFilePath;
  }
}
