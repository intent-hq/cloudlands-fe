/**
 * Workspace note MCP tools.
 *
 * Split out of workspace-tools.ts to keep the main export hub smaller.
 */

import { BaseMCPTool, createInputSchema, stringProperty } from './tool';
import { Logger } from '../../../../shared/logger';
import { sendToWorkspaceWindows } from '../../../system/main/system.ipc';
import { ToolCall, ToolResult } from './protocol';
import { getProvenanceContextManager } from '$features/workspace/main/provenance/provenance-context-manager';
import { hasTaskBlocks } from '../../../notes/utils/task-block-parser';
import { notesService } from '../../../notes/main/notes.service';
import { WorkspaceId } from '../../../../shared/types/branded-ids';
import { REFERENCE_DOCS, AVAILABLE_TOPICS } from './reference-docs';
import { noteUrl, noteLink } from '../../../../shared/constants/intent-links';

const logger = new Logger('WorkspaceTools');

/**
 * Tool to get reference documentation on-demand
 */
export class GetReferenceDocsTool extends BaseMCPTool {
  constructor() {
    super(
      'get_reference_docs',
      `Get detailed documentation for workspace features. Available topics: ${AVAILABLE_TOPICS.join(', ')}`,
      createInputSchema(
        {
          topic: stringProperty(
            `The topic to get documentation for. One of: ${AVAILABLE_TOPICS.join(', ')}`,
          ),
        },
        ['topic'],
      ),
    );
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    const { topic } = call.arguments;

    if (!topic) {
      return this.error(`Topic is required. Available topics: ${AVAILABLE_TOPICS.join(', ')}`);
    }

    const docs = REFERENCE_DOCS[topic.toLowerCase()];
    if (!docs) {
      return this.error(
        `Unknown topic: "${topic}". Available topics: ${AVAILABLE_TOPICS.join(', ')}`,
      );
    }

    return this.success(docs);
  }
}

/**
 * Tool to create a note in the workspace
 */
export class CreateNoteTool extends BaseMCPTool {
  private workspaceManager: any;
  private workspaceId: string;

  constructor(workspaceManager: any, workspaceId: string) {
    super(
      'create_note',
      "Create a new note in the workspace. DO NOT use this for specifications - the spec is an existing note with ID 'spec' that should be edited using add_to_note or edit_note instead.",
      createInputSchema(
        {
          title: stringProperty('The title of the note'),
          content: stringProperty('The content of the note'),
          tags: stringProperty('Comma-separated tags for the note'),
        },
        ['title', 'content'],
      ),
    );
    this.workspaceManager = workspaceManager;
    this.workspaceId = workspaceId;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const { title, content, tags } = call.arguments;

      if (!title || !content) {
        return this.error('Title and content are required');
      }

      // Validate workspace manager
      if (!this.workspaceManager) {
        return this.error('Workspace manager not available');
      }

      // Set provenance context for agent operations if not already set
      const provenanceManager = getProvenanceContextManager();

      // Check if there's already a context (e.g., set by HTTP MCP bridge)
      const existingContext = provenanceManager.getCurrentContext();
      let contextId: string | undefined;
      let shouldPopContext = false;

      if (!existingContext) {
        // No existing context, create one
        // Extract agent info from the call context if available
        const agentInfo = (call as any).metadata?.agent || {
          id: 'agent',
          name: 'Agent',
        };

        // Create agent context for this tool execution
        contextId = provenanceManager.createAgentContext({
          agentId: agentInfo.id || 'agent',
          agentName: agentInfo.name || 'Agent',
          messageId: `msg-${Date.now()}`,
          sessionId: (call as any).metadata?.sessionId,
          turnNumber: (call as any).metadata?.turnNumber,
        });

        shouldPopContext = true; // We created it, so we should pop it
        logger.debug('Created provenance context for note creation', {
          contextId,
          agentId: agentInfo.id,
          title,
        });
      } else {
        logger.debug('Using existing provenance context for note creation', {
          contextId: existingContext.contextId,
          title,
        });
      }

      try {
        // Create note through the workspace manager with proper metadata
        const note = await this.workspaceManager.createNote(this.workspaceId, {
          title,
          content,
          tags: tags ? tags.split(',').map((t: string) => t.trim()) : [],
          metadata: {
            author: {
              id: 'agent',
              name: 'Agent',
              type: 'agent',
            },
          },
        });

        if (!note) {
          return this.error('Failed to create note: no note returned from workspace manager');
        }

        // Transform to match UI format
        const transformedNote = {
          id: note.id,
          title: note.title,
          content: note.content,
          tags: note.tags || [],
          isPinned: false,
          isArchived: false,
          createdAt: note.created_at || note.createdAt,
          updatedAt: note.updated_at || note.updatedAt,
          workspaceId: this.workspaceId,
          // Also include snake_case for backward compatibility
          is_pinned: false,
          is_archived: false,
          created_at: note.created_at || note.createdAt,
          updated_at: note.updated_at || note.updatedAt,
          author: {
            type: 'agent',
            id: 'agent',
            name: 'Agent',
          },
        };

        logger.debug('Successfully created note', {
          noteId: note.id,
          workspaceId: this.workspaceId,
          title: note.title,
        });

        // Track note creation (best-effort — don't break note creation if analytics fails)
        try {
          const { trackMain } = await import('$lib/services/analytics/main');
          trackMain('Created Note', {
            note_type: note.metadata?.task ? 'task' : 'regular',
          });
        } catch {
          // Silently ignore analytics errors
        }

        // Emit note:created event to workspace windows
        try {
          sendToWorkspaceWindows(this.workspaceId, 'note:created', {
            workspaceId: this.workspaceId,
            noteId: note.id,
            note: transformedNote,
          });
        } catch (emitError) {
          logger.warn('Failed to emit note:created event', {
            error: (emitError as Error).message,
          });
          // Don't fail the tool execution if event emission fails
        }

        return this.success(
          `Note created successfully!\n\nTo link to this note in your response, use:\n${noteLink(note.title, note.id)}`,
          {
            noteId: note.id,
            title: note.title,
            link: noteUrl(note.id),
          },
        );
      } finally {
        // Pop the provenance context only if we created it
        if (shouldPopContext && contextId) {
          provenanceManager.popContext();
          logger.debug('Popped provenance context', { contextId });
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error creating note', error as Error);
      return this.error(`Failed to create note: ${errorMessage}`);
    }
  }
}

/**
 * Tool to list notes in the workspace
 */
export class ListNotesTool extends BaseMCPTool {
  private workspaceManager: any;
  private workspaceId: string;

