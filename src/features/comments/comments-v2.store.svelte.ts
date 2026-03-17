/**
 * Comments Store V2
 *
 * Out-of-band comment storage that works with anchor nodes.
 * Comments are stored separately from the document and linked via anchor IDs.
 */

import type { CommentV2 } from './comment-types-v2';
import { createLogger } from '$lib/utils/client-logger';
import { generateCommentId } from '$shared/utils/comment-id-generator';

export type { CommentV2 };

const logger = createLogger('CommentsStoreV2');

// Re-export CommentAnchor for backward compatibility
export interface CommentAnchor {
  type: 'range' | 'point';
  startId?: string; // For range comments
  endId?: string; // For range comments
  pointId?: string; // For point comments
}

export interface CommentThread {
  id: string;
  rootCommentId: string;
  commentIds: string[];
  status: 'open' | 'resolved';
  lastActivity: string;
}

class CommentsStoreV2 {
  // Core data structures
  private commentsById = $state<Map<string, CommentV2>>(new Map());
  private threadsByid = $state<Map<string, CommentThread>>(new Map());
  private commentsByThread = $state<Map<string, Set<string>>>(new Map());

  // UI state
  private selectedCommentId: string | null = $state(null);
  private hoveredCommentId: string | null = $state(null);
  private expandedThreadIds = $state<Set<string>>(new Set());

  // Reactive comments array - recreated whenever commentsById changes
  comments = $derived(Array.from(this.commentsById.values()));

  get threads() {
    return Array.from(this.threadsByid.values());
  }

  get selectedComment() {
    return this.selectedCommentId ? this.commentsById.get(this.selectedCommentId) : null;
  }

  get hoveredComment() {
    return this.hoveredCommentId ? this.commentsById.get(this.hoveredCommentId) : null;
  }

  // Comment operations
  addComment(comment: Omit<CommentV2, 'id' | 'createdAt' | 'updatedAt'>): CommentV2 {
    const id = generateCommentId();
    const now = new Date().toISOString();

    const newComment: CommentV2 = {
      ...comment,
      id,
      createdAt: now,
      updatedAt: now,
    } as CommentV2;

    this.commentsById.set(id, newComment);
    // Trigger reactivity by reassigning the Map
    this.commentsById = new Map(this.commentsById);

    // Update thread tracking
    if (!this.commentsByThread.has(comment.threadId)) {
      this.commentsByThread.set(comment.threadId, new Set());

      // Create thread if it doesn't exist
      const thread: CommentThread = {
        id: comment.threadId,
        rootCommentId: comment.parentId ? '' : id, // Set as root if no parent
        commentIds: [id],
        status: 'open',
        lastActivity: now,
      };
      this.threadsByid.set(comment.threadId, thread);
    } else {
      // Add to existing thread
      this.commentsByThread.get(comment.threadId)?.add(id);
      const thread = this.threadsByid.get(comment.threadId);
      if (thread) {
        thread.commentIds.push(id);
        thread.lastActivity = now;
        if (!thread.rootCommentId && !comment.parentId) {
          thread.rootCommentId = id;
        }
      }
    }

    logger.debug('Added comment', { id, threadId: comment.threadId });
    return newComment;
  }

  updateComment(id: string, updates: Partial<CommentV2>): boolean {
    const comment = this.commentsById.get(id);
    if (!comment) {
      logger.warn('Comment not found for update', { id });
      return false;
    }

    const updatedComment = {
      ...comment,
      ...updates,
      id: comment.id, // Ensure ID can't be changed
      updatedAt: new Date().toISOString(),
    } as CommentV2;

    this.commentsById.set(id, updatedComment);
    // Trigger reactivity by reassigning the Map
    this.commentsById = new Map(this.commentsById);

    // Update thread status if comment status changed
    if (updates.status && comment.threadId) {
      this.updateThreadStatus(comment.threadId);
    }

    logger.debug('Updated comment', { id, updates });
    return true;
  }

