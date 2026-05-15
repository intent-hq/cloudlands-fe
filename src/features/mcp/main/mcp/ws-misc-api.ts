import * as fs from 'fs/promises';
import * as Diff from 'diff';

import {
  executeBrowserActions,
  type ExecutionResult,
} from '../../../browser/main/browser.ipc';
import { assetsService } from '../../../notes/main/assets.service';
import { terminalManager } from '../../../terminal/main/terminal.ipc';
import {
  FileSystemWorkspaceRepository,
  type WorkspaceRepository,
} from '../../../workspace/main/workspace.repository';
import { getAttributionEngine } from '$features/workspace/main/provenance/attribution-engine';
import { sendToWorkspaceWindows } from '../../../system/main/system.ipc';
import { createWorkspaceEvent } from '$features/events/types';
import { mainDispatch } from '../../../../store/main/redux-store-bridge';
import { emitWorkspaceEvent } from '../../../../store/main/slices/workspace-events/workspace-events-slice';
import { Logger } from '$shared/logger';
import type { Workspace } from '$shared/types';
import type { WorkspaceId } from '$shared/types/branded-ids';
import type { ToolCall, ToolResult } from './protocol';
import { BrowserDocsTool } from './browser-tools';
import {
  type IFileSystemAdapter,
  LocalFileSystemAdapter,
} from './file-system-adapter';
import {
  emitAgentFileChange,
  trackFileOperation,
} from './workspace-file-tools';

const logger = new Logger('WorkspaceMiscApi');
const browserDocsTool = new BrowserDocsTool();
const defaultWorkspaceRepository = new FileSystemWorkspaceRepository();

interface WorkspaceManagerLike {
  getNote(workspaceId: string, noteId: string): Promise<any>;
  listNotes(workspaceId: string): Promise<any[]>;
}

interface CrossWorkspaceApiDeps {
  workspaceId: string;
  workspaceManager?: WorkspaceManagerLike;
  repository?: WorkspaceRepository;
}

interface FileApiDeps {
  workspaceId: string;
  workspacePath: string;
  call: ToolCall;
  fsAdapter?: IFileSystemAdapter;
}

function getTextContent(result: ToolResult): string {
  const text = result.content
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('\n');
  if (result.isError) {
    throw new Error(text || 'Tool execution failed');
  }
  return text;
}

function getAgentInfo(call: ToolCall) {
  return {
    id: call.context?.agentId || 'agent',
    name: call.context?.agentName || 'Agent',
  };
}

function numberLines(content: string): string {
  return content
    .split('\n')
    .map((line, index) => `${String(index + 1).padStart(4, ' ')} | ${line}`)
    .join('\n');
}

function safeBroadcastToWindows(channel: string, data: unknown, workspaceId?: string): void {
  try {
    sendToWorkspaceWindows(workspaceId, channel, data);
  } catch (error) {
    logger.warn('Failed to broadcast IPC message', {
      channel,
      error: (error as Error).message,
    });
  }
}

async function persistBrowserScreenshots(result: ExecutionResult, workspaceId?: string): Promise<void> {
  if (!workspaceId) return;

  for (const actionResult of result.results) {
    const screenshotData = actionResult.result as
      | { base64?: string; width?: number; height?: number }
      | undefined;
    if (actionResult.action !== 'screenshot' || !actionResult.success || !screenshotData?.base64) {
      continue;
    }

    try {
      const saved = await assetsService.saveAsset(
        workspaceId,
        screenshotData.base64,
        'image/jpeg',
        `screenshot-${Date.now()}.jpg`,
      );
      actionResult.result = {
        assetUrl: saved.url,
        width: screenshotData.width,
        height: screenshotData.height,
      };
    } catch (error) {
      logger.warn('Failed to save screenshot as asset, keeping base64 in result', {
        error: (error as Error).message,
      });
    }
  }
}

async function getSiblingWorkspaceOrThrow(
  repository: WorkspaceRepository,
  currentWorkspaceId: string,
  targetWorkspaceId: string,
): Promise<Workspace> {
  const currentWorkspace = await repository.findById(currentWorkspaceId as WorkspaceId);
  if (!currentWorkspace) {
    throw new Error('Current workspace not found');
  }

  if (!currentWorkspace.repositoryPath) {
    throw new Error('Current workspace is not associated with a repository');
  }

  const targetWorkspace = await repository.findById(targetWorkspaceId as WorkspaceId);
  if (!targetWorkspace) {
    throw new Error(`Target workspace not found: ${targetWorkspaceId}`);
  }

  if (targetWorkspace.repositoryPath !== currentWorkspace.repositoryPath) {
    throw new Error('Access denied: Can only access workspaces in the same repository');
  }

  return targetWorkspace;
}

