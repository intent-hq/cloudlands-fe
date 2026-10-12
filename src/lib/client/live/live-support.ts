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
import { createNoteWorkspaceDiscovery } from './backend-note-workspace-discovery';
import { createWorkspaceIdRuntime } from './backend-workspace-id-runtime';
import type { MutationResult } from '../app-client';
import { backendRequest, onBackendNotification, onBackendReconnected } from './backend-transport';

export { newIdempotencyKey } from './idempotency-key';

// Svelte compatibility binding; remove at the renderer cutover.
import { createRunMutation, extractConflict, mutationErrorMessage } from './backend-mutation';
export { extractConflict, mutationErrorMessage } from './backend-mutation';
export const runMutation = createRunMutation(<T>(...args: Parameters<typeof backendRequest>) =>
  backendRequest<T>(...args),
);

/**
 * Extract the canonical entity id from a daemon mutation response. Handles a
 * bare entity (`{ id }`) and the common single-entity wrappers the daemon uses
 * (`{ task }`, `{ note }`, `{ entity }`). Returns undefined when no id is found.
 */
function extractEntityId(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const record = result as Record<string, unknown>;
  const direct = record.id;
  if (typeof direct === 'string' && direct.length > 0) return direct;
  for (const key of ['task', 'note', 'entity']) {
    const nested = record[key];
    if (nested && typeof nested === 'object') {
      const nestedId = (nested as Record<string, unknown>).id;
      if (typeof nestedId === 'string' && nestedId.length > 0) return nestedId;
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

// Svelte compatibility binding shared by every collection and note resolver.
// Remove at renderer cutover after all consumers use their renderer's single owner.
const workspaceIds = createWorkspaceIdRuntime({
  backendRequest: <T>(...args: Parameters<typeof backendRequest>): Promise<T> =>
    backendRequest<T>(...args),
  onBackendNotification: (...args: Parameters<typeof onBackendNotification>) =>
    onBackendNotification(...args),
  onBackendReconnected: (...args: Parameters<typeof onBackendReconnected>) =>
    onBackendReconnected(...args),
});

export const { listWorkspaceIds, subscribeWorkspaceIds } = workspaceIds;
const { listWorkspaceIdsOrThrow } = workspaceIds;

/** Test-only: clear the module-level workspace.list / note-resolution caches. */
export function __resetLiveSupportCachesForTests(): void {
  workspaceIds.resetListCachesForTests();
  noteWorkspaceDiscovery.resetTransientCachesForTests();
}

// Svelte compatibility binding shared by notes, tasks and comments.
// Remove at renderer cutover after every consumer uses its renderer's discovery owner.
const noteWorkspaceDiscovery = createNoteWorkspaceDiscovery({
  backendRequest: <T>(...args: Parameters<typeof backendRequest>): Promise<T> =>
    backendRequest<T>(...args),
  listWorkspaceIdsOrThrow,
});

export const { rememberNoteWorkspace, resolveNoteWorkspaceId } = noteWorkspaceDiscovery;

export { isEventInFamily, isEventOneOf } from './backend-event-matchers';
