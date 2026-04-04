/**
 * Log Repository
 *
 * Data access layer for log operations.
 * Handles reading and writing log files.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { Logger } from '../../../shared/logger';

const logger = new Logger('LogRepository');

/**
 * Repository interface for logs
 */
export interface LogRepository {
  readLogFile(type: 'main' | 'renderer'): Promise<string>;
  clearLogFile(type: 'main' | 'renderer' | 'all'): Promise<void>;
  getLogStats(): Promise<LogStats>;
  appendRendererLogs(entries: RendererLogEntry[]): Promise<void>;
}

export interface RendererLogEntry {
  timestamp: string;
  level: string;
  category: string;
  message: string;
  context?: any;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

export interface LogStats {
  mainLogSize: number;
  rendererLogSize: number;
  totalLines: number;
  errorCount: number;
  warningCount: number;
}

/**
 * File system implementation of LogRepository
 */
export class FileSystemLogRepository implements LogRepository {
  private logPath: string | null = null;

  constructor() {
    // Defer path initialization until app is ready
  }

  private getLogPath(): string {
    if (!this.logPath) {
      this.logPath = path.join(app.getPath('userData'), 'logs');
    }
    return this.logPath;
  }

  /**
   * Read a log file
   */
  async readLogFile(type: 'main' | 'renderer'): Promise<string> {
    try {
      const fileName = type === 'main' ? 'main.log' : 'renderer.log';
      const filePath = path.join(this.getLogPath(), fileName);

      // Check if file exists
      try {
        await fs.access(filePath);
      } catch {
        logger.debug('Log file does not exist', { type, filePath });
        return '';
      }

      // Read file
      const content = await fs.readFile(filePath, 'utf-8');
      return content;
    } catch (error) {
      logger.error('Failed to read log file', error as Error, { type });
      throw error;
    }
  }

  /**
   * Clear log files
   */
  async clearLogFile(type: 'main' | 'renderer' | 'all'): Promise<void> {
    try {
      const files = type === 'all' ? ['main.log', 'renderer.log'] : [`${type}.log`];

      for (const file of files) {
        const filePath = path.join(this.getLogPath(), file);
        try {
          await fs.unlink(filePath);
          logger.info('Cleared log file', { file });
        } catch  {
          // File might not exist, that's okay
          logger.debug('Log file not found', { file });
        }
      }
    } catch (error) {
      logger.error('Failed to clear log files', error as Error, { type });
      throw error;
    }
  }

  /**
   * Append renderer log entries to the renderer.log file
   */
  async appendRendererLogs(entries: RendererLogEntry[]): Promise<void> {
    try {
      if (entries.length === 0) {
        return;
      }

      const logPath = this.getLogPath();
      const filePath = path.join(logPath, 'renderer.log');

      // Ensure log directory exists
      try {
        await fs.mkdir(logPath, { recursive: true });
      } catch (error) {
        logger.debug('Log directory already exists or could not be created', { error });
      }

      // Format entries as JSON lines (one entry per line)
      const lines = entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n';

      // Append to file
      try {
        await fs.appendFile(filePath, lines, 'utf-8');
      } catch (error) {
        logger.error('Failed to append to renderer log file', error as Error, { filePath });
        throw error;
      }
    } catch (error) {
      logger.error('Failed to append renderer logs', error as Error);
      throw error;
    }
  }

  /**
   * Get log statistics
   */
  async getLogStats(): Promise<LogStats> {
    try {
      let mainLogSize = 0;
      let rendererLogSize = 0;
      let totalLines = 0;
      let errorCount = 0;
      let warningCount = 0;

      // Read both log files
      for (const fileName of ['main.log', 'renderer.log']) {
        const filePath = path.join(this.getLogPath(), fileName);

        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const lines = content.split('\n');

          // Get file size
          const stats = await fs.stat(filePath);
          if (fileName === 'main.log') {
            mainLogSize = stats.size;
          } else {
            rendererLogSize = stats.size;
          }

          // Count lines and errors/warnings
          for (const line of lines) {
            if (line.trim()) {
              totalLines++;
              if (line.includes('[ERROR]')) {
                errorCount++;
              } else if (line.includes('[WARN]')) {
                warningCount++;
              }
            }
          }
        } catch (error) {
          // File doesn't exist or can't be read, log at debug level and skip
          logger.debug(`Could not read log file ${fileName}`, error as Error);
        }
      }

      return {
        mainLogSize,
        rendererLogSize,
        totalLines,
        errorCount,
        warningCount,
      };
    } catch (error) {
      logger.error('Failed to get log stats', error as Error);
      throw error;
    }
  }
}

/**
 * In-memory implementation for testing
 */
export class InMemoryLogRepository implements LogRepository {
  private logs = new Map<string, string>();

  async readLogFile(type: 'main' | 'renderer'): Promise<string> {
    return this.logs.get(type) || '';
  }

  async clearLogFile(type: 'main' | 'renderer' | 'all'): Promise<void> {
    if (type === 'all') {
      this.logs.clear();
    } else {
      this.logs.delete(type);
    }
  }

  async appendRendererLogs(entries: RendererLogEntry[]): Promise<void> {
    const current = this.logs.get('renderer') || '';
    const lines = entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n';
    this.logs.set('renderer', current + lines);
  }

  async getLogStats(): Promise<LogStats> {
    const mainContent = this.logs.get('main') || '';
    const rendererContent = this.logs.get('renderer') || '';

    const mainLines = mainContent.split('\n').filter((l) => l.trim());
    const rendererLines = rendererContent.split('\n').filter((l) => l.trim());

    return {
      mainLogSize: mainContent.length,
      rendererLogSize: rendererContent.length,
      totalLines: mainLines.length + rendererLines.length,
      errorCount: [...mainLines, ...rendererLines].filter((l) => l.includes('[ERROR]')).length,
      warningCount: [...mainLines, ...rendererLines].filter((l) => l.includes('[WARN]')).length,
    };
  }

  // Test helper
  setLog(type: 'main' | 'renderer', content: string): void {
    this.logs.set(type, content);
  }
}