export function buildBrowserApi(call: ToolCall) {
  return {
    async exec(actions: unknown[], tabId?: string) {
      logger.debug('ws.browser.exec', { actionCount: Array.isArray(actions) ? actions.length : 0, tabId });

      if (!Array.isArray(actions)) {
        throw new Error('actions parameter is required and must be an array');
      }
      if (actions.length === 0) {
        throw new Error('actions array cannot be empty');
      }

      const result = await executeBrowserActions(
        actions,
        tabId,
        call.context?.agentId,
        call.context?.workspaceId,
      );
      if (!result.success) {
        throw new Error(`Browser action failed: ${result.error}`);
      }

      await persistBrowserScreenshots(result, call.context?.workspaceId);
      if (result.results.length === 1) {
        const actionResult = result.results[0];
        return actionResult.result ?? { action: actionResult.action, success: actionResult.success };
      }

      return result.results;
    },

    async docs(topic: string) {
      logger.debug('ws.browser.docs', { topic });
      return getTextContent(await browserDocsTool.execute({ name: 'browser_docs', arguments: { topic } }));
    },
  };
}

export function buildTerminalApi(workspaceId: string) {
  return {
    async list() {
      logger.debug('ws.terminal.list', { workspaceId });
      return terminalManager.getWorkspaceTerminals(workspaceId).map((terminal) => {
        const info = terminal.getInfo();
        return {
          id: info.id,
          name: info.title || 'Terminal',
          cwd: info.cwd,
          isExecutingCommand: info.isExecutingCommand,
        };
      });
    },

    async readOutput(terminalId: string, maxLines: number = 200) {
      logger.debug('ws.terminal.readOutput', { terminalId, maxLines });
      if (!terminalId) {
        throw new Error('terminalId is required');
      }

      const terminal = terminalManager.getTerminal(terminalId);
      if (!terminal) {
        throw new Error(`Terminal not found: ${terminalId}`);
      }

      const info = terminal.getInfo();
      if (info.workspaceId !== workspaceId) {
        throw new Error('Terminal does not belong to this workspace');
      }

      const rawOutput = terminal.getBufferedOutput();
      if (!rawOutput || rawOutput.trim().length === 0) {
        return 'Terminal has no output yet.';
      }

      const cleanOutput = rawOutput.replace(
        /\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b\[[\?]?[0-9;]*[a-zA-Z]/g,
        '',
      );
      const lines = cleanOutput.split('\n');
      const maxLineCount = Math.max(1, Math.min(maxLines, 10000));
      const outputLines = lines.length > maxLineCount ? lines.slice(-maxLineCount) : lines;
      while (outputLines.length > 0 && !outputLines[outputLines.length - 1]?.trim()) {
        outputLines.pop();
      }

      const truncated = lines.length > maxLineCount;
      const header = `Terminal ${terminalId} (cwd: ${info.cwd})${truncated ? ` [showing last ${maxLineCount} of ${lines.length} lines]` : ''}`;
      return `${header}\n${'─'.repeat(40)}\n${outputLines.join('\n')}`;
    },
  };
}

export function buildCrossWorkspaceApi({
  workspaceId,
  workspaceManager,
  repository = defaultWorkspaceRepository,
}: CrossWorkspaceApiDeps) {
  return {
    async listSiblings() {
      logger.debug('ws.crossWorkspace.listSiblings', { workspaceId });
      const currentWorkspace = await repository.findById(workspaceId as WorkspaceId);
      if (!currentWorkspace) {
        throw new Error('Current workspace not found');
      }
      if (!currentWorkspace.repositoryPath) {
        throw new Error('Current workspace is not associated with a repository');
      }

      const allWorkspaces = await repository.findAll();
      return allWorkspaces
        .filter((workspace) => workspace.id !== workspaceId && workspace.repositoryPath === currentWorkspace.repositoryPath)
        .map((workspace) => ({
          id: workspace.id,
          title: workspace.title || 'Untitled',
          branch: workspace.branch,
          status: workspace.status,
          createdAt: workspace.createdAt,
          updatedAt: workspace.updatedAt,
        }));
    },

    async readNote(targetWorkspaceId: string, noteId: string) {
      logger.debug('ws.crossWorkspace.readNote', { targetWorkspaceId, noteId });
      if (!workspaceManager) throw new Error('Workspace manager not available');
      if (!targetWorkspaceId || !noteId) throw new Error('Both workspaceId and noteId are required');

      const targetWorkspace = await getSiblingWorkspaceOrThrow(repository, workspaceId, targetWorkspaceId);
      const note = await workspaceManager.getNote(targetWorkspaceId, noteId);
      if (!note) {
        throw new Error(`Note not found: ${noteId} in workspace ${targetWorkspaceId}`);
      }

      const content = note.content || '';
      return {
        id: note.id,
        title: note.title,
        content,
        numberedContent: numberLines(content),
        sourceWorkspaceId: targetWorkspaceId,
        sourceWorkspaceTitle: targetWorkspace.title,
        branch: targetWorkspace.branch,
        lineCount: content.split('\n').length,
      };
    },

    async listNotes(targetWorkspaceId: string) {
      logger.debug('ws.crossWorkspace.listNotes', { targetWorkspaceId });
      if (!workspaceManager) throw new Error('Workspace manager not available');
      if (!targetWorkspaceId) throw new Error('workspaceId is required');

      await getSiblingWorkspaceOrThrow(repository, workspaceId, targetWorkspaceId);
      const notes = await workspaceManager.listNotes(targetWorkspaceId);
      if (!Array.isArray(notes)) {
        throw new Error('Failed to list notes: invalid response from workspace manager');
      }

      return notes.map((note) => ({
        id: note.id,
        title: note.title,
        createdAt: note.created_at || note.createdAt,
        updatedAt: note.updated_at || note.updatedAt,
      }));
    },
  };
}

export function buildFileApi({ workspaceId, workspacePath, call, fsAdapter }: FileApiDeps) {
  const adapter = fsAdapter || new LocalFileSystemAdapter(workspacePath);

  return {
    async read(path: string) {
      logger.debug('ws.file.read', { path });
      if (!path) throw new Error('path is required');
      if (!adapter.isWithinWorkspace(path)) throw new Error('Access denied: path outside workspace');
      return adapter.readFile(path);
    },

    async write(path: string, content: string) {
      logger.debug('ws.file.write', { path });
      if (!path || content === undefined) throw new Error('path and content are required');
      if (!adapter.isWithinWorkspace(path)) throw new Error('Access denied: path outside workspace');

      let oldContent = '';
      const fileExisted = await adapter.exists(path).catch(() => false);
      if (fileExisted) oldContent = await adapter.readFile(path).catch(() => '');

      await adapter.writeFile(path, content);
      const agentInfo = getAgentInfo(call);
      getAttributionEngine().recordAgentWrite(
        {
          agentId: agentInfo.id,
          agentName: agentInfo.name,
          sessionId: call.context?.sessionId,
          turnNumber: call.context?.metadata?.turnNumber as number | undefined,
          messageId: `msg-${Date.now()}`,
        },
        path,
        content,
        workspacePath,
        workspaceId,
      );

      trackFileOperation(workspaceId, path, 'write');
      sendToWorkspaceWindows(workspaceId, 'file:content-changed', {
        path,
        content,
        source: 'agent',
        workspaceId,
      });
      emitAgentFileChange(workspaceId, path);

      try {
        const patch = Diff.createPatch(path, oldContent, content, '', '', { context: 3 });
        let additions = 0;
        let deletions = 0;
        for (const line of patch.split('\n')) {
          if (line.startsWith('@@') || line.startsWith('---') || line.startsWith('+++')) continue;
          if (line.startsWith('+')) additions++;
          else if (line.startsWith('-')) deletions++;
        }

        mainDispatch(emitWorkspaceEvent(createWorkspaceEvent(
          'file:changed', workspaceId,
          { type: 'agent', id: agentInfo.id, name: agentInfo.name },
          { path, relativePath: path, action: fileExisted ? 'modify' : 'create', diff: patch, additions, deletions },
        )));
      } catch (error) {
        logger.warn('Failed to emit file change to activity log', { error });
      }

      return { ok: true, path, size: content.length };
    },

    async list(path: string = '.') {
      logger.debug('ws.file.list', { path });
      if (!adapter.isWithinWorkspace(path)) throw new Error('Access denied: path outside workspace');
      if (adapter.isRemote) {
        return (await adapter.listFiles(path)).map((name) => ({ name, type: 'unknown' }));
      }

      return (await fs.readdir(adapter.resolvePath(path), { withFileTypes: true })).map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
      }));
    },

    async delete(path: string) {
      logger.debug('ws.file.delete', { path });
      if (!path) throw new Error('path is required');
      if (!adapter.isWithinWorkspace(path)) throw new Error('Access denied: path outside workspace');
      if (!(await adapter.exists(path))) throw new Error(`File not found: ${path}`);
      if (await adapter.isDirectory(path)) throw new Error(`Cannot delete directory with this method: ${path}`);

      const oldContent = await adapter.readFile(path).catch(() => '');
      await adapter.deleteFile(path);
      trackFileOperation(workspaceId, path, 'delete');
      safeBroadcastToWindows(`file:deleted:${workspaceId}`, { path, source: 'agent', workspaceId }, workspaceId);
      emitAgentFileChange(workspaceId, path);

      try {
        const agentInfo = getAgentInfo(call);
        const patch = Diff.createPatch(path, oldContent, '', '', '', { context: 3 });
        const deletions = patch.split('\n').filter((line) => line.startsWith('-') && !line.startsWith('---')).length;
        mainDispatch(emitWorkspaceEvent(createWorkspaceEvent(
          'file:changed', workspaceId,
          { type: 'agent', id: agentInfo.id, name: agentInfo.name },
          { path, relativePath: path, action: 'delete', diff: patch, additions: 0, deletions },
        )));
      } catch (error) {
        logger.warn('Failed to emit file delete to activity log', { error });
      }

      return { ok: true, path, deleted: true };
    },

    async mkdir(path: string) {
      logger.debug('ws.file.mkdir', { path });
      if (!path) throw new Error('path is required');
      if (!adapter.isWithinWorkspace(path)) throw new Error('Access denied: path outside workspace');

      if (await adapter.exists(path)) {
        if (await adapter.isDirectory(path)) return { ok: true, path, existed: true };
        throw new Error(`Path exists but is not a directory: ${path}`);
      }

      await adapter.createDirectory(path);
      safeBroadcastToWindows(`directory:created:${workspaceId}`, { path, source: 'agent', workspaceId }, workspaceId);
      return { ok: true, path, created: true };
    },

    async rename(oldPath: string, newPath: string) {
      logger.debug('ws.file.rename', { oldPath, newPath });
      if (!oldPath || !newPath) throw new Error('Both oldPath and newPath are required');
      if (!adapter.isWithinWorkspace(oldPath) || !adapter.isWithinWorkspace(newPath)) {
        throw new Error('Access denied: path outside workspace');
      }
      if (!(await adapter.exists(oldPath))) throw new Error(`Source file not found: ${oldPath}`);
      if (await adapter.exists(newPath)) throw new Error(`Destination already exists: ${newPath}`);

      const isDirectory = await adapter.isDirectory(oldPath);
      const content = isDirectory ? null : await adapter.readFile(oldPath);
      await adapter.renameFile(oldPath, newPath);

      trackFileOperation(workspaceId, oldPath, 'delete');
      trackFileOperation(workspaceId, newPath, 'write');
      if (isDirectory) {
        safeBroadcastToWindows(`directory:deleted:${workspaceId}`, { path: oldPath, source: 'agent', workspaceId }, workspaceId);
        safeBroadcastToWindows(`directory:created:${workspaceId}`, { path: newPath, source: 'agent', workspaceId }, workspaceId);
      } else {
        safeBroadcastToWindows(`file:deleted:${workspaceId}`, { path: oldPath, source: 'agent', workspaceId }, workspaceId);
        safeBroadcastToWindows('file:content-changed', { path: newPath, content, source: 'agent', workspaceId }, workspaceId);
      }
      emitAgentFileChange(workspaceId, newPath);

      try {
        const agentInfo = getAgentInfo(call);
        mainDispatch(emitWorkspaceEvent(createWorkspaceEvent(
          'file:changed', workspaceId,
          { type: 'agent', id: agentInfo.id, name: agentInfo.name },
          { path: newPath, relativePath: newPath, action: 'rename', oldPath },
        )));
      } catch (error) {
        logger.warn('Failed to emit rename to activity log', { error });
      }

      return { ok: true, oldPath, newPath, renamed: true, isDirectory };
    },
  };
}