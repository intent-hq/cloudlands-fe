/**
 * Script MCP tools for agent interaction with workspace scripts.
 *
 * Provides tools to list, create, remove, start, stop, restart scripts,
 * read script output, get script status, and run command-mode scripts.
 */

import { v4 as uuidv4 } from 'uuid';
import { BaseMCPTool, createInputSchema, stringProperty, numberProperty } from './tool';
import type { ToolCall, ToolResult } from './protocol';
import { getScriptProcessManager } from '../../../scripts/main/script-process-manager';
import type { WorkspaceScript } from '../../../scripts/types';
import {
  readScripts,
  upsertScript,
  removeScript as removeScriptFromDisk,
} from '../../../scripts/main/scripts-persistence';
import { Logger } from '$shared/logger';
// onDomainEvent('script:stopped') replaced with polling-based waiting

const logger = new Logger('ScriptTools');

// ============================================================================
// ListScriptsTool
// ============================================================================

export class ListScriptsTool extends BaseMCPTool {
  private workspaceId: string;

  constructor(workspaceId: string) {
    super(
      'list_scripts',
      'List all workspace scripts with their definitions and runtime status. Returns script name, command, mode (service/command), category, and current status (idle/running/exited).',
      createInputSchema({}, []),
    );
    this.workspaceId = workspaceId;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async execute(_call: ToolCall): Promise<ToolResult> {
    try {
      const scripts = await readScripts(this.workspaceId);
      if (scripts.length === 0) {
        return this.success('No scripts defined in this workspace.');
      }

      let manager: ReturnType<typeof getScriptProcessManager> | null = null;
      try {
        manager = getScriptProcessManager(this.workspaceId);
      } catch {
        // Manager not initialized — runtime status unavailable
      }

      const result = scripts.map((s) => {
        const state = manager?.getState(s.id);
        return {
          id: s.id,
          name: s.name,
          command: s.command,
          cwd: s.cwd,
          mode: s.mode,
          category: s.category,
          source: s.source,
          autoStart: s.autoStart,
          status: state?.status ?? 'idle',
          pid: state?.pid,
          exitCode: state?.exitCode,
          detectedUrl: state?.detectedUrl,
        };
      });

      return this.success(JSON.stringify(result, null, 2));
    } catch (error) {
      logger.error('[ListScriptsTool] Failed:', error as Error);
      return this.error(`Failed to list scripts: ${(error as Error).message}`);
    }
  }
}

// ============================================================================
// CreateScriptTool
// ============================================================================

export class CreateScriptTool extends BaseMCPTool {
  private workspaceId: string;

  constructor(workspaceId: string) {
    super(
      'create_script',
      'Create or update a workspace script. Provide a name, command, and mode (service or command). Services run continuously and auto-restart; commands run once to completion. Returns the script ID.',
      createInputSchema(
        {
          name: stringProperty('Human-readable name for the script (e.g., "Dev Server", "Type Check")'),
          command: stringProperty('Shell command to execute (e.g., "npm run dev", "npx tsc --noEmit")'),
          mode: stringProperty('Script mode: "service" (long-running, auto-restart) or "command" (run once)', { enum: ['service', 'command'] }),
          cwd: stringProperty('Working directory relative to workspace root (optional)'),
          env: { type: 'object', description: 'Environment variables to set as key-value string pairs (optional)' },
          category: stringProperty('Script category (optional)', { enum: ['dev', 'build', 'test', 'lint', 'typecheck', 'format', 'storybook', 'other'] }),
          autoStart: { type: 'boolean', description: 'Auto-start when workspace opens (services only, default: false)' },
          scriptId: stringProperty('Existing script ID to update (optional — omit to create new)'),
        },
        ['name', 'command', 'mode'],
      ),
    );
    this.workspaceId = workspaceId;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const { name, command, mode, cwd, category, autoStart, scriptId, env } = call.arguments;

      if (!name || !command || !mode) {
        return this.error('name, command, and mode are required.');
      }
      if (mode !== 'service' && mode !== 'command') {
        return this.error('mode must be "service" or "command".');
      }

      const now = new Date().toISOString();
      const id = scriptId || uuidv4();

      // When updating, preserve existing source and createdAt
      let existingSource: WorkspaceScript['source'] = 'user';
      let existingCreatedAt = now;
      if (scriptId) {
        const scripts = await readScripts(this.workspaceId);
        const existing = scripts.find((s) => s.id === scriptId);
        if (existing) {
          existingSource = existing.source;
          existingCreatedAt = existing.createdAt;
        }
      }

      const script: WorkspaceScript = {
        id,
        workspaceId: this.workspaceId,
        name,
        command,
        mode,
        source: existingSource,
        createdAt: existingCreatedAt,
        ...(cwd && { cwd }),
        ...(env && { env }),
        ...(category && { category }),
        ...(autoStart !== undefined && { autoStart }),
        ...(scriptId && { updatedAt: now }),
      };

      await upsertScript(this.workspaceId, script);
      const action = scriptId ? 'updated' : 'created';
      return this.success(`Script "${name}" ${action} with ID: ${id}`, { scriptId: id });
    } catch (error) {
      logger.error('[CreateScriptTool] Failed:', error as Error);
      return this.error(`Failed to create script: ${(error as Error).message}`);
    }
  }
}

// ============================================================================
// RemoveScriptTool
// ============================================================================

export class RemoveScriptTool extends BaseMCPTool {
  private workspaceId: string;

  constructor(workspaceId: string) {
    super(
      'remove_script',
      'Remove a script from the workspace. Stops it first if running.',
      createInputSchema({ scriptId: stringProperty('The ID of the script to remove') }, ['scriptId']),
    );
    this.workspaceId = workspaceId;
  }


  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const { scriptId } = call.arguments;
      if (!scriptId) return this.error('scriptId is required.');

      // Stop if running
      try {
        const manager = getScriptProcessManager(this.workspaceId);
        await manager.remove(scriptId);
      } catch {
        // Manager not initialized — just remove from disk
      }

      const removed = await removeScriptFromDisk(this.workspaceId, scriptId);
      if (!removed) return this.error(`Script not found: ${scriptId}`);
      return this.success(`Script ${scriptId} removed.`);
    } catch (error) {
      logger.error('[RemoveScriptTool] Failed:', error as Error);
      return this.error(`Failed to remove script: ${(error as Error).message}`);
    }
  }
}

// ============================================================================
// StartScriptTool
// ============================================================================

export class StartScriptTool extends BaseMCPTool {
  private workspaceId: string;

  constructor(workspaceId: string) {
    super(
      'start_script',
      'Start a script by ID. The script must already be created. For services, it runs continuously. For commands, it runs once.',
      createInputSchema({ scriptId: stringProperty('The ID of the script to start') }, ['scriptId']),
    );
    this.workspaceId = workspaceId;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const { scriptId } = call.arguments;
      if (!scriptId) return this.error('scriptId is required.');

      const scripts = await readScripts(this.workspaceId);
      const script = scripts.find((s) => s.id === scriptId);
      if (!script) return this.error(`Script not found: ${scriptId}`);

      const manager = getScriptProcessManager(this.workspaceId);
      manager.start(script);
      return this.success(`Script "${script.name}" started.`);
    } catch (error) {
      logger.error('[StartScriptTool] Failed:', error as Error);
      return this.error(`Failed to start script: ${(error as Error).message}`);
    }
  }
}

// ============================================================================
// StopScriptTool
// ============================================================================

export class StopScriptTool extends BaseMCPTool {
  private workspaceId: string;

  constructor(workspaceId: string) {
    super(
      'stop_script',
      'Stop a running script by ID. Sends SIGTERM, then SIGKILL after timeout.',
      createInputSchema({ scriptId: stringProperty('The ID of the script to stop') }, ['scriptId']),
    );
    this.workspaceId = workspaceId;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const { scriptId } = call.arguments;
      if (!scriptId) return this.error('scriptId is required.');

      const manager = getScriptProcessManager(this.workspaceId);
      await manager.stop(scriptId);
      return this.success(`Script ${scriptId} stop requested.`);
    } catch (error) {
      logger.error('[StopScriptTool] Failed:', error as Error);
      return this.error(`Failed to stop script: ${(error as Error).message}`);
    }
  }
}

// ============================================================================
// RestartScriptTool
// ============================================================================

export class RestartScriptTool extends BaseMCPTool {
  private workspaceId: string;

  constructor(workspaceId: string) {
    super(
      'restart_script',
      'Restart a script by ID. Stops it first (if running), then starts it again.',
      createInputSchema({ scriptId: stringProperty('The ID of the script to restart') }, ['scriptId']),
    );
    this.workspaceId = workspaceId;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const { scriptId } = call.arguments;
      if (!scriptId) return this.error('scriptId is required.');

      const manager = getScriptProcessManager(this.workspaceId);
      await manager.restart(scriptId);
      return this.success(`Script ${scriptId} restarted.`);
    } catch (error) {
      logger.error('[RestartScriptTool] Failed:', error as Error);
      return this.error(`Failed to restart script: ${(error as Error).message}`);
    }
  }
}

// ============================================================================
// GetScriptOutputTool
// ============================================================================

export class GetScriptOutputTool extends BaseMCPTool {
  private workspaceId: string;

  constructor(workspaceId: string) {
    super(
      'get_script_output',
      'Get recent output from a script. Returns the last N lines from the output buffer (default 100). Useful for checking build errors, test results, or server logs.',
      createInputSchema(
        {
          scriptId: stringProperty('The ID of the script'),
          maxLines: numberProperty('Maximum number of lines to return (default: 100)', { default: 100 }),
        },
        ['scriptId'],
      ),
    );
    this.workspaceId = workspaceId;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const { scriptId, maxLines = 100 } = call.arguments;
      if (!scriptId) return this.error('scriptId is required.');

      const manager = getScriptProcessManager(this.workspaceId);
      const buffer = manager.getBuffer(scriptId);
      if (!buffer) return this.error(`Script not found or never started: ${scriptId}`);

      const lineCount = Math.max(1, Math.min(maxLines, 10000));
      const text = buffer.getLastText(lineCount);

      if (!text.trim()) {
        return this.success('No output yet.');
      }

      const allLines = buffer.getLines();
      const truncated = allLines.length > lineCount;
      const header = truncated
        ? `[showing last ${lineCount} of ${allLines.length} lines]`
        : `[${allLines.length} lines]`;

      return this.success(`${header}\n${text}`);
    } catch (error) {
      logger.error('[GetScriptOutputTool] Failed:', error as Error);
      return this.error(`Failed to get script output: ${(error as Error).message}`);
    }
  }
}

// ============================================================================
// GetScriptStatusTool
// ============================================================================

export class GetScriptStatusTool extends BaseMCPTool {
  private workspaceId: string;

  constructor(workspaceId: string) {
    super(
      'get_script_status',
      'Get the runtime status of a script. Returns status (idle/running/exited), PID, exit code, restart count, detected URL, and timing info.',
      createInputSchema({ scriptId: stringProperty('The ID of the script') }, ['scriptId']),
    );
    this.workspaceId = workspaceId;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const { scriptId } = call.arguments;
      if (!scriptId) return this.error('scriptId is required.');

      const manager = getScriptProcessManager(this.workspaceId);
      const state = manager.getState(scriptId);
      if (!state) return this.error(`Script not found or never started: ${scriptId}`);

      return this.success(JSON.stringify(state, null, 2));
    } catch (error) {
      logger.error('[GetScriptStatusTool] Failed:', error as Error);
      return this.error(`Failed to get script status: ${(error as Error).message}`);
    }
  }
}

// ============================================================================
// RunScriptTool
// ============================================================================

export class RunScriptTool extends BaseMCPTool {
  private workspaceId: string;

  constructor(workspaceId: string) {
    super(
      'run_script',
      'Start a command-mode script and wait for it to exit. Returns the exit code and last N lines of output. Use this for scripts that run to completion (builds, tests, linting). Times out after the specified duration.',
      createInputSchema(
        {
          scriptId: stringProperty('The ID of the script to run'),
          maxLines: numberProperty('Maximum output lines to return (default: 200)', { default: 200 }),
          timeoutSeconds: numberProperty('Maximum seconds to wait for completion (default: 300)', { default: 300 }),
        },
        ['scriptId'],
      ),
    );
    this.workspaceId = workspaceId;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const { scriptId, maxLines = 200, timeoutSeconds = 300 } = call.arguments;
      if (!scriptId) return this.error('scriptId is required.');

      const scripts = await readScripts(this.workspaceId);
      const script = scripts.find((s) => s.id === scriptId);
      if (!script) return this.error(`Script not found: ${scriptId}`);

      // Warn if this is a service (long-running) — agent should use start_script instead
      if (script.mode === 'service') {
        return this.success(
          `Warning: "${script.name}" is a long-running service. Use start_script instead of run_script for services. run_script is designed for commands that run to completion (builds, tests, etc.). If you still want to proceed, change the script mode to "command" first.`,
          { warning: 'service_mode', scriptId },
        );
      }

      const manager = getScriptProcessManager(this.workspaceId);

      // Start the script
      manager.start(script);

      // Wait for exit or timeout
      const timeoutMs = Math.max(1, Math.min(timeoutSeconds, 3600)) * 1000;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const startTime = Date.now();

      const exitState = await new Promise<'exited' | 'timeout'>((resolve) => {
        let settled = false;

        // Poll the script manager's state to detect when the script exits.
        // Previously used onDomainEvent('script:stopped'), now script:stopped
        // is dispatched as a Redux action — polling the manager state is simpler
        // and more reliable for in-process waiting.
        const pollInterval = setInterval(() => {
          if (settled) return;
          const currentState = manager.getState(scriptId);
          if (!currentState || currentState.status !== 'running') {
            settled = true;
            clearInterval(pollInterval);
            clearTimeout(timer);
            resolve('exited');
          }
        }, 200);

        // Safety-net timeout
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          clearInterval(pollInterval);
          resolve('timeout');
        }, timeoutMs);

        // Check if the script already exited before polling started
        const currentState = manager.getState(scriptId);
        if (!currentState || currentState.status !== 'running') {
          if (!settled) {
            settled = true;
            clearInterval(pollInterval);
            clearTimeout(timer);
            resolve('exited');
          }
        }
      });

      const state = manager.getState(scriptId);
      const buffer = manager.getBuffer(scriptId);
      const lineCount = Math.max(1, Math.min(maxLines, 10000));
      const output = buffer ? buffer.getLastText(lineCount) : '';

      if (exitState === 'timeout') {
        return this.success(
          `Script timed out after ${timeoutSeconds}s (still running).\n\nOutput:\n${output}`,
          { timedOut: true, status: state?.status },
        );
      }

      const exitCode = state?.exitCode ?? null;
      const header = `Exit code: ${exitCode}`;
      return this.success(`${header}\n\n${output}`, { exitCode });
    } catch (error) {
      logger.error('[RunScriptTool] Failed:', error as Error);
      return this.error(`Failed to run script: ${(error as Error).message}`);
    }
  }
}