/**
 * Workspace task-related MCP tools.
 *
 * Split out of workspace-tools.ts to keep the main export hub smaller.
 */

import { Logger } from '../../../../shared/logger';
import { BaseMCPTool, createInputSchema, numberProperty, stringProperty } from './tool';
import type { ToolCall, ToolResult } from './protocol';
import { sendToWorkspaceWindows } from '../../../system/main/system.ipc';

const logger = new Logger('WorkspaceTools');

/**
 * Tool to atomically update a task's status in a note.
 *
 * Preferred over set_note_content when marking tasks complete to avoid conflicts
 * when multiple agents are working on different tasks in the same note.
 */
export class UpdateTaskStatusTool extends BaseMCPTool {
  private workspaceManager: any;
  private workspaceId: string;

  constructor(workspaceManager: any, workspaceId: string) {
    super(
      'update_task_status',
      'Atomically update a task checkbox status in a note. Use this instead of set_note_content when marking tasks complete to avoid conflicts with other agents. The task is identified by matching its text content.',
      createInputSchema(
        {
          noteId: stringProperty(
            "The ID of the note containing the task (use 'spec' for the workspace specification)",
          ),
          taskText: stringProperty(
            'The text content of the task to update (without the checkbox). Must match exactly.',
          ),
          status: stringProperty(
            "The new status: 'done' (checked [x]), 'todo' (unchecked [ ]), or 'in-progress' ([/])",
            { enum: ['done', 'todo', 'in-progress'] },
          ),
        },
        ['noteId', 'taskText', 'status'],
      ),
    );
    this.workspaceManager = workspaceManager;
    this.workspaceId = workspaceId;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const { noteId, taskText, status } = call.arguments;

      if (!noteId) {
        return this.error('Note ID is required');
      }
      if (!taskText) {
        return this.error('Task text is required to identify the task');
      }
      if (!status || !['done', 'todo', 'in-progress'].includes(status)) {
        return this.error("Status must be 'done', 'todo', or 'in-progress'");
      }

      // Get the current note
      const note = await this.workspaceManager.getNote(this.workspaceId, noteId as string);
      if (!note) {
        return this.error(`Note not found: ${noteId}`);
      }

      // Determine the checkbox pattern to search for and replace with
      const checkboxPatterns = {
        todo: '[ ]',
        'in-progress': '[/]',
        done: '[x]',
      };
      const newCheckbox = checkboxPatterns[status as keyof typeof checkboxPatterns];

      // Normalize task text for matching (trim whitespace)
      const normalizedTaskText = String(taskText).trim();

      // Find and replace the task line
      // Match any checkbox pattern followed by the task text
      const taskLineRegex = new RegExp(
        `^(\\s*-\\s*)\\[([ x/])\\](\\s*)${this.escapeRegExp(normalizedTaskText)}(\\s*)$`,
        'gm',
      );

      const currentContent = note.content || '';
      let found = false;
      const updatedContent = currentContent.replace(
        taskLineRegex,
        (_match: string, prefix: string, _checkbox: string, space1: string, space2: string) => {
          found = true;
          return `${prefix}${newCheckbox}${space1}${normalizedTaskText}${space2}`;
        },
      );

      if (!found) {
        // Try a more lenient match (partial text match)
        const lines = currentContent.split('\n');
        let lineIndex = -1;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // Check if line is a task and contains the task text
          if (/^\s*-\s*\[[ x/]\]/.test(line) && line.includes(normalizedTaskText)) {
            lineIndex = i;
            break;
          }
        }

        if (lineIndex === -1) {
          return this.error(
            `Task not found: "${normalizedTaskText}". Make sure the task text matches exactly.`,
          );
        }

        // Update the found line
        lines[lineIndex] = lines[lineIndex].replace(/\[[ x/]\]/, newCheckbox);
        const updatedContentFromLines = lines.join('\n');

        // Update the note with the modified content
        await this.workspaceManager.updateNote(this.workspaceId, noteId as string, {
          content: updatedContentFromLines,
        });

        // Emit update event
        this.emitNoteUpdate(noteId as string, updatedContentFromLines);

        return this.success(
          `Task status updated to '${status}': ${normalizedTaskText.substring(0, 50)}${normalizedTaskText.length > 50 ? '...' : ''}`,
          { noteId, taskText: normalizedTaskText, status },
        );
      }

      // Update the note with the modified content
      await this.workspaceManager.updateNote(this.workspaceId, noteId as string, {
        content: updatedContent,
      });

      // Emit update event
      this.emitNoteUpdate(noteId as string, updatedContent);

