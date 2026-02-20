import { commentsClient } from './comments.client';
import { Logger } from '../../shared/logger';
import type { NoteComment } from '../../shared/types';

const logger = new Logger('CommentLoader');

// Minimal input type for creating a new comment (ID is assigned by backend)
export type NewCommentInput = {
  content: string;
  type: NoteComment['type'];
  author: string;
  authorType: NoteComment['authorType'];
  status: NoteComment['status'];
  threadId?: string;
  parentId?: string;
  section?: string;
  lineStart?: number;
  lineEnd?: number;
  from?: number;
  to?: number;
  markId?: string;
  agentId?: string;
};

export interface CommentLoaderOptions {
  workspaceId: string;
  noteId?: string; // Optional noteId for loading note-specific comments
  useMockData?: boolean;
  mockComments?: NoteComment[];
}

/**
 * Load comments from IPC
 *
 * Fetches comments for a note directly via IPC.
 * Returns mock data in non-Electron environments or when useMockData is requested.
 */
export async function loadComments(options: CommentLoaderOptions): Promise<NoteComment[]> {
  const { workspaceId, noteId, useMockData = false, mockComments } = options;

  // Use mock data if requested
  if (useMockData) {
    return mockComments || getDefaultMockComments();
  }

  // Note ID is required
  if (!noteId) {
    logger.warn('[CommentLoader] No noteId provided, cannot load comments');
    return [];
  }

  try {
    // Load comments via IPC
    const result = await commentsClient.list(workspaceId, noteId);

    if (result.ok) {
      const data = result.data || [];
      logger.info('[CommentLoader] Successfully loaded comments:', data.length);
      const converted: NoteComment[] = (data as any[]).map((c: any) => ({
        id: c.id,
        noteId: c.noteId ?? noteId,
        threadId: c.threadId ?? c.id,
        author: c.author ?? 'Unknown',
        authorType: (c.authorType as NoteComment['authorType']) ?? 'user',
        type: c.type as NoteComment['type'],
        content: c.content ?? '',
        status: (c.status as NoteComment['status']) ?? 'open',
        createdAt: c.createdAt ?? new Date().toISOString(),
        updatedAt: c.updatedAt ?? new Date().toISOString(),
        parentId: c.parentId,
        section: c.section,
        lineStart: c.lineStart,
        lineEnd: c.lineEnd,
        reactions: c.reactions,
        suggestionDiff: c.suggestionDiff
          ? { original: c.suggestionDiff.original, proposed: c.suggestionDiff.proposed }
          : undefined,
        from: c.from,
        to: c.to,
        markId: c.markId,
        agentId: c.agentId,
      }));
      return converted;
    } else {
      logger.error('[CommentLoader] Failed to load comments:', result.error);
      return [];
    }
  } catch (error) {
    logger.error('[CommentLoader] Failed to load comments:', error);
    return [];
  }
}

/**
 * Default mock comments for testing
 */
function getDefaultMockComments(): NoteComment[] {
  return [
    {
      id: 'demo-comment-1',
      noteId: 'demo-note',
      threadId: 'thread-1',
      content: 'This is a demo comment for testing the unified layout system',
      author: 'Demo User',
      authorType: 'user',
      type: 'comment',
      status: 'open',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lineStart: 1,
      lineEnd: 3,
      section: 'Overview',
      reactions: {},
    },
    {
      id: 'demo-comment-2',
      noteId: 'demo-note',
      threadId: 'thread-2',
      content: 'Another test comment to verify layout algorithm',
      author: 'Demo User',
      authorType: 'user',
      type: 'suggestion',
      status: 'open',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lineStart: 10,
      lineEnd: 12,
      section: 'Goals',
      reactions: {},
    },
    {
      id: 'demo-comment-3',
      noteId: 'demo-note',
      threadId: 'thread-3',
      content: 'What about edge cases?',
      author: 'Reviewer',
      authorType: 'agent',
      type: 'question',
      status: 'open',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lineStart: 20,
      lineEnd: 22,
      section: 'Implementation',
      reactions: {},
    },
  ];
}

/**
 * Add a new comment via IPC
 */
