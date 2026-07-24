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
  CommentAddParams,
  CommentRespondParams,
  CommentsClient,
  MutationResult,
  SubscriptionHandler,
  Unsubscribe,
} from "../app-client";
import { backendRequest } from "./backend-transport";
import { createDeltaSubscription } from "./delta-subscription";
import {
  isEventInFamily,
  newIdempotencyKey,
  resolveNoteWorkspaceId,
  runMutation,
} from "./live-support";

/** Coerce the daemon's §8.7 reaction map into the renderer `Record<string, string[]>`. */
function normalizeReactions(raw: unknown): Record<string, string[]> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.map((v) => String(v)) : [String(value)],
    ]),
  );
}

/** Map the daemon's optional nested `anchorContext { before, after }` (§8.7). */
function normalizeAnchorContext(raw: unknown): { before: string; after: string } | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const ctx = raw as { before?: unknown; after?: unknown };
  return { before: String(ctx.before ?? ""), after: String(ctx.after ?? "") };
}

/** Map the daemon's nested suggestion diff `{ original, proposed }` (§8.7). */
function normalizeSuggestionDiff(raw: unknown): { original: string; proposed: string } {
  const diff = (raw && typeof raw === "object" ? raw : {}) as {
    original?: unknown;
    proposed?: unknown;
  };
  return { original: String(diff.original ?? ""), proposed: String(diff.proposed ?? "") };
}

/**
 * Coerce a raw daemon comment object into the renderer `CommentV2` shape.
 *
 * Builds the discriminated union explicitly per `type` so the subtype-required
 * fields are populated from the daemon's §8.7 shape — nested `anchorContext`
 * for every subtype and `suggestionDiff` for suggestions — rather than a raw
 * spread/cast that would leave those fields unset (Wave 6.1 §8.7 nit).
 */
function normalizeComment(
  raw: Record<string, unknown>,
  noteId: string,
  workspaceId?: string,
): CommentV2 {
  const now = new Date().toISOString();
  const id = String(raw.id ?? "");
  const anchor =
    raw.anchor && typeof raw.anchor === "object"
      ? (raw.anchor as CommentAnchor)
      : ({ type: "point" } as CommentAnchor);
  const anchorContext = normalizeAnchorContext(raw.anchorContext);
  const reactions = normalizeReactions(raw.reactions);

  const base = {
    id,
    threadId: String(raw.threadId ?? id),
    noteId: String(raw.noteId ?? noteId),
    ...(workspaceId ? { workspaceId } : {}),
    content: String(raw.content ?? ""),
    author: String(raw.author ?? ""),
    authorType: (raw.authorType === "agent" ? "agent" : "user") as CommentAuthorType,
    status: (typeof raw.status === "string" ? raw.status : "open") as CommentStatus,
    anchor,
    createdAt: String(raw.createdAt ?? now),
    updatedAt: String(raw.updatedAt ?? now),
    ...(typeof raw.parentId === "string" ? { parentId: raw.parentId } : {}),
    ...(raw.anchorText !== undefined || raw.section !== undefined
      ? { anchorText: String(raw.anchorText ?? raw.section ?? "") }
      : {}),
    ...(anchorContext ? { anchorContext } : {}),
    ...(typeof raw.isOrphaned === "boolean" ? { isOrphaned: raw.isOrphaned } : {}),
    ...(reactions ? { reactions } : {}),
  };

  const type = (typeof raw.type === "string" ? raw.type : "comment") as CommentType;
  switch (type) {
    case "suggestion":
      return { ...base, type, suggestionDiff: normalizeSuggestionDiff(raw.suggestionDiff) };
    case "session":
      return { ...base, type, agentId: String(raw.agentId ?? "") };
    case "change-request":
    case "question":
      return { ...base, type };
    case "comment":
    default:
      return { ...base, type: "comment" };
  }
}

