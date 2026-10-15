import type { NotesClient, NoteCreateOptions } from '../app-client';
import type { BackendRequestOptions } from './backend-transport-types';
import { mutationErrorMessage } from './backend-mutation';
import { normalizeNote } from './note-normalization';
import { newIdempotencyKey } from './idempotency-key';
import { m } from '../../../shared/paraglide/messages.js';

/** Decode the returned entity; a list diff cannot identify which creation was ours. */
export function createNoteCreate({
  backendRequest,
  rememberNoteWorkspace,
}: {
  backendRequest: <T = unknown>(
    method: string,
    params?: unknown,
    options?: BackendRequestOptions & Partial<Pick<NoteCreateOptions, 'onDispatch'>>,
  ) => Promise<T>;
  rememberNoteWorkspace?: (noteId: string, workspaceId: string) => void;
}): NotesClient['create'] {
  return async (request, options) => {
    if (
      options &&
      (!request.workspaceId ||
        typeof request.title !== 'string' ||
        typeof request.content !== 'string' ||
        typeof options.idempotencyKey !== 'string' ||
        !options.idempotencyKey.trim())
    )
      return { success: false, createOutcome: 'failed' };
    let dispatched = false;
    try {
      const params = { ...request, idempotencyKey: options?.idempotencyKey ?? newIdempotencyKey() };
      const result = await (options
        ? backendRequest<unknown>('note.create', params, {
            onDispatch: () => {
              if (dispatched) throw new Error(m.ui_reversibleActions_cancelled_message());
              options.onDispatch();
              dispatched = true;
            },
          })
        : backendRequest<unknown>('note.create', params));
      const raw =
        result && typeof result === 'object' && !Array.isArray(result)
          ? (result as { note?: unknown }).note
          : undefined;
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const value = raw as Record<string, unknown>;
        if (
          (!options || dispatched) &&
          typeof value.id === 'string' &&
          value.id.trim() &&
          value.workspaceId === request.workspaceId &&
          typeof value.title === 'string' &&
          typeof value.content === 'string' &&
          typeof value.rev === 'number' &&
          Number.isSafeInteger(value.rev) &&
          value.rev >= 0 &&
          (!options ||
            (typeof value.contentType === 'string' &&
              Array.isArray(value.tags) &&
              value.tags.every((tag) => typeof tag === 'string') &&
              typeof value.isDefault === 'boolean' &&
              typeof value.isPinned === 'boolean' &&
              typeof value.isArchived === 'boolean' &&
              typeof value.visibility === 'string' &&
              (value.metadata === undefined ||
                value.metadata === null ||
                (typeof value.metadata === 'object' && !Array.isArray(value.metadata)))))
        ) {
          const note = normalizeNote(value, request.workspaceId);
          rememberNoteWorkspace?.(note.id, note.workspaceId);
          return {
            success: true,
            note,
            ...(options ? { createOutcome: 'confirmed' as const } : {}),
          };
        }
      }
      // Legacy callers keep success-on-resolve, but never receive a guessed identity.
      return options ? { success: false, createOutcome: 'unknown' } : { success: true };
    } catch (error) {
      const rpcCode = (error as { rpcCode?: unknown } | null)?.rpcCode;
      // Internal/storage failures can follow the write, including saving the idempotency receipt.
      const refused = [-32600, -32601, -32602, -32003].includes(rpcCode as number);
      return {
        success: false,
        error: mutationErrorMessage(error),
        ...(options
          ? { createOutcome: !dispatched || refused ? ('failed' as const) : ('unknown' as const) }
          : {}),
      };
    }
  };
}
