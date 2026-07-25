/**
 * Type-safe comment types using discriminated unions
 *
 * This ensures that type-specific fields are properly enforced at compile time.
 * Each comment type has its own interface with required type-specific fields.
 */

export type CommentType = 'comment' | 'suggestion' | 'change-request' | 'question' | 'session';
export type CommentStatus = 'open' | 'resolved' | 'accepted' | 'rejected' | 'pending';
export type AuthorType = 'user' | 'agent';

export interface CommentAnchor {
  type: 'range' | 'point';
  startId?: string; // For range comments
  endId?: string; // For range comments
  pointId?: string; // For point comments
}

/**
 * Base fields shared by all comment types
 */
interface BaseComment {
  id: string;
  threadId: string;
  content: string;
  author: string;
  authorType: AuthorType;
  status: CommentStatus;
  createdAt: string;
  updatedAt: string;
  parentId?: string;
  noteId?: string;
  /**
   * The note's owning workspace. Note ids are not globally unique (every
   * workspace has a `spec` note), so consumers reconciling the global slice
   * per note must scope by workspaceId too when it is present.
   */
  workspaceId?: string;
  /**
   * Absent on post-#729 replies: only thread roots carry an authoritative
   * anchor on the wire; replies anchor through their thread root
   * (`threadId`/`parentId`, PROTOCOL §5.3 "Reply anchoring").
   */
  anchor?: CommentAnchor;
  anchorText?: string;
  anchorContext?: {
    before: string;
    after: string;
  };
  isOrphaned?: boolean;
  reactions?: Record<string, string[]>;
}

/**
 * Regular comment - no special fields
 */
export interface RegularComment extends BaseComment {
  type: 'comment';
}

/**
 * Suggestion comment - requires suggestionDiff
 */
export interface SuggestionComment extends BaseComment {
  type: 'suggestion';
  suggestionDiff: {
    original: string;
    proposed: string;
  };
}

/**
 * Change request comment - no special fields currently
 */
export interface ChangeRequestComment extends BaseComment {
  type: 'change-request';
}

/**
 * Question comment - no special fields currently
 */
export interface QuestionComment extends BaseComment {
  type: 'question';
}

/**
 * Session comment - requires agentId
 */
export interface SessionComment extends BaseComment {
  type: 'session';
  agentId: string; // Required for session comments
}

/**
 * Discriminated union of all comment types
 * TypeScript will enforce that type-specific fields are present based on the 'type' field
 */
export type CommentV2 =
  | RegularComment
  | SuggestionComment
  | ChangeRequestComment
  | QuestionComment
  | SessionComment;

/**
 * Type guard to check if a comment is a session comment
 */
export function isSessionComment(comment: CommentV2): comment is SessionComment {
  return comment.type === 'session';
}

/**
 * Type guard to check if a comment is a suggestion comment
 */
export function isSuggestionComment(comment: CommentV2): comment is SuggestionComment {
  return comment.type === 'suggestion';
}

/**
 * Helper to create a session comment with type safety
 */
export function createSessionComment(
  base: Omit<BaseComment, 'type'>,
  agentId: string,
): SessionComment {
  return {
    ...base,
    type: 'session',
    agentId,
  };
}

/**
 * Helper to create a suggestion comment with type safety
 */
export function createSuggestionComment(
  base: Omit<BaseComment, 'type'>,
  suggestionDiff: { original: string; proposed: string },
): SuggestionComment {
  return {
    ...base,
    type: 'suggestion',
    suggestionDiff,
  };
}

/**
 * Conversion helper that ensures all fields are properly mapped
 * This function will cause TypeScript errors if required fields are missing
 *
 * `anchor` is optional: post-#729 replies carry no anchor (PROTOCOL §5.3
 * "Reply anchoring") — callers pass `undefined` for them so no anchor key is
 * set, keeping the stored shape identical to the wire shape.
 */
export function convertBackendCommentToV2(
  backendComment: any,
  anchor: CommentAnchor | undefined,
  noteId: string,
  workspaceId?: string,
): CommentV2 {
  // Normalize reactions format
  const reactions = backendComment.reactions
    ? Object.fromEntries(
      Object.entries(backendComment.reactions).map(([k, v]) => [
        k,
        Array.isArray(v) ? (v as string[]) : [v as string],
      ]),
    )
    : undefined;

  const base = {
    id: backendComment.id,
    threadId: backendComment.threadId || `thread-${backendComment.id}`,
    content: backendComment.content,
    author: backendComment.author,
    authorType: backendComment.authorType as AuthorType,
    status: backendComment.status as CommentStatus,
    createdAt: backendComment.createdAt,
    updatedAt: backendComment.updatedAt,
    parentId: backendComment.parentId,
    noteId,
    ...(workspaceId ? { workspaceId } : {}),
    ...(anchor ? { anchor } : {}),
    ...(backendComment.section !== undefined ? { anchorText: backendComment.section } : {}),
    ...(backendComment.anchorContext !== undefined
      ? { anchorContext: backendComment.anchorContext }
      : {}),
    isOrphaned: backendComment.isOrphaned,
    reactions,
  };

  // Type-specific handling with compile-time safety
  switch (backendComment.type) {
    case 'session':
      // Handle legacy session comments that may not have agentId
      return createSessionComment(base, backendComment.agentId || 'unknown');

    case 'suggestion':
      if (!backendComment.suggestionDiff) {
        throw new Error(`Suggestion comment ${backendComment.id} missing required suggestionDiff`);
      }
      return createSuggestionComment(base, backendComment.suggestionDiff);

    case 'comment':
    case 'change-request':
    case 'question':
      return { ...base, type: backendComment.type };

    default:
      throw new Error(`Unknown comment type: ${backendComment.type}`);
  }
}