      return this.success(
        `Task status updated to '${status}': ${normalizedTaskText.substring(0, 50)}${normalizedTaskText.length > 50 ? '...' : ''}`,
        { noteId, taskText: normalizedTaskText, status },
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error updating task status', error as Error);
      return this.error(`Failed to update task status: ${errorMessage}`);
    }
  }

  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private emitNoteUpdate(noteId: string, content: string) {
    try {
      sendToWorkspaceWindows(this.workspaceId, 'note:updated', {
        workspaceId: this.workspaceId,
        noteId,
        content,
        source: 'agent',
      });
      sendToWorkspaceWindows(this.workspaceId, `note:content-changed:${this.workspaceId}`, {
        noteId,
        content,
        source: 'agent',
        workspaceId: this.workspaceId,
      });
    } catch (emitError) {
      logger.warn('Failed to emit note:updated event', { error: (emitError as Error).message });
    }
  }
}

/**
 * Tool to update a Task Note's metadata status.
 *
 * This updates the note's taskStatus field (not_started, in_progress, complete, blocked).
 * Use this when working on a Task Note to track progress.
 *
 * This is different from update_task_status which updates checkbox status in markdown content.
 * This tool updates the note's metadata which is displayed in the sidebar and used for filtering.
 */
export class UpdateNoteTaskStatusTool extends BaseMCPTool {
  private workspaceManager: any;
  private workspaceId: string;

  constructor(workspaceManager: any, workspaceId: string) {
    super(
      'update_note_task_status',
      'Update the status of a Task Note. This updates the note metadata (shown in sidebar) to track progress. Use this when you start working on a task (in_progress), need discussion (discussion_needed), have work ready for review (review_required), or complete it (complete). Different from update_task_status which updates checkboxes in markdown.',
      createInputSchema(
        {
          noteId: stringProperty(
            'The ID of the Task Note to update. This is the note you are working on, not the parent note containing the checklist.',
          ),
          status: stringProperty(
            "The new task status: 'not_started', 'waiting', 'discussion_needed', 'in_progress', 'review_required', 'complete', or 'cancelled'",
            {
              enum: [
                'not_started',
                'waiting',
                'discussion_needed',
                'in_progress',
                'review_required',
                'complete',
                'cancelled',
              ],
            },
          ),
        },
        ['noteId', 'status'],
      ),
    );
    this.workspaceManager = workspaceManager;
    this.workspaceId = workspaceId;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const { noteId, status } = call.arguments;

      if (!noteId) {
        return this.error('Note ID is required');
      }
      if (!status) {
        return this.error('Status is required');
      }

      const validStatuses = [
        'not_started',
        'waiting',
        'discussion_needed',
        'in_progress',
        'review_required',
        'complete',
        'cancelled',
      ];
      if (!validStatuses.includes(status)) {
        return this.error(`Invalid status: ${status}. Must be one of: ${validStatuses.join(', ')}`);
      }

      logger.info('Updating Task Note status via MCP tool', {
        workspaceId: this.workspaceId,
        noteId,
        status,
      });

      // Call the workspace manager to update task status
      const result = await this.workspaceManager.updateTaskStatus(this.workspaceId, noteId, status);

      if (!result || !result.success) {
        const errorMsg = result?.error || 'Unknown error updating task status';
        logger.error('Failed to update Task Note status', { noteId, status, error: errorMsg });
        return this.error(errorMsg);
      }

      // Emit update event to frontend
      this.emitNoteUpdate(noteId, result.data);

      return this.success(`Task Note status updated to '${status}'`, {
        noteId,
        status,
        note: result.data,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error updating Task Note status', error as Error);
      return this.error(`Failed to update Task Note status: ${errorMessage}`);
    }
  }

  private emitNoteUpdate(noteId: string, note: any) {
    try {
      sendToWorkspaceWindows(this.workspaceId, 'note:updated', {
        workspaceId: this.workspaceId,
        noteId,
        note,
        source: 'agent',
      });
    } catch (emitError) {
      logger.warn('Failed to emit note:updated event', { error: (emitError as Error).message });
    }
  }
}

/**
 * Tool to atomically update a single task in a note by line number.
 *
 * Preferred for agents editing tasks to avoid conflicts when multiple agents
 * are working on different tasks in the same note.
 */
export class UpdateTaskTool extends BaseMCPTool {
  private workspaceManager: any;
  private workspaceId: string;

