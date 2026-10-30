/**
 * Live notes domain backed by the intentd daemon.
 *
 * `list` resolves via `note.list({ workspaceId })`; `get` uses the caller's
 * `workspaceId` when supplied (daemon `note.get` requires one), falling back
 * to resolving the note's workspace via the cache. Every listed note's
 * workspace is cached so note-scoped clients (tasks, comments) can resolve it.
 * `subscribe` aggregates notes across workspaces, converging via one typed
 * per-workspace `note.subscribe` channel per workspace (PROTOCOL §6.9) — the
 * sole data path (intent-hq/monorepo#1697); there is no legacy `note:*`
 * events-driven refetch.
 */
import { m } from '$shared/paraglide/messages.js';
import { AuthorType, ContentType, NoteVisibility } from '$shared/types';
import { NoteId, WorkspaceId } from '$shared/types/branded-ids';
import { isProjectionRejected } from '$shared/utils/note-content';
import type { Author, CreateNoteRequest, Note, NoteVersion } from '$shared/types';
import type {
  MutationResult,
  NoteAddOptions,
  NoteGetOptions,
  NoteSetContentOptions,
  NoteMetadataPatch,
  NoteRestoreResult,
  NotesClient,
  SubscriptionHandler,
  Unsubscribe,
} from '../app-client';
import { backendRequest, observeBackendNodeCapabilities } from './backend-transport';
import { createDeltaSubscription } from './delta-subscription';
import {
  newIdempotencyKey,
  rememberNoteWorkspace,
  resolveNoteWorkspaceId,
  runMutation,
  runMutationWithId,
  subscribeWorkspaceIds,
} from './live-support';

/**
 * Parse a daemon version number (`v: i64` on the wire) from a value the FE may
 * carry as either a string (`NoteVersion.versionId`) or a number. Returns
 * `null` when the value cannot be resolved to a finite non-negative integer.
 */
function normalizeVersionNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.trunc(value);
  }
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.trunc(parsed);
  }
  return null;
}

/**
 * Adapt a daemon `NoteVersion` (§5.2 `{type, v, date, author, title, content}`)
 * into the renderer `NoteVersion` shape (`{versionId, versionNumber, createdAt,
 * ...}`). The daemon's `v: i64` is the version number; `versionId` is the
 * stringified `v` (opaque to the UI, unwrapped on restore).
 */
function normalizeNoteVersion(raw: unknown): NoteVersion | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const v = normalizeVersionNumber(r.v);
  if (v === null) return null;
  const authorRaw =
    r.author && typeof r.author === 'object' ? (r.author as Record<string, unknown>) : null;
  const author: Author | undefined = authorRaw
    ? {
        id: String(authorRaw.id ?? ''),
        name: String(authorRaw.name ?? ''),
        type: (typeof authorRaw.type === 'string'
          ? authorRaw.type
          : AuthorType.System) as AuthorType,
      }
    : undefined;
  return {
    versionId: String(v),
    versionNumber: v,
    content: String(r.content ?? ''),
    title: String(r.title ?? ''),
    ...(author ? { author } : {}),
    createdAt: String(r.date ?? ''),
  };
}

/** The daemon's truncated-read capability could not be read from an acknowledged hello. */
export class NoteCapabilityUnknownError extends Error {
  constructor() {
    super('Truncated note read capability is unknown: no acknowledged hello yet');
    this.name = 'NoteCapabilityUnknownError';
  }
}

/**
 * Only a transport that cannot report node capabilities at all is a plain "no":
 * one without the observer, or a renderer whose IPC router has no handler for
 * the capability channel (the in-memory mock router of browser and component
 * builds throws `UnbridgedMockIpcChannelError`, which no retry can change).
 * Every other failure — a connection that is changing, not connected yet, or a
 * transport error from the Electron bridge — leaves the capability unknown.
 */
function isTransientCapabilityError(error: unknown): boolean {
  if (!(error instanceof Error)) return true;
  if (error.message === m.agent_placement_unavailable()) return false;
  return error.name !== 'UnbridgedMockIpcChannelError';
}

/** Bounded wait for an acknowledged hello while it is being renewed (~3 s). */
const CAPABILITY_ATTEMPTS = 30;
const CAPABILITY_RETRY_MS = 100;

