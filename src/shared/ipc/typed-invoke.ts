/**
 * Type-Safe IPC Invoke Wrapper
 *
 * Provides a type-safe wrapper around Electron's IPC invoke mechanism.
 * Ensures request and response types are correctly matched at compile time.
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

import type { IpcContractMap, IpcResponse } from './contracts';
import { Logger } from '../logger';

const logger = new Logger('TypedInvoke');

/**
 * Type-safe invoke function with full type inference
 *
 * @param channel - The IPC channel name (must be in IpcContractMap)
 * @param request - The request payload (type-checked against contract)
 * @returns Promise resolving to typed response
 *
 * @example
 *   const response = await typedInvoke('agent:create', {
 *     workspaceId: WorkspaceId('123'),
 *     workspacePath: '/path',
 *     name: 'Agent'
 *   });
 *   if (response.success) {
 *     console.log(response.data?.agent.name);
 *   } else {
 *     console.error(response.error?.message);
 *   }
 */
export async function typedInvoke<K extends keyof IpcContractMap>(
  channel: K,
  request: IpcContractMap[K][0],
): Promise<IpcResponse<IpcContractMap[K][1]>> {
  try {
    // Get the electron IPC API from preload
    const electronAPI = (window as any).electronAPI;

    if (!electronAPI || !electronAPI.invoke) {
      throw new Error('IPC renderer not available - electronAPI not exposed');
    }

    logger.debug(`Invoking IPC channel: ${String(channel)}`, { request });

    // Invoke the channel with the request
    const response = await electronAPI.invoke(channel, request);

    logger.debug(`IPC response from ${String(channel)}:`, { response });

    // Ensure response has the correct structure
    if (!response || typeof response !== 'object') {
      return {
        success: false,
        error: {
          code: 'INVALID_RESPONSE',
          message: 'Invalid response format from IPC handler',
          details: { response },
        },
      };
    }

    return response as IpcResponse<IpcContractMap[K][1]>;
  } catch (error) {
    logger.error(`IPC error on channel ${String(channel)}:`, error as Error);

    return {
      success: false,
      error: {
        code: 'IPC_ERROR',
        message: error instanceof Error ? error.message : 'Unknown IPC error',
        details: error instanceof Error ? { stack: error.stack } : undefined,
      },
    };
  }
}

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
