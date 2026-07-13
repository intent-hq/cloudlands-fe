/**
 * CDP Connection Manager
 *
 * Manages the Chrome DevTools Protocol connection to the Electron renderer process.
 * Handles connection lifecycle, domain enablement, and disconnection events.
 */

import CDP from 'chrome-remote-interface';
import { Logger } from '../../shared/logger';

export interface ConsoleLogEntry {
  timestamp: number;
  type: string; // 'log', 'error', 'warn', 'info', 'debug', etc.
  args: any[];
  stackTrace?: any;
}

const MAX_CONSOLE_LOGS = 1000;

export class CdpConnectionManager {
  private client: any = null;
  private logger: Logger;
  private port: number;
  private consoleLogs: ConsoleLogEntry[] = [];

  constructor(port: number = 9223) {
    this.port = port;
    this.logger = new Logger('CdpConnectionManager');
  }

  /**
   * Connect to CDP immediately
   */
  async connect(): Promise<void> {
    if (this.client) {
      this.logger.debug('Already connected to CDP');
      return;
    }

    try {
      this.logger.debug(`Connecting to CDP on port ${this.port}`);
      this.client = await CDP({ port: this.port });

      // Enable required domains
      await this.client.Runtime.enable();
      await this.client.DOM.enable();

      // Enable console log capture
      this.setupConsoleCapture();

      this.logger.debug(`Connected to CDP on port ${this.port}`);

      // Handle disconnection
      this.client.on('disconnect', () => {
        this.logger.warn(`CDP client disconnected from port ${this.port}`);
        this.client = null;
        this.consoleLogs = []; // Clear logs on disconnect
      });
    } catch (error) {
      this.logger.error(`Failed to connect to CDP on port ${this.port}:`, error as Error);
      throw new Error(
        `Cannot connect to Electron app. Is it running with --remote-debugging-port=${this.port}?`,
      );
    }
  }

  /**
   * Get the CDP client (throws if not connected)
   */
  getClient(): any {
    if (!this.client) {
      throw new Error('CDP client not connected. Call connect() first.');
    }
    return this.client;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.client !== null;
  }

  /**
   * Disconnect from CDP
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.consoleLogs = [];
      this.logger.debug(`Disconnected from CDP on port ${this.port}`);
    }
  }

  /**
   * Setup console log capture
   */
  private setupConsoleCapture(): void {
    if (!this.client) {
      return;
    }

    try {
      // Listen to Runtime.consoleAPICalled events
      this.client.Runtime.consoleAPICalled((params: any) => {
        const entry: ConsoleLogEntry = {
          timestamp: Date.now(),
          type: params.type,
          args: params.args.map((arg: any) => {
            // Extract the value from the RemoteObject
            if (arg.value !== undefined) {
              return arg.value;
            } else if (arg.description !== undefined) {
              return arg.description;
            } else if (arg.type === 'undefined') {
              return undefined;
            } else {
              return `[${arg.type}]`;
            }
          }),
          stackTrace: params.stackTrace,
        };

        // Add to circular buffer
        this.consoleLogs.push(entry);
        if (this.consoleLogs.length > MAX_CONSOLE_LOGS) {
          this.consoleLogs.shift(); // Remove oldest entry
        }
      });

      this.logger.debug('Console log capture enabled');
    } catch (error) {
      this.logger.warn(`Failed to setup console capture: ${(error as Error).message}`);
    }
  }

  /**
   * Get console logs with optional filtering
   */
  getConsoleLogs(options?: {
    count?: number;
    filter?: string;
    types?: string[];
  }): ConsoleLogEntry[] {
    const { count = 100, filter, types } = options || {};

    // Filter logs
    let filteredLogs = [...this.consoleLogs];

    // Filter by types if specified
    if (types && types.length > 0) {
      filteredLogs = filteredLogs.filter((log) => types.includes(log.type));
    }

    // Filter by string if specified
    if (filter) {
      const filterLower = filter.toLowerCase();
      filteredLogs = filteredLogs.filter((log) =>
        // Check if any arg contains the filter string
        log.args.some((arg) => {
          const argStr = String(arg).toLowerCase();
          return argStr.includes(filterLower);
        }),
      );
    }

    // Get the most recent logs
    const maxCount = Math.min(Math.max(1, count), MAX_CONSOLE_LOGS);
    return filteredLogs.slice(-maxCount);
  }

  /**
   * Get total number of buffered console logs
   */
  getConsoleLogCount(): number {
    return this.consoleLogs.length;
  }
}