  constructor(workspaceManager: any, workspaceId: string) {
    super(
      'list_notes',
      'List all notes in the workspace',
      createInputSchema(
        {
          tag: stringProperty('Optional: filter by tag'),
        },
        [],
      ),
    );
    this.workspaceManager = workspaceManager;
    this.workspaceId = workspaceId;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const { tag } = call.arguments;

      // Validate workspace manager
      if (!this.workspaceManager) {
        return this.error('Workspace manager not available');
      }

      // Get all notes
      const notes = await this.workspaceManager.listNotes(this.workspaceId);

      if (!Array.isArray(notes)) {
        return this.error('Failed to list notes: invalid response from workspace manager');
      }

      // Filter by tag if specified
      const filteredNotes = tag ? notes.filter((note: any) => note.tags?.includes(tag)) : notes;

      const notesList = filteredNotes.map((note: any) => ({
        id: note.id,
        title: note.title,
        tags: note.tags,
        created_at: note.created_at || note.createdAt,
        updated_at: note.updated_at || note.updatedAt,
      }));

      return this.success(JSON.stringify(notesList, null, 2), {
        count: notesList.length,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error listing notes', error as Error);
      return this.error(`Failed to list notes: ${errorMessage}`);
    }
  }
}

/**
 * Tool to list just the task items from a note.
 * Returns a compact list of tasks with their text, checkbox status,
 * linked task note IDs, and line numbers — without the full note content.
 *
 * This is much more efficient than read_note when you only need task IDs
 * for delegation (e.g., coordinators extracting task IDs from the spec).
 */
export class ListNoteTasksTool extends BaseMCPTool {
  private workspaceManager: any;
  private workspaceId: string;

  constructor(workspaceManager: any, workspaceId: string) {
    super(
      'list_note_tasks',
      `List all task checkboxes in a note. Returns task text, status, linked task note IDs, and line numbers — without returning the full note content.

Use this instead of read_note when you only need task IDs for delegation. Much more efficient for coordinators.

Example response:
  Tasks in "Project Plan" (3 tasks):
    Line 5: [ ] Build auth system → task note: abc-123
    Line 6: [x] Set up database → task note: def-456
    Line 7: [/] Design API → (no linked task note)`,
      createInputSchema(
        {
          noteId: stringProperty(
            "The ID of the note to list tasks from (use 'spec' for the workspace specification)",
          ),
        },
        ['noteId'],
      ),
    );
    this.workspaceManager = workspaceManager;
    this.workspaceId = workspaceId;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const { noteId } = call.arguments;

      if (!noteId) {
        return this.error('Note ID is required');
      }

      if (!this.workspaceManager) {
        return this.error('Workspace manager not available');
      }

      const note = await this.workspaceManager.getNote(this.workspaceId, noteId);

      if (!note) {
        return this.error(`Note not found: ${noteId}`);
      }

      const content = note.content || '';
      const lines = content.split('\n');

      // Parse task checkboxes from the note content
      // Match: optional whitespace, -, whitespace, [status], whitespace, text
      // where text may include a linked task note: [Title](intent://local/task/{id})
      const TASK_LINE_REGEX = /^(\s*[-*]\s*)\[([ xX\/])\]\s*(.+)$/;
      const TASK_LINK_PATTERN = /\[([^\]]+)\]\(intent:\/\/local\/task\/([a-f0-9-]+)\)/;