/** Coerce a raw daemon note object into the renderer `Note` shape. */
export function normalizeNote(raw: Record<string, unknown>, workspaceId: string): Note {
  const now = new Date().toISOString();
  const id = String(raw.id ?? '');
  return {
    ...(raw as Partial<Note>),
    id: NoteId(id),
    workspaceId: WorkspaceId(String(raw.workspaceId ?? workspaceId)),
    title: String(raw.title ?? ''),
    content: String(raw.content ?? ''),
    contentType: (typeof raw.contentType === 'string'
      ? raw.contentType
      : ContentType.Markdown) as ContentType,
    tags: Array.isArray(raw.tags) ? (raw.tags as string[]) : [],
    isPinned: Boolean(raw.isPinned ?? raw.is_pinned ?? false),
    isArchived: Boolean(raw.isArchived ?? raw.is_archived ?? false),
    visibility: (typeof raw.visibility === 'string'
      ? raw.visibility
      : NoteVisibility.Workspace) as NoteVisibility,
    // Optimistic-concurrency revision (§11.4-D): carried through when the daemon
    // returns a number, forced to undefined otherwise (overriding the raw spread)
    // so a malformed value can never leak — no behavior change → last-writer-wins.
    rev: typeof raw.rev === 'number' ? raw.rev : undefined,
    // Slim-projection fields (§5.2 `projection: "slim"`): carried through only
    // when the daemon returned them, undefined otherwise (overriding the raw
    // spread) so full rows never carry stale slim markers.
    contentPreview: typeof raw.contentPreview === 'string' ? raw.contentPreview : undefined,
    contentLength: typeof raw.contentLength === 'number' ? raw.contentLength : undefined,
    // Truncated-read markers (§5.2 "Truncated note reads"): carried only when
    // the daemon flagged a truncated prefix, undefined otherwise.
    contentTruncated: raw.contentTruncated === true ? true : undefined,
    contentBytes:
      raw.contentTruncated === true && typeof raw.contentBytes === 'number'
        ? raw.contentBytes
        : undefined,
    createdAt: String(raw.createdAt ?? raw.created_at ?? now),
    updatedAt: String(raw.updatedAt ?? raw.updated_at ?? now),
  } as Note;
}

export class LiveNotesClient implements NotesClient {
  async list(workspaceId: string, options?: { projection?: 'full' | 'slim' }): Promise<Note[]> {
    // §5.2 `projection`: only ride the wire when "slim" is requested so older
    // daemons see an unchanged request. If a daemon rejects the unknown param
    // (-32602 Invalid params), fall back once to the plain full list; other
    // failures (transport, workspace not found) propagate unchanged.
    let result: { notes?: unknown[] } | null;
    if (options?.projection === 'slim') {
      try {
        result = await backendRequest<{ notes?: unknown[] }>('note.list', {
          workspaceId,
          projection: 'slim',
        });
      } catch (error) {
        if (!isProjectionRejected(error)) throw error;
        result = await backendRequest<{ notes?: unknown[] }>('note.list', { workspaceId });
      }
    } else {
      result = await backendRequest<{ notes?: unknown[] }>('note.list', { workspaceId });
    }
    const notes = Array.isArray(result?.notes) ? result.notes : [];
    return notes.map((n) => {
      const note = normalizeNote(n as Record<string, unknown>, workspaceId);
      rememberNoteWorkspace(String(note.id), workspaceId);
      return note;
    });
  }

  /**
   * Whether the connected daemon advertises the truncated note read contract
   * (`server.capabilities.noteTruncatedRead === 1`, §5.2 "Truncated note reads").
   * Read from the acknowledged hello without another RPC.
   *
   * Resolves `true` / `false` only from an acknowledged hello (or `false` for a
   * transport that cannot report node capabilities at all). While the hello is
   * being renewed (startup, reconnect) the answer is unknown, not "no": it waits
   * briefly and then rejects with {@link NoteCapabilityUnknownError}, so a view
   * read fails (and can be retried) instead of loading a large note whole.
   */
  async supportsTruncatedRead(): Promise<boolean> {
    for (let attempt = 0; attempt < CAPABILITY_ATTEMPTS; attempt++) {
      try {
        const hello = (await observeBackendNodeCapabilities()) as {
          server?: { capabilities?: { noteTruncatedRead?: unknown } | null };
        } | null;
        const capabilities = hello?.server?.capabilities;
        if (capabilities) return capabilities.noteTruncatedRead === 1;
      } catch (error) {
        if (!isTransientCapabilityError(error)) return false;
      }
      await new Promise((resolve) => setTimeout(resolve, CAPABILITY_RETRY_MS));
    }
    throw new NoteCapabilityUnknownError();
  }