async function fetchComments(noteId: string, explicitWorkspaceId?: string): Promise<CommentV2[]> {
  const workspaceId = explicitWorkspaceId ?? (await resolveNoteWorkspaceId(noteId));
  if (!workspaceId) return [];
  try {
    // PROTOCOL §5.3: `comment.list` returns `{ threads: [...] }` and only
    // populates each `threads[].comments` when `includeComments` is set. The
    // renderer needs a flat `CommentV2[]`, so request the nested comments and
    // flatten them in order.
    const result = await backendRequest<{ threads?: unknown[] }>("comment.list", {
      workspaceId,
      noteId,
      includeComments: true,
    });
    const threads = Array.isArray((result as { threads?: unknown[] })?.threads)
      ? (result as { threads: unknown[] }).threads
      : [];
    const out: CommentV2[] = [];
    for (const t of threads) {
      if (!t || typeof t !== "object") continue;
      const thread = t as { comments?: unknown[] };
      if (Array.isArray(thread.comments)) {
        for (const c of thread.comments) {
          out.push(normalizeComment(c as Record<string, unknown>, noteId, workspaceId));
        }
      } else {
        // Trivial fallback when `includeComments` was not honored: the
        // thread summary itself becomes a head-comment proxy (threadId,
        // status, timestamps) so the renderer at least sees the thread.
        out.push(normalizeComment(thread as Record<string, unknown>, noteId, workspaceId));
      }
    }
    return out;
  } catch {
    return [];
  }
}

export class LiveCommentsClient implements CommentsClient {
  async list(noteId: string, workspaceId?: string): Promise<CommentV2[]> {
    return fetchComments(noteId, workspaceId);
  }

  // ---- Mutations ----------------------------------------------------------
  // Each forwards to the daemon (§7) and folds the outcome into a
  // MutationResult; the subscribe→refetch loop reconciles store state from the
  // resulting `comment:*` events. Comments are note-scoped; the workspace is
  // the caller-supplied `workspaceId` when provided, otherwise resolved via
  // `resolveNoteWorkspaceId`. The explicit id matters because note ids are not
  // globally unique (every workspace holds a `spec` note) and the resolver's
  // last-writer-wins cache can point a shared id at the wrong workspace.

  async add(noteId: string, params: CommentAddParams): Promise<MutationResult> {
    return this.runCommentMutation(
      noteId,
      "comment.add",
      {
        searchContext: params.searchContext,
        commentTarget: params.commentTarget,
        comment: params.comment,
        ...(params.type !== undefined ? { type: params.type } : {}),
        ...(params.author !== undefined ? { author: params.author } : {}),
        ...(params.authorType !== undefined ? { authorType: params.authorType } : {}),
        idempotencyKey: newIdempotencyKey(),
      },
      params.workspaceId,
    );
  }

  async respond(noteId: string, params: CommentRespondParams): Promise<MutationResult> {
    return this.runCommentMutation(
      noteId,
      "comment.respond",
      {
        ...(params.threadId !== undefined ? { threadId: params.threadId } : {}),
        ...(params.commentId !== undefined ? { commentId: params.commentId } : {}),
        comment: params.comment,
        ...(params.type !== undefined ? { type: params.type } : {}),
        ...(params.suggestionOriginal !== undefined
          ? { suggestionOriginal: params.suggestionOriginal }
          : {}),
        ...(params.suggestionProposed !== undefined
          ? { suggestionProposed: params.suggestionProposed }
          : {}),
      },
      params.workspaceId,
    );
  }

  async delete(noteId: string, commentId: string, workspaceId?: string): Promise<MutationResult> {
    return this.runCommentMutation(noteId, "comment.delete", { commentId }, workspaceId);
  }

  /**
   * Issue a note-scoped comment mutation with `{ workspaceId, noteId, ...params }`.
   * Uses the caller's `explicitWorkspaceId` when supplied; otherwise resolves
   * the note's workspace via the cache. Returns a failed MutationResult
   * (never throws, never faked success) when the workspace cannot be resolved.
   */
  private async runCommentMutation(
    noteId: string,
    method: string,
    params: Record<string, unknown>,
    explicitWorkspaceId?: string,
  ): Promise<MutationResult> {
    const workspaceId = explicitWorkspaceId ?? (await resolveNoteWorkspaceId(noteId));
    if (!workspaceId) {
      return { success: false, error: `Cannot resolve workspace for note ${noteId}` };
    }
    return runMutation(method, { workspaceId, noteId, ...params });
  }

  subscribe(noteId: string, handler: SubscriptionHandler<CommentV2[]>): Unsubscribe {
    return createDeltaSubscription<CommentV2>({
      eventTypes: ["comment:added"],
      matchLegacyEvent: (method, params) => isEventInFamily(method, params, "comment"),
      fetchAll: () => fetchComments(noteId),
      getId: (raw) => String(raw.id ?? ""),
      normalize: (raw) => normalizeComment(raw, noteId),
      handler,
    });
  }
}