  constructor(workspaceManager: any, workspaceId: string) {
    super(
      'update_task',
      `Atomically update a single task in a note. Use this instead of set_note_content when editing tasks to avoid conflicts with other agents.

IMPORTANT: This tool updates ONLY the specified task line, preserving all other content.

Parameters:
- noteId: The note containing the task (use 'spec' for workspace specification)
- lineNumber: The 1-based line number of the task to update (from read_note output)
- newText: New text for the task (without checkbox prefix like "- [ ]")
- status: Optional new status: 'todo', 'in-progress', or 'done'
- expectedContent: Optional - the current task text you expect. If provided and doesn't match, the operation fails (conflict detection)

Example: To change line 5 from "- [ ] Old task" to "- [x] Completed task":
  update_task(noteId="spec", lineNumber=5, newText="Completed task", status="done")`,
      createInputSchema(
        {
          noteId: stringProperty(
            "The ID of the note containing the task (use 'spec' for the workspace specification)",
          ),
          lineNumber: numberProperty(
            'The 1-based line number of the task to update (as shown in read_note output)',
          ),
          newText: stringProperty(
            'The new text content for the task (without the checkbox prefix like "- [ ]"). If not provided, only status is updated.',
          ),
          status: stringProperty(
            "Optional: The new status - 'todo' ([ ]), 'in-progress' ([/]), or 'done' ([x])",
            { enum: ['todo', 'in-progress', 'done'] },
          ),
          expectedContent: stringProperty(
            'Optional: The task text you expect to find. If provided and does not match current content, the update fails with a conflict error. Use this to detect if another agent modified the task.',
          ),
        },
        ['noteId', 'lineNumber'],
      ),
    );
    this.workspaceManager = workspaceManager;
    this.workspaceId = workspaceId;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const { noteId, lineNumber, newText, status, expectedContent } = call.arguments;

      if (!noteId) {
        return this.error('Note ID is required');
      }
      if (lineNumber === undefined || lineNumber === null) {
        return this.error('Line number is required');
      }
      if (newText === undefined && status === undefined) {
        return this.error('Either newText or status (or both) must be provided');
      }

      const lineNum = Number(lineNumber);
      if (isNaN(lineNum) || lineNum < 1) {
        return this.error('Line number must be a positive integer');
      }

      if (status && !['todo', 'in-progress', 'done'].includes(status)) {
        return this.error("Status must be 'todo', 'in-progress', or 'done'");
      }

      // Get the current note
      const note = await this.workspaceManager.getNote(this.workspaceId, noteId as string);
      if (!note) {
        return this.error(`Note not found: ${noteId}`);
      }

      const currentContent = note.content || '';
      const lines = currentContent.split('\n');

      // Validate line number
      if (lineNum > lines.length) {
        return this.error(`Line ${lineNum} does not exist. Note has ${lines.length} lines.`);
      }

      const lineIndex = lineNum - 1;
      const currentLine = lines[lineIndex];

      // Check if this line is a task
      const taskMatch = currentLine.match(/^(\s*-\s*)\[([ x/])\]\s*(.*)$/);
      if (!taskMatch) {
        return this.error(
          `Line ${lineNum} is not a task. Expected format: "- [ ] task text". Found: "${currentLine.substring(0, 50)}${currentLine.length > 50 ? '...' : ''}"`,
        );
      }

      const [, prefix, currentCheckbox, currentTaskText] = taskMatch;

      // Optimistic locking: check if content matches expectation
      if (expectedContent !== undefined) {
        const normalizedExpected = String(expectedContent).trim();
        const normalizedCurrent = currentTaskText.trim();
        if (normalizedExpected !== normalizedCurrent) {
          return this.error(
            `Conflict detected: Task content has changed.\nExpected: "${normalizedExpected}"\nActual: "${normalizedCurrent}"\nAnother agent may have modified this task. Please re-read the note and try again.`,
          );
        }
      }

      // Determine new checkbox
      const checkboxMap: Record<string, string> = {
        todo: '[ ]',
        'in-progress': '[/]',
        done: '[x]',
      };

      let newCheckbox: string;
      if (status) {
        newCheckbox = checkboxMap[status];
      } else {
        // Preserve current checkbox if no status change
        const currentStatus =
          currentCheckbox === 'x' ? 'done' : currentCheckbox === '/' ? 'in-progress' : 'todo';
        newCheckbox = checkboxMap[currentStatus];
      }

      // Determine new task text
      const finalText = newText !== undefined ? String(newText).trim() : currentTaskText;

      // Build the new line
      const newLine = `${prefix}${newCheckbox} ${finalText}`;

      // Update the line
      lines[lineIndex] = newLine;
      const updatedContent = lines.join('\n');

      // Save the updated note
      await this.workspaceManager.updateNote(this.workspaceId, noteId as string, {
        content: updatedContent,
      });

      // Emit update events
      this.emitNoteUpdate(noteId as string, updatedContent);

      const statusLabel =
        status ||
        (currentCheckbox === 'x' ? 'done' : currentCheckbox === '/' ? 'in-progress' : 'todo');
      return this.success(
        `Task updated at line ${lineNum}: "${finalText.substring(0, 40)}${finalText.length > 40 ? '...' : ''}" [${statusLabel}]`,
        {
          noteId,
          lineNumber: lineNum,
          previousText: currentTaskText,
          newText: finalText,
          status: statusLabel,
        },
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error updating task', error as Error);
      return this.error(`Failed to update task: ${errorMessage}`);
    }
  }

  private emitNoteUpdate(noteId: string, content: string) {
    try {
      sendToWorkspaceWindows(this.workspaceId, 'note:updated', {
        workspaceId: this.workspaceId,
        noteId,
        content,
        source: 'agent',
      });
      sendToWorkspaceWindows(this.workspaceId, `note:content-changed:${this.workspaceId}`, {
        noteId,
        content,
        source: 'agent',
        workspaceId: this.workspaceId,
      });
    } catch (emitError) {
      logger.warn('Failed to emit note:updated event', { error: (emitError as Error).message });
    }
  }
}
