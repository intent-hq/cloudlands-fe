/**
 * IPC Debug Tracker
 *
 * Tracks all IPC calls, validation errors, and missing handlers.
 * Writes debug information to a file for agent debugging.
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { Logger } from '../logger';
import { writeJsonAsync } from './async-utils';

const logger = new Logger('IPCDebugTracker');

interface IPCDebugEntry {
  timestamp: string;
  channel: string;
  type: 'call' | 'validation_error' | 'missing_handler' | 'success';
  data?: any;
  error?: string;
  stack?: string;
  source?: 'main' | 'renderer' | 'preload';
}

class IPCDebugTracker {
  private static instance: IPCDebugTracker;
  private entries: IPCDebugEntry[] = [];
  private debugFilePath: string;
  private missingHandlersFilePath: string;
  private missingHandlers: Set<string> = new Set();
  private maxEntries = 100; // Reduced from 1000 to prevent memory issues
  private maxDataSize = 500; // Max characters for data field
  private writeDebounceTimer: NodeJS.Timeout | null = null;
  private periodicSaveInterval: NodeJS.Timeout | null = null;
  private debugDir: string;
  private enabled: boolean;

  private constructor() {
    // Only enable in development when explicitly requested
    this.enabled = process.env.IPC_DEBUG === 'true';

    // Initialize file paths
    const userDataPath = app?.getPath('userData') || process.cwd();
    this.debugDir = path.join(userDataPath, '.intent', 'ipc-debug');

    // Ensure directory exists
    if (!fs.existsSync(this.debugDir)) {
      fs.mkdirSync(this.debugDir, { recursive: true });
    }

    this.debugFilePath = path.join(this.debugDir, 'ipc-debug.json');
    this.missingHandlersFilePath = path.join(this.debugDir, 'missing-handlers.json');

    // Only load existing data if enabled
    if (this.enabled) {
      this.loadExistingData();
      // Set up periodic save with cleanup tracking
      this.periodicSaveInterval = setInterval(() => this.saveToFile(), 30000); // Save every 30 seconds
    }
  }

  /**
   * Truncate data to prevent memory issues
   */
  private truncateData(data: any): any {
    if (data === undefined || data === null) return data;

    try {
      const str = JSON.stringify(data);
      if (str.length > this.maxDataSize) {
        return `[truncated: ${str.length} chars] ${str.slice(0, this.maxDataSize)}...`;
      }
      return data;
    } catch {
      return '[non-serializable data]';
    }
  }

  static getInstance(): IPCDebugTracker {
    if (!IPCDebugTracker.instance) {
      IPCDebugTracker.instance = new IPCDebugTracker();
    }
    return IPCDebugTracker.instance;
  }

  private loadExistingData(): void {
    try {
      if (fs.existsSync(this.debugFilePath)) {
        const data = fs.readFileSync(this.debugFilePath, 'utf-8');
        const parsed = JSON.parse(data);
        // Only keep last maxEntries to prevent memory issues
        this.entries = Array.isArray(parsed) ? parsed.slice(-this.maxEntries) : [];
      }

      if (fs.existsSync(this.missingHandlersFilePath)) {
        const data = fs.readFileSync(this.missingHandlersFilePath, 'utf-8');
        const missingData = JSON.parse(data);
        this.missingHandlers = new Set(missingData.channels || []);
      }
    } catch (error) {
      // If loading fails, just start fresh
      this.entries = [];
      logger.warn('Failed to load existing IPC debug data, starting fresh', error as Error);
    }
  }

  trackCall(channel: string, data?: any, source: 'main' | 'renderer' | 'preload' = 'main'): void {
    if (!this.enabled) return;

    this.addEntry({
      timestamp: new Date().toISOString(),
      channel,
      type: 'call',
      data: this.truncateData(data),
      source,
    });
  }

  trackSuccess(channel: string, data?: any): void {
    if (!this.enabled) return;

    this.addEntry({
      timestamp: new Date().toISOString(),
      channel,
      type: 'success',
      data: this.truncateData(data),
    });
  }

  trackValidationError(channel: string, error: any, data?: any): void {
    // Always track validation errors even if disabled
    this.addEntry({
      timestamp: new Date().toISOString(),
      channel,
      type: 'validation_error',
      data: this.truncateData(data),
      error: error.message || String(error),
      stack: error.stack?.slice(0, 500), // Truncate stack too
    });

    logger.warn(`IPC validation error on channel ${channel}:`, error);

    // Force immediate save for validation errors
    this.saveToFile();
  }

  trackMissingHandler(channel: string, data?: any): void {
    // Always track missing handlers even if disabled
    this.missingHandlers.add(channel);

    this.addEntry({
      timestamp: new Date().toISOString(),
      channel,
      type: 'missing_handler',
      data: this.truncateData(data),
      error: `No handler registered for channel: ${channel}`,
    });

    logger.error(`Missing IPC handler for channel: ${channel}`);

    // Immediately save both missing handlers and debug log
    this.saveMissingHandlers();
    this.saveToFile();
  }

  private addEntry(entry: IPCDebugEntry): void {
    this.entries.push(entry);

    // Trim if too many entries
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }

    // Debounce save
    this.debounceSave();
  }

  private debounceSave(): void {
    if (this.writeDebounceTimer) {
      clearTimeout(this.writeDebounceTimer);
    }

    this.writeDebounceTimer = setTimeout(() => {
      this.saveToFile();
    }, 5000); // Save after 5 seconds of inactivity
  }

  /**
   * Save debug entries to file asynchronously
   * PERF: Converted from writeFileSync to prevent blocking main thread
   */
  private async saveToFile(): Promise<void> {
    if (this.entries.length === 0) return;

    try {
      // PERF: Use async JSON write to prevent blocking main thread
      await writeJsonAsync(this.debugFilePath, this.entries);
      logger.debug(`Saved ${this.entries.length} IPC debug entries`);
    } catch (error) {
      logger.error('Failed to save IPC debug data', error as Error);
    }
  }

  /**
   * Save missing handlers to file asynchronously
   * PERF: Converted from writeFileSync to prevent blocking main thread
   */
  private async saveMissingHandlers(): Promise<void> {
    try {
      const data = {
        timestamp: new Date().toISOString(),
        count: this.missingHandlers.size,
        channels: Array.from(this.missingHandlers).sort(),
        suggestions: this.generateSuggestions(),
      };

      // PERF: Use async JSON write to prevent blocking main thread
      await writeJsonAsync(this.missingHandlersFilePath, data);

      // Also log to console for immediate visibility
      if (this.missingHandlers.size > 0) {
        console.warn(`\n⚠️  Missing IPC Handlers Detected: ${this.missingHandlers.size}`);
        console.warn(`📁 Debug file: ${this.missingHandlersFilePath}`);
        console.warn('Channels:', Array.from(this.missingHandlers).join(', '));
      }

      logger.debug(
        `Saved ${this.missingHandlers.size} missing handlers to ${this.missingHandlersFilePath}`,
      );
    } catch (error) {
      logger.error('Failed to save missing handlers data', error as Error);
    }
  }

  private generateSuggestions(): Record<string, string> {
    const suggestions: Record<string, string> = {};

    for (const channel of this.missingHandlers) {
      if (channel.startsWith('workspace:')) {
        suggestions[channel] = 'Check src/features/workspace/main/workspace.ipc.ts';
      } else if (channel.startsWith('agent:')) {
        suggestions[channel] = 'Check src/features/agent/main/unified-agent-handlers.ts';
      } else if (channel.startsWith('git:')) {
        suggestions[channel] = 'Check src/features/git/git.ipc.ts';
      } else if (channel.startsWith('file:')) {
        suggestions[channel] = 'Check src/features/file-tracking/main/file-tracking.ipc.ts';
      } else if (channel.startsWith('terminal:')) {
        suggestions[channel] =
          'Check src/features/terminal/main/terminal.ipc.ts or terminal-professional.ipc.ts';
      } else if (channel.startsWith('ssh:')) {
        suggestions[channel] = 'Check src/features/ssh/main/ssh.ipc.ts';
      } else if (channel.includes('vscode') || channel.includes('jetbrains')) {
        suggestions[channel] = 'Check src/features/ide/main/ide.ipc.ts';
      } else {
        suggestions[channel] = 'Create new handler file in appropriate feature directory';
      }
    }

    return suggestions;
  }

  getDebugInfo(): {
    totalCalls: number;
    successfulCalls: number;
    validationErrors: number;
    missingHandlers: string[];
    recentErrors: IPCDebugEntry[];
    } {
    const validationErrors = this.entries.filter((e) => e.type === 'validation_error');
    const successfulCalls = this.entries.filter((e) => e.type === 'success');
    const recentErrors = this.entries
      .filter((e) => e.type === 'validation_error' || e.type === 'missing_handler')
      .slice(-10);

    return {
      totalCalls: this.entries.length,
      successfulCalls: successfulCalls.length,
      validationErrors: validationErrors.length,
      missingHandlers: Array.from(this.missingHandlers),
      recentErrors,
    };
  }

  clearDebugData(): void {
    this.entries = [];
    this.missingHandlers.clear();
    this.saveToFile();
    this.saveMissingHandlers();
    logger.info('IPC debug data cleared');
  }

  forceSave(): void {
    this.saveToFile();
    this.saveMissingHandlers();
    logger.info('IPC debug data force saved');
  }

  getFilePaths(): { debug: string; missingHandlers: string } {
    return {
      debug: this.debugFilePath,
      missingHandlers: this.missingHandlersFilePath,
    };
  }

  /**
   * Cleanup resources - should be called on app quit
   */
  dispose(): void {
    if (this.periodicSaveInterval) {
      clearInterval(this.periodicSaveInterval);
      this.periodicSaveInterval = null;
    }
    if (this.writeDebounceTimer) {
      clearTimeout(this.writeDebounceTimer);
      this.writeDebounceTimer = null;
    }
    // Final save before shutdown
    if (this.enabled) {
      this.saveToFile();
      this.saveMissingHandlers();
    }
    logger.info('IPC debug tracker disposed');
  }
}

export const ipcDebugTracker = IPCDebugTracker.getInstance();

// Export for use in other modules
export type { IPCDebugEntry };
