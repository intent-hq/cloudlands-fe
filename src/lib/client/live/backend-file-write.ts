import type { FilesClient } from '../app-client';
import type { FileWriteOptions } from '../file-write-types';
import type { BackendRequestOptions } from './backend-transport-types';
import { isDaemonErrorResponse } from './backend-transport-types';
import { createRunMutation, mutationErrorMessage } from './backend-mutation';
import { newIdempotencyKey } from './idempotency-key';

/** One file.write encoder, with opt-in confirmation and final-dispatch admission. */
export function createFileWrite(
  request: <T = unknown>(
    method: string,
    params?: unknown,
    options?: BackendRequestOptions & Partial<FileWriteOptions>,
  ) => Promise<T>,
): FilesClient['write'] {
  const runMutation = createRunMutation(request);
  return async (workspaceId, path, content, options) => {
    const params = {
      workspaceId,
      path,
      content: content.content,
      idempotencyKey: newIdempotencyKey(),
    };
    // Source create/delete/Undo callers retain their established mutation result contract.
    if (!options) return runMutation('file.write', params);
    let dispatched = false;
    try {
      const response = await request<unknown>('file.write', params, {
        onDispatch: () => {
          options.onDispatch();
          dispatched = true;
        },
      });
      if (
        dispatched &&
        response &&
        typeof response === 'object' &&
        (response as { ok?: unknown }).ok === true
      )
        return { success: true };
      return { success: false, outcome: 'uncertain' };
    } catch (error) {
      return {
        success: false,
        error: mutationErrorMessage(error),
        outcome: !dispatched || isDaemonErrorResponse(error) ? 'failed' : 'uncertain',
      };
    }
  };
}