  async get(
    noteId: string,
    explicitWorkspaceId?: string,
    options?: NoteGetOptions,
  ): Promise<Note | null> {
    // The caller's workspaceId wins over the resolver cache — note ids are not
    // globally unique (every workspace has a `spec` note) and the cache is
    // last-writer-wins across workspaces (monorepo#621).
    const workspaceId = explicitWorkspaceId ?? (await resolveNoteWorkspaceId(noteId));
    if (!workspaceId) return null;
    try {
      const result = await backendRequest<{ note?: unknown } | unknown>('note.get', {
        workspaceId,
        noteId,
        ...(options?.maxContentBytes !== undefined
          ? { maxContentBytes: options.maxContentBytes }
          : {}),
      });
      const raw =
        result && typeof result === 'object' && 'note' in result
          ? (result as { note?: unknown }).note
          : result;
      if (!raw || typeof raw !== 'object') return null;
      return normalizeNote(raw as Record<string, unknown>, workspaceId);
    } catch {
      return null;
    }
  }

  // ---- Mutations ----------------------------------------------------------
  // Each forwards to the daemon (§7.8) and folds the outcome into a
  // MutationResult; the subscribe→refetch loop reconciles store state from the
  // resulting `note:*` events. `create` is workspace-scoped and carries an
  // idempotencyKey (§5.6); the rest are note-scoped — the caller-supplied
  // `workspaceId` wins when provided, otherwise the workspace is resolved via
  // `resolveNoteWorkspaceId` (fallback-only; the cache is last-writer-wins).

  async create(request: CreateNoteRequest): Promise<MutationResult> {
    // Surface the daemon-assigned id (`{ note: { id } }`, §5.2) so callers act on
    // the note they created rather than guessing it from a relist (intent#4780).
    return runMutationWithId('note.create', { ...request, idempotencyKey: newIdempotencyKey() });
  }

  async setContent(
    noteId: string,
    content: string,
    expectedVersion?: number,
    workspaceId?: string,
    options?: NoteSetContentOptions,
  ): Promise<MutationResult> {
    return this.runNoteMutation(
      noteId,
      'note.setContent',
      {
        content,
        ...(options?.baseContentBytes !== undefined
          ? { baseContentBytes: options.baseContentBytes }
          : {}),
      },
      expectedVersion,
      workspaceId,
    );
  }

  async add(
    noteId: string,
    content: string,
    options?: NoteAddOptions,
    expectedVersion?: number,
    workspaceId?: string,
  ): Promise<MutationResult> {
    return this.runNoteMutation(
      noteId,
      'note.add',
      {
        content,
        ...(options?.heading !== undefined ? { heading: options.heading } : {}),
        ...(options?.position !== undefined ? { position: options.position } : {}),
      },
      expectedVersion,
      workspaceId,
    );
  }

  async edit(
    noteId: string,
    oldText: string,
    newText: string,
    expectedVersion?: number,
    workspaceId?: string,
  ): Promise<MutationResult> {
    return this.runNoteMutation(
      noteId,
      'note.edit',
      { old: oldText, new: newText },
      expectedVersion,
      workspaceId,
    );
  }

  async editLines(
    noteId: string,
    start: number,
    end: number,
    content: string,
    expectedVersion?: number,
    workspaceId?: string,
  ): Promise<MutationResult> {
    return this.runNoteMutation(
      noteId,
      'note.editLines',
      { start, end, content },
      expectedVersion,
      workspaceId,
    );
  }

  async delete(
    noteId: string,
    expectedVersion?: number,
    workspaceId?: string,
  ): Promise<MutationResult> {
    return this.runNoteMutation(noteId, 'note.delete', {}, expectedVersion, workspaceId);
  }

  async updateMetadata(
    noteId: string,
    metadata: NoteMetadataPatch,
    expectedVersion?: number,
    workspaceId?: string,
  ): Promise<MutationResult> {
    return this.runNoteMutation(
      noteId,
      'note.updateMetadata',
      {
        ...(metadata.title !== undefined ? { title: metadata.title } : {}),
        ...(metadata.tags !== undefined ? { tags: metadata.tags } : {}),
      },
      expectedVersion,
      workspaceId,
    );
  }

