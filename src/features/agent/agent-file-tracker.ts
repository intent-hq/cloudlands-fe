/**
 * Agent File Tracker
 *
 * Tracks which files agents are editing and emits events for the follow system.
 *
 * NOTE: This module is specifically for the "follow agent" feature, which allows
 * the UI to track what file/note an agent is currently working on. It does NOT
 * handle file change attribution - that is handled by the main attribution system:
 * - acp-provider-streaming.ts records agent writes with content hash
 * - change-processor.ts detects changes via git polling
 * - attribution-engine.ts matches content hash to attribute to agent
 */

import type { AuggieToolCall } from '$shared/types';
import { getReduxStore } from '$lib/store/redux-dispatch-bridge';
import { selectIsFollowingAgent, selectFollowedAgentId } from '$lib/store/slices/agent-follow/agent-follow-selectors';
import { setCurrentFile, setCurrentNote, queueTextAnimation } from '$lib/store/slices/agent-follow/agent-follow-slice';

import { Logger } from '$lib/utils/logger';
const logger = new Logger({ category: 'AgentFileTracker' });

/**
 * Represents a file editing operation performed by an agent.
 */
interface FileEdit {
  /** ID of the agent performing the edit */
  agentId: string;
  /** Path to the file being edited */
  file?: string;
  /** ID of the note being edited (if applicable) */
  noteId?: string;
  /** Type of entity being edited */
  type: 'file' | 'note';
  /** Type of editing action performed */
  action: 'open' | 'edit' | 'create' | 'delete';
  /** New content after the edit */
  content?: string;
  /** Original content before the edit (for calculating diffs) */
  oldContent?: string;
  /** Timestamp when the edit occurred */
  timestamp: number;
}

/**
 * Service for tracking file operations performed by agents.
 * Monitors tool calls, extracts file edits, and notifies the follow system
 * and file tracking store about changes.
 *
 * @example
 * ```typescript
 * agentFileTracker.trackToolCall(
 *   'agent-123',
 *   toolCall,
 *   'session-456',
 *   1,
 *   'Code Assistant'
 * );
 * ```
 */
class AgentFileTracker {
  private activeEdits = new Map<string, FileEdit[]>();
  private listeners = new Set<(edit: FileEdit) => void>();

  /**
   * Track a tool call from an agent and extract file operations.
   * Analyzes the tool call to identify file edits and updates tracking stores.
   *
   * @param agentId - ID of the agent making the tool call
   * @param toolCall - The tool call to analyze
   * @param sessionId - Optional session ID for attribution
   * @param turnNumber - Optional turn number in the conversation
   * @param agentName - Optional human-readable agent name
   * @example
   * ```typescript
   * tracker.trackToolCall('agent-123', {
   *   name: 'str_replace_editor',
   *   arguments: { path: 'src/app.ts', ... }
   * });
   * ```
   */
  trackToolCall(
    agentId: string,
    toolCall: AuggieToolCall,
  ) {
    const fileEdits = this.extractFileEdits(agentId, toolCall);

    if (fileEdits.length > 0) {
      logger.debug('[AgentFileTracker] Extracted file edits:', {
        agentId,
        toolName: toolCall.name,
        edits: fileEdits,
        isFollowing: selectIsFollowingAgent.select(getReduxStore().getState(), agentId),
        followedAgentId: selectFollowedAgentId.select(getReduxStore().getState()),
      });
    }

    fileEdits.forEach((edit) => {
      // Store the edit
      if (!this.activeEdits.has(agentId)) {
        this.activeEdits.set(agentId, []);
      }
      this.activeEdits.get(agentId)!.push(edit);

      // Notify listeners
      this.notifyListeners(edit);

      // NOTE: We no longer call trackChange() on the file tracking store here.
      // File tracking is handled by the main attribution system:
      // 1. acp-provider-streaming.ts records agent writes with content hash
      // 2. change-processor.ts detects changes via git polling
      // 3. attribution-engine.ts matches content hash to attribute to agent
      // This prevents duplicate tracking and ensures consistent attribution.

      // If this agent is being followed, trigger follow actions
      if (selectIsFollowingAgent.select(getReduxStore().getState(), agentId)) {
        logger.debug('[AgentFileTracker] Handling followed agent edit:', edit);
        this.handleFollowedAgentEdit(edit);
      }
    });
  }