      interface TaskEntry {
        lineNumber: number;
        text: string;
        status: 'todo' | 'in-progress' | 'done';
        taskNoteId: string | null;
      }

      const tasks: TaskEntry[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = line.match(TASK_LINE_REGEX);
        if (!match) continue;

        const [, , checkbox, taskText] = match;

        // Determine status from checkbox
        const status: TaskEntry['status'] =
          checkbox === 'x' || checkbox === 'X' ? 'done' :
          checkbox === '/' ? 'in-progress' :
          'todo';

        // Check for linked task note
        const linkMatch = taskText.match(TASK_LINK_PATTERN);
        const taskNoteId = linkMatch ? linkMatch[2] : null;

        // Clean task text: use link text if it's a linked task, otherwise raw text
        // Strip agent anchors (<!--agent:id-->) for cleaner output
        const cleanText = linkMatch
          ? linkMatch[1]
          : taskText.replace(/<!--agent:[^>]+-->/g, '').trim();

        tasks.push({
          lineNumber: i + 1,
          text: cleanText,
          status,
          taskNoteId,
        });
      }

      // Format response
      const noteTitle = note.title || noteId;
      let responseText = `Tasks in "${noteTitle}" (${tasks.length} task${tasks.length !== 1 ? 's' : ''}):\n`;

      if (tasks.length === 0) {
        responseText += '\n(no task checkboxes found)';
      } else {
        for (const task of tasks) {
          const checkbox = task.status === 'done' ? '[x]' : task.status === 'in-progress' ? '[/]' : '[ ]';
          const linkInfo = task.taskNoteId ? ` → task note: ${task.taskNoteId}` : '';
          responseText += `\n  Line ${task.lineNumber}: ${checkbox} ${task.text}${linkInfo}`;
        }
      }

      return this.success(responseText, {
        noteId: note.id,
        title: noteTitle,
        taskCount: tasks.length,
        tasks,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error listing note tasks', error as Error);
      return this.error(`Failed to list note tasks: ${errorMessage}`);
    }
  }
}

/**
 * Tool to read a specific note
 */
export class ReadNoteTool extends BaseMCPTool {
  private workspaceManager: any;
  private workspaceId: string;

  constructor(workspaceManager: any, workspaceId: string) {
    super(
      'read_note',
      "Read the content of a specific note. Use noteId='spec' to read the workspace specification. The response includes line numbers (shown as '   1 | line content') so you can reference exact line numbers when using update_task or adding comments with lineStart and lineEnd parameters.",
      createInputSchema(
        {
          noteId: stringProperty(
            "The ID of the note to read (use 'spec' for the workspace specification)",
          ),
        },
        ['noteId'],
      ),
    );
    this.workspaceManager = workspaceManager;
    this.workspaceId = workspaceId;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const { noteId } = call.arguments;

      if (!noteId) {
        return this.error('Note ID is required');
      }

      if (!this.workspaceManager) {
        return this.error('Workspace manager not available');
      }

      const note = await this.workspaceManager.getNote(this.workspaceId, noteId);

      if (!note) {
        return this.error(`Note not found: ${noteId}`);
      }

      // Extract images from note content for multi-modal response
      // We'll keep the text clean and return images as separate content items
      const embeddedImages = await this.extractImagesFromContent(note.content);

      // Replace workspace-asset:// URLs with descriptive placeholders in the text
      // so the LLM knows images exist but doesn't get huge base64 in the text
      const { content: contentWithPlaceholders, imageDescriptions } =
        this.replaceAssetUrlsWithPlaceholders(note.content || '');

      // Add line numbers to content for easier reference when adding comments
      const contentWithLineNumbers = contentWithPlaceholders
        ? contentWithPlaceholders
            .split('\n')
            .map((line: string, index: number) => `${String(index + 1).padStart(4, ' ')} | ${line}`)
            .join('\n')
        : '';

      // Prepend image summary if there are images
      // NOTE: Images are returned as content items, but auggie's ACP layer currently
      // only passes through rawOutput.output (text), not image content. The actual
      // images will only be visible if they were injected into the initial prompt
      // when the user sent a message while viewing this note.
      let imagesSummary = '';
      if (embeddedImages.length > 0) {
        imagesSummary = `--- Embedded Images (${embeddedImages.length}) ---\n`;
        imagesSummary += 'The following images are referenced in this note:\n';
        imageDescriptions.forEach((desc, idx) => {
          imagesSummary += `  ${idx + 1}. ${desc}\n`;
        });
        imagesSummary +=
          'Note: If you received images in your initial prompt (when the user was viewing this note and sent you a message), you can already see these images there.\n\n';
      }

      // Build response text with image summary first, then note content
      let responseText = `Note: ${note.title || noteId}\n\n${imagesSummary}${contentWithLineNumbers}`;

      // Add task metadata section if this is a task
      if (note.metadata?.task) {
        const task = note.metadata.task;
        const dependencies = note.metadata.dependencies || [];

        responseText += `\n\n--- Task Metadata ---\nStatus: ${task.status}`;
        if (task.acceptanceCriteria && task.acceptanceCriteria.length > 0) {
          responseText += `\nAcceptance Criteria:\n${task.acceptanceCriteria.map((c: string) => `  - ${c}`).join('\n')}`;
        }
        if (dependencies.length > 0) {
          responseText += `\nDependencies (${dependencies.length}):\n`;
          dependencies.forEach((dep: any) => {
            responseText += `  - ${dep.noteId} (${dep.type})${dep.reason ? `: ${dep.reason}` : ''}\n`;
          });
        }
        if (task.assignedAgentIds && task.assignedAgentIds.length > 0) {
          responseText += `\nAssigned Agents: ${task.assignedAgentIds.join(', ')}`;
        }
        if (task.estimatedEffort) {
          responseText += `\nEstimated Effort: ${task.estimatedEffort}`;
        }
        if (task.blockedReason) {
          responseText += `\nBlocked Reason: ${task.blockedReason}`;
        }
      }

      const metadata: any = {
        noteId: note.id,
        title: note.title,
        totalLines: note.content ? note.content.split('\n').length : 0,
      };

      // Include task metadata in response metadata
      if (note.metadata?.task) {
        metadata.isTask = true;
        metadata.taskStatus = note.metadata.task.status;
        metadata.taskMetadata = note.metadata.task;
      }

      // Build content items array - text first, then images as separate items
      // The separate image items are what the LLM actually "sees" visually
      const contentItems: Array<
        { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
      > = [{ type: 'text', text: responseText }];

      // Add image content items for multi-modal support
      for (const img of embeddedImages) {
        contentItems.push({
          type: 'image',
          data: img.data,
          mimeType: img.mimeType,
        });
      }

      if (embeddedImages.length > 0) {
        metadata.imageCount = embeddedImages.length;
        logger.info('Embedded images in read_note response for agent', {
          noteId,
          imageCount: embeddedImages.length,
          separateImageItems: embeddedImages.length,
          textLength: responseText.length,
        });
      }

      return this.result(contentItems, false, metadata);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error reading note', error as Error);
      return this.error(`Failed to read note: ${errorMessage}`);
    }
  }

