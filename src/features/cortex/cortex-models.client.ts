/**
 * Cortex Models Client
 *
 * Client-side functions for fetching Cortex models
 */

import { invoke } from '$lib/electron-bridge';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('CortexModelsClient');

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return 'Unknown error';
}

function toCortexError(message: string): Error {
  return new Error(message.startsWith('Cortex:') ? message : `Cortex: ${message}`);
}

/**
 * Invoke a provider model IPC channel, preferring the real Electron bridge
 * (`window.electronAPI`) so the request reaches the live main-process handler
 * (`cortex:get-models`). The default `$lib/electron-bridge` invoke is wired to
 * the in-memory mock IPC router, which has no handler for this channel, so on a
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

export interface CortexModel {
  value: string;
  label: string;
  description?: string;
}

interface GetModelsResponse {
  success: boolean;
  data?: CortexModel[];
  error?: string;
  warning?: string;
}

interface CheckAvailabilityResponse {
  success: boolean;
  available: boolean;
}

/**
 * Check if Cortex is available
 */
export async function checkCortexAvailability(): Promise<boolean> {
  // Skip in Node.js environment (backend)
  if (typeof window === 'undefined') {
    logger.debug('Skipping Cortex availability check - not in browser environment');
    return false;
  }

  try {
    const result = await invoke<CheckAvailabilityResponse>('cortex:check-availability');
    return result?.available ?? false;
  } catch (error) {
    logger.warn('Failed to check Cortex availability:', { error });
    return false;
  }
}

/**
 * Get available models from Cortex
 */
export async function getCortexModels(): Promise<CortexModel[]> {
  // Skip in Node.js environment (backend)
  if (typeof window === 'undefined') {
    logger.debug('Skipping Cortex models fetch - not in browser environment');
    return [];
  }

  try {
    logger.debug('Getting models from Cortex');

    const result = await invokeModelChannel<GetModelsResponse>('cortex:get-models');
    if (result?.success && result.data && result.data.length > 0) {
      if (result.warning) {
        logger.warn('Cortex models returned with warning:', { warning: result.warning });
      }
      logger.info('Got models from Cortex', { count: result.data.length });
      return result.data;
    }
    const errorMessage = result?.error || result?.warning || 'No models returned';
    logger.warn('Failed to get Cortex models:', {
      error: result?.error,
      warning: result?.warning,
    });
    throw toCortexError(errorMessage);
  } catch (error) {
    logger.warn('Failed to get Cortex models:', { error });
    throw toCortexError(toErrorMessage(error));
  }
}

