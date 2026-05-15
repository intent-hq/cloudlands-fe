import {
  spawn,
  ChildProcess,
} from 'child_process';
import { EventEmitter } from '$shared/utils/event-emitter';
import { homedir } from 'os';
import { join } from 'path';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { Logger } from '$shared/logger';
import {
  findAuggieAsync,
  existsAsync,
} from '../../../shared/main/async-utils';

interface StreamResponse {
  content: string;
  tool_calls?: any[];
}

interface ChatContext {
  model?: string;
  systemPrompt?: string;
  history?: any[];
  workspaceId?: string;
  agentId?: string;
  skipMcp?: boolean; // Skip MCP server initialization for faster simple requests
}

export class AugmentCLI extends EventEmitter {
  private auggiePath: string | null = null;
  private auggiePathPromise: Promise<string> | null = null;
  private tokenPath: string;
  private activeProcesses: Map<string, ChildProcess>;
  private logger: Logger;

  constructor() {
    super();
    this.logger = new Logger('AugmentCLI');
    // PERF: Lazy async initialization - don't block constructor
    this.tokenPath = join(homedir(), '.augment', 'token');
    this.activeProcesses = new Map();
  }

  /**
   * Get auggie path with lazy async initialization
   * PERF: Uses async lookup to avoid blocking main thread
   */
  private async getAuggiePath(): Promise<string> {
    // Return cached path if already resolved
    if (this.auggiePath) {
      return this.auggiePath;
    }

    // Use existing promise if already in flight
    if (this.auggiePathPromise) {
      return this.auggiePathPromise;
    }

    // Start async lookup
    this.auggiePathPromise = this.findAuggiePathAsync();
    this.auggiePath = await this.auggiePathPromise;
    return this.auggiePath;
  }

  /**
   * Find auggie path asynchronously
   * PERF: Replaced synchronous execSync with async alternatives
   */
  private async findAuggiePathAsync(): Promise<string> {
    // Try using the shared async utility first
    const foundPath = await findAuggieAsync();
    if (foundPath) {
      this.logger.debug('Found auggie at:', { path: foundPath });
      return foundPath;
    }

    // Try common npm global locations (async, platform-specific)
    const commonPaths: string[] = [];
    if (process.platform === 'win32') {
      const appData = process.env.APPDATA || '';
      if (appData) {
        commonPaths.push(`${appData}\\npm\\auggie.cmd`);
        commonPaths.push(`${appData}\\npm\\auggie`);
      }
      commonPaths.push(`${homedir()}\\.npm-global\\auggie.cmd`);
      commonPaths.push(`${homedir()}\\.npm-global\\auggie`);
      if (process.env.LOCALAPPDATA) {
        commonPaths.push(`${process.env.LOCALAPPDATA}\\Volta\\bin\\auggie.exe`);
      }
    } else {
      commonPaths.push(
        '/usr/local/bin/auggie',
        '/opt/homebrew/bin/auggie',
        `${homedir()}/.npm-global/bin/auggie`,
        `${homedir()}/.local/bin/auggie`,
        `${homedir()}/.cargo/bin/auggie`,
      );
    }

    for (const path of commonPaths) {
      if (await existsAsync(path)) {
        this.logger.debug('Found auggie at common location:', { path });
        return path;
      }
    }

    // Fall back to just "auggie" and let the shell resolve it
    this.logger.debug("Using 'auggie' from PATH");
    return 'auggie';
  }

  private async getToken(): Promise<string | null> {
    if (existsSync(this.tokenPath)) {
      const token = await readFile(this.tokenPath, 'utf-8');
      return token.trim();
    }
    return null;
  }

  async isAvailable(): Promise<boolean> {
    try {
      this.logger.debug('Checking if auggie is available...');
      const result = await this.executeCommand('--version', []);
      // Check if we got a version output (should contain version number and commit hash)
      const isAvailable =
        result.success &&
        (result.output.includes('auggie') ||
          result.output.includes('commit') ||
          /\d+\.\d+\.\d+/.test(result.output)); // Check for version pattern like 0.5.8
      this.logger.debug('Auggie available:', { isAvailable, output: result.output });
      return isAvailable;
    } catch (error) {
      this.logger.debug('Auggie not available, error:', { error });
      return false;
    }
  }

  async getVersion(): Promise<string | null> {
    try {
      const result = await this.executeCommand('--version', []);
      if (result.success) {
        // Extract version from output like "auggie version 1.0.0"
        const match = result.output.match(/version\s+([\d.]+)/i);
        return match ? match[1] : result.output.trim();
      }
      return null;
    } catch  {
      return null;
    }
  }

