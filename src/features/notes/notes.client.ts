/**
 * Notes IPC Client
 *
 * Client-side wrapper for notes IPC communication.
 * Used by renderer process to communicate with main process.
 */

import type {
  Note,
  NoteId,
  WorkspaceId,
  CreateNoteRequest,
  UpdateNoteRequest,
  Result,
  CommandResponse,
  TaskMetadata,
  TaskStatus,
  AgentId,
  AgentSession,
} from '../../shared/types';
import { NOTES_CHANNELS } from '$shared/ipc/channels';

class NotesClient {
  private async invoke<T>(channel: string, data?: any): Promise<Result<T, string>> {
    try {
      if (typeof window !== 'undefined' && window.electronAPI) {
        const response = await window.electronAPI.invoke(channel, data);
        // Convert CommandResponse to Result type
        return this.commandResponseToResult<T>(response);
      }
      return { ok: false, error: 'IPC not available' };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'IPC call failed',
      };
    }
  }

  private commandResponseToResult<T>(response: CommandResponse<T>): Result<T, string> {
    if (response.success) {
      return { ok: true, data: response.data as T };
    } else {
      return { ok: false, error: response.error || 'Unknown error' };
    }
  }

  async list(workspaceId: WorkspaceId): Promise<Result<Note[], string>> {
    return this.invoke<Note[]>(NOTES_CHANNELS.LIST, { workspaceId });
  }

  /**
   * Batch load notes for multiple workspaces at once.
   * Used by homepage to load progress data for all workspace cards.
   */
  async batchList(
    workspaceIds: WorkspaceId[],
  ): Promise<Result<Record<string, Note[]>, string>> {
    return this.invoke<Record<string, Note[]>>(NOTES_CHANNELS.BATCH_LIST, { workspaceIds });
  }

  async create(request: CreateNoteRequest): Promise<Result<Note, string>> {
    return this.invoke<Note>(NOTES_CHANNELS.CREATE, request);
  }

  async get(workspaceId: WorkspaceId, noteId: NoteId): Promise<Result<Note, string>> {
    return this.invoke<Note>(NOTES_CHANNELS.GET, { workspaceId, noteId });
  }

  async update(request: UpdateNoteRequest): Promise<Result<Note, string>> {
    return this.invoke<Note>(NOTES_CHANNELS.UPDATE, request);
  }

  async delete(id: NoteId, workspaceId?: WorkspaceId): Promise<Result<void, string>> {
    return this.invoke<void>(NOTES_CHANNELS.DELETE, { id, workspaceId });
  }

  async restoreSpec(workspaceId: WorkspaceId, versionId?: string): Promise<Result<Note, string>> {
    return this.invoke<Note>(NOTES_CHANNELS.RESTORE_SPEC, { workspaceId, versionId });
  }

  async restoreVersion(
    workspaceId: WorkspaceId,
    noteId: NoteId,
    versionId: string,
  ): Promise<Result<Note, string>> {
    return this.invoke<Note>('notes:restore-version', { workspaceId, noteId, versionId });
  }

  /**
   * Flush any pending version for a note.
   * This forces the creation of a version if there are unsaved changes,
   * useful before viewing version history to ensure current edits are captured.
   */
  async flushPendingVersion(
    workspaceId: WorkspaceId,
    noteId: NoteId,
  ): Promise<Result<{ created: boolean }, string>> {
    return this.invoke<{ created: boolean }>(NOTES_CHANNELS.FLUSH_PENDING_VERSION, {
      workspaceId,
      noteId,
    });
  }

  // Task metadata operations (Phase 1A)
  async markAsTask(
    workspaceId: WorkspaceId,
    noteId: NoteId,
    taskMetadata: TaskMetadata,
  ): Promise<Result<Note, string>> {
    return this.invoke<Note>(NOTES_CHANNELS.MARK_AS_TASK, { workspaceId, noteId, taskMetadata });
  }

  async updateTaskStatus(
    workspaceId: WorkspaceId,
    noteId: NoteId,
    status: TaskStatus,
  ): Promise<Result<Note, string>> {
    return this.invoke<Note>(NOTES_CHANNELS.UPDATE_TASK_STATUS, { workspaceId, noteId, status });
  }

  async updateTaskPeerOrder(
    workspaceId: WorkspaceId,
    noteId: NoteId,
    peerOrder: number,
  ): Promise<Result<Note, string>> {
    return this.invoke<Note>(NOTES_CHANNELS.UPDATE_TASK_PEER_ORDER, {
      workspaceId,
      noteId,
      peerOrder,
    });
  }

  async removeTaskMetadata(
    workspaceId: WorkspaceId,
    noteId: NoteId,
  ): Promise<Result<Note, string>> {
    return this.invoke<Note>(NOTES_CHANNELS.REMOVE_TASK_METADATA, { workspaceId, noteId });
  }

  async getTaskNotes(
    workspaceId: WorkspaceId,
    filters?: {
      status?: TaskStatus;
    },
  ): Promise<Result<Note[], string>> {
    return this.invoke<Note[]>(NOTES_CHANNELS.GET_TASK_NOTES, { workspaceId, filters });
  }

  // Note: addDependency, removeDependency, getDependencies methods removed
  // Task orchestration now uses parentId (sidebar hierarchy) as the dependency graph

  async getDependents(workspaceId: WorkspaceId, noteId: NoteId): Promise<Result<Note[], string>> {
    return this.invoke<Note[]>(NOTES_CHANNELS.GET_DEPENDENTS, { workspaceId, noteId });
  }

  async createPrerequisiteNote(
    workspaceId: WorkspaceId,
    dependentNoteId: NoteId,
    options: {
      title: string;
      content?: string;
      taskStatus?: TaskStatus;
      peerOrder?: number; // Order among sibling tasks (uses gaps of 100)
      agentConfig?: {
        instruction?: string;
        model?: string;
        autoStart?: boolean;
        agentId?: string; // Pre-generated agent ID for optimistic UI updates
      };
    },
  ): Promise<Result<{ note: Note; agent?: AgentSession }, string>> {
    return this.invoke<{ note: Note; agent?: AgentSession }>(
      NOTES_CHANNELS.CREATE_PREREQUISITE_NOTE,
      {
        workspaceId,
        dependentNoteId,
        options,
      },
    );
  }

  // Phase 1C: Agent assignment operations
  async assignAgentToTask(
    workspaceId: WorkspaceId,
    noteId: NoteId,
    agentId: AgentId,
  ): Promise<Result<Note, string>> {
    return this.invoke<Note>(NOTES_CHANNELS.ASSIGN_AGENT_TO_TASK, {
      workspaceId,
      noteId,
      agentId,
    });
  }

  /**
   * Convert ```task blocks to linked Task Notes
   */
  async convertTaskBlocks(
    workspaceId: WorkspaceId,
    noteId: NoteId,
  ): Promise<
    Result<
      {
        convertedCount: number;
        createdNoteIds: string[];
        updatedContent: string | null;
      },
      string
    >
  > {
    return this.invoke(NOTES_CHANNELS.CONVERT_TASK_BLOCKS, {
      workspaceId,
      noteId,
    });
  }

  /**
   * Find the next task to work on using DFS with dependency satisfaction.
   * Starts from a root task and finds the next leaf task that's ready.
   *
   * @param workspaceId - Workspace ID
   * @param rootNoteId - The root task note to start searching from
   * @returns The next task to work on, or null if no tasks are ready
   */
  async findNextTask(
    workspaceId: WorkspaceId,
    rootNoteId: NoteId,
  ): Promise<Result<Note | null, string>> {
    return this.invoke<Note | null>(NOTES_CHANNELS.FIND_NEXT_TASK, {
      workspaceId,
      rootNoteId,
    });
  }

  /**
   * Find all tasks that are ready to be worked on.
   *
   * Returns tasks that:
   * 1. Are not in a terminal status (complete, cancelled)
   * 2. Have all dependencies complete
   *
   * @param workspaceId - Workspace ID
   * @returns Object with flattened task tree and ready tasks
   */
  async findReadyTasks(
    workspaceId: WorkspaceId,
  ): Promise<Result<{ flattened: Note[]; ready: Note[] }, string>> {
    return this.invoke<{ flattened: Note[]; ready: Note[] }>(NOTES_CHANNELS.FIND_READY_TASKS, {
      workspaceId,
    });
  }
}

export const notesClient = new NotesClient();
