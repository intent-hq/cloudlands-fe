/**
 * Workspace note comment thread MCP tools.
 *
 * Split out of workspace-tools.ts to keep that module as a small export hub.
 */

import { BaseMCPTool, createInputSchema, stringProperty, booleanProperty } from './tool';
import { ToolCall, ToolResult } from './protocol';

/**
 * Tool to list comments on a note
 */
export class ListNoteCommentsTool extends BaseMCPTool {
  private workspaceManager: any;
  private workspaceId: string;

  constructor(workspaceManager: any, workspaceId: string) {
    super(
      'list_note_comments',
      `List comments on a note, grouped by thread with metadata for easy navigation.

Returns threads (not individual comments) with metadata including:
- Targeted text from the spec
- Thread status and activity timestamps
- Latest comment author info (useful for finding threads needing responses)
- Optional: full comment history

**Perfect for agents**: Get threads where users commented last that need responses:
  list_note_comments(noteId="spec", since="<timestamp>", authorType="user", status="open", includeComments=true)

Parameters:
- includeComments: Include full comment objects (default: false)
- since: Filter threads with activity after this timestamp (applied to lastActivity)
- authorType: Filter threads where the LATEST comment is from this author type
- status: Filter threads by status (open/resolved/pending)`,
      createInputSchema(
        {
          noteId: stringProperty(
            "The ID of the note to list comments for. Use 'spec' for the workspace specification, or any other note ID",
          ),
          includeComments: booleanProperty(
            'Optional: Include full comment objects in each thread. Default: false (only thread metadata)',
          ),
          since: stringProperty(
            "Optional: ISO 8601 timestamp. Only return threads with activity (lastActivity) after this time. Example: '2024-01-15T10:30:00Z'",
          ),
          authorType: stringProperty(
            "Optional: Filter threads where the LATEST comment is from this author type ('user' or 'agent'). Useful for finding threads needing agent responses.",
          ),
          status: stringProperty(
            "Optional: Filter threads by status ('open', 'resolved', or 'pending')",
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
      const { noteId, includeComments = false, since, authorType, status } = call.arguments;

      if (!noteId) {
        return this.error('Note ID is required');
      }

      // Validate 'since' timestamp if provided
      let sinceDate: Date | null = null;
      if (since) {
        sinceDate = new Date(since);
        if (isNaN(sinceDate.getTime())) {
          return this.error(`Invalid 'since' timestamp: ${since}. Must be ISO 8601 format.`);
        }
      }

      // Validate 'authorType' if provided
      if (authorType && authorType !== 'user' && authorType !== 'agent') {
        return this.error(`Invalid 'authorType': ${authorType}. Must be 'user' or 'agent'.`);
      }

      // Validate 'status' if provided
      if (status && !['open', 'resolved', 'pending'].includes(status)) {
        return this.error(`Invalid 'status': ${status}. Must be 'open', 'resolved', or 'pending'.`);
      }

      // Check if the note exists first
      const note = await this.workspaceManager.getNote(this.workspaceId, noteId);
      if (!note) {
        return this.error(`Note not found: ${noteId}`);
      }

      // Get comments through the protocol adapter
      const result = await this.workspaceManager.listComments({
        workspaceId: this.workspaceId,
        noteId,
      });

      if (!result || !result.ok) {
        // If no comments, return empty threads array
        return this.success(
          JSON.stringify({ threads: [], totalThreads: 0, totalComments: 0 }, null, 2),
          { noteId, includeComments, since: since || null, authorType: authorType || null },
        );
      }

      const comments = result.data || [];

      // Group comments by thread
      const threadMap = new Map<string, any[]>();
      for (const comment of comments) {
        const threadId = comment.threadId || comment.id;
        if (!threadMap.has(threadId)) {
          threadMap.set(threadId, []);
        }
        threadMap.get(threadId)!.push(comment);
      }

      // Build thread objects
      let threads = Array.from(threadMap.entries()).map(([threadId, threadComments]) => {
        // Sort comments by creation time
        threadComments.sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );

        // Find root comment (no parentId)
        const rootComment = threadComments.find((c) => !c.parentId) || threadComments[0];

        // Find latest comment (most recent updatedAt)
        const latestComment = threadComments.reduce((latest, current) =>
          new Date(current.updatedAt).getTime() > new Date(latest.updatedAt).getTime()
            ? current
            : latest,
        );

        // Calculate thread status (open if any comment is open)
        const threadStatus = threadComments.some((c) => c.status === 'open')
          ? 'open'
          : threadComments.every((c) => c.status === 'resolved')
            ? 'resolved'
            : 'pending';

        // Calculate last activity (most recent updatedAt)
        const lastActivity = threadComments.reduce((latest, current) => {
          const currentTime = new Date(current.updatedAt).getTime();
          return currentTime > new Date(latest).getTime() ? current.updatedAt : latest;
        }, threadComments[0].updatedAt);

        return {
          threadId,
          noteId,
          targetedText: rootComment.section || null,
          anchorId: rootComment.markId || null,
          status: threadStatus,
          createdAt: rootComment.createdAt,
          lastActivity,
          latestCommentAuthor: latestComment.author,
          latestCommentAuthorType: latestComment.authorType,
          latestCommentAt: latestComment.updatedAt,
          commentCount: threadComments.length,
          ...(includeComments ? { comments: threadComments } : {}),
        };
      });

      // Apply filters
      if (sinceDate) {
        threads = threads.filter((thread) => new Date(thread.lastActivity) > sinceDate!);
      }

      if (authorType) {
        threads = threads.filter((thread) => thread.latestCommentAuthorType === authorType);
      }

      if (status) {
        threads = threads.filter((thread) => thread.status === status);
      }

      // Sort by last activity (most recent first)
      threads.sort(
        (a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime(),
      );

      const totalComments = threads.reduce((sum, thread) => sum + thread.commentCount, 0);

      const response = {
        threads,
        totalThreads: threads.length,
        totalComments,
      };

      return this.success(JSON.stringify(response, null, 2), {
        noteId,
        includeComments,
        since: since || null,
        authorType: authorType || null,
        status: status || null,
      });
    } catch (error) {
      return this.error(`Failed to list comments: ${(error as Error).message}`);
    }
  }
}

export class GetCommentThreadTool extends BaseMCPTool {
  private workspaceManager: any;
  private workspaceId: string;

  constructor(workspaceManager: any, workspaceId: string) {
    super(
      'get_comment_thread',
      `Get a complete comment thread with all replies in chronological order.

This tool retrieves a thread by either:
- threadId: Get all comments in a specific thread
- commentId: Get the thread containing a specific comment

The response includes:
- Root comment (the first comment in the thread)
- All replies in chronological order
- Full context for understanding the conversation

Use this when you need to:
- Read the full conversation in a thread
- Understand the context before replying
- See all replies to a specific comment`,
      createInputSchema(
        {
          noteId: stringProperty(
            "The ID of the note containing the thread. Use 'spec' for the workspace specification",
          ),
          threadId: stringProperty(
            'Optional: The thread ID to retrieve. Either threadId or commentId must be provided',
          ),
          commentId: stringProperty(
            'Optional: Get the thread containing this comment. Either threadId or commentId must be provided',
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
      const { noteId, threadId, commentId } = call.arguments;

      if (!noteId) {
        return this.error('Note ID is required');
      }

      if (!threadId && !commentId) {
        return this.error('Either threadId or commentId must be provided');
      }

      // Check if the note exists first
      const note = await this.workspaceManager.getNote(this.workspaceId, noteId);
      if (!note) {
        return this.error(`Note not found: ${noteId}`);
      }

      // Get all comments for the note
      const result = await this.workspaceManager.listComments({
        workspaceId: this.workspaceId,
        noteId,
      });

      if (!result || !result.ok) {
        return this.error('Failed to retrieve comments');
      }

      const allComments = result.data || [];

      // Find the target thread ID
      let targetThreadId = threadId;
      if (!targetThreadId && commentId) {
        // Find the comment and get its threadId
        const comment = allComments.find((c: any) => c.id === commentId);
        if (!comment) {
          return this.error(`Comment not found: ${commentId}`);
        }
        targetThreadId = comment.threadId;
      }

      // Filter comments for this thread
      const threadComments = allComments.filter((c: any) => c.threadId === targetThreadId);

      if (threadComments.length === 0) {
        return this.error(`Thread not found: ${targetThreadId}`);
      }

      // Sort by creation time to get chronological order
      threadComments.sort(
        (a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );

      // Find root comment (no parentId)
      const rootComment = threadComments.find((c: any) => !c.parentId);
      const replies = threadComments.filter((c: any) => c.parentId);

      const thread = {
        threadId: targetThreadId,
        noteId,
        rootComment: rootComment || threadComments[0],
        replies,
        totalComments: threadComments.length,
        status: threadComments.every(
          (c: any) => c.status === 'resolved' || c.status === 'accepted' || c.status === 'rejected',
        )
          ? 'resolved'
          : 'open',
      };

      return this.success(JSON.stringify(thread, null, 2), {
        threadId: targetThreadId,
        commentCount: threadComments.length,
      });
    } catch (error) {
      return this.error(`Failed to get comment thread: ${(error as Error).message}`);
    }
  }
}

export class RespondToCommentThreadTool extends BaseMCPTool {
  private workspaceManager: any;
  private workspaceId: string;

  constructor(workspaceManager: any, workspaceId: string) {
    super(
      'respond_to_comment_thread',
      `Respond to a comment thread by adding a reply. This is the recommended way to reply to comments.

This tool:
1. Retrieves the full thread context automatically
2. Validates the thread exists
3. Adds your reply with the correct parentId and threadId
4. Uses the same anchor as the parent comment (no need to search for text)

Supports all comment types:
- 'comment': General response or discussion
- 'suggestion': Propose a specific change
- 'question': Ask for clarification
- 'change-request': Request a modification

For suggestions, you can optionally provide suggestionDiff with original and proposed text.`,
      createInputSchema(
        {
          noteId: stringProperty(
            "The ID of the note containing the thread. Use 'spec' for the workspace specification",
          ),
          threadId: stringProperty(
            'Optional: The thread ID to respond to. Either threadId or commentId must be provided',
          ),
          commentId: stringProperty(
            'Optional: Respond to the thread containing this comment. Either threadId or commentId must be provided',
          ),
          comment: stringProperty('Your response text'),
          author: stringProperty("Optional: Author name (defaults to 'Agent')"),
          type: stringProperty(
            "Optional: 'comment', 'suggestion', 'question', or 'change-request' (default: 'comment')",
          ),
          suggestionOriginal: stringProperty(
            "Optional: For type='suggestion', the original text to be changed",
          ),
          suggestionProposed: stringProperty(
            "Optional: For type='suggestion', the proposed replacement text",
          ),
        },
        ['noteId', 'comment'],
      ),
    );
    this.workspaceManager = workspaceManager;
    this.workspaceId = workspaceId;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const {
        noteId,
        threadId,
        commentId,
        comment,
        author = 'Agent',
        type = 'comment',
        suggestionOriginal,
        suggestionProposed,
      } = call.arguments;

      // Validate inputs
      if (!noteId) {
        return this.error('Note ID is required');
      }

      if (!threadId && !commentId) {
        return this.error('Either threadId or commentId must be provided');
      }

      if (!comment || typeof comment !== 'string' || comment.trim().length === 0) {
        return this.error('Comment text is required and must be non-empty');
      }

      // Validate suggestion fields if type is 'suggestion'
      if (type === 'suggestion') {
        if (!suggestionOriginal || !suggestionProposed) {
          return this.error(
            "For type='suggestion', both suggestionOriginal and suggestionProposed are required",
          );
        }
      }

      // Check if the note exists
      const note = await this.workspaceManager.getNote(this.workspaceId, noteId);
      if (!note) {
        return this.error(`Note not found: ${noteId}`);
      }

      // Get all comments for the note
      const result = await this.workspaceManager.listComments({
        workspaceId: this.workspaceId,
        noteId,
      });

      if (!result || !result.ok) {
        return this.error('Failed to retrieve comments');
      }

      const allComments = result.data || [];

      // Find the target thread ID
      let targetThreadId = threadId;
      let parentComment = null;

      if (!targetThreadId && commentId) {
        // Find the comment and get its threadId
        parentComment = allComments.find((c: any) => c.id === commentId);
        if (!parentComment) {
          return this.error(`Comment not found: ${commentId}`);
        }
        targetThreadId = parentComment.threadId;
      }

      // Get all comments in the thread
      const threadComments = allComments.filter((c: any) => c.threadId === targetThreadId);

      if (threadComments.length === 0) {
        return this.error(`Thread not found: ${targetThreadId}`);
      }

      // Sort by creation time to find the most recent comment
      threadComments.sort(
        (a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );

      // Use the most recent comment as the parent (or the specified comment if commentId was provided)
      if (!parentComment) {
        parentComment = threadComments[0];
      }

      // Build the comment data
      const commentData: any = {
        noteId,
        content: comment,
        author,
        authorType: 'agent',
        type,
        status: 'open',
        section: parentComment.section,
        threadId: targetThreadId,
        parentId: parentComment.id,
        markId: parentComment.markId, // Use same anchor as parent
      };

      // Add suggestion diff if provided
      if (type === 'suggestion' && suggestionOriginal && suggestionProposed) {
        commentData.suggestionDiff = {
          original: suggestionOriginal,
          proposed: suggestionProposed,
        };
      }

      // Add the comment through the workspace manager
      const addResult = await this.workspaceManager.addComment({
        workspaceId: this.workspaceId,
        ...commentData,
      });

      if (addResult && addResult.ok) {
        const newComment = addResult.data;
        return this.success(
          JSON.stringify(
            {
              success: true,
              message: 'Reply added successfully',
              comment: newComment,
              thread: {
                threadId: targetThreadId,
                totalComments: threadComments.length + 1,
              },
            },
            null,
            2,
          ),
          {
            commentId: newComment.id,
            threadId: targetThreadId,
            parentId: parentComment.id,
          },
        );
      } else {
        return this.error('Failed to add reply to thread');
      }
    } catch (error) {
      return this.error(`Failed to respond to comment thread: ${(error as Error).message}`);
    }
  }
}


export class DeleteNoteCommentTool extends BaseMCPTool {
  private workspaceManager: any;
  private workspaceId: string;

  constructor(workspaceManager: any, workspaceId: string) {
    super(
      'delete_note_comment',
      `Delete a comment from a note.

This tool permanently removes a comment by its ID. Use this to clean up
comments that are no longer relevant, were posted in error, or have been
addressed and should be removed.

You need:
- noteId: The ID of the note containing the comment
- commentId: The ID of the comment to delete`,
      createInputSchema(
        {
          noteId: stringProperty(
            "The ID of the note containing the comment. Use 'spec' for the workspace specification",
          ),
          commentId: stringProperty('The ID of the comment to delete'),
        },
        ['noteId', 'commentId'],
      ),
    );
    this.workspaceManager = workspaceManager;
    this.workspaceId = workspaceId;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      const { noteId, commentId } = call.arguments;

      if (!noteId) {
        return this.error('Note ID is required');
      }

      if (!commentId) {
        return this.error('Comment ID is required');
      }

      const result = await this.workspaceManager.deleteComment({
        workspaceId: this.workspaceId,
        noteId,
        commentId,
      });

      if (result && result.ok) {
        return this.success(
          JSON.stringify(
            {
              success: true,
              message: `Comment ${commentId} deleted from note ${noteId}`,
            },
            null,
            2,
          ),
          { noteId, commentId },
        );
      } else {
        return this.error(result?.error || 'Failed to delete comment');
      }
    } catch (error) {
      return this.error(`Failed to delete comment: ${(error as Error).message}`);
    }
  }
}
