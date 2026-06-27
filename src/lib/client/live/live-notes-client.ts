/**
 * Live notes domain backed by the intentd daemon.
 *
 * `list` resolves via `note.list({ workspaceId })`; `get` resolves the note's
 * workspace first (daemon `note.get` requires `workspaceId`, which the fixed
 * AppClient signature does not carry) then fetches it. Every listed note's
 * workspace is cached so note-scoped clients (tasks, comments) can resolve it.
 * `subscribe` aggregates notes across workspaces and refetches on `note:*`.
 */
import { ContentType, NoteVisibility } from "$shared/types";
import { NoteId, WorkspaceId } from "$shared/types/branded-ids";
import type { CreateNoteRequest, Note } from "$shared/types";
import type {
  MutationResult,
  NoteAddOptions,
  NoteMetadataPatch,
  NotesClient,
  SubscriptionHandler,
  Unsubscribe,
} from "../app-client";
import { backendRequest } from "./backend-transport";
import { createDeltaSubscription } from "./delta-subscription";
import {
  isEventInFamily,
  listWorkspaceIds,
  newIdempotencyKey,
  rememberNoteWorkspace,
  resolveNoteWorkspaceId,
  runMutation,
} from "./live-support";

/** Coerce a raw daemon note object into the renderer `Note` shape. */
export function normalizeNote(raw: Record<string, unknown>, workspaceId: string): Note {
  const now = new Date().toISOString();
  const id = String(raw.id ?? "");
  return {
    ...(raw as Partial<Note>),
    id: NoteId(id),
    workspaceId: WorkspaceId(String(raw.workspaceId ?? workspaceId)),
    title: String(raw.title ?? ""),
    content: String(raw.content ?? ""),
    contentType: (typeof raw.contentType === "string"
      ? raw.contentType
      : ContentType.Markdown) as ContentType,
    tags: Array.isArray(raw.tags) ? (raw.tags as string[]) : [],
    isPinned: Boolean(raw.isPinned ?? raw.is_pinned ?? false),
    isArchived: Boolean(raw.isArchived ?? raw.is_archived ?? false),
    visibility: (typeof raw.visibility === "string"
      ? raw.visibility
      : NoteVisibility.Workspace) as NoteVisibility,
    // Optimistic-concurrency revision (§11.4-D): carried through when the daemon
    // returns a number, forced to undefined otherwise (overriding the raw spread)
    // so a malformed value can never leak — no behavior change → last-writer-wins.
    rev: typeof raw.rev === "number" ? raw.rev : undefined,
    createdAt: String(raw.createdAt ?? raw.created_at ?? now),
    updatedAt: String(raw.updatedAt ?? raw.updated_at ?? now),
  } as Note;
}

export class LiveNotesClient implements NotesClient {
  async list(workspaceId: string): Promise<Note[]> {
    const result = await backendRequest<{ notes?: unknown[] }>("note.list", { workspaceId });
    const notes = Array.isArray(result?.notes) ? result.notes : [];
    return notes.map((n) => {
      const note = normalizeNote(n as Record<string, unknown>, workspaceId);
      rememberNoteWorkspace(String(note.id), workspaceId);
      return note;
    });
  }

  async get(noteId: string): Promise<Note | null> {
    const workspaceId = await resolveNoteWorkspaceId(noteId);
    if (!workspaceId) return null;
    try {
      const result = await backendRequest<{ note?: unknown } | unknown>("note.get", {
        workspaceId,
        noteId,
      });
      const raw =
        result && typeof result === "object" && "note" in result
          ? (result as { note?: unknown }).note
          : result;
      if (!raw || typeof raw !== "object") return null;
      return normalizeNote(raw as Record<string, unknown>, workspaceId);
    } catch {
      return null;
    }
  }

  // ---- Mutations ----------------------------------------------------------
  // Each forwards to the daemon (§7.8) and folds the outcome into a
  // MutationResult; the subscribe→refetch loop reconciles store state from the
  // resulting `note:*` events. `create` is workspace-scoped and carries an
  // idempotencyKey (§5.6); the rest are note-scoped, so the workspace is
  // resolved via `resolveNoteWorkspaceId` (the seam signature lacks it).

