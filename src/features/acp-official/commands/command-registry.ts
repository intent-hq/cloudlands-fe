/**
 * Command Registry for ACP Slash Commands
 *
 * Manages slash commands with autocomplete, validation, and execution.
 */

import { EventEmitter } from '../utils/browser-event-emitter';
import type { AgentId } from '$shared/types/branded-ids';
import { Logger } from '../../../shared/logger';
import type { AvailableCommand, SessionId } from '../types/base';

const logger = new Logger('CommandRegistry');

export interface CommandParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'enum';
  description?: string;
  required?: boolean;
  default?: any;
  options?: string[]; // For enum type
  validate?: (value: any) => boolean;
}

export interface Command extends AvailableCommand {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  category?: 'system' | 'navigation' | 'editing' | 'utility' | 'custom';
  parameters?: CommandParameter[];
  aliases?: string[];
  icon?: string;
  shortcut?: string;
  handler?: (args: Record<string, any>, context: CommandContext) => Promise<CommandResult>;
}

export interface CommandContext {
  sessionId: AgentId;
  workspaceId?: string;
  userId?: string;
  timestamp: number;
}

export interface CommandResult {
  success: boolean;
  message?: string;
  data?: any;
  action?:
    | 'clear'
    | 'reset'
    | 'navigate'
    | 'execute'
    | 'undo'
    | 'redo'
    | 'export'
    | 'settings'
    | 'help';
}

export interface CommandSuggestion {
  command: Command;
  score: number;
  matchedAlias?: string;
}

export class CommandRegistry extends EventEmitter {
  private commands = new Map<string, Command>();
  private aliases = new Map<string, string>();
  private history: string[] = [];
  private maxHistory = 50;

  constructor() {
    super();
    this.registerBuiltInCommands();
  }

  /**
   * Register a command
   */
  registerCommand(command: Command): void {
    // Validate command
    if (!command.id || !command.name) {
      throw new Error('Command must have id and name');
    }

    // Store command
    this.commands.set(command.id, command);

    // Register aliases
    if (command.aliases) {
      for (const alias of command.aliases) {
        this.aliases.set(alias.toLowerCase(), command.id);
      }
    }

    // Also register the main name as an alias
    this.aliases.set(command.name.toLowerCase(), command.id);

    logger.info('Command registered', { id: command.id, name: command.name });
    this.emit('command:registered', command);
  }

  /**
   * Unregister a command
   */
  unregisterCommand(commandId: string): void {
    const command = this.commands.get(commandId);
    if (!command) return;

    // Remove aliases
    if (command.aliases) {
      for (const alias of command.aliases) {
        this.aliases.delete(alias.toLowerCase());
      }
    }
    this.aliases.delete(command.name.toLowerCase());

    // Remove command
    this.commands.delete(commandId);

    logger.info('Command unregistered', { id: commandId });
    this.emit('command:unregistered', command);
  }