  async executeCommand(command: string, args: string[], cwd?: string): Promise<any> {
    // PERF: Get auggie path asynchronously before spawning
    const auggiePath = await this.getAuggiePath();

    return new Promise((resolve, reject) => {
      // Create environment with full shell access
      const env = { ...process.env };

      // On Windows, use shell: true (handles .cmd/.bat files and resolves commands via cmd.exe).
      // On Unix, use user's default shell.
      const shellOption: string | boolean =
        process.platform === 'win32' ? true : (process.env.SHELL || '/bin/bash');

      // On Windows with shell: true, quote the path to handle spaces (e.g. C:\Users\John Doe\...)
      const spawnCommand = process.platform === 'win32' ? `"${auggiePath}"` : auggiePath;

      const childProcess = spawn(spawnCommand, [command, ...args], {
        cwd: cwd || process.cwd(),
        env,
        shell: shellOption,
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';

      childProcess.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      childProcess.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      childProcess.on('close', (code: number | null) => {
        if (code === 0) {
          resolve({ success: true, output: stdout });
        } else {
          reject(new Error(`Command failed with code ${code}: ${stderr}`));
        }
      });

      childProcess.on('error', (error: Error) => {
        reject(error);
      });
    });
  }

  async streamChat(
    message: string,
    context: ChatContext,
    onChunk: (chunk: string) => void,
    signal?: AbortSignal,
    timeoutMs: number = 60000, // Default 60 second timeout
  ): Promise<StreamResponse> {
    // PERF: Get auggie path asynchronously before spawning
    const auggiePath = await this.getAuggiePath();

    return new Promise((resolve, reject) => {
      // Use --print mode for piped input support (without --quiet to show tool calls)
      const args = ['--print'];

      // Skip MCP server initialization for faster simple requests (like prompt enhancement)
      if (context.skipMcp) {
        args.push('--mcp-config', '{"mcpServers":{}}');
      }

      // Build the full prompt with context
      let fullPrompt = message;
      if (context.systemPrompt) {
        fullPrompt = `System: ${context.systemPrompt}\n\n${message}`;
      }

      const childProcess = spawn(auggiePath, args, {
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
        cwd: (context as any).workspacePath || process.cwd(),
        windowsHide: true,
      });

      const processKey = `${context.workspaceId}:${context.agentId}`;
      this.activeProcesses.set(processKey, childProcess);

      let fullContent = '';
      let buffer = '';
      const toolCalls: any[] = [];
      let currentToolCall: any = null;

      let responseStarted = false;
      let hasResolved = false;

      // Cleanup function to handle abort handler and timeout
      const cleanup = () => {
        if (signal && abortHandler) {
          signal.removeEventListener('abort', abortHandler);
        }
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      };

      // Set up timeout to prevent infinite hanging
      const timeoutId = setTimeout(() => {
        if (!hasResolved) {
          hasResolved = true;
          this.logger.warn('streamChat timed out', { timeoutMs, processKey });
          childProcess.kill('SIGTERM');
          this.activeProcesses.delete(processKey);
          cleanup();
          reject(new Error(`Chat request timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      // Handle abort signal
      let abortHandler: (() => void) | null = null;
      if (signal) {
        abortHandler = () => {
          if (!hasResolved) {
            hasResolved = true;
            childProcess.kill('SIGTERM');
            this.activeProcesses.delete(processKey);
            cleanup();
            reject(new Error('Generation aborted'));
          }
        };
        signal.addEventListener('abort', abortHandler);
      }

      childProcess.stdout.on('data', (data: Buffer) => {
        const text = data.toString();
        buffer += text;

        // Process line by line
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          const cleanLine = this.removeAnsiCodes(line).trim();

          // Skip empty lines
          if (!cleanLine) {
            onChunk(`${line}\n`);
            fullContent += (fullContent ? '\n' : '') + line;
            continue;
          }

          // Detect tool call markers
          if (cleanLine.startsWith('🔧 Tool call:')) {
            const toolName = cleanLine.replace('🔧 Tool call:', '').trim();
            currentToolCall = {
              id: `tool_${Date.now()}`,
              name: toolName,
              input: {},
              status: 'pending',
            };
            toolCalls.push(currentToolCall);
            continue;
          }

          // Detect tool result markers
          if (cleanLine.startsWith('📋 Tool result:')) {
            if (currentToolCall) {
              currentToolCall.status = 'completed';
              currentToolCall.output = '';
            }
            continue;
          }

          // Detect robot emoji delimiter (separates tool output from response)
          if (cleanLine === '🤖') {
            currentToolCall = null;
            responseStarted = true;
            continue;
          }

          // Collect tool input parameters
          if (currentToolCall && currentToolCall.status === 'pending' && cleanLine.includes(':')) {
            const [key, ...valueParts] = cleanLine.split(':');
            const value = valueParts.join(':').trim();
            currentToolCall.input[key.trim()] = value;
            continue;
          }

          // Collect tool output
          if (currentToolCall && currentToolCall.status === 'completed') {
            if (currentToolCall.output) {
              currentToolCall.output += `\n${cleanLine}`;
            } else {
              currentToolCall.output = cleanLine;
            }
            continue;
          }

          // Regular content - only stream after response has started (after 🤖 delimiter)
          // and skip tool-related lines
          if (
            responseStarted &&
            !cleanLine.startsWith('🔧') &&
            !cleanLine.startsWith('📋') &&
            !cleanLine.startsWith('Tool call:') &&
            !cleanLine.startsWith('Tool result:')
          ) {
            fullContent += (fullContent ? '\n' : '') + line;
            onChunk(`${line}\n`);
          } else if (responseStarted) {
            // Still add to fullContent even if we don't stream it
            fullContent += (fullContent ? '\n' : '') + line;
          }
        }
      });

      childProcess.stderr.on('data', (data: Buffer) => {
        this.logger.error('Auggie stderr:', new Error(data.toString()));
      });

      childProcess.on('close', (code: number | null) => {
        if (hasResolved) return; // Already resolved by timeout or abort
        this.activeProcesses.delete(processKey);

        // Process any remaining buffer
        if (buffer) {
          fullContent += (fullContent ? '\n' : '') + buffer;
          onChunk(buffer);
        }

        // Add a small delay to ensure file system changes are fully persisted
        // This prevents race conditions where the page reloads before files are written
        setTimeout(() => {
          if (hasResolved) return; // Check again after delay
          hasResolved = true;
          cleanup();

          if (code === 0) {
            resolve({
              content: this.cleanAgentMessage(fullContent),
              tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
            });
          } else {
            reject(new Error(`Auggie process exited with code ${code}`));
          }
        }, 500); // 500ms delay to ensure file system changes are persisted
      });

      childProcess.on('error', (error: Error) => {
        if (hasResolved) return; // Already resolved
        hasResolved = true;
        this.activeProcesses.delete(processKey);
        cleanup();
        reject(error);
      });

      // Handle stdin EPIPE errors (child process may exit before consuming all input)
      childProcess.stdin.on('error', (error) => {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes('EPIPE')) {
          // Benign: child process exited before reading all stdin data
          this.logger.debug('Stdin EPIPE (child exited before consuming input)');
        } else {
          this.logger.error('Stdin error:', error);
        }
      });

      // Send the message to the child process's stdin
      childProcess.stdin.write(fullPrompt);
      childProcess.stdin.end();
    });
  }

  private removeAnsiCodes(text: string): string {
    // Remove ANSI escape codes
    return text.replace(/\u001b\[[0-9;]*m/g, '');
  }

  private cleanAgentMessage(content: string): string {
    if (!content) return '';

    let cleaned = content;

    // Remove ANSI escape codes
    cleaned = this.removeAnsiCodes(cleaned);

    // Split by robot emoji to separate tool execution from response
    const parts = cleaned.split('🤖');
    if (parts.length > 1) {
      // Return only the part after the robot emoji (the actual response)
      cleaned = parts[parts.length - 1].trim();
    } else {
      // If no robot emoji, try to clean tool markers manually
      const lines = cleaned.split('\n');
      const cleanedLines: string[] = [];
      let skipNextLines = false;
      let inToolSection = false;

      for (const line of lines) {
        const trimmed = line.trim();

        // Detect tool call markers (with or without emoji)
        if (
          trimmed.startsWith('🔧 Tool call:') ||
          trimmed.startsWith('Tool call:') ||
          trimmed.startsWith('📋 Tool result:') ||
          trimmed.startsWith('Tool result:')
        ) {
          inToolSection = true;
          skipNextLines = true;
          continue;
        }

        // Skip lines that look like tool parameters (indented or key:value format)
        if (
          inToolSection &&
          (line.startsWith('   ') ||
            line.startsWith('\t') ||
            (trimmed.includes(':') && !trimmed.startsWith('#')))
        ) {
          continue;
        }

        // Stop skipping after empty line following tool section
        if (inToolSection && trimmed === '') {
          inToolSection = false;
          skipNextLines = false;
          continue;
        }

        if (!skipNextLines) {
          cleanedLines.push(line);
        }
      }

      cleaned = cleanedLines.join('\n');
    }

    // Remove common output artifacts
    cleaned = cleaned
      .replace(/Here's the result of running.*?\n/g, '')
      .replace(/Here's the files? and directories.*?\n/g, '')
      .replace(/Here's the content.*?\n/g, '')
      .replace(/\.\.\. \(\d+ more lines?\)/g, '')
      .replace(/^Created (?:note|file|workspace):.*?\n/gm, '')
      .replace(/^Updated (?:note|file|workspace):.*?\n/gm, '')
      .replace(/^Successfully (?:edited|created|deleted|modified).*?\n/gm, '')
      .replace(/^Result for\s+\w+.*?\n/gm, '')
      .replace(/^Total lines in file:.*?\n/gm, '');

    return cleaned.trim();
  }

  stopAllProcesses(): void {
    for (const [, process] of this.activeProcesses) {
      process.kill('SIGTERM');
    }
    this.activeProcesses.clear();
  }
}
