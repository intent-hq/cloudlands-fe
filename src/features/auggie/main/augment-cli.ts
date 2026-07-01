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
import { hostExec } from '../../../shared/main/host-exec';
import { hostExecStream, type HostExecStreamHandle } from '../../../shared/main/host-exec-stream';

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
  private activeProcesses: Map<string, HostExecStreamHandle>;
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
    // Route through the daemon's buffered one-shot exec (`host.exec`, PROTOCOL
    // §5.14). No local shell, no argv splitting — the daemon owns the process
    // group and honours the enriched PATH the host reports.
    const auggiePath = await this.getAuggiePath();
    const result = await hostExec(auggiePath, {
      args: [command, ...args],
      ...(cwd ? { cwd } : {}),
    });
    if (result.exitCode !== 0) {
      throw new Error(`Command failed with code ${result.exitCode}: ${result.stderr}`);
    }
    return { success: true, output: result.stdout };
  }

  async streamChat(
    message: string,
    context: ChatContext,
    onChunk: (chunk: string) => void,
    signal?: AbortSignal,
    timeoutMs: number = 60000, // Default 60 second timeout
  ): Promise<StreamResponse> {
    // Route through the daemon's streaming exec (`host.execStream`, PROTOCOL
    // §5.14). The initial `stdin` ships the prompt with the request payload;
    // a follow-up `write { eof: true }` closes stdin so the reader-to-EOF
    // `auggie --print` exits cleanly.
    const auggiePath = await this.getAuggiePath();

    // Use --print mode for piped input support (without --quiet to show tool calls)
    const args = ['--print'];
    if (context.skipMcp) {
      args.push('--mcp-config', '{"mcpServers":{}}');
    }

    let fullPrompt = message;
    if (context.systemPrompt) {
      fullPrompt = `System: ${context.systemPrompt}\n\n${message}`;
    }

    const processKey = `${context.workspaceId}:${context.agentId}`;
    const workspacePath = (context as any).workspacePath as string | undefined;

    // The daemon enforces `cwd` ⇒ `workspaceId` containment (PROTOCOL §5.14); if a
    // caller supplied a bare `workspacePath` without a `workspaceId` (e.g. the
    // setup-scripts flow that runs against an unregistered repo), we drop `cwd`
    // rather than trip a `-32602`. The auggie prompt still carries the path in
    // its context message, so the LLM sees where the repo lives.
    const cwdArgs: { cwd?: string; workspaceId?: string } = {};
    if (workspacePath && context.workspaceId) {
      cwdArgs.cwd = workspacePath;
      cwdArgs.workspaceId = context.workspaceId;
    } else if (workspacePath) {
      this.logger.debug('streamChat: dropping cwd (no workspaceId for containment)', {
        workspacePath,
      });
    }

    let fullContent = '';
    let buffer = '';
    const toolCalls: any[] = [];
    let currentToolCall: any = null;
    let responseStarted = false;

    const consumeLine = (line: string): void => {
      const cleanLine = this.removeAnsiCodes(line).trim();
      if (!cleanLine) {
        onChunk(`${line}\n`);
        fullContent += (fullContent ? '\n' : '') + line;
        return;
      }
      if (cleanLine.startsWith('🔧 Tool call:')) {
        const toolName = cleanLine.replace('🔧 Tool call:', '').trim();
        currentToolCall = {
          id: `tool_${Date.now()}`,
          name: toolName,
          input: {},
          status: 'pending',
        };
        toolCalls.push(currentToolCall);
        return;
      }
      if (cleanLine.startsWith('📋 Tool result:')) {
        if (currentToolCall) {
          currentToolCall.status = 'completed';
          currentToolCall.output = '';
        }
        return;
      }
      if (cleanLine === '🤖') {
        currentToolCall = null;
        responseStarted = true;
        return;
      }
      if (currentToolCall && currentToolCall.status === 'pending' && cleanLine.includes(':')) {
        const [key, ...valueParts] = cleanLine.split(':');
        const value = valueParts.join(':').trim();
        currentToolCall.input[key.trim()] = value;
        return;
      }
      if (currentToolCall && currentToolCall.status === 'completed') {
        if (currentToolCall.output) {
          currentToolCall.output += `\n${cleanLine}`;
        } else {
          currentToolCall.output = cleanLine;
        }
        return;
      }
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
        fullContent += (fullContent ? '\n' : '') + line;
      }
    };

    let handle;
    try {
      handle = await hostExecStream(auggiePath, {
        args,
        env: { PYTHONUNBUFFERED: '1' },
        ...cwdArgs,
        timeoutMs,
        stdin: fullPrompt,
        ...(signal ? { signal } : {}),
        onStdout: (chunk: Buffer) => {
          buffer += chunk.toString('utf8');
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) consumeLine(line);
        },
        onStderr: (chunk: Buffer) => {
          this.logger.error('Auggie stderr:', new Error(chunk.toString('utf8')));
        },
      });
    } catch (error) {
      // Honest degradation: RPC failed (transport down or events.subscribe error).
      // Mirrors the old spawn `error` event surfacing the raw error to the caller.
      throw error instanceof Error ? error : new Error(String(error));
    }

    this.activeProcesses.set(processKey, handle);

    // Close the child's stdin so `auggie --print` reads to EOF and exits cleanly.
    // A failed write is non-fatal — the child may have already exited; `done`
    // still settles from the terminal `host:exec:exit` frame.
    try {
      await handle.endStdin();
    } catch (error) {
      this.logger.debug('host.execStream.write { eof:true } failed (child may have exited)', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    let exitResult;
    try {
      exitResult = await handle.done;
    } catch (error) {
      this.activeProcesses.delete(processKey);
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('aborted')) {
        throw new Error('Generation aborted');
      }
      throw error instanceof Error ? error : new Error(msg);
    }
    this.activeProcesses.delete(processKey);

    // Drain any tail bytes without a terminating newline (mirrors the old
    // `close`-handler buffer flush before the FS-settle delay).
    if (buffer) {
      fullContent += (fullContent ? '\n' : '') + buffer;
      onChunk(buffer);
      buffer = '';
    }

    if (exitResult.timedOut) {
      this.logger.warn('streamChat timed out', { timeoutMs, processKey });
      throw new Error(`Chat request timed out after ${timeoutMs}ms`);
    }
    if (exitResult.cancelled) {
      throw new Error('Generation aborted');
    }
    if (!exitResult.ok) {
      const exitCode = exitResult.exitCode ?? null;
      throw new Error(`Auggie process exited with code ${exitCode}`);
    }

    // Preserve the 500ms FS-settle delay from the old spawn path — prevents
    // race conditions where the caller reloads before the child's writes land.
    await new Promise((r) => setTimeout(r, 500));

    return {
      content: this.cleanAgentMessage(fullContent),
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    };
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
    // Fire cancel RPCs for every in-flight stream; errors are logged inside
    // `hostExecStream` so we intentionally do not await here.
    for (const [, stream] of this.activeProcesses) {
      void stream.cancel().catch(() => {
        /* logged inside hostExecStream */
      });
    }
    this.activeProcesses.clear();
  }
}
