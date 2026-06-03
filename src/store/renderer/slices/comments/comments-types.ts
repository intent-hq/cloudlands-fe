/**
 * Comments V2 Redux slice types.
 *
 * Safe to import from any process (no renderer-only dependencies).
 */

import type { Collection } from "ag-redux-toolkit/utils/collections/collection-utils";
import type { CommentV2 } from "$features/comments/comment-types-v2";

export type { CommentV2 };

export interface CommentThread {
  id: string;
  rootCommentId: string;
  commentIds: string[];
  status: "open" | "resolved";
  lastActivity: string;
}

export type CommentsV2State = {
  /** All comments keyed by id */
  commentsById: Collection<CommentV2, "id">;
  /** All threads keyed by id */
  threadsById: Collection<CommentThread, "id">;
  /** Mapping of threadId → array of commentIds in that thread */
  commentIdsByThread: Record<string, string[]>;
  /** Currently selected comment id */
  selectedCommentId: string | null;
  /** Currently hovered comment id */
  hoveredCommentId: string | null;
  /** Set of expanded thread ids (Record<string, true>) */
  expandedThreadIds: Record<string, true>;
};

