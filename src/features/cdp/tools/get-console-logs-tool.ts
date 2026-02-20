/**
 * Get Console Logs Tool
 *
 * Retrieves browser console logs captured from the Electron renderer process.
 * Supports filtering by count, string match, and console type.
 */

import { BaseMCPTool } from '../../mcp/main/mcp/tool';
import { ToolCall, ToolResult } from '../../mcp/main/mcp/protocol';
import { CdpConnectionManager } from '../cdp-connection';

export class GetConsoleLogsTool extends BaseMCPTool {
  constructor(private connectionManager: CdpConnectionManager) {
    super(
      'cdp.get_console_logs',
      `Get browser console logs captured from the Electron renderer process.

Console logs are automatically captured when the CDP connection is established. This tool retrieves the buffered logs (up to 1000 most recent entries) with optional filtering.`,
      {
        type: 'object',
        properties: {
          count: {
            type: 'integer',
            description: 'Maximum number of recent logs to return. Default: 100. Maximum: 1000.',
          },
          filter: {
            type: 'string',
            description:
              'Optional filter string. Only logs containing this string (case-insensitive) will be returned. Useful for filtering by log level like "[DEBUG]" or "[ERROR]", or by specific keywords.',
          },
          types: {
            type: 'array',
            description:
              'Optional array of console types to include. Valid types: "log", "error", "warn", "info", "debug". If not specified, all types are included.',
          },
        },
        required: [],
      },
    );
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const {
        count = 100,
        filter,
        types,
      } = call.arguments as {
        count?: number;
        filter?: string;
        types?: string[];
      };

      const logs = this.connectionManager.getConsoleLogs({ count, filter, types });
      const totalBuffered = this.connectionManager.getConsoleLogCount();

      // Format logs for display
      const formattedLogs = logs
        .map((log) => {
          const timestamp = new Date(log.timestamp).toISOString();
          const argsStr = log.args
            .map((arg) => {
              if (typeof arg === 'object') {
                try {
                  return JSON.stringify(arg);
                } catch {
                  return String(arg);
                }
              }
              return String(arg);
            })
            .join(' ');
          return `[${timestamp}] [${log.type}] ${argsStr}`;
        })
        .join('\n');

      const summary = `Retrieved ${logs.length} console log(s)${
        filter ? ` matching filter "${filter}"` : ''
      }${types ? ` of types [${types.join(', ')}]` : ''} (total buffered: ${totalBuffered})`;

      return this.success(`${summary}\n\n${formattedLogs || '(no logs)'}`, {
        totalBuffered,
        returned: logs.length,
        filter: filter || null,
        types: types || null,
      });
    } catch (error) {
      return this.error(`CDP error: ${(error as Error).message}`);
    }
  }
}