  // ---- Version history (PROTOCOL §5.2) ------------------------------------
  // `note.listVersions` returns summaries (no content). The version-history UI
  // renders the diff viewer against each version's content, so this method
  // fetches the summaries then batches `note.getVersion` for each to hydrate
  // the content — adapting the daemon `{v, date, ...}` shape to the FE
  // `NoteVersion` shape (`{versionId, versionNumber, createdAt, ...}`). Errors
  // propagate so callers can surface them; the middleware maps thrown errors
  // to `applyNoteVersionsError`.

  async listVersions(workspaceId: string, noteId: string): Promise<NoteVersion[]> {
    const summaries = await backendRequest<unknown[]>('note.listVersions', {
      workspaceId,
      noteId,
    });
    if (!Array.isArray(summaries) || summaries.length === 0) return [];
    const full = await Promise.all(
      summaries.map((s) => {
        const v = normalizeVersionNumber((s as { v?: unknown }).v);
        if (v === null) return Promise.resolve(null);
        return backendRequest<unknown>('note.getVersion', { workspaceId, noteId, v })
          .then((raw) => normalizeNoteVersion(raw))
          .catch(() => null);
      }),
    );
    return full.filter((v): v is NoteVersion => v !== null);
  }

  async restoreVersion(
    workspaceId: string,
    noteId: string,
    versionId: string,
  ): Promise<NoteRestoreResult> {
    const v = normalizeVersionNumber(versionId);
    if (v === null) {
      return { success: false, error: `Invalid version id: ${versionId}` };
    }
    try {
      const raw = await backendRequest<{ ok?: boolean; note?: unknown }>('note.restoreVersion', {
        workspaceId,
        noteId,
        v,
      });
      const note =
        raw && typeof raw === 'object' && raw.note && typeof raw.note === 'object'
          ? normalizeNote(raw.note as Record<string, unknown>, workspaceId)
          : undefined;
      return { success: true, note };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Issue a note-scoped mutation with `{ workspaceId, noteId, ...params }`.
   * Uses the caller's `explicitWorkspaceId` when supplied (note ids are not
   * globally unique — every workspace has a `spec` note — and the resolver
   * cache is last-writer-wins across workspaces); otherwise resolves the
   * note's workspace via the cache. `expectedVersion` (§11.4-D) is added to
   * the params ONLY when defined — when absent the daemon ignores it and
   * last-writer-wins applies, exactly as today. Returns a failed MutationResult
   * (never throws, never faked success) when the workspace cannot be resolved.
   */
  private async runNoteMutation(
    noteId: string,
    method: string,
    params: Record<string, unknown>,
    expectedVersion?: number,
    explicitWorkspaceId?: string,
  ): Promise<MutationResult> {
    const workspaceId = explicitWorkspaceId ?? (await resolveNoteWorkspaceId(noteId));
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
    if (current && typeof current === 'object') {
      return {
        ...result,
        conflict: { current: normalizeNote(current as Record<string, unknown>, workspaceId) },
      };
    }
    return result;
  }

  /**
   * Subscribe to notes across every workspace.
   *
   * Typed §6.9 channel: one per-workspace `note.subscribe`
   * (`{ workspaceId }`) is registered per id yielded by
   * `subscribeWorkspaceIds` — the sole data path (intent-hq/monorepo#1697).
   * Workspace add → a new channel registers and its snapshot merges in;
   * workspace delete → the channel unsubscribes and its notes are evicted.
   */
  subscribe(handler: SubscriptionHandler<Note[]>): Unsubscribe {
    return createDeltaSubscription<Note>({
      channel: {
        subscribeMethod: 'note.subscribe',
        unsubscribeMethod: 'note.unsubscribe',
        dynamic: {
          subscribeIds: subscribeWorkspaceIds,
          paramsForId: (id) => ({ workspaceId: id }),
        },
      },
      getId: (raw) => String(raw.id ?? ''),
      // Push-path entities are the daemon's wire `Note` (§9.1), which always
      // carries `workspaceId` (camelCase serde) — no per-channel stamping.
      normalize: (raw) => {
        const workspaceId = String(raw.workspaceId ?? '');
        if (!workspaceId) return null;
        const note = normalizeNote(raw, workspaceId);
        rememberNoteWorkspace(String(note.id), workspaceId);
        return note;
      },
      handler,
    });
  }
}
