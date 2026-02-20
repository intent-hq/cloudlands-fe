/**
 * Terminal MCP tools for agent access to user terminal sessions.
 *
 * Provides list_terminals and read_terminal_output tools so agents
 * can proactively inspect terminal state without requiring explicit
 * @terminal mentions from the user.
 */

import { BaseMCPTool, createInputSchema, stringProperty } from './tool';
import type { ToolCall, ToolResult } from './protocol';
import { terminalManager } from '../../../terminal/main/terminal.ipc';
import { Logger } from '$shared/logger';

const logger = new Logger('TerminalTools');

/**
 * Tool to list all active terminals in the workspace
 */
export class ListTerminalsTool extends BaseMCPTool {
  private workspaceId: string;

  constructor(workspaceId: string) {
    super(
      'list_terminals',
      'List all active terminal sessions in the current workspace. Returns terminal IDs, working directories, and whether a command is currently executing.',
      createInputSchema({}, []),
    );
    this.workspaceId = workspaceId;
  }

  async execute(_call: ToolCall): Promise<ToolResult> {
    try {
      const terminals = terminalManager.getWorkspaceTerminals(this.workspaceId);

      if (terminals.length === 0) {
        return this.success('No active terminals in this workspace.');
      }

      const terminalList = terminals.map((t, index) => {
        const info = t.getInfo();
        return {
          index: index + 1,
          id: info.id,
          name: info.title || 'Terminal',
          cwd: info.cwd,
          isExecutingCommand: info.isExecutingCommand,
        };
      });

      return this.success(JSON.stringify(terminalList, null, 2), {
        terminalCount: terminals.length,
      });
    } catch (error) {
      logger.error('[ListTerminalsTool] Failed to list terminals:', error as Error);
      return this.error(`Failed to list terminals: ${(error as Error).message}`);
    }
  }
}

/**
 * Tool to read the output buffer of a specific terminal
 */
export class ReadTerminalOutputTool extends BaseMCPTool {
  private workspaceId: string;

  constructor(workspaceId: string) {
    super(
      'read_terminal_output',
      'Read the output buffer of a terminal session. Use list_terminals first to get available terminal IDs. Returns the recent terminal output including command results, errors, and logs.',
      createInputSchema(
        {
          terminal_id: stringProperty('The terminal ID to read output from'),
          max_lines: {
            type: 'number',
            description:
              'Maximum number of lines to return from the end of the buffer. Defaults to 200. Use a smaller value for quick checks, larger for full context.',
          },
        },
        ['terminal_id'],
      ),
    );
    this.workspaceId = workspaceId;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const { terminal_id, max_lines = 200 } = call.arguments;

      if (!terminal_id) {
        return this.error('terminal_id is required. Use list_terminals to see available terminals.');
      }

      const terminal = terminalManager.getTerminal(terminal_id);

      if (!terminal) {
        return this.error(
          `Terminal not found: ${terminal_id}. Use list_terminals to see available terminals.`,
        );
      }

      // Verify the terminal belongs to this workspace
      const info = terminal.getInfo();
      if (info.workspaceId !== this.workspaceId) {
        return this.error('Terminal does not belong to this workspace.');
      }

      const rawOutput = terminal.getBufferedOutput();

      if (!rawOutput || rawOutput.trim().length === 0) {
        return this.success('Terminal has no output yet.', {
          terminalId: terminal_id,
          cwd: info.cwd,
        });
      }

      // Strip ANSI escape sequences for cleaner output
      const cleanOutput = rawOutput.replace(
        // eslint-disable-next-line no-control-regex
        /\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b\[[\?]?[0-9;]*[a-zA-Z]/g,
        '',
      );

      // Split into lines and take the last N lines
      const lines = cleanOutput.split('\n');
      const maxLineCount = Math.max(1, Math.min(max_lines, 10000));
      const truncated = lines.length > maxLineCount;
      const outputLines = truncated ? lines.slice(-maxLineCount) : lines;

      // Trim trailing empty lines
      while (outputLines.length > 0 && !outputLines[outputLines.length - 1].trim()) {
        outputLines.pop();
      }

      const header = `Terminal ${terminal_id} (cwd: ${info.cwd})${truncated ? ` [showing last ${maxLineCount} of ${lines.length} lines]` : ''}`;
      const content = `${header}\n${'─'.repeat(40)}\n${outputLines.join('\n')}`;

      return this.success(content, {
        terminalId: terminal_id,
        cwd: info.cwd,
        totalLines: lines.length,
        returnedLines: outputLines.length,
        truncated,
      });
    } catch (error) {
      logger.error('[ReadTerminalOutputTool] Failed to read terminal:', error as Error);
      return this.error(`Failed to read terminal output: ${(error as Error).message}`);
    }
  }
}