  /**
   * Get command suggestions based on input
   */
  getSuggestions(input: string, limit = 10): CommandSuggestion[] {
    const query = input.toLowerCase().replace(/^\//, '');
    if (!query) {
      // Return all commands if no query
      return Array.from(this.commands.values())
        .slice(0, limit)
        .map((cmd) => ({ command: cmd, score: 0 }));
    }

    const suggestions: CommandSuggestion[] = [];

    // Check each command and its aliases
    for (const [_id, command] of this.commands) {
      let bestScore = 0;
      let matchedAlias: string | undefined;

      // Check main name
      const nameScore = this.calculateMatchScore(query, command.name.toLowerCase());
      if (nameScore > bestScore) {
        bestScore = nameScore;
      }

      // Check aliases
      if (command.aliases) {
        for (const alias of command.aliases) {
          const aliasScore = this.calculateMatchScore(query, alias.toLowerCase());
          if (aliasScore > bestScore) {
            bestScore = aliasScore;
            matchedAlias = alias;
          }
        }
      }

      // Check description
      if (command.description) {
        const descScore = this.calculateMatchScore(query, command.description.toLowerCase()) * 0.5;
        bestScore = Math.max(bestScore, descScore);
      }

      if (bestScore > 0) {
        suggestions.push({ command, score: bestScore, matchedAlias });
      }
    }

    // Sort by score and return top results
    return suggestions.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /**
   * Parse and execute a command
   */
  async executeCommand(input: string, context: CommandContext): Promise<CommandResult> {
    // Parse command and arguments
    const { commandName, args } = this.parseCommand(input);

    // Find command
    const commandId = this.aliases.get(commandName.toLowerCase());
    if (!commandId) {
      return {
        success: false,
        message: `Unknown command: ${commandName}`,
      };
    }

    const command = this.commands.get(commandId);
    if (!command) {
      return {
        success: false,
        message: `Command not found: ${commandName}`,
      };
    }

    // Add to history
    this.addToHistory(input);

    // Validate arguments
    const validatedArgs = this.validateArguments(command, args);
    if (!validatedArgs.valid) {
      return {
        success: false,
        message: validatedArgs.error,
      };
    }

    // Execute command
    try {
      if (command.handler) {
        const result = await command.handler(validatedArgs.args!, context);
        this.emit('command:executed', { command, args: validatedArgs.args, result });
        return result;
      } else {
        // Command without handler - just emit event
        this.emit('command:execute', { command, args: validatedArgs.args, context });
        return {
          success: true,
          message: `Command ${command.name} triggered`,
        };
      }
    } catch (error) {
      logger.error('Command execution failed', error as Error, { command: command.name });
      return {
        success: false,
        message: `Command failed: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Parse command input
   */
  private parseCommand(input: string): { commandName: string; args: Record<string, any> } {
    const trimmed = input.trim().replace(/^\//, '');
    const parts = trimmed.split(/\s+/);
    const commandName = parts[0] || '';

    // Parse arguments (simple key=value format)
    const args: Record<string, any> = {};
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      if (part.includes('=')) {
        const [key, ...valueParts] = part.split('=');
        args[key] = valueParts.join('=');
      } else {
        // Positional argument
        args[`arg${i}`] = part;
      }
    }

    return { commandName, args };
  }

  /**
   * Validate command arguments
   */
  private validateArguments(
    command: Command,
    args: Record<string, any>,
  ): { valid: boolean; args?: Record<string, any>; error?: string } {
    if (!command.parameters) {
      return { valid: true, args };
    }

    const validated: Record<string, any> = {};

    for (const param of command.parameters) {
      const value = args[param.name] ?? param.default;

      // Check required
      if (param.required && value === undefined) {
        return {
          valid: false,
          error: `Missing required parameter: ${param.name}`,
        };
      }

      // Type conversion and validation
      if (value !== undefined) {
        // Convert type
        let converted = value;
        try {
          switch (param.type) {
            case 'number':
              converted = Number(value);
              if (isNaN(converted)) {
                return {
                  valid: false,
                  error: `Parameter ${param.name} must be a number`,
                };
              }
              break;
            case 'boolean':
              converted = value === 'true' || value === true;
              break;
            case 'enum':
              if (param.options && !param.options.includes(value)) {
                return {
                  valid: false,
                  error: `Parameter ${param.name} must be one of: ${param.options.join(', ')}`,
                };
              }
              break;
          }
        } catch (_error) {
          return {
            valid: false,
            error: `Invalid value for parameter ${param.name}`,
          };
        }

        // Custom validation
        if (param.validate && !param.validate(converted)) {
          return {
            valid: false,
            error: `Invalid value for parameter ${param.name}`,
          };
        }

        validated[param.name] = converted;
      }
    }

    return { valid: true, args: validated };
  }

  /**
   * Calculate match score for autocomplete
   */
  private calculateMatchScore(query: string, target: string): number {
    if (target.startsWith(query)) return 1;
    if (target.includes(query)) return 0.5;

    // Fuzzy match
    let score = 0;
    let queryIndex = 0;
    for (let i = 0; i < target.length && queryIndex < query.length; i++) {
      if (target[i] === query[queryIndex]) {
        score += 1 / query.length;
        queryIndex++;
      }
    }
    return score * 0.3;
  }

  /**
   * Add command to history
   */
  private addToHistory(command: string): void {
    this.history.unshift(command);
    if (this.history.length > this.maxHistory) {
      this.history.pop();
    }
  }

  /**
   * Get command history
   */
  getHistory(): string[] {
    return [...this.history];
  }

  /**
   * Clear command history
   */
  clearHistory(): void {
    this.history = [];
  }

  /**
   * Register built-in commands
   */
  private registerBuiltInCommands(): void {
    // System commands
    this.registerCommand({
      id: 'help',
      name: 'help',
      description: 'Show available commands',
      enabled: true,
      category: 'system',
      icon: 'fa-question-circle',
      aliases: ['h', '?'],
      handler: async () => ({
        success: true,
        action: 'help',
        message: 'Available commands',
        data: Array.from(this.commands.values()),
      }),
    });

    this.registerCommand({
      id: 'clear',
      name: 'clear',
      description: 'Clear the conversation',
      enabled: true,
      category: 'system',
      icon: 'fa-broom',
      aliases: ['cls', 'reset'],
      handler: async () => ({
        success: true,
        action: 'clear',
        message: 'Conversation cleared',
      }),
    });

    this.registerCommand({
      id: 'undo',
      name: 'undo',
      description: 'Undo the last action',
      enabled: true,
      category: 'system',
      icon: 'fa-undo',
      aliases: ['u'],
      handler: async () => ({
        success: true,
        action: 'undo',
        message: 'Last action undone',
      }),
    });

    this.registerCommand({
      id: 'redo',
      name: 'redo',
      description: 'Redo the last undone action',
      enabled: true,
      category: 'system',
      icon: 'fa-redo',
      aliases: ['r'],
      handler: async () => ({
        success: true,
        action: 'redo',
        message: 'Action redone',
      }),
    });

    // Navigation commands
    this.registerCommand({
      id: 'goto',
      name: 'goto',
      description: 'Navigate to a file or location',
      enabled: true,
      category: 'navigation',
      icon: 'fa-location-dot',
      aliases: ['g', 'nav'],
      parameters: [
        {
          name: 'path',
          type: 'string',
          description: 'File path or location',
          required: true,
        },
        {
          name: 'line',
          type: 'number',
          description: 'Line number',
          required: false,
        },
      ],
      handler: async (args) => ({
        success: true,
        action: 'navigate',
        data: { path: args.path, line: args.line },
        message: `Navigating to ${args.path}${args.line ? `:${args.line}` : ''}`,
      }),
    });

    // Utility commands
    this.registerCommand({
      id: 'export',
      name: 'export',
      description: 'Export conversation or plan',
      enabled: true,
      category: 'utility',
      icon: 'fa-download',
      aliases: ['save'],
      parameters: [
        {
          name: 'format',
          type: 'enum',
          description: 'Export format',
          options: ['markdown', 'json', 'text'],
          default: 'markdown',
        },
      ],
      handler: async (args) => ({
        success: true,
        action: 'export',
        data: { format: args.format },
        message: `Exporting as ${args.format}`,
      }),
    });

    this.registerCommand({
      id: 'settings',
      name: 'settings',
      description: 'Open settings',
      enabled: true,
      category: 'system',
      icon: 'fa-gear',
      aliases: ['config', 'prefs'],
      handler: async () => ({
        success: true,
        action: 'settings',
        message: 'Opening settings',
      }),
    });

    // App commands (palette integration)
    this.registerCommand({
      id: 'new-workspace',
      name: 'new-workspace',
      description: 'Create a new workspace',
      enabled: true,
      category: 'utility',
      icon: 'fa-folder-open',
      aliases: ['workspace:new'],
      handler: async () => ({ success: true, action: 'execute', data: { event: 'new-workspace' } }),
    });

    this.registerCommand({
      id: 'new-note',
      name: 'new-note',
      description: 'Create a new note',
      enabled: true,
      category: 'utility',
      icon: 'fa-file-alt',
      aliases: ['note:new'],
      handler: async () => ({ success: true, action: 'execute', data: { event: 'new-note' } }),
    });

    this.registerCommand({
      id: 'new-agent',
      name: 'new-agent',
      description: 'Start a new agent chat',
      enabled: true,
      category: 'utility',
      icon: 'fa-comment-dots',
      aliases: ['agent:new', 'chat:new'],
      handler: async () => ({ success: true, action: 'execute', data: { event: 'new-agent' } }),
    });

    this.registerCommand({
      id: 'new-terminal',
      name: 'new-terminal',
      description: 'Open a new terminal',
      enabled: true,
      category: 'utility',
      icon: 'fa-terminal',
      aliases: ['terminal:new'],
      handler: async () => ({ success: true, action: 'execute', data: { event: 'new-terminal' } }),
    });

    this.registerCommand({
      id: 'search-files',
      name: 'search-files',
      description: 'Quick open files',
      enabled: true,
      category: 'navigation',
      icon: 'fa-search',
      aliases: ['files', 'open'],
      handler: async () => ({
        success: true,
        action: 'execute',
        data: { type: 'open-palette', mode: 'file' },
      }),
    });

    this.registerCommand({
      id: 'search-workspace',
      name: 'search-workspace',
      description: 'Search within files',
      enabled: true,
      category: 'navigation',
      icon: 'fa-search',
      aliases: ['ripgrep', 'grep'],
      handler: async () => ({
        success: true,
        action: 'execute',
        data: { type: 'open-palette', mode: 'search' },
      }),
    });

    this.registerCommand({
      id: 'command-palette',
      name: 'command-palette',
      description: 'Open the command palette',
      enabled: true,
      category: 'system',
      icon: 'fa-slash',
      aliases: ['palette', 'cmd'],
      handler: async () => ({
        success: true,
        action: 'execute',
        data: { type: 'open-palette', mode: 'command' },
      }),
    });
  }
}

// Singleton instance
export const commandRegistry = new CommandRegistry();