  async create(request: CreateNoteRequest): Promise<MutationResult> {
    return runMutation("note.create", { ...request, idempotencyKey: newIdempotencyKey() });
  }

  async setContent(
    noteId: string,
    content: string,
    expectedVersion?: number,
  ): Promise<MutationResult> {
    return this.runNoteMutation(noteId, "note.setContent", { content }, expectedVersion);
  }

  async add(
    noteId: string,
    content: string,
    options?: NoteAddOptions,
    expectedVersion?: number,
  ): Promise<MutationResult> {
    return this.runNoteMutation(
      noteId,
      "note.add",
      {
        content,
        ...(options?.heading !== undefined ? { heading: options.heading } : {}),
        ...(options?.position !== undefined ? { position: options.position } : {}),
      },
      expectedVersion,
    );
  }

  async edit(
    noteId: string,
    oldText: string,
    newText: string,
    expectedVersion?: number,
  ): Promise<MutationResult> {
    return this.runNoteMutation(noteId, "note.edit", { old: oldText, new: newText }, expectedVersion);
  }

  async editLines(
    noteId: string,
    start: number,
    end: number,
    content: string,
    expectedVersion?: number,
  ): Promise<MutationResult> {
    return this.runNoteMutation(noteId, "note.editLines", { start, end, content }, expectedVersion);
  }

  async delete(noteId: string, expectedVersion?: number): Promise<MutationResult> {
    return this.runNoteMutation(noteId, "note.delete", {}, expectedVersion);
  }

  async updateMetadata(
    noteId: string,
    metadata: NoteMetadataPatch,
    expectedVersion?: number,
  ): Promise<MutationResult> {
    return this.runNoteMutation(
      noteId,
      "note.updateMetadata",
      {
        ...(metadata.title !== undefined ? { title: metadata.title } : {}),
        ...(metadata.tags !== undefined ? { tags: metadata.tags } : {}),
      },
      expectedVersion,
    );
  }

  /**
   * Resolve a note's workspace, then issue a note-scoped mutation with
   * `{ workspaceId, noteId, ...params }`. `expectedVersion` (§11.4-D) is added to
   * the params ONLY when defined — when absent the daemon ignores it and
   * last-writer-wins applies, exactly as today. Returns a failed MutationResult
   * (never throws, never faked success) when the workspace cannot be resolved.
   */
  private async runNoteMutation(
    noteId: string,
    method: string,
    params: Record<string, unknown>,
    expectedVersion?: number,
  ): Promise<MutationResult> {
    const workspaceId = await resolveNoteWorkspaceId(noteId);
    if (!workspaceId) {
      return { success: false, error: `Cannot resolve workspace for note ${noteId}` };
    }
    const result = await runMutation(method, {
      workspaceId,
      noteId,
      ...params,
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
    });
    // On an optimistic-concurrency conflict (§11.4-D), normalize the raw
    // authoritative `current` into a renderer `Note` so the write service can
    // reload-to-latest (advancing the threaded rev) without touching daemon shapes.
    const current = result.conflict?.current;
    if (current && typeof current === "object") {
      return {
        ...result,
        conflict: { current: normalizeNote(current as Record<string, unknown>, workspaceId) },
      };
    }
    return result;
  }

  subscribe(handler: SubscriptionHandler<Note[]>): Unsubscribe {
    return createDeltaSubscription<Note>({
      eventTypes: ["note:created", "note:updated", "note:deleted"],
      matchLegacyEvent: (method, params) => isEventInFamily(method, params, "note"),
      fetchAll: async () => {
        const ids = await listWorkspaceIds();
        const perWorkspace = await Promise.all(ids.map((id) => this.list(id)));
        return perWorkspace.flat();
      },
      getId: (raw) => String(raw.id ?? ""),
      normalize: (raw) => {
        const workspaceId = String(raw.workspaceId ?? "");
        const note = normalizeNote(raw, workspaceId);
        rememberNoteWorkspace(String(note.id), String(note.workspaceId));
        return note;
      },
      handler,
    });
  }
}
