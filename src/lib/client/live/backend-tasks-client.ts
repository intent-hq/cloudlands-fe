import type { WorkspaceTask, WorkspaceTaskStats } from '../../../shared/types';
import type { TaskAgentAssociationsByTaskKey } from '../../../store/renderer/slices/task-agent-associations/task-agent-associations-types';
import type { TasksReadClient } from '../lifecycle-read-client-types';
import type { BackendTransport } from './backend-transport-types';
import { normalizeAgentLink, normalizeStats, normalizeTaskEntity } from './task-normalization';

/** Canonical task reads; discovery is required and belongs to the renderer's real shared owner. */
export function createBackendTasksClient({
  backendRequest,
  rememberNoteWorkspace,
}: {
  backendRequest: BackendTransport['request'];
  rememberNoteWorkspace: (noteId: string, workspaceId: string) => void;
}): TasksReadClient {
  return {
    async list(
      workspaceId: string,
    ): Promise<{ tasks: WorkspaceTask[]; stats: WorkspaceTaskStats }> {
      const result = await backendRequest<{ tasks?: unknown[]; stats?: unknown }>('task.list', {
        workspaceId,
      });
      const rawTasks = Array.isArray(result?.tasks) ? result.tasks : [];
      const tasks: WorkspaceTask[] = [];
      for (const entry of rawTasks) {
        const task = normalizeTaskEntity(entry as Record<string, unknown>);
        if (!task) continue;
        if (task.id) rememberNoteWorkspace(task.id, workspaceId);
        tasks.push(task);
      }
      return { tasks, stats: normalizeStats(result?.stats) };
    },

    async listAgentLinks(
      workspaceId: string,
    ): Promise<Record<string, TaskAgentAssociationsByTaskKey>> {
      const result = await backendRequest<{ linksByNoteId?: unknown }>('task.listAgentLinks', {
        workspaceId,
      });
      const raw = result?.linksByNoteId;
      if (!raw || typeof raw !== 'object') return {};
      const out: Record<string, TaskAgentAssociationsByTaskKey> = {};
      for (const [noteId, byKeyRaw] of Object.entries(raw as Record<string, unknown>)) {
        if (!byKeyRaw || typeof byKeyRaw !== 'object') continue;
        const byKey: TaskAgentAssociationsByTaskKey = {};
        for (const [taskKey, rowRaw] of Object.entries(byKeyRaw as Record<string, unknown>)) {
          const assoc = normalizeAgentLink(rowRaw);
          if (assoc) byKey[taskKey] = assoc;
        }
        if (Object.keys(byKey).length > 0) out[noteId] = byKey;
      }
      return out;
    },
  };
}
