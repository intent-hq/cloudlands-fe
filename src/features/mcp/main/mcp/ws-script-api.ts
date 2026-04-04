import { v4 as uuidv4 } from 'uuid';

import { Logger } from '$shared/logger';

import { getScriptProcessManager } from '../../../scripts/main/script-process-manager';
import {
  readScripts,
  upsertScript,
  removeScript as removeScriptFromDisk,
} from '../../../scripts/main/scripts-persistence';
import type { ScriptCategory, ScriptMode, WorkspaceScript } from '../../../scripts/types';

const logger = new Logger('WsScriptApi');

export interface CreateScriptOptions {
  cwd?: string;
  env?: Record<string, string>;
  category?: ScriptCategory;
  autoStart?: boolean;
  scriptId?: string;
}

export interface RunScriptOptions {
  maxLines?: number;
  timeout?: number;
  timeoutSeconds?: number;
}

function clampLineCount(maxLines: number | undefined, fallback: number): number {
  return Math.max(1, Math.min(maxLines ?? fallback, 10_000));
}

async function getScriptOrThrow(workspaceId: string, scriptId: string): Promise<WorkspaceScript> {
  const scripts = await readScripts(workspaceId);
  const script = scripts.find((candidate) => candidate.id === scriptId);
  if (!script) {
    throw new Error(`Script not found: ${scriptId}`);
  }
  return script;
}

export function buildScriptApi(workspaceId: string) {
  return {
    async list() {
      logger.info('[ws.script.list] Listing scripts', { workspaceId });

      const scripts = await readScripts(workspaceId);
      let manager: ReturnType<typeof getScriptProcessManager> | null = null;

      try {
        manager = getScriptProcessManager(workspaceId);
      } catch {
        // Manager not initialized — runtime status unavailable
      }

      return scripts.map((script) => {
        const state = manager?.getState(script.id);
        return {
          id: script.id,
          name: script.name,
          command: script.command,
          cwd: script.cwd,
          mode: script.mode,
          category: script.category,
          source: script.source,
          autoStart: script.autoStart,
          status: state?.status ?? 'idle',
          pid: state?.pid,
          exitCode: state?.exitCode,
          detectedUrl: state?.detectedUrl,
        };
      });
    },

    async create(name: string, command: string, mode: ScriptMode, options: CreateScriptOptions = {}) {
      logger.info('[ws.script.create] Creating or updating script', { workspaceId, name, mode, scriptId: options.scriptId });

      if (!name || !command || !mode) {
        throw new Error('name, command, and mode are required.');
      }
      if (mode !== 'service' && mode !== 'command') {
        throw new Error('mode must be "service" or "command".');
      }

      const now = new Date().toISOString();
      const id = options.scriptId || uuidv4();
      let existingSource: WorkspaceScript['source'] = 'user';
      let existingCreatedAt = now;

      if (options.scriptId) {
        const existing = (await readScripts(workspaceId)).find((script) => script.id === options.scriptId);
        if (existing) {
          existingSource = existing.source;
          existingCreatedAt = existing.createdAt;
        }
      }

      const script: WorkspaceScript = {
        id,
        workspaceId,
        name,
        command,
        mode,
        source: existingSource,
        createdAt: existingCreatedAt,
        ...(options.cwd && { cwd: options.cwd }),
        ...(options.env && { env: options.env }),
        ...(options.category && { category: options.category }),
        ...(options.autoStart !== undefined && { autoStart: options.autoStart }),
        ...(options.scriptId && { updatedAt: now }),
      };

      await upsertScript(workspaceId, script);
      return { id };
    },

    async remove(scriptId: string) {
      logger.info('[ws.script.remove] Removing script', { workspaceId, scriptId });

      try {
        await getScriptProcessManager(workspaceId).remove(scriptId);
      } catch {
        // Manager not initialized — just remove from disk
      }

      const removed = await removeScriptFromDisk(workspaceId, scriptId);
      if (!removed) {
        throw new Error(`Script not found: ${scriptId}`);
      }

      return { ok: true };
    },

    async start(scriptId: string) {
      logger.info('[ws.script.start] Starting script', { workspaceId, scriptId });
      const script = await getScriptOrThrow(workspaceId, scriptId);
      getScriptProcessManager(workspaceId).start(script);
      return { ok: true };
    },

    async stop(scriptId: string) {
      logger.info('[ws.script.stop] Stopping script', { workspaceId, scriptId });
      await getScriptProcessManager(workspaceId).stop(scriptId);
      return { ok: true };
    },

    async restart(scriptId: string) {
      logger.info('[ws.script.restart] Restarting script', { workspaceId, scriptId });
      await getScriptProcessManager(workspaceId).restart(scriptId);
      return { ok: true };
    },

    async output(scriptId: string, maxLines = 100) {
      logger.info('[ws.script.output] Reading script output', { workspaceId, scriptId, maxLines });

      const manager = getScriptProcessManager(workspaceId);
      const buffer = manager.getBuffer(scriptId);
      if (!buffer) {
        throw new Error(`Script not found or never started: ${scriptId}`);
      }

      const lineCount = clampLineCount(maxLines, 100);
      const text = buffer.getLastText(lineCount);
      if (!text.trim()) {
        return 'No output yet.';
      }

      const allLines = buffer.getLines();
      const header = allLines.length > lineCount
        ? `[showing last ${lineCount} of ${allLines.length} lines]`
        : `[${allLines.length} lines]`;

      return `${header}\n${text}`;
    },

    async status(scriptId: string) {
      logger.info('[ws.script.status] Reading script status', { workspaceId, scriptId });

      const state = getScriptProcessManager(workspaceId).getState(scriptId);
      if (!state) {
        throw new Error(`Script not found or never started: ${scriptId}`);
      }

      return state;
    },

    async run(scriptId: string, options: RunScriptOptions = {}) {
      logger.info('[ws.script.run] Running command script', { workspaceId, scriptId, options });

      const script = await getScriptOrThrow(workspaceId, scriptId);
      if (script.mode === 'service') {
        return {
          warning: 'service_mode',
          scriptId,
          output: `Warning: "${script.name}" is a long-running service. Use ws.script.start() instead of ws.script.run() for services. If you still want to proceed, change the script mode to "command" first.`,
        };
      }

      const manager = getScriptProcessManager(workspaceId);
      manager.start(script);

      const timeoutSeconds = Math.max(1, Math.min(options.timeout ?? options.timeoutSeconds ?? 300, 3600));
      // Poll the script manager's state to detect when the script exits.
      // Previously used onDomainEvent('script:stopped'), now script:stopped
      // is dispatched as a Redux action — polling the manager state is simpler
      // and more reliable for in-process waiting.
      const exitState = await new Promise<'exited' | 'timeout'>((resolve) => {
        let settled = false;

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

        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          clearInterval(pollInterval);
          resolve('timeout');
        }, timeoutSeconds * 1000);

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
      const output = buffer ? buffer.getLastText(clampLineCount(options.maxLines, 200)) : '';

      if (exitState === 'timeout') {
        return { timedOut: true, status: state?.status, output };
      }

      return { exitCode: state?.exitCode ?? null, output };
    },
  };
}