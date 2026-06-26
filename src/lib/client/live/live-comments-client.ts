/**
 * Live comments domain backed by the intentd daemon.
 *
 * `comment.list` is workspace-scoped (`{ workspaceId, noteId }`) while the fixed
 * AppClient signature only carries `noteId`, so the note's workspace is resolved
 * first (see `resolveNoteWorkspaceId`). Results are normalized into the renderer
 * `CommentV2` shape. `subscribe` refetches on `comment:*` events.
 */
import type {
  CommentAnchor,
  CommentStatus,
  CommentType,
  CommentV2,
  AuthorType as CommentAuthorType,
} from "$features/comments/comment-types-v2";
import type {
  CommentsClient,
  SubscriptionHandler,
  Unsubscribe,
} from "../app-client";
import {
  backendRequest,
  backendSubscribe,
  backendUnsubscribe,
  onBackendNotification,
} from "./backend-transport";
import { isEventInFamily, resolveNoteWorkspaceId } from "./live-support";

/** Coerce a raw daemon comment object into the renderer `CommentV2` shape. */
function normalizeComment(raw: Record<string, unknown>, noteId: string): CommentV2 {
  const now = new Date().toISOString();
  const id = String(raw.id ?? "");
  const anchor =
    raw.anchor && typeof raw.anchor === "object"
      ? (raw.anchor as CommentAnchor)
      : ({ type: "point" } as CommentAnchor);
  return {
    ...(raw as Partial<CommentV2>),
    id,
    threadId: String(raw.threadId ?? id),
    noteId: String(raw.noteId ?? noteId),
    type: (typeof raw.type === "string" ? raw.type : "comment") as CommentType,
    content: String(raw.content ?? ""),
    author: String(raw.author ?? ""),
    authorType: (raw.authorType === "agent" ? "agent" : "user") as CommentAuthorType,
    status: (typeof raw.status === "string" ? raw.status : "open") as CommentStatus,
    anchor,
    createdAt: String(raw.createdAt ?? now),
    updatedAt: String(raw.updatedAt ?? now),
  } as CommentV2;
}

async function fetchComments(noteId: string): Promise<CommentV2[]> {
  const workspaceId = await resolveNoteWorkspaceId(noteId);
  if (!workspaceId) return [];
  try {
    const result = await backendRequest<{ comments?: unknown[] } | unknown[]>("comment.list", {
      workspaceId,
      noteId,
    });
    const comments = Array.isArray(result)
      ? result
      : Array.isArray((result as { comments?: unknown[] })?.comments)
        ? (result as { comments: unknown[] }).comments
        : [];
    return comments.map((c) => normalizeComment(c as Record<string, unknown>, noteId));
  } catch {
    return [];
  }
}

export class LiveCommentsClient implements CommentsClient {
  async list(noteId: string): Promise<CommentV2[]> {
    return fetchComments(noteId);
  }

  subscribe(noteId: string, handler: SubscriptionHandler<CommentV2[]>): Unsubscribe {
    let disposed = false;
    let subscriptionId: string | undefined;

    const emit = () => {
      fetchComments(noteId)
        .then((comments) => {
          if (!disposed) handler(comments);
        })
        .catch(() => {
          // Snapshot refresh failures are non-fatal for the subscription.
        });
    };

    emit();

    const off = onBackendNotification((n) => {
      if (isEventInFamily(n.method, n.params, "comment")) emit();
    });

    backendSubscribe<{ subscriptionId?: string }>({ eventTypes: ["comment:added"] })
      .then((result) => {
        subscriptionId = result?.subscriptionId;
        if (disposed && subscriptionId) void backendUnsubscribe(subscriptionId);
      })
      .catch(() => {
        // Without a daemon subscription we still serve the initial snapshot.
      });

    return () => {
      disposed = true;
      off();
      if (subscriptionId) void backendUnsubscribe(subscriptionId);
    };
  }
}
