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

/** Human-readable message for a failed mutation. */
function mutationErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Issue a mutating JSON-RPC request and fold the outcome into a `MutationResult`:
 * success on resolve, `{ success: false, error }` on any transport/daemon error.
 * The seam never throws from a mutation. State convergence is left to the
 * existing subscribe→refetch loops driven by daemon events.
 */
export async function runMutation(method: string, params?: unknown): Promise<MutationResult> {
  try {
    await backendRequest(method, params);
    return { success: true };
  } catch (error) {
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

/** Whether a daemon notification belongs to the given colon-delimited event family. */
export function isEventInFamily(method: string, params: unknown, family: string): boolean {
  if (method !== "events.event") return false;
  const type = (params as { type?: unknown } | undefined)?.type;
  // Refetch on any event whose type starts with the family; if the type is
  // absent (older daemons) refetch defensively.
  return typeof type !== "string" || type.startsWith(family);
}

/** Whether a daemon notification's event type is one of the listed types. */
export function isEventOneOf(method: string, params: unknown, types: readonly string[]): boolean {
  if (method !== "events.event") return false;
  const type = (params as { type?: unknown } | undefined)?.type;
  if (typeof type !== "string") return true;
  return types.includes(type);
}