  /**
   * Extract images from note content and convert to base64 data
   * This allows agents to "see" images embedded in notes
   */
  private async extractImagesFromContent(
    content: string,
  ): Promise<Array<{ url: string; data: string; mimeType: string; alt?: string }>> {
    if (!content) return [];

    const images: Array<{ url: string; data: string; mimeType: string; alt?: string }> = [];

    // Match markdown image syntax with workspace-asset:// URLs
    // ![alt text](workspace-asset://workspaceId/assetId)
    const imageRegex = /!\[([^\]]*)\]\((workspace-asset:\/\/[^)]+)\)/g;
    let match;

    while ((match = imageRegex.exec(content)) !== null) {
      const alt = match[1];
      const url = match[2];

      try {
        // Parse the workspace-asset:// URL
        // Format: workspace-asset://{workspaceId}/{assetId}
        const urlMatch = url.match(/workspace-asset:\/\/([^/]+)\/(.+)/);
        if (!urlMatch) continue;

        const assetWorkspaceId = urlMatch[1];
        const assetId = urlMatch[2];

        // Only resolve assets from the same workspace for security
        if (assetWorkspaceId !== this.workspaceId) {
          logger.warn('Skipping cross-workspace asset reference in read_note', {
            noteWorkspaceId: this.workspaceId,
            assetWorkspaceId,
            assetId,
          });
          continue;
        }

        // Import assetsService dynamically to avoid circular deps
        const { assetsService } = await import('../../../notes/main/assets.service');

        // Get the asset as a data URL
        const dataUrl = await assetsService.readAssetAsDataUrl(this.workspaceId, assetId);

        // Parse the data URL to extract mime type and base64 data
        const dataMatch = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (dataMatch) {
          images.push({
            url,
            data: dataMatch[2],
            mimeType: dataMatch[1],
            alt: alt || undefined,
          });
        }
      } catch (error) {
        logger.warn('Failed to embed image from note in read_note', {
          url,
          error: (error as Error).message,
        });
      }
    }

    return images;
  }

