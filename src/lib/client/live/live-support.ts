/**
 * Shared helpers for the live domain clients.
 *
 * Several daemon read methods are workspace-scoped (`note.get`, `comment.list`,
 * `file.read`, …) while the corresponding AppClient signatures only carry an
 * entity id (the interface is fixed). These helpers bridge that gap:
 *  - `listWorkspaceIds()` enumerates the daemon's workspaces so a no-arg
 *    `subscribe()` can aggregate workspace-scoped collections.
 *  - a small note→workspace index, populated by `LiveNotesClient.list`, lets the
 *    note-scoped clients (`notes.get`, `tasks.get`, `comments.list`) resolve a
 *    workspace without an extra parameter; when the cache misses they fall back
 *    to scanning the workspace list.
 */
import type { MutationResult } from "../app-client";
import { backendRequest } from "./backend-transport";

/**
 * Generate an idempotency key for create/commit/merge mutations (§5.6): a UUID
 * when the platform exposes `crypto.randomUUID`, otherwise a best-effort unique
 * string. The server dedupes retried requests by this key.
 */
export function newIdempotencyKey(): string {
  const cryptoObj = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof cryptoObj?.randomUUID === "function") return cryptoObj.randomUUID();
  return `idk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Human-readable message for a failed mutation. The daemon maps
 * `Error::Internal` to JSON-RPC -32603 with the hardcoded message
 * "Internal error" and carries the real cause as a string in `error.data`; the
 * main-process bridge (`json-rpc-errors.ts`) normalizes that string onto
 * `data.detail` before it crosses the IPC boundary. When the generic message
 * is all we have, fold the detail into the message so toasts stay actionable.
 * A raw string `data` is handled too for transports that skip the
 * normalization.
 */
function mutationErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "Internal error" && error && typeof error === "object") {
    const data = (error as { data?: unknown }).data;
    if (typeof data === "string" && data.length > 0) return `${message}: ${data}`;
    if (data && typeof data === "object") {
      const detail = (data as { detail?: unknown }).detail;
      if (typeof detail === "string" && detail.length > 0) return `${message}: ${detail}`;
    }
  }
  return message;
}

/** Numeric JSON-RPC code the daemon returns for an optimistic-concurrency conflict (§11.4-D). */
export const CONFLICT_RPC_CODE = -32005;

/**
 * Detect the daemon's optimistic-concurrency conflict response EXACTLY: numeric
 * `rpcCode === -32005` AND `data.code === "conflict"`. On a match it returns the
 * authoritative server entity (`data.current`, which carries the advanced `rev`)
 * wrapped for the MutationResult; every other error returns `undefined` so
 * generic failures behave exactly as today. Duck-typed (no `instanceof`) so it
 * works regardless of how the transport layer is mocked in tests.
 */
export function extractConflict(error: unknown): { current: unknown } | undefined {
  if (!error || typeof error !== "object") return undefined;
  if ((error as { rpcCode?: unknown }).rpcCode !== CONFLICT_RPC_CODE) return undefined;
  const data = (error as { data?: unknown }).data;
  if (!data || typeof data !== "object") return undefined;
  if ((data as { code?: unknown }).code !== "conflict") return undefined;
  return { current: (data as { current?: unknown }).current };
}

/**
 * Extract the daemon's echoed authoritative note revision (`noteRev`, #638)
 * from a mutation response. Returned by mutations that rewrite a note's
 * content daemon-side (e.g. `comment.add`'s anchor insertion). Tolerant of
 * older daemons that omit the field: returns `undefined` unless the response
 * carries a finite number.
 */
function extractNoteRev(result: unknown): number | undefined {
  if (!result || typeof result !== "object") return undefined;
  const noteRev = (result as { noteRev?: unknown }).noteRev;
  return typeof noteRev === "number" && Number.isFinite(noteRev) ? noteRev : undefined;
}

/**
 * Issue a mutating JSON-RPC request and fold the outcome into a `MutationResult`:
 * success on resolve, `{ success: false, error }` on any transport/daemon error.
 * An optimistic-concurrency conflict (§11.4-D) additionally carries the raw
 * `conflict.current` so callers can reload-to-latest. When the daemon echoes an
 * authoritative `noteRev` (#638), it is surfaced on the result so rev
 * bookkeeping can consume it instead of inferring `rev + 1`. The seam never
 * throws from a mutation. State convergence is otherwise left to the existing
 * subscribe→refetch loops driven by daemon events.
 *
 * `options.timeoutMs` overrides the JSON-RPC client's default 30s timeout for
 * long-running operations (e.g. `workspace.delete` bulk operations on large
 * checkouts).
 */
export async function runMutation(
  method: string,
  params?: unknown,
  options?: { timeoutMs?: number },
): Promise<MutationResult> {
  try {
    // Only forward options when defined to preserve 2-arg wire protocol shape
    const result = await (options !== undefined
      ? backendRequest(method, params, options)
      : backendRequest(method, params));
    const noteRev = extractNoteRev(result);
    return noteRev !== undefined ? { success: true, noteRev } : { success: true };
  } catch (error) {
    const conflict = extractConflict(error);
    if (conflict) return { success: false, error: mutationErrorMessage(error), conflict };
    return { success: false, error: mutationErrorMessage(error) };
  }
}

/**
 * Extract the canonical entity id from a daemon mutation response. Handles a
 * bare entity (`{ id }`) and the common single-entity wrappers the daemon uses
 * (`{ task }`, `{ note }`, `{ entity }`). Returns undefined when no id is found.
 */
function extractEntityId(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const record = result as Record<string, unknown>;
  const direct = record.id;
  if (typeof direct === "string" && direct.length > 0) return direct;
  for (const key of ["task", "note", "entity"]) {
    const nested = record[key];
    if (nested && typeof nested === "object") {
      const nestedId = (nested as Record<string, unknown>).id;
      if (typeof nestedId === "string" && nestedId.length > 0) return nestedId;
    }
  }
  return undefined;
}

/**
 * Like `runMutation`, but also surfaces the created/affected entity's canonical
 * id on success when the daemon returns one (e.g. the Rev 2 §7.9 task mutations
 * return a WorkspaceTask). Call sites that need the new id — such as creating a
 * prerequisite task and then linking to it — use this variant; the id is omitted
 * when the response carries none.
 */
export async function runMutationWithId(
  method: string,
  params?: unknown,
  options?: { timeoutMs?: number },
): Promise<MutationResult> {
  try {
    // Only forward options when defined to preserve 2-arg wire protocol shape
    const result = await (options !== undefined
      ? backendRequest(method, params, options)
      : backendRequest(method, params));
    const id = extractEntityId(result);
    return id !== undefined ? { success: true, id } : { success: true };
  } catch (error) {
    const conflict = extractConflict(error);
    if (conflict) return { success: false, error: mutationErrorMessage(error), conflict };
    return { success: false, error: mutationErrorMessage(error) };
  }
}

/** Enumerate the daemon's workspace ids (best-effort; empty on transport error). */
export async function listWorkspaceIds(): Promise<string[]> {
  try {
    const result = await backendRequest<{ workspaces?: unknown[] }>("workspace.list");
    const workspaces = Array.isArray(result?.workspaces) ? result.workspaces : [];
    return workspaces
      .map((w) => String((w as { id?: unknown; workspaceId?: unknown }).id ?? (w as { workspaceId?: unknown }).workspaceId ?? ""))
      .filter((id) => id.length > 0);
  } catch {
    return [];
  }
}

/** noteId → workspaceId, populated as notes are listed so note-scoped reads resolve. */
const noteWorkspaceIndex = new Map<string, string>();

/** Record the workspace a note belongs to (called from `LiveNotesClient.list`). */
export function rememberNoteWorkspace(noteId: string, workspaceId: string): void {
  if (noteId && workspaceId) noteWorkspaceIndex.set(noteId, workspaceId);
}

/**
 * Resolve the workspace a note belongs to. Returns the cached value when known,
 * otherwise scans each workspace's `note.list` (caching every note it sees)
 * until the note is found. Returns `null` when no workspace claims the note.
 */
export async function resolveNoteWorkspaceId(noteId: string): Promise<string | null> {
  const cached = noteWorkspaceIndex.get(noteId);
  if (cached) return cached;

  for (const workspaceId of await listWorkspaceIds()) {
    try {
      const result = await backendRequest<{ notes?: unknown[] }>("note.list", { workspaceId });
      const notes = Array.isArray(result?.notes) ? result.notes : [];
      let found = false;
      for (const note of notes) {
        const id = String((note as { id?: unknown }).id ?? "");
        if (id) rememberNoteWorkspace(id, workspaceId);
        if (id === noteId) found = true;
      }
      if (found) return workspaceId;
    } catch {
      // Skip workspaces whose notes cannot be listed.
    }
  }
  return null;
}

/**
 * Resolve the event `type` from an `events.event` notification's params. The
 * daemon wraps each domain event as `{ event: { type, … }, subscriptionId? }`
 * (mirrors extractEvent in features/events/daemon-events-bridge.ts); legacy /
 * flat payloads place `type` directly on params. Returns `undefined` only when
 * the type is genuinely absent AFTER unwrapping, so the family/type matchers'
 * defensive-match branch still fires for truly typeless payloads but not for
 * properly wrapped events of an unrelated family.
 */
function resolveEventType(params: unknown): string | undefined {
  if (!params || typeof params !== "object") return undefined;
  const wrapped = (params as { event?: unknown }).event;
  if (wrapped && typeof wrapped === "object") {
    const wrappedType = (wrapped as { type?: unknown }).type;
    if (typeof wrappedType === "string") return wrappedType;
  }
  const flat = (params as { type?: unknown }).type;
  return typeof flat === "string" ? flat : undefined;
}

/** Whether a daemon notification belongs to the given colon-delimited event family. */
export function isEventInFamily(method: string, params: unknown, family: string): boolean {
  if (method !== "events.event") return false;
  const type = resolveEventType(params);
  // Refetch on any event whose type starts with the family; if the type is
  // absent (older daemons) refetch defensively.
  return type === undefined || type.startsWith(family);
}

/** Whether a daemon notification's event type is one of the listed types. */
export function isEventOneOf(method: string, params: unknown, types: readonly string[]): boolean {
  if (method !== "events.event") return false;
  const type = resolveEventType(params);
  if (type === undefined) return true;
  return types.includes(type);
}