  /**
   * Extract file edits from a tool call
   */
  private extractFileEdits(agentId: string, toolCall: AuggieToolCall): FileEdit[] {
    const edits: FileEdit[] = [];
    const timestamp = Date.now();

    // Handle both 'input' and 'arguments' properties
    const input = toolCall.input || (toolCall as any).arguments;
    if (!input) return edits;

    switch (toolCall.name) {
      case 'str_replace_editor':
      case 'str-replace-editor':
        if (input.path) {
          edits.push({
            agentId,
            file: input.path,
            type: 'file',
            action: 'edit',
            content: input.new_str || input.new_str_1 || '',
            oldContent: input.old_str || input.old_str_1 || '',
            timestamp,
          });
        }
        break;

      case 'create_file':
      case 'save-file':
        if (input.path) {
          edits.push({
            agentId,
            file: input.path,
            type: 'file',
            action: 'create',
            content: input.content || input.file_content || '',
            timestamp,
          });
        }
        break;

      case 'view':
      case 'view_file':
        if (input.path && (!input.type || input.type === 'file')) {
          edits.push({
            agentId,
            file: input.path,
            type: 'file',
            action: 'open',
            timestamp,
          });
        }
        break;

      case 'delete_file':
      case 'remove-files':
        const paths = input.file_paths || [input.path];
        (paths || []).filter(Boolean).forEach((path: string) => {
          edits.push({
            agentId,
            file: path as string,
            type: 'file',
            action: 'delete',
            timestamp,
          });
        });
        break;

      // Note operations
      case 'create_note':
        if (input.title || input.noteId) {
          edits.push({
            agentId,
            noteId: input.noteId || input.title,
            type: 'note',
            action: 'create',
            content: input.content || '',
            timestamp,
          });
        }
        break;

      case 'update_note': // Legacy alias
      case 'set_note_content':
      case 'edit_note':
      case 'edit_note_lines':
      case 'add_to_note':
      case 'append_to_note': // Legacy alias
        if (input.noteId) {
          edits.push({
            agentId,
            noteId: input.noteId,
            type: 'note',
            action: 'edit',
            content: input.content || '',
            timestamp,
          });
        }
        break;

      case 'read_note':
      case 'view_note':
        if (input.noteId) {
          edits.push({
            agentId,
            noteId: input.noteId,
            type: 'note',
            action: 'open',
            timestamp,
          });
        }
        break;

      case 'delete_note':
        if (input.noteId) {
          edits.push({
            agentId,
            noteId: input.noteId,
            type: 'note',
            action: 'delete',
            timestamp,
          });
        }
        break;
    }

    return edits;
  }

  /**
   * Handle edits from a followed agent
   */
  private handleFollowedAgentEdit(edit: FileEdit) {
    logger.debug('[AgentFileTracker] handleFollowedAgentEdit called:', {
      action: edit.action,
      type: edit.type,
      file: edit.file,
      noteId: edit.noteId,
      hasContent: !!edit.content,
    });

    switch (edit.action) {
      case 'open':
      case 'create':
      case 'edit':
        // Update the current file or note in the follow store
        if (edit.type === 'file' && edit.file) {
          logger.debug('[AgentFileTracker] Setting current file to:', { file: edit.file });
          getReduxStore().dispatch(setCurrentFile(edit.file));
        } else if (edit.type === 'note' && edit.noteId) {
          logger.debug('[AgentFileTracker] Setting current note to:', { noteId: edit.noteId });
          getReduxStore().dispatch(setCurrentNote(edit.noteId));
        }

        // Queue animation for edits with content
        if (edit.action === 'edit' && edit.content) {
          const target = edit.type === 'file' ? edit.file : edit.noteId;
          logger.debug(`[AgentFileTracker] Queueing text animation for ${edit.type}:`, { target });
          if (target) {
            getReduxStore().dispatch(
              queueTextAnimation(target, edit.content, true),
            );
          }
        }
        break;
    }
  }

  /**
   * Add a listener for file edits
   */
  addListener(listener: (edit: FileEdit) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Notify all listeners of a file edit
   */
  private notifyListeners(edit: FileEdit) {
    this.listeners.forEach((listener) => listener(edit));
  }

  /**
   * Get recent edits for an agent
   */
  getAgentEdits(agentId: string): FileEdit[] {
    return this.activeEdits.get(agentId) || [];
  }

  /**
   * Clear edits for an agent
   */
  clearAgentEdits(agentId: string) {
    this.activeEdits.delete(agentId);
  }

  /**
   * Track file changes for an agent
   */
  trackChanges(agentId: string, fileChanges: Array<{ file: string; action: string }>) {
    const timestamp = Date.now();
    fileChanges.forEach((change) => {
      const edit: FileEdit = {
        agentId,
        file: change.file,
        type: 'file',
        action: change.action as any,
        timestamp,
      };

      if (!this.activeEdits.has(agentId)) {
        this.activeEdits.set(agentId, []);
      }
      this.activeEdits.get(agentId)!.push(edit);
      this.notifyListeners(edit);
    });
  }

  /**
   * Get file changes for an agent
   */
  getChanges(agentId: string): Array<{ file: string; action: string }> {
    const edits = this.activeEdits.get(agentId) || [];
    return edits
      .filter((e) => e.type === 'file' && e.file)
      .map((e) => ({
        file: e.file!,
        action: e.action,
      }));
  }
}

export const agentFileTracker = new AgentFileTracker();
