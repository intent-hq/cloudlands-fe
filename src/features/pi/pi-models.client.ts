/**
 * Pi Models Client
 *
 * Client-side functions for fetching Pi models
 */

import { invoke } from '$lib/electron-bridge';
import { createLogger } from '$lib/utils/client-logger';
import { PI_CHANNELS } from '$shared/ipc/channels';

const logger = createLogger('PiModelsClient');

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return 'Unknown error';
}

function toPiError(message: string): Error {
  return new Error(message.startsWith('Pi:') ? message : `Pi: ${message}`);
}

/**
 * Invoke a provider model IPC channel, preferring the real Electron bridge
 * (`window.electronAPI`) so the request reaches the live main-process handler
 * (`pi:get-models`). The default `$lib/electron-bridge` invoke is wired to the
 * in-memory mock IPC router, which has no handler for this channel, so on a
 * live build it resolves to `undefined` and the model list comes back empty.
 * Falls back to the mock-routed invoke when no real bridge is present (unit
 * tests / non-Electron environments).
 */
async function invokeModelChannel<T>(channel: string): Promise<T> {
  if (typeof window !== 'undefined' && window.electronAPI?.invoke) {
    return (await window.electronAPI.invoke(channel)) as T;
  }
  return await invoke<T>(channel);
}

export interface PiModel {
  value: string;
  label: string;
  description?: string;
}

interface GetModelsResponse {
  success: boolean;
  data?: PiModel[];
  error?: string;
  warning?: string;
}

export interface InstallPiMcpAdapterResponse {
  success: boolean;
  error?: string;
}

export async function checkPiMcpAdapterInstalled(): Promise<boolean> {
  if (typeof window === 'undefined') {
    logger.debug('Skipping Pi MCP adapter check - not in browser environment');
    return true;
  }

  return await invoke<boolean>(PI_CHANNELS.CHECK_MCP_ADAPTER);
}

export async function installPiMcpAdapter(): Promise<InstallPiMcpAdapterResponse> {
  if (typeof window === 'undefined') {
    logger.debug('Skipping Pi MCP adapter install - not in browser environment');
    return { success: false, error: 'Pi MCP adapter install is only available in the app' };
  }

  return await invoke<InstallPiMcpAdapterResponse>(PI_CHANNELS.INSTALL_MCP_ADAPTER);
}

/**
 * Get available models from Pi
 */
export async function getPiModels(): Promise<PiModel[]> {
  // Skip in Node.js environment (backend)
  if (typeof window === 'undefined') {
    logger.debug('Skipping Pi models fetch - not in browser environment');
    return [];
  }

  try {
    logger.debug('Getting models from Pi');

    const result = await invokeModelChannel<GetModelsResponse>('pi:get-models');
    if (result?.success && result.data && result.data.length > 0) {
      if (result.warning) {
        logger.warn('Pi models returned with warning:', { warning: result.warning });
      }
      logger.info('Got models from Pi', { count: result.data.length });
      return result.data;
    }
    const errorMessage = result?.error || result?.warning || 'No models returned';
    logger.warn('Failed to get Pi models:', {
      error: result?.error,
      warning: result?.warning,
    });
    throw toPiError(errorMessage);
  } catch (error) {
    logger.warn('Failed to get Pi models:', { error });
    throw toPiError(toErrorMessage(error));
  }
}
