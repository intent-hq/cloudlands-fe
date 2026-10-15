import type { NotesClient, NoteSetContentOptions } from '../app-client';
import type { BackendRequestOptions } from './backend-transport-types';
import { createRunMutation, mutationErrorMessage } from './backend-mutation';
import { normalizeNote } from './note-normalization';

/** Canonical note.setContent encoder; strict callers must identify the workspace and base revision. */
export function createNoteSetContent({
  backendRequest,
  resolveNoteWorkspaceId,
}: {
  backendRequest: <T = unknown>(
    method: string,
    params?: unknown,
    options?: BackendRequestOptions & Partial<Pick<NoteSetContentOptions, 'onDispatch'>>,
  ) => Promise<T>;
  resolveNoteWorkspaceId?: (noteId: string) => Promise<string | null>;
}): NotesClient['setContent'] {
  const runMutation = createRunMutation(backendRequest);
  return async (noteId, content, expectedVersion, explicitWorkspaceId, options) => {
    if (
      options &&
      (!explicitWorkspaceId ||
        !noteId ||
        typeof content !== 'string' ||
        typeof expectedVersion !== 'number' ||
        !Number.isSafeInteger(expectedVersion) ||
        expectedVersion < 0)
    )
      return { success: false, contentOutcome: 'failed' };
    const workspaceId = explicitWorkspaceId ?? (await resolveNoteWorkspaceId?.(noteId));
    if (!workspaceId)
      return {
        success: false,
        error: `Cannot resolve workspace for note ${noteId}`,
        ...(options ? { contentOutcome: 'failed' as const } : {}),
      };
    const params = {
      workspaceId,
      noteId,
      content,
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
    };
    if (!options) {
      const result = await runMutation('note.setContent', params);
      const current = result.conflict?.current;
      return current && typeof current === 'object'
        ? {
            ...result,
            conflict: { current: normalizeNote(current as Record<string, unknown>, workspaceId) },
          }
        : result;
    }
    let dispatched = false;
    try {
      const result = await backendRequest<unknown>('note.setContent', params, {
        onDispatch: () => {
          options.onDispatch();
          dispatched = true;
        },
      });
      if (dispatched && result && typeof result === 'object' && !Array.isArray(result)) {
        const {
          ok,
          noteId: echoedId,
          newContent,
          rev,
        } = result as { ok?: unknown; noteId?: unknown; newContent?: unknown; rev?: unknown };
        if (
          ok === true &&
          echoedId === noteId &&
          typeof newContent === 'string' &&
          typeof rev === 'number' &&
          Number.isSafeInteger(rev) &&
          typeof expectedVersion === 'number' &&
          rev >= expectedVersion
        )
          return { success: true, contentOutcome: 'confirmed', newContent, noteRev: rev };
      }
      return { success: false, contentOutcome: 'unknown' };
    } catch (error) {
      const rpcCode = (error as { rpcCode?: unknown } | null)?.rpcCode;
      // Generic server failures may follow persistence. Only these pre-write refusals are definite.
      const refused = [-32600, -32601, -32602, -32003].includes(rpcCode as number);
      return {
        success: false,
        error: mutationErrorMessage(error),
        contentOutcome: !dispatched || refused ? 'failed' : 'unknown',
      };
    }
  };
}