export async function addComment(
  workspaceId: string,
  noteId: string,
  comment: NewCommentInput & { id?: string },
): Promise<NoteComment | null> {
  try {
    if (!noteId) {
      logger.error('[CommentLoader] noteId is required to add a comment');
      return null;
    }

    const payload = {
      ...(comment.id && { id: comment.id }), // Pass ID if provided
      workspaceId,
      noteId,
      content: comment.content,
      type: comment.type,
      author: comment.author,
      authorType: comment.authorType,
      section: comment.section,
      lineStart: comment.lineStart,
      lineEnd: comment.lineEnd,
      parentId: comment.parentId,
      threadId: comment.threadId,
      // Pass position data if available
      ...(comment.from !== undefined && { from: comment.from }),
      ...(comment.to !== undefined && { to: comment.to }),
      ...(comment.markId !== undefined && { markId: comment.markId }),
      ...(comment.agentId !== undefined && { agentId: comment.agentId }),
    };

    logger.info('[CommentLoader] Sending comment to backend', {
      commentId: comment.id,
      markId: comment.markId,
      hasId: !!comment.id,
      payloadId: payload.id,
      payloadMarkId: payload.markId,
      fullPayload: payload, // Log the entire payload to debug
    });

    const result = await commentsClient.add(payload);

    if (result.ok) {
      logger.info('[CommentLoader] Successfully added comment:', result.data.id);
      const c: any = result.data;
      const converted: NoteComment = {
        id: c.id,
        noteId: c.noteId ?? noteId,
        threadId: c.threadId ?? c.id,
        author: c.author ?? 'Unknown',
        authorType: (c.authorType as NoteComment['authorType']) ?? 'user',
        type: c.type as NoteComment['type'],
        content: c.content ?? '',
        status: (c.status as NoteComment['status']) ?? 'open',
        createdAt: c.createdAt ?? new Date().toISOString(),
        updatedAt: c.updatedAt ?? new Date().toISOString(),
        parentId: c.parentId,
        section: c.section,
        lineStart: c.lineStart,
        lineEnd: c.lineEnd,
        reactions: c.reactions,
        suggestionDiff: c.suggestionDiff
          ? { original: c.suggestionDiff.original, proposed: c.suggestionDiff.proposed }
          : undefined,
        from: c.from,
        to: c.to,
        markId: c.markId,
        agentId: c.agentId,
      };
      return converted;
    } else {
      logger.error('[CommentLoader] Failed to add comment:', result.error);
      return null;
    }
  } catch (error) {
    logger.error('[CommentLoader] Failed to add comment:', error);
    return null;
  }
}

/**
 * Resolve a comment via IPC
 */
export async function resolveComment(
  workspaceId: string,
  commentId: string,
  noteId: string = 'spec',
): Promise<boolean> {
  try {
    const result = await commentsClient.updateStatus({
      workspaceId,
      noteId,
      commentId,
      status: 'resolved',
    });

    return result.ok;
  } catch (error) {
    logger.error('[CommentLoader] Failed to resolve comment:', error);
    return false;
  }
}

/**
 * Reply to a comment via IPC
 */
export async function replyToComment(
  workspaceId: string,
  noteId: string,
  parentId: string,
  content: string,
  author: string,
): Promise<NoteComment | null> {
  try {
    const result = await commentsClient.add({
      workspaceId,
      noteId,
      content,
      type: 'comment',
      author,
      authorType: 'user',
      parentId,
    });

    if (result.ok) {
      logger.info('[CommentLoader] Successfully replied to comment');
      const c: any = result.data;
      const converted: NoteComment = {
        id: c.id,
        noteId: c.noteId ?? noteId,
        threadId: c.threadId ?? c.id,
        author: c.author ?? 'Unknown',
        authorType: (c.authorType as NoteComment['authorType']) ?? 'user',
        type: c.type as NoteComment['type'],
        content: c.content ?? '',
        status: (c.status as NoteComment['status']) ?? 'open',
        createdAt: c.createdAt ?? new Date().toISOString(),
        updatedAt: c.updatedAt ?? new Date().toISOString(),
        parentId: c.parentId,
        section: c.section,
        lineStart: c.lineStart,
        lineEnd: c.lineEnd,
        reactions: c.reactions,
        suggestionDiff: c.suggestionDiff
          ? { original: c.suggestionDiff.original, proposed: c.suggestionDiff.proposed }
          : undefined,
        from: c.from,
        to: c.to,
        markId: c.markId,
      };
      return converted;
    } else {
      logger.error('[CommentLoader] Failed to reply to comment:', result.error);
      return null;
    }
  } catch (error) {
    logger.error('[CommentLoader] Failed to reply to comment:', error);
    return null;
  }
}
