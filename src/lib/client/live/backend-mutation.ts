import type { MutationResult } from '../client-types';
import type { BackendTransport } from './backend-transport-types';

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
export function mutationErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'Internal error' && error && typeof error === 'object') {
    const data = (error as { data?: unknown }).data;
    if (typeof data === 'string' && data.length > 0) return `${message}: ${data}`;
    if (data && typeof data === 'object') {
      const detail = (data as { detail?: unknown }).detail;
      if (typeof detail === 'string' && detail.length > 0) return `${message}: ${detail}`;
    }
  }
  return message;
}

/** Numeric JSON-RPC code the daemon returns for an optimistic-concurrency conflict (§11.4-D). */
const CONFLICT_RPC_CODE = -32005;

/**
 * Detect the daemon's optimistic-concurrency conflict response EXACTLY: numeric
 * `rpcCode === -32005` AND `data.code === "conflict"`. On a match it returns the
 * authoritative server entity (`data.current`, which carries the advanced `rev`)
 * wrapped for the MutationResult; every other error returns `undefined` so
 * generic failures behave exactly as today. Duck-typed (no `instanceof`) so it
 * works regardless of how the transport layer is mocked in tests.
 */
export function extractConflict(error: unknown): { current: unknown } | undefined {
  if (!error || typeof error !== 'object') return undefined;
  if ((error as { rpcCode?: unknown }).rpcCode !== CONFLICT_RPC_CODE) return undefined;
  const data = (error as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return undefined;
  if ((data as { code?: unknown }).code !== 'conflict') return undefined;
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
  if (!result || typeof result !== 'object') return undefined;
  const noteRev = (result as { noteRev?: unknown }).noteRev;
  return typeof noteRev === 'number' && Number.isFinite(noteRev) ? noteRev : undefined;
}

/**
 * Extract the full-content write echo from a `note.setContent` response: the
 * authoritative merged `newContent` and, on daemons that report it, the
 * post-write `rev` (additive — after a merge the stored rev is not
 * `sentRev + 1`, so callers cannot infer it). `rev` is only read alongside
 * `newContent` so unrelated mutation results never surface a stray `rev`.
 */
function extractContentEcho(result: unknown): { newContent: string; rev?: number } | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const { newContent, rev } = result as { newContent?: unknown; rev?: unknown };
  if (typeof newContent !== 'string') return undefined;
  return typeof rev === 'number' && Number.isFinite(rev) ? { newContent, rev } : { newContent };
}

/**
 * Issue a mutating JSON-RPC request and fold the outcome into a `MutationResult`:
 * success on resolve, `{ success: false, error }` on any transport/daemon error.
 * An optimistic-concurrency conflict (§11.4-D) additionally carries the raw
 * `conflict.current` so callers can reload-to-latest. When the daemon echoes an
 * authoritative `noteRev` (#638), it is surfaced on the result so rev
 * bookkeeping can consume it instead of inferring `rev + 1`; a `note.setContent`
 * echo (`newContent` + optional `rev`) is surfaced as `newContent` / `noteRev`
 * so the save path can apply the daemon's merged text. The seam never
 * throws from a mutation. State convergence is otherwise left to the existing
 * subscribe→refetch loops driven by daemon events.
 *
 * `options.timeoutMs` overrides the JSON-RPC client's default 30s timeout for
 * long-running operations (e.g. `workspace.delete` bulk operations on large
 * checkouts).
 */
export function createRunMutation(backendRequest: BackendTransport['request']) {
  async function runMutation(
    method: string,
    params?: unknown,
    options?: { timeoutMs?: number },
  ): Promise<MutationResult> {
    try {
      // Only forward options when defined to preserve 2-arg wire protocol shape
      const result = await (options !== undefined
        ? backendRequest(method, params, options)
        : backendRequest(method, params));
      const echo = extractContentEcho(result);
      const noteRev = extractNoteRev(result) ?? echo?.rev;
      return {
        success: true,
        ...(noteRev !== undefined ? { noteRev } : {}),
        ...(echo !== undefined ? { newContent: echo.newContent } : {}),
      };
    } catch (error) {
      const conflict = extractConflict(error);
      if (conflict) return { success: false, error: mutationErrorMessage(error), conflict };
      return { success: false, error: mutationErrorMessage(error) };
    }
  }

  return runMutation;
}