  removeComment(id: string): boolean {
    const comment = this.commentsById.get(id);
    if (!comment) {
      logger.warn('Comment not found for removal', { id });
      return false;
    }

    // Remove from maps
    this.commentsById.delete(id);
    // Trigger reactivity by reassigning the Map
    this.commentsById = new Map(this.commentsById);
    this.commentsByThread.get(comment.threadId)?.delete(id);

    // Update thread
    const thread = this.threadsByid.get(comment.threadId);
    if (thread) {
      thread.commentIds = thread.commentIds.filter((cid) => cid !== id);
      if (thread.commentIds.length === 0) {
        // Remove empty thread
        this.threadsByid.delete(comment.threadId);
        this.commentsByThread.delete(comment.threadId);
      } else if (thread.rootCommentId === id) {
        // Find new root if root was removed
        thread.rootCommentId = thread.commentIds[0];
      }
    }

    logger.debug('Removed comment', { id });
    return true;
  }

  getComment(id: string): CommentV2 | undefined {
    return this.commentsById.get(id);
  }

  getById(id: string): CommentV2 | undefined {
    return this.commentsById.get(id);
  }

  getCommentsForThread(threadId: string): CommentV2[] {
    const commentIds = this.commentsByThread.get(threadId);
    if (!commentIds) return [];

    return Array.from(commentIds)
      .map((id) => this.commentsById.get(id))
      .filter((c): c is CommentV2 => c !== undefined)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  // Thread operations
  private updateThreadStatus(threadId: string) {
    const thread = this.threadsByid.get(threadId);
    if (!thread) return;

    const comments = this.getCommentsForThread(threadId);
    const allResolved = comments.every(
      (c) => c.status === 'resolved' || c.status === 'accepted' || c.status === 'rejected',
    );

    thread.status = allResolved ? 'resolved' : 'open';
  }

  resolveThread(threadId: string) {
    const comments = this.getCommentsForThread(threadId);
    comments.forEach((comment) => {
      this.updateComment(comment.id, { status: 'resolved' });
    });
  }

  // UI state management
  selectComment(id: string | null) {
    this.selectedCommentId = id;
    logger.debug('Selected comment', { id });
  }

  hoverComment(id: string | null) {
    this.hoveredCommentId = id;
  }

  toggleThreadExpanded(threadId: string) {
    if (this.expandedThreadIds.has(threadId)) {
      this.expandedThreadIds.delete(threadId);
    } else {
      this.expandedThreadIds.add(threadId);
    }
  }

  isThreadExpanded(threadId: string): boolean {
    return this.expandedThreadIds.has(threadId);
  }

  // Bulk operations
  loadComments(comments: CommentV2[]) {
    // Clear existing data
    this.commentsById.clear();
    this.threadsByid.clear();
    this.commentsByThread.clear();

    // Load new comments
    comments.forEach((comment) => {
      this.commentsById.set(comment.id, comment);

      // Rebuild thread tracking
      if (!this.commentsByThread.has(comment.threadId)) {
        this.commentsByThread.set(comment.threadId, new Set());
      }
      this.commentsByThread.get(comment.threadId)?.add(comment.id);
    });

    // Rebuild threads
    this.commentsByThread.forEach((commentIds, threadId) => {
      const threadComments = Array.from(commentIds)
        .map((id) => this.commentsById.get(id))
        .filter((c): c is CommentV2 => c !== undefined);

      if (threadComments.length > 0) {
        const rootComment = threadComments.find((c) => !c.parentId) || threadComments[0];
        const lastActivity =
          threadComments
            .map((c) => c.updatedAt)
            .sort()
            .pop() || new Date().toISOString();

        const thread: CommentThread = {
          id: threadId,
          rootCommentId: rootComment.id,
          commentIds: Array.from(commentIds),
          status: threadComments.every(
            (c) => c.status === 'resolved' || c.status === 'accepted' || c.status === 'rejected',
          )
            ? 'resolved'
            : 'open',
          lastActivity,
        };

        this.threadsByid.set(threadId, thread);
      }
    });

    // Trigger reactivity by reassigning the Map
    this.commentsById = new Map(this.commentsById);

    logger.info('Loaded comments', { count: comments.length, threads: this.threadsByid.size });
  }

  clear() {
    this.commentsById.clear();
    this.threadsByid.clear();
    this.commentsByThread.clear();
    this.selectedCommentId = null;
    this.hoveredCommentId = null;
    this.expandedThreadIds.clear();
    logger.debug('Cleared all comments');
  }
}

// Export singleton instance
export const commentsStoreV2 = new CommentsStoreV2();
