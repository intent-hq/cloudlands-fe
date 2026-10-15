import { isForbiddenErrorResponse } from '$lib/client/live/backend-transport-types';
import { m } from '$shared/paraglide/messages.js';
export function creationError(
  error: unknown,
  fallback = m.agent_creation_createFailed_error(),
): Error {
  if (isForbiddenErrorResponse(error)) {
    return Object.assign(new Error(m.agent_creation_notPermitted_error()), {
      rpcCode: (error as { rpcCode: number }).rpcCode,
      cause: error,
    });
  }
  if (error instanceof Error) return error;
  return new Error(error ? String(error) : fallback);
}

/** The typed transport error when the factory captured one, else its flattened text. */
export function factoryFailure(result: { error?: string; cause?: unknown }): unknown {
  return result.cause ?? result.error;
}
