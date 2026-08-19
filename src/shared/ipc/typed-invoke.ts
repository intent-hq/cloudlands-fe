/**
 * Type-Safe IPC Invoke Wrapper
 *
 * Provides a type-safe wrapper around the generated renderer IPC client.
 * Ensures request and response types are correctly matched at compile time while
 * keeping raw Electron invoke access centralized in generated/ipc-client.
 *
 * Usage:
 *   const response = await typedInvoke('agent:create', {
 *     workspaceId: WorkspaceId('123'),
 *     workspacePath: '/path',
 *     name: 'Agent'
 *   });
 *   // response.data?.agent is typed as AgentSession
 *   // TypeScript will error if you pass wrong request type
 */

import type { IpcResponse } from './contracts';

/**
 * Helper to check if a response was successful
 */
export function isSuccessResponse<T>(
  response: IpcResponse<T>,
): response is IpcResponse<T> & { success: true; data: T } {
  return response.success === true && response.data !== undefined;
}

/**
 * Helper to check if a response failed
 */
export function isErrorResponse(
  response: IpcResponse<any>,
): response is IpcResponse<any> & { success: false; error: NonNullable<IpcResponse['error']> } {
  return response.success === false && response.error !== undefined;
}

/**
 * Helper to throw on error response
 */
export function throwOnError<T>(
  response: IpcResponse<T>,
): IpcResponse<T> & { success: true; data: T } {
  if (!isSuccessResponse(response)) {
    throw new Error(`IPC Error: ${response.error?.code} - ${response.error?.message}`);
  }
  return response;
}