  /**
   * Replace workspace-asset:// URLs in content with descriptive placeholders
   * Returns modified content and descriptions of each image
   */
  private replaceAssetUrlsWithPlaceholders(content: string): {
    content: string;
    imageDescriptions: string[];
  } {
    if (!content) return { content: '', imageDescriptions: [] };

    let modifiedContent = content;
    const imageDescriptions: string[] = [];
    let imageIndex = 1;

    // Match markdown image syntax with workspace-asset:// URLs
    // ![alt text](workspace-asset://workspaceId/assetId)
    const imageRegex = /!\[([^\]]*)\]\((workspace-asset:\/\/[^)]+)\)/g;
    const matches: Array<{ fullMatch: string; alt: string; url: string }> = [];

    let match;
    while ((match = imageRegex.exec(content)) !== null) {
      matches.push({
        fullMatch: match[0],
        alt: match[1],
        url: match[2],
      });
    }

    for (const { fullMatch, alt, url } of matches) {
      // Parse the workspace-asset:// URL to get asset ID
      const urlMatch = url.match(/workspace-asset:\/\/[^/]+\/(.+)/);
      const assetId = urlMatch ? urlMatch[1] : 'unknown';

      // Create a descriptive placeholder
      const description = alt || assetId || `Image ${imageIndex}`;
      const placeholder = `[Image ${imageIndex}: ${description}]`;

      modifiedContent = modifiedContent.replace(fullMatch, placeholder);
      imageDescriptions.push(description);
      imageIndex++;
    }

    return { content: modifiedContent, imageDescriptions };
  }
}

/**
 * Tool to read a workspace asset (image) by its ID or workspace-asset:// URL
 * This allows agents to view images that are embedded in notes
 */
export class ReadAssetTool extends BaseMCPTool {
  private workspaceId: string;

  constructor(workspaceId: string) {
    super(
      'read_asset',
      `Read an image asset from the workspace. Use this to view images that are embedded in notes.

Input can be either:
- An asset ID (e.g., "mixft990-156b6d43.png")
- A full workspace-asset:// URL (e.g., "workspace-asset://workspace123/mixft990-156b6d43.png")

The image will be returned so you can see and describe it.`,
      createInputSchema(
        {
          asset: stringProperty('The asset ID or workspace-asset:// URL of the image to read'),
        },
        ['asset'],
      ),
    );
    this.workspaceId = workspaceId;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const { asset } = call.arguments;

      if (!asset) {
        return this.error('Asset ID or URL is required');
      }

      // Parse the asset parameter - could be full URL or just ID
      let assetId: string;
      if (asset.startsWith('workspace-asset://')) {
        // Parse the URL: workspace-asset://workspaceId/assetId
        const urlMatch = asset.match(/workspace-asset:\/\/[^/]+\/(.+)/);
        if (!urlMatch) {
          return this.error(`Invalid workspace-asset URL format: ${asset}`);
        }
        assetId = urlMatch[1];
      } else {
        assetId = asset;
      }

      // Import assetsService dynamically to avoid circular deps
      const { assetsService } = await import('../../../notes/main/assets.service');

      // Get the asset as a data URL
      const dataUrl = await assetsService.readAssetAsDataUrl(this.workspaceId, assetId);

      // Parse the data URL to extract mime type and base64 data
      const dataMatch = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!dataMatch) {
        return this.error('Failed to parse asset data');
      }

      const mimeType = dataMatch[1];
      const base64Data = dataMatch[2];

      // Return both text description and image content
      // NOTE: The image is returned as a content item, but auggie's ACP layer
      // currently only passes through rawOutput.output (text), not image content.
      // The actual image will only be visible if it was injected into the initial
      // prompt when the user sent a message while viewing the note.
      return {
        isError: false,
        content: [
          {
            type: 'text' as const,
            text: `Asset: ${assetId}\nType: ${mimeType}\nSize: ${Math.round(base64Data.length / 1024)}KB\n\nNote: If you were sent images in the initial prompt (when the user was viewing this note), you can already see this image there. Otherwise, this image cannot currently be displayed through tool results.`,
          },
          {
            type: 'image' as const,
            data: base64Data,
            mimeType,
          },
        ],
      };
    } catch (error) {
      return this.error(`Failed to read asset: ${(error as Error).message}`);
    }
  }
}

/**
 * Tool to SET (replace) the entire content of a note.
 * Named "set_note_content" to make it clear this is a full replacement.
 *
 * For safer alternatives:
 * - add_to_note: Add content to a note (preserves existing content)
 * - edit_note: Surgical str_replace style editing
 * - update_note_metadata: Update only title/tags
 */
export class SetNoteContentTool extends BaseMCPTool {
  private workspaceManager: any;
  private workspaceId: string;

