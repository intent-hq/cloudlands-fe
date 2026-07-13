/**
 * Comment Types
 *
 * Shared types for comments that can be safely imported in both
 * main process and renderer process code.
 */

/**
 * Represents a comment on a note
 */
export interface NoteComment {
  id: string;
  noteId: string;
  author: string;
  authorType: 'user' | 'agent';
  type: 'comment' | 'suggestion' | 'change-request' | 'question' | 'session';
  content: string;
  lineStart?: number;
  lineEnd?: number;
  section?: string;
  status: 'open' | 'resolved' | 'pending';
  createdAt: string;
  updatedAt: string;
  parentId?: string;
  threadId?: string;
  tags?: string[];
  reactions?: Record<string, string>;
  suggestionDiff?: {
    original: string;
    proposed: string;
    lineStart?: number;
    lineEnd?: number;
  };
  // Store exact positions for accurate mark placement
  from?: number;
  to?: number;
  // Store anchor IDs for the new comment system
  markId?: string;
  // Track whether comment anchors are orphaned (missing from document)
  isOrphaned?: boolean;
  // Link to agent for "session" type comments
  agentId?: string;
}

/**
 * Data structure for storing comments associated with a note
 */
export interface NoteCommentsData {
  version: string;
  comments: NoteComment[];
  lastUpdated: string;
}
