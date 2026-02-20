/**
 * Workspace note editing MCP tools.
 *
 * Provides safe alternatives to set_note_content (full replacement):
 * - add_to_note: Add content to a note (preserves existing content)
 * - edit_note: Surgical str_replace style editing
 * - edit_note_lines: Line-based editing
 * - update_note_metadata: Update only title/tags
 */

import { BaseMCPTool, createInputSchema, stringProperty } from './tool';
import { sendToWorkspaceWindows } from '../../../system/main/system.ipc';
import { Logger } from '../../../../shared/logger';
import { ToolCall, ToolResult } from './protocol';
import { getProvenanceContextManager } from '$features/workspace/main/provenance/provenance-context-manager';
import { hasTaskBlocks } from '../../../notes/utils/task-block-parser';
import { notesService } from '../../../notes/main/notes.service';
import { WorkspaceId } from '../../../../shared/types/branded-ids';

const logger = new Logger('NoteEditTools');

/**
 * Tool to add content to an existing note.
 * This is the SAFEST way to add new content without risking data loss.
 */
export class AddToNoteTool extends BaseMCPTool {
  private workspaceManager: any;
  private workspaceId: string;

  constructor(workspaceManager: any, workspaceId: string) {
    super(
      'add_to_note',
      `Add content to an existing note. This is the SAFEST way to add new information.

The existing content is PRESERVED and your new content is added.

PREFER THIS TOOL when asked to:
- "Add this to the spec"
- "Put this in the note"
- "Document this in the spec"
- "Include this information"

Parameters:
- noteId: The note to add to (use 'spec' for the specification)
- content: The content to add
- heading: Optional section heading (e.g., "## New Section")
- position: Where to add - "end" (default), "start", or "after:HEADING" to add after a specific heading

Examples:
- add_to_note(noteId="spec", heading="## Phase 2", content="...")
- add_to_note(noteId="spec", content="...", position="after:## Phase 1")`,
      createInputSchema(
        {
          noteId: stringProperty(
            "The ID of the note to add to (use 'spec' for the workspace specification)",
          ),
          content: stringProperty('The content to add to the note'),
          heading: stringProperty(
            'Optional: A heading to add before the content (e.g., "## New Section")',
          ),
          position: stringProperty(
            'Where to add: "end" (default), "start", or "after:HEADING" (e.g., "after:## Phase 1")',
          ),
        },
        ['noteId', 'content'],
      ),
    );
    this.workspaceManager = workspaceManager;
    this.workspaceId = workspaceId;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const { noteId, content, heading, position } = call.arguments;

      logger.info('add_to_note called', {
        noteId,
        workspaceId: this.workspaceId,
        contentLength: content?.length,
        position: position || 'end',
        hasHeading: !!heading,
      });

      if (!noteId) {
        return this.error('Note ID is required');
      }

      if (!content) {
        return this.error('Content is required');
      }

      // Get the current note
      const currentNote = await this.workspaceManager.getNote(this.workspaceId, noteId);
      if (!currentNote) {
        return this.error(`Note not found: ${noteId}`);
      }

      const oldContent = currentNote.content || '';

      // Build the section to add (with optional heading)
      let addSection = '';
      if (heading) {
        addSection = `${heading}\n\n${content}`;
      } else {
        addSection = content;
      }

      // Determine where to insert based on position
      let newContent: string;
      let positionInfo = 'at end';

      if (!position || position === 'end') {
        // Default: add at end
        newContent = oldContent + '\n\n' + addSection;
        positionInfo = 'at end';
      } else if (position === 'start') {
        // Add at start
        newContent = addSection + '\n\n' + oldContent;
        positionInfo = 'at start';
      } else if (position.startsWith('after:')) {
        // Add after specific heading
        const afterHeading = position.substring(6).trim();
        const headingIndex = oldContent.indexOf(afterHeading);

        if (headingIndex === -1) {
          return this.error(
            `Heading not found: "${afterHeading}". Use position="end" or specify an existing heading.`,
          );
        }

        // Find the end of the heading line
        const lineEnd = oldContent.indexOf('\n', headingIndex);
        const insertPoint = lineEnd === -1 ? oldContent.length : lineEnd;

        // Find the next heading or end of content to insert before it
        const afterHeadingContent = oldContent.substring(insertPoint);
        const nextHeadingMatch = afterHeadingContent.match(/\n(#{1,6}\s)/);

        let insertAt: number;
        if (nextHeadingMatch) {
          insertAt = insertPoint + nextHeadingMatch.index!;
        } else {
          insertAt = oldContent.length;
        }

        newContent =
          oldContent.substring(0, insertAt) + '\n\n' + addSection + oldContent.substring(insertAt);
        positionInfo = `after "${afterHeading}"`;
      } else {
        return this.error(
          `Invalid position: "${position}". Use "end", "start", or "after:HEADING".`,
        );
      }

      // Set up provenance context
      const provenanceManager = getProvenanceContextManager();
      const existingContext = provenanceManager.getCurrentContext();
      let contextId: string | undefined;
      let shouldPopContext = false;

      if (!existingContext) {
        const agentInfo = (call as any).metadata?.agent || { id: 'agent', name: 'Agent' };
        contextId = provenanceManager.createAgentContext({
          agentId: agentInfo.id || 'agent',
          agentName: agentInfo.name || 'Agent',
          messageId: `msg-${Date.now()}`,
          sessionId: (call as any).metadata?.sessionId,
          turnNumber: (call as any).metadata?.turnNumber,
        });
        shouldPopContext = true;
      }

      try {
        // Update the note with new content
        const note = await this.workspaceManager.updateNote(this.workspaceId, noteId as string, {
          content: newContent,
        });

        if (!note) {
          return this.error(`Failed to update note: ${noteId}`);
        }

        // Emit update events
        this.emitUpdateEvents(noteId, newContent, note);

        // Auto-convert @@@task blocks to Task Notes
        let convertedTasksInfo = '';
        try {
          if (hasTaskBlocks(newContent)) {
            const conversionResult = await notesService.convertTaskBlocks(
              WorkspaceId(this.workspaceId),
              noteId as string,
            );

            if (conversionResult.ok && conversionResult.data.convertedCount > 0) {
              convertedTasksInfo = ` Auto-converted ${conversionResult.data.convertedCount} task block(s) to Task Notes.`;
              logger.info('Auto-converted task blocks in add_to_note', {
                noteId,
                convertedCount: conversionResult.data.convertedCount,
                createdNoteIds: conversionResult.data.createdNoteIds,
              });
            }
          }
        } catch (conversionError) {
          logger.warn('Failed to auto-convert task blocks in add_to_note', {
            noteId,
            error: (conversionError as Error).message,
          });
          // Don't fail the tool execution if conversion fails
        }

        const headingInfo = heading ? ` with heading "${heading}"` : '';
        return this.success(
          `Content added to note "${noteId}" ${positionInfo}${headingInfo}. Added ${content.length} characters.${convertedTasksInfo}`,
          {
            noteId: note.id,
            addedLength: content.length,
            totalLength: newContent.length,
            position: positionInfo,
            oldContent,
            newContent,
          },
        );
      } finally {
        if (shouldPopContext && contextId) {
          provenanceManager.popContext();
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error adding to note', error as Error);
      return this.error(`Failed to add to note: ${errorMessage}`);
    }
  }

  private emitUpdateEvents(noteId: string, content: string, note: any) {
    try {
      sendToWorkspaceWindows(this.workspaceId, 'note:updated', {
        workspaceId: this.workspaceId,
        noteId,
        content,
        note,
        source: 'agent',
      });
      sendToWorkspaceWindows(this.workspaceId, `note:content-changed:${this.workspaceId}`, {
        noteId,
        content,
        source: 'agent',
        workspaceId: this.workspaceId,
      });
    } catch (emitError) {
      logger.warn('Failed to emit note update event', { error: (emitError as Error).message });
    }
  }
}

/**
 * @deprecated Use AddToNoteTool instead. This alias is kept for backward compatibility.
 */
export const AppendToNoteTool = AddToNoteTool;

/**
 * Tool for surgical str_replace style editing of note content.
 * This mirrors how code editing works, making it intuitive for agents.
 */
export class EditNoteTool extends BaseMCPTool {
  private workspaceManager: any;
  private workspaceId: string;

  constructor(workspaceManager: any, workspaceId: string) {
    super(
      'edit_note',
      `Surgically edit a note by replacing specific text. Works like str_replace in code editing.

Use this when you need to:
- Fix a typo or error in existing content
- Update a specific section without affecting other content
- Make targeted changes to a note

Parameters:
- noteId: The note to edit (use 'spec' for the specification)
- old_text: The exact text to find and replace (must match exactly)
- new_text: The replacement text (can be empty to delete)

The old_text must match EXACTLY - including whitespace and line breaks.
Only the first occurrence is replaced.

Example: edit_note(noteId="spec", old_text="Phase 1: Planning", new_text="Phase 1: Planning ✓")`,
      createInputSchema(
        {
          noteId: stringProperty('The ID of the note to edit'),
          old_text: stringProperty('The exact text to find and replace'),
          new_text: stringProperty('The replacement text (can be empty to delete)'),
        },
        ['noteId', 'old_text', 'new_text'],
      ),
    );
    this.workspaceManager = workspaceManager;
    this.workspaceId = workspaceId;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const { noteId, old_text, new_text } = call.arguments;

      logger.info('edit_note called', {
        noteId,
        workspaceId: this.workspaceId,
        oldTextLength: old_text?.length,
        newTextLength: new_text?.length,
      });

      if (!noteId) {
        return this.error('Note ID is required');
      }

      if (old_text === undefined || old_text === '') {
        return this.error('old_text is required and cannot be empty');
      }

      if (new_text === undefined) {
        return this.error('new_text is required');
      }

      // Get the current note
      const currentNote = await this.workspaceManager.getNote(this.workspaceId, noteId);
      if (!currentNote) {
        return this.error(`Note not found: ${noteId}`);
      }

      logger.info('edit_note: note loaded', {
        noteId,
        contentLength: currentNote.content?.length || 0,
        hasContent: !!currentNote.content && currentNote.content.length > 0,
      });

      const oldContent = currentNote.content || '';

      let newContent: string;
      let matchIndex = -1;
      let wasEmpty = false;

      if (oldContent.length === 0) {
        // Note is empty — treat as setting the content directly
        logger.info('edit_note: note is empty, setting content directly', {
          noteId,
          workspaceId: this.workspaceId,
          newTextLength: new_text.length,
        });
        newContent = new_text;
        wasEmpty = true;
      } else {
        // Find the text to replace
        matchIndex = oldContent.indexOf(old_text);
        if (matchIndex === -1) {
          return this.error(
            `Text not found in note. Make sure old_text matches exactly (including whitespace and line breaks).\n\nNote content length: ${oldContent.length} chars.\n\nSearched for:\n${old_text.substring(0, 200)}${old_text.length > 200 ? '...' : ''}`,
          );
        }

        // Perform the replacement
        newContent =
          oldContent.substring(0, matchIndex) +
          new_text +
          oldContent.substring(matchIndex + old_text.length);
      }

      // Set up provenance context
      const provenanceManager = getProvenanceContextManager();
      const existingContext = provenanceManager.getCurrentContext();
      let contextId: string | undefined;
      let shouldPopContext = false;

      if (!existingContext) {
        const agentInfo = (call as any).metadata?.agent || { id: 'agent', name: 'Agent' };
        contextId = provenanceManager.createAgentContext({
          agentId: agentInfo.id || 'agent',
          agentName: agentInfo.name || 'Agent',
          messageId: `msg-${Date.now()}`,
          sessionId: (call as any).metadata?.sessionId,
          turnNumber: (call as any).metadata?.turnNumber,
        });
        shouldPopContext = true;
      }

      try {
        // Update the note
        const note = await this.workspaceManager.updateNote(this.workspaceId, noteId as string, {
          content: newContent,
        });

        if (!note) {
          return this.error(`Failed to update note: ${noteId}`);
        }

        // Emit update events
        this.emitUpdateEvents(noteId, newContent, note);

        // Auto-convert @@@task blocks to Task Notes
        let convertedTasksInfo = '';
        try {
          if (hasTaskBlocks(newContent)) {
            const conversionResult = await notesService.convertTaskBlocks(
              WorkspaceId(this.workspaceId),
              noteId as string,
            );

            if (conversionResult.ok && conversionResult.data.convertedCount > 0) {
              convertedTasksInfo = ` Auto-converted ${conversionResult.data.convertedCount} task block(s) to Task Notes.`;
              logger.info('Auto-converted task blocks in edit_note', {
                noteId,
                convertedCount: conversionResult.data.convertedCount,
                createdNoteIds: conversionResult.data.createdNoteIds,
              });
            }
          }
        } catch (conversionError) {
          logger.warn('Failed to auto-convert task blocks in edit_note', {
            noteId,
            error: (conversionError as Error).message,
          });
          // Don't fail the tool execution if conversion fails
        }

        const changeDescription = wasEmpty
          ? `Note was empty, set content (${new_text.length} chars)`
          : new_text.length === 0
            ? `Deleted ${old_text.length} characters`
            : `Replaced ${old_text.length} chars with ${new_text.length} chars`;

        return this.success(`Note edited: ${changeDescription}${convertedTasksInfo}`, {
          noteId: note.id,
          oldTextLength: wasEmpty ? 0 : old_text.length,
          newTextLength: new_text.length,
          matchPosition: matchIndex,
          oldContent,
          newContent,
        });
      } finally {
        if (shouldPopContext && contextId) {
          provenanceManager.popContext();
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error editing note', error as Error);
      return this.error(`Failed to edit note: ${errorMessage}`);
    }
  }

  private emitUpdateEvents(noteId: string, content: string, note: any) {
    try {
      sendToWorkspaceWindows(this.workspaceId, 'note:updated', {
        workspaceId: this.workspaceId,
        noteId,
        content,
        note,
        source: 'agent',
      });
      sendToWorkspaceWindows(this.workspaceId, `note:content-changed:${this.workspaceId}`, {
        noteId,
        content,
        source: 'agent',
        workspaceId: this.workspaceId,
      });
    } catch (emitError) {
      logger.warn('Failed to emit note update event', { error: (emitError as Error).message });
    }
  }
}

/**
 * Tool for line-based editing of note content.
 * This provides a familiar interface similar to line-based code editing.
 */
export class EditNoteLinesTool extends BaseMCPTool {
  private workspaceManager: any;
  private workspaceId: string;

  constructor(workspaceManager: any, workspaceId: string) {
    super(
      'edit_note_lines',
      `Edit specific lines in a note. Works like line-based code editing.

Use this when you need to:
- Replace a range of lines
- Delete specific lines
- Insert new lines at a specific position

Parameters:
- noteId: The note to edit (use 'spec' for the specification)
- start_line: First line to replace (1-based, inclusive)
- end_line: Last line to replace (1-based, inclusive)
- new_content: The replacement content (can be empty to delete lines)

Line numbers are 1-based. Both start_line and end_line are INCLUSIVE.

Examples:
- edit_note_lines(noteId="spec", start_line=5, end_line=7, new_content="New content")
- edit_note_lines(noteId="spec", start_line=10, end_line=10, new_content="") // Delete line 10`,
      createInputSchema(
        {
          noteId: stringProperty('The ID of the note to edit'),
          start_line: stringProperty('First line to replace (1-based, inclusive)'),
          end_line: stringProperty('Last line to replace (1-based, inclusive)'),
          new_content: stringProperty('The replacement content (can be empty to delete lines)'),
        },
        ['noteId', 'start_line', 'end_line', 'new_content'],
      ),
    );
    this.workspaceManager = workspaceManager;
    this.workspaceId = workspaceId;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const { noteId, start_line, end_line, new_content } = call.arguments;

      if (!noteId) {
        return this.error('Note ID is required');
      }

      const startLine = parseInt(start_line, 10);
      const endLine = parseInt(end_line, 10);

      if (isNaN(startLine) || startLine < 1) {
        return this.error('start_line must be a positive integer');
      }

      if (isNaN(endLine) || endLine < 1) {
        return this.error('end_line must be a positive integer');
      }

      if (startLine > endLine) {
        return this.error('start_line cannot be greater than end_line');
      }

      if (new_content === undefined) {
        return this.error('new_content is required');
      }

      // Get the current note
      const currentNote = await this.workspaceManager.getNote(this.workspaceId, noteId);
      if (!currentNote) {
        return this.error(`Note not found: ${noteId}`);
      }

      const oldContent = currentNote.content || '';

      let newContent: string;

      if (oldContent.length === 0) {
        // Note is empty — treat as setting the content directly
        logger.info('edit_note_lines: note is empty, setting content directly', {
          noteId,
          workspaceId: this.workspaceId,
          newContentLength: new_content.length,
        });
        newContent = new_content;
      } else {
        const lines = oldContent.split('\n');
        const totalLines = lines.length;

        if (startLine > totalLines) {
          return this.error(
            `start_line (${startLine}) exceeds total lines in note (${totalLines})`,
          );
        }

        if (endLine > totalLines) {
          return this.error(`end_line (${endLine}) exceeds total lines in note (${totalLines})`);
        }

        // Build new content by replacing the line range
        const beforeLines = lines.slice(0, startLine - 1);
        const afterLines = lines.slice(endLine);
        const newLines = new_content.length > 0 ? new_content.split('\n') : [];

        newContent = [...beforeLines, ...newLines, ...afterLines].join('\n');
      }

      // Set up provenance context
      const provenanceManager = getProvenanceContextManager();
      const existingContext = provenanceManager.getCurrentContext();
      let contextId: string | undefined;
      let shouldPopContext = false;

      if (!existingContext) {
        const agentInfo = (call as any).metadata?.agent || { id: 'agent', name: 'Agent' };
        contextId = provenanceManager.createAgentContext({
          agentId: agentInfo.id || 'agent',
          agentName: agentInfo.name || 'Agent',
          messageId: `msg-${Date.now()}`,
          sessionId: (call as any).metadata?.sessionId,
          turnNumber: (call as any).metadata?.turnNumber,
        });
        shouldPopContext = true;
      }

      try {
        // Update the note
        const note = await this.workspaceManager.updateNote(this.workspaceId, noteId as string, {
          content: newContent,
        });

        if (!note) {
          return this.error(`Failed to update note: ${noteId}`);
        }

        // Emit update events
        this.emitUpdateEvents(noteId, newContent, note);

        // Auto-convert @@@task blocks to Task Notes
        let convertedTasksInfo = '';
        try {
          if (hasTaskBlocks(newContent)) {
            const conversionResult = await notesService.convertTaskBlocks(
              WorkspaceId(this.workspaceId),
              noteId as string,
            );

            if (conversionResult.ok && conversionResult.data.convertedCount > 0) {
              convertedTasksInfo = ` Auto-converted ${conversionResult.data.convertedCount} task block(s) to Task Notes.`;
              logger.info('Auto-converted task blocks in edit_note_lines', {
                noteId,
                convertedCount: conversionResult.data.convertedCount,
                createdNoteIds: conversionResult.data.createdNoteIds,
              });
            }
          }
        } catch (conversionError) {
          logger.warn('Failed to auto-convert task blocks in edit_note_lines', {
            noteId,
            error: (conversionError as Error).message,
          });
          // Don't fail the tool execution if conversion fails
        }

        const totalLinesBefore = oldContent.split('\n').length;
        const totalLinesAfter = newContent.split('\n').length;
        const wasEmpty = oldContent.length === 0;

        const changeDescription = wasEmpty
          ? `Note was empty, set content (${totalLinesAfter} lines)`
          : (() => {
              const linesReplaced = endLine - startLine + 1;
              const linesAdded = new_content.length > 0 ? new_content.split('\n').length : 0;
              return linesAdded === 0
                ? `Deleted ${linesReplaced} line(s) (${startLine}-${endLine})`
                : `Replaced ${linesReplaced} line(s) with ${linesAdded} line(s) at lines ${startLine}-${endLine}`;
            })();

        return this.success(`Note edited: ${changeDescription}${convertedTasksInfo}`, {
          noteId: note.id,
          startLine: wasEmpty ? undefined : startLine,
          endLine: wasEmpty ? undefined : endLine,
          totalLinesBefore,
          totalLinesAfter,
          oldContent,
          newContent,
        });
      } finally {
        if (shouldPopContext && contextId) {
          provenanceManager.popContext();
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error editing note lines', error as Error);
      return this.error(`Failed to edit note lines: ${errorMessage}`);
    }
  }

  private emitUpdateEvents(noteId: string, content: string, note: any) {
    try {
      sendToWorkspaceWindows(this.workspaceId, 'note:updated', {
        workspaceId: this.workspaceId,
        noteId,
        content,
        note,
        source: 'agent',
      });
      sendToWorkspaceWindows(this.workspaceId, `note:content-changed:${this.workspaceId}`, {
        noteId,
        content,
        source: 'agent',
        workspaceId: this.workspaceId,
      });
    } catch (emitError) {
      logger.warn('Failed to emit note update event', { error: (emitError as Error).message });
    }
  }
}
