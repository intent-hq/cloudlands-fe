/**
 * Comments Client
 *
 * Daemon-backed comment reads/mutations (PROTOCOL §5.3 `comment.*`).
 *
 * Formerly routed `comments:*` IPC to the local FileSystemCommentsRepository
 * (JSON files) — a split-brain store agents never wrote to. All operations now
 * go over `backendRequest` so UI comments and agent comments share the daemon
 * store. Anchored comment creation and deletion live in
 * `comments-write-service` (appClient.comments.*); this client covers the
 * legacy `NoteComment`-shaped surface used by `comment-loader`.
 */

import type { Result, NoteComment } from '../../shared/types';
import { backendRequest } from '$lib/client/live/backend-transport';
import { m } from '$shared/paraglide/messages.js';

export interface ListCommentsParams {
  status?: 'open' | 'resolved' | 'pending' | 'all';
  type?: 'comment' | 'suggestion' | 'change-request' | 'question' | 'session' | 'all';
  author?: string;
}

export interface AddCommentParams {
  id?: string; // Allow frontend to provide its own ID
  workspaceId: string;
  noteId: string;
  content: string;
  type: 'comment' | 'suggestion' | 'change-request' | 'question' | 'session';
  author: string;
  authorType: 'user' | 'agent';
  section?: string;
  lineStart?: number;
  lineEnd?: number;
  parentId?: string;
  threadId?: string;
  tags?: string;
  // Store exact positions for accurate mark placement
  from?: number;
  to?: number;
  markId?: string;
  agentId?: string;
}

export interface UpdateStatusParams {
  workspaceId: string;
  noteId: string;
  commentId: string;
  status: 'open' | 'resolved' | 'pending';
  resolvedBy?: string;
}

/** Map a raw daemon comment (§8.7) into the legacy `NoteComment` shape. */
function normalizeComment(raw: Record<string, unknown>, noteId: string): NoteComment {
  const now = new Date().toISOString();
  const id = String(raw.id ?? '');
  const suggestionDiff =
    raw.suggestionDiff && typeof raw.suggestionDiff === 'object'
      ? {
          original: String((raw.suggestionDiff as Record<string, unknown>).original ?? ''),
          proposed: String((raw.suggestionDiff as Record<string, unknown>).proposed ?? ''),
        }
      : undefined;
  return {
    id,
    noteId: String(raw.noteId ?? noteId),
    threadId: String(raw.threadId ?? id),
    content: String(raw.content ?? ''),
    author: String(raw.author ?? ''),
    authorType: raw.authorType === 'agent' ? 'agent' : 'user',
    type: (typeof raw.type === 'string' ? raw.type : 'comment') as NoteComment['type'],
    status: (typeof raw.status === 'string' ? raw.status : 'open') as NoteComment['status'],
    createdAt: String(raw.createdAt ?? now),
    updatedAt: String(raw.updatedAt ?? now),
    ...(typeof raw.parentId === 'string' ? { parentId: raw.parentId } : {}),
    ...(raw.anchorText !== undefined || raw.section !== undefined
      ? { section: String(raw.anchorText ?? raw.section ?? '') }
      : {}),
    ...(suggestionDiff ? { suggestionDiff } : {}),
    ...(typeof raw.agentId === 'string' ? { agentId: raw.agentId } : {}),
  };
}

function toError(error: unknown): string {
  return error instanceof Error ? error.message : m.comments_client_backendRequestFailed_error();
}