  constructor(workspaceManager: any, workspaceId: string) {
    super(
      'set_note_content',
      `⚠️ FULL REPLACEMENT: This tool REPLACES the ENTIRE note content.

USE SAFER ALTERNATIVES INSTEAD:
- add_to_note: To ADD new content (use for "add to spec", "put in spec")
- edit_note: To make surgical edits (str_replace style)
- update_note_metadata: To change only title or tags

Only use set_note_content when you intentionally want to REPLACE ALL content.

SAFETY: If your new content is significantly shorter than the existing content,
you will be asked to confirm with confirm_replacement=true.

⚠️ The spec note's title is always "Spec" and CANNOT be changed.

Task blocks (\`\`\`task) are automatically converted to Task Notes.`,
      createInputSchema(
        {
          noteId: stringProperty(
            "The ID of the note to set content for (use 'spec' for the specification)",
          ),
          content: stringProperty('The new content that will REPLACE all existing content'),
          confirm_replacement: stringProperty(
            'Set to "true" to confirm replacement when new content is significantly shorter than existing',
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
      const { noteId, content, confirm_replacement } = call.arguments;

      logger.info('set_note_content called', {
        noteId,
        workspaceId: this.workspaceId,
        newContentLength: content?.length,
        hasConfirmReplacement: !!confirm_replacement,
      });

      if (!noteId) {
        return this.error('Note ID is required');
      }

      if (content === undefined) {
        return this.error(
          'Content is required. Use update_note_metadata to change only title/tags.',
        );
      }

      // Get the current note content before updating (for diff display and safety check)
      let oldContent: string | undefined;
      let oldTitle: string | undefined;
      try {
        const currentNote = await this.workspaceManager.getNote(this.workspaceId, noteId);
        if (currentNote) {
          oldContent = currentNote.content;
          oldTitle = currentNote.title;
          logger.info('set_note_content: existing note loaded', {
            noteId,
            oldContentLength: oldContent?.length || 0,
            hasOldContent: !!oldContent && oldContent.length > 0,
          });
        }
      } catch (error) {
        // Note might not exist yet, that's okay
      }

      // Safety check: If new content is significantly shorter (or empty), require confirmation
      if (oldContent && oldContent.length > 0) {
        const oldLen = oldContent.length;
        const newLen = content.length;
        const reductionPercent = ((oldLen - newLen) / oldLen) * 100;

        // If reducing content by more than 50% and not confirmed, require confirmation
        if (reductionPercent > 50 && confirm_replacement !== 'true') {
          const message = `⚠️ CONTENT REDUCTION DETECTED: Your new content (${newLen} chars) is ${Math.round(reductionPercent)}% shorter than the existing content (${oldLen} chars).

This will REPLACE the entire note. If you intended to:
- ADD content: Use add_to_note instead
- EDIT a section: Use edit_note instead
- PROCEED with replacement: Call set_note_content again with confirm_replacement="true"`;

          logger.warn('Content reduction detected, requiring confirmation', {
            noteId,
            oldLength: oldLen,
            newLength: newLen,
            reductionPercent: Math.round(reductionPercent),
          });

          return this.error(message);
        }
      }

      // Set provenance context for agent operations if not already set
      const provenanceManager = getProvenanceContextManager();

      // Check if there's already a context (e.g., set by HTTP MCP bridge)
      const existingContext = provenanceManager.getCurrentContext();
      let contextId: string | undefined;
      let shouldPopContext = false;

      if (!existingContext) {
        // No existing context, create one
        // Extract agent info from the call context if available
        const agentInfo = (call as any).metadata?.agent || {
          id: 'agent',
          name: 'Agent',
        };

        // Create agent context for this tool execution
        contextId = provenanceManager.createAgentContext({
          agentId: agentInfo.id || 'agent',
          agentName: agentInfo.name || 'Agent',
          messageId: `msg-${Date.now()}`,
          sessionId: (call as any).metadata?.sessionId,
          turnNumber: (call as any).metadata?.turnNumber,
        });

        shouldPopContext = true; // We created it, so we should pop it
        logger.debug('Created provenance context for note update', {
          contextId,
          agentId: agentInfo.id,
          noteId,
        });
      } else {
        logger.debug('Using existing provenance context for note update', {
          contextId: existingContext.contextId,
          noteId,
        });
      }

      try {
        // Clean up malformed content from agent
        let cleanContent = content;

        // Handle various malformed content patterns
        if (typeof cleanContent === 'string') {
          // Pattern 1: Content starting with escaped quote
          if (cleanContent.startsWith('"') || cleanContent.startsWith('\"')) {
            logger.warn('Detected malformed content starting with quote, attempting to clean');
            cleanContent = cleanContent.substring(1);

            // If it ends with a quote too, it might be double-escaped
            if (cleanContent.endsWith('"') || cleanContent.endsWith('\"')) {
              cleanContent = cleanContent.substring(0, cleanContent.length - 1);
            }
          }

          // Pattern 2: Content that looks like truncated JSON
          if (cleanContent.includes('": ') && !cleanContent.includes('\n')) {
            logger.error('Content appears to be malformed JSON', undefined, {
              content: cleanContent,
            });
            // Try to extract just the value part if it looks like "key": "value"
            const match = cleanContent.match(/:\s*"?(.+)"?$/);
            if (match) {
              cleanContent = match[1];
            }
          }

          // Pattern 3: Content that's suspiciously short and incomplete
          if (
            cleanContent.length < 50 &&
            !cleanContent.includes('\n') &&
            cleanContent.endsWith('...')
          ) {
            logger.warn('Content appears truncated', { content: cleanContent });
            return this.error(
              'Content appears to be truncated. Please provide the complete content.',
            );
          }

          // Pattern 4: Empty or whitespace-only content
          if (cleanContent.trim().length === 0) {
            return this.error('Content cannot be empty.');
          }
        } else {
          // Non-string content - try to convert
          logger.warn('Non-string content received, converting', {
            contentType: typeof content,
          });
          cleanContent = String(content);
        }

        const updateData = { content: cleanContent };

        // Update note through the workspace manager
        const note = await this.workspaceManager.updateNote(
          this.workspaceId,
          noteId as string,
          updateData,
        );

        if (!note) {
          return this.error(`Note not found: ${noteId}`);
        }

        // Transform to match UI format
        const transformedNote = {
          id: note.id,
          title: note.title,
          content: note.content,
          tags: note.tags || [],
          isPinned: false,
          isArchived: false,
          createdAt: note.created_at || note.createdAt,
          updatedAt: note.updated_at || note.updatedAt,
          workspaceId: this.workspaceId,
          // Also include snake_case for backward compatibility
          is_pinned: false,
          is_archived: false,
          created_at: note.created_at || note.createdAt,
          updated_at: note.updated_at || note.updatedAt,
          author: {
            type: note.author_type || 'agent',
            id: 'agent',
            name: 'Agent',
          },
        };

        // Emit note:updated event to workspace windows
        try {
          sendToWorkspaceWindows(this.workspaceId, 'note:updated', {
            workspaceId: this.workspaceId,
            noteId,
            content,
            note: transformedNote,
            source: 'agent',
          });

          // Also emit real-time content change event for UI streaming
          if (content !== undefined) {
            sendToWorkspaceWindows(this.workspaceId, `note:content-changed:${this.workspaceId}`, {
              noteId,
              content,
              source: 'agent',
              workspaceId: this.workspaceId,
            });
          }
        } catch (emitError) {
          logger.warn('Failed to emit note:updated event', {
            error: (emitError as Error).message,
          });
          // Don't fail the tool execution if event emission fails
        }

        // Auto-convert ```task blocks to Task Notes.
        // This runs for ALL notes including the spec when updated via agent tools.
        // The previous concern about spec overwrites from external file updates doesn't apply
        // here because this code path is only triggered by agent tool calls, not file sync.
        let convertedTasksInfo = '';

        if (content !== undefined) {
          try {
            const hasBlocks = hasTaskBlocks(content);

            // Convert if there are ```task blocks
            if (hasBlocks) {
              const conversionResult = await notesService.convertTaskBlocks(
                WorkspaceId(this.workspaceId),
                noteId as string,
              );

              if (conversionResult.ok && conversionResult.data.convertedCount > 0) {
                convertedTasksInfo = `\n\nAuto-converted ${conversionResult.data.convertedCount} task block(s) to Task Notes.`;
                logger.info('Auto-converted task blocks', {
                  noteId,
                  convertedCount: conversionResult.data.convertedCount,
                  createdNoteIds: conversionResult.data.createdNoteIds,
                });
              }
            }
          } catch (conversionError) {
            logger.warn('Failed to auto-convert task blocks', {
              noteId,
              error: (conversionError as Error).message,
            });
            // Don't fail the tool execution if conversion fails
          }
        }

        return this.success(`Note content replaced: ${note.id}${convertedTasksInfo}`, {
          noteId: note.id,
          title: note.title,
          updated_at: note.updated_at || note.updatedAt,
          // Include old/new content for diff display in UI
          oldContent,
          newContent: note.content,
        });
      } finally {
        // Pop the provenance context only if we created it
        if (shouldPopContext && contextId) {
          provenanceManager.popContext();
          logger.debug('Popped provenance context', { contextId });
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error setting note content', error as Error);
      return this.error(`Failed to set note content: ${errorMessage}`);
    }
  }
}

/**
 * Tool to update only the metadata (title, tags) of a note without changing content.
 * This is the SAFEST way to update note metadata.
 */
export class UpdateNoteMetadataTool extends BaseMCPTool {
  private workspaceManager: any;
  private workspaceId: string;

  constructor(workspaceManager: any, workspaceId: string) {
    super(
      'update_note_metadata',
      `Update the title and/or tags of a note without changing the content.

This is the SAFEST way to update note metadata. Content is never modified.

Use this when you need to:
- Change a note's title
- Add or modify tags
- Rename a note

Parameters:
- noteId: The note to update (use 'spec' for the specification)
- title: New title (optional)
- tags: Comma-separated tags (optional)

Note: The spec note's title cannot be changed.`,
      createInputSchema(
        {
          noteId: stringProperty('The ID of the note to update'),
          title: stringProperty('New title for the note'),
          tags: stringProperty('Comma-separated list of tags'),
        },
        ['noteId'],
      ),
    );
    this.workspaceManager = workspaceManager;
    this.workspaceId = workspaceId;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const { noteId, title, tags } = call.arguments;

      if (!noteId) {
        return this.error('Note ID is required');
      }

      if (title === undefined && tags === undefined) {
        return this.error('At least one of title or tags must be provided');
      }

      // Get the current note
      const currentNote = await this.workspaceManager.getNote(this.workspaceId, noteId);
      if (!currentNote) {
        return this.error(`Note not found: ${noteId}`);
      }

      // Build update data
      const updateData: any = {};
      let changes: string[] = [];

      if (title !== undefined) {
        // Silently ignore title changes for spec note
        if (noteId === 'spec') {
          logger.warn('Ignoring title change for spec note', {
            noteId,
            workspaceId: this.workspaceId,
            requestedTitle: title,
          });
        } else {
          updateData.title = title;
          changes.push(`title: "${currentNote.title}" → "${title}"`);
        }
      }

      if (tags !== undefined) {
        updateData.tags = tags
          ? String(tags)
              .split(',')
              .map((t: string) => t.trim())
          : [];
        changes.push(`tags: [${updateData.tags.join(', ')}]`);
      }

      if (Object.keys(updateData).length === 0) {
        return this.success('No changes made (spec title cannot be modified)', {
          noteId,
        });
      }

      // Update note through the workspace manager
      const note = await this.workspaceManager.updateNote(
        this.workspaceId,
        noteId as string,
        updateData,
      );

      if (!note) {
        return this.error(`Failed to update note: ${noteId}`);
      }

      return this.success(`Note metadata updated: ${changes.join(', ')}`, {
        noteId: note.id,
        title: note.title,
        tags: note.tags,
        updated_at: note.updated_at || note.updatedAt,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error updating note metadata', error as Error);
      return this.error(`Failed to update note metadata: ${errorMessage}`);
    }
  }
}

/**
 * Tool to delete a note from the workspace
 */
export class DeleteNoteTool extends BaseMCPTool {
  private workspaceManager: any;
  private workspaceId: string;

  constructor(workspaceManager: any, workspaceId: string) {
    super(
      'delete_note',
      'Delete a note from the workspace',
      createInputSchema(
        {
          noteId: stringProperty('The ID of the note to delete'),
        },
        ['noteId'],
      ),
    );
    this.workspaceManager = workspaceManager;
    this.workspaceId = workspaceId;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const { noteId } = call.arguments;

      if (!noteId) {
        return this.error('Note ID is required');
      }

      if (!this.workspaceManager) {
        return this.error('Workspace manager not available');
      }

      // Set provenance context for agent operations if not already set
      const provenanceManager = getProvenanceContextManager();

      // Check if there's already a context (e.g., set by HTTP MCP bridge)
      const existingContext = provenanceManager.getCurrentContext();
      let contextId: string | undefined;
      let shouldPopContext = false;

      if (!existingContext) {
        // No existing context, create one
        // Extract agent info from the call context if available
        const agentInfo = (call as any).metadata?.agent || {
          id: 'agent',
          name: 'Agent',
        };

        // Create agent context for this tool execution
        contextId = provenanceManager.createAgentContext({
          agentId: agentInfo.id || 'agent',
          agentName: agentInfo.name || 'Agent',
          messageId: `msg-${Date.now()}`,
          sessionId: (call as any).metadata?.sessionId,
          turnNumber: (call as any).metadata?.turnNumber,
        });

        shouldPopContext = true; // We created it, so we should pop it
        logger.debug('Created provenance context for note deletion', {
          contextId,
          agentId: agentInfo.id,
          noteId,
        });
      } else {
        logger.debug('Using existing provenance context for note deletion', {
          contextId: existingContext.contextId,
          noteId,
        });
      }

      try {
        // Delete note through the workspace manager
        const deleted = await this.workspaceManager.deleteNote(this.workspaceId, noteId as string);

        if (!deleted) {
          return this.error(`Note not found: ${noteId}`);
        }

        // Emit real-time deletion event for UI streaming
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          sendToWorkspaceWindows(this.workspaceId, `note:deleted:${this.workspaceId}`, {
            noteId,
            source: 'agent',
            workspaceId: this.workspaceId,
          });
        } catch (emitError) {
          logger.warn('Failed to emit note deletion event', {
            error: (emitError as Error).message,
          });
        }

        return this.success(`Note deleted: ${noteId}`, {
          noteId,
          deleted: true,
        });
      } finally {
        // Pop the provenance context only if we created it
        if (shouldPopContext && contextId) {
          provenanceManager.popContext();
          logger.debug('Popped provenance context', { contextId });
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error deleting note', error as Error);
      return this.error(`Failed to delete note: ${errorMessage}`);
    }
  }
}

/**
 * @deprecated Use SetNoteContentTool instead. This alias is kept for backward compatibility.
 */
export const UpdateNoteTool = SetNoteContentTool;