class CommentsClient {
  /**
   * List a note's comments via `comment.list` (§5.3). The daemon returns a
   * `{ threads }` envelope; `includeComments` nests each thread's comments,
   * which are flattened into the legacy flat `NoteComment[]`.
   */
  async list(
    workspaceId: string,
    noteId: string,
    params?: ListCommentsParams,
  ): Promise<Result<NoteComment[], string>> {
    try {
      const result = await backendRequest<{ threads?: unknown[] }>('comment.list', {
        workspaceId,
        noteId,
        includeComments: true,
        ...(params?.status && params.status !== 'all' ? { status: params.status } : {}),
      });
      const threads = Array.isArray(result?.threads) ? result.threads : [];
      let comments: NoteComment[] = [];
      for (const t of threads) {
        if (!t || typeof t !== 'object') continue;
        const thread = t as { comments?: unknown[] };
        if (Array.isArray(thread.comments)) {
          for (const c of thread.comments) {
            comments.push(normalizeComment(c as Record<string, unknown>, noteId));
          }
        } else {
          // Thread summary fallback when `includeComments` was not honored.
          comments.push(normalizeComment(thread as Record<string, unknown>, noteId));
        }
      }
      if (params?.type && params.type !== 'all') {
        comments = comments.filter((c) => c.type === params.type);
      }
      if (params?.author) {
        comments = comments.filter((c) => c.author === params.author);
      }
      return { ok: true, data: comments };
    } catch (error) {
      return { ok: false, error: toError(error) };
    }
  }

  /**
   * Add a reply to an existing thread/comment via `comment.respond` (§5.3).
   *
   * The daemon's `comment.add` anchors new comments by text search
   * (`searchContext`/`commentTarget`), which this legacy param shape does not
   * carry — anchored creation goes through `comments-write-service`
   * (appClient.comments.add). Calls without a `parentId`/`threadId` fail
   * loudly instead of writing anywhere.
   */
  async add(params: AddCommentParams): Promise<Result<NoteComment, string>> {
    if (!params.parentId && !params.threadId) {
      return {
        ok: false,
        error:
          'commentsClient.add only supports replies (comment.respond); ' +
          'use comments-write-service for new anchored comments (comment.add)',
      };
    }
    try {
      const response = await backendRequest<Record<string, unknown>>('comment.respond', {
        workspaceId: params.workspaceId,
        noteId: params.noteId,
        ...(params.parentId ? { commentId: params.parentId } : { threadId: params.threadId }),
        comment: params.content,
        type: params.type,
        ...(params.author ? { author: params.author } : {}),
        ...(params.authorType ? { authorType: params.authorType } : {}),
      });
      const raw = (response ?? {}) as Record<string, unknown>;
      const now = new Date().toISOString();
      // Echo the created reply; the subscribe→refetch loop reconciles the
      // store to the canonical daemon state.
      const reply: NoteComment = {
        id: String(raw.commentId ?? raw.id ?? params.id ?? ''),
        noteId: params.noteId,
        threadId:
          typeof raw.threadId === 'string'
            ? raw.threadId
            : (params.threadId ?? params.parentId),
        content: params.content,
        author: params.author,
        authorType: params.authorType,
        type: params.type,
        status: 'open',
        createdAt: now,
        updatedAt: now,
        ...(params.parentId ? { parentId: params.parentId } : {}),
        ...(params.section ? { section: params.section } : {}),
        ...(params.agentId ? { agentId: params.agentId } : {}),
      };
      return { ok: true, data: reply };
    } catch (error) {
      return { ok: false, error: toError(error) };
    }
  }

  /**
   * Update a comment's resolved state via `comment.resolveThread` (§5.3
   * extension) — the daemon resolves/unresolves the whole thread addressed by
   * `commentId`. There is no daemon arm for `pending`; any non-`resolved`
   * status maps to `resolved: false`.
   */
  async updateStatus(params: UpdateStatusParams): Promise<Result<void, string>> {
    try {
      await backendRequest('comment.resolveThread', {
        workspaceId: params.workspaceId,
        noteId: params.noteId,
        commentId: params.commentId,
        resolved: params.status === 'resolved',
      });
      return { ok: true, data: undefined };
    } catch (error) {
      return { ok: false, error: toError(error) };
    }
  }
}

export const commentsClient = new CommentsClient();
