/**
 * Droid Models Client
 *
 * Client-side functions for fetching Factory Droid models
 */

import { invoke } from '$lib/electron-bridge';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('DroidModelsClient');

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return 'Unknown error';
}

function toDroidError(message: string): Error {
  return new Error(message.startsWith('Droid:') ? message : `Droid: ${message}`);
}

export interface DroidModel {
  value: string; // Droid model ID (e.g., "claude-sonnet-4-5")
  label: string; // Display label
  description?: string;
}

interface GetModelsResponse {
  success: boolean;
  data?: DroidModel[];
  error?: string;
  warning?: string;
}

interface CheckAvailabilityResponse {
  success: boolean;
  available: boolean;
}

/**
 * Check if Droid CLI is available
 */
export async function checkDroidAvailability(): Promise<boolean> {
  // Skip in Node.js environment (backend)
  if (typeof window === 'undefined') {
    logger.debug('Skipping droid availability check - not in browser environment');
    return false;
  }

  try {
    const result = await invoke<CheckAvailabilityResponse>('droid:check-availability');
    return result?.available ?? false;
  } catch (error) {
    logger.warn('Failed to check Droid availability:', { error });
    return false;
  }
}

/**
 * Get available models from Droid (live list from the ACP session/new response)
 */
export async function getDroidModels(): Promise<DroidModel[]> {
  // Skip in Node.js environment (backend)
  if (typeof window === 'undefined') {
    logger.debug('Skipping droid models fetch - not in browser environment');
    return [];
  }

  try {
    logger.debug('Getting models from droid');

    const result = await invoke<GetModelsResponse>('droid:get-models');
    if (result?.success && result.data && result.data.length > 0) {
      if (result.warning) {
        logger.warn('Droid models returned with warning:', { warning: result.warning });
      }
      logger.info('Got models from droid', { count: result.data.length });
      return result.data;
    }
    const errorMessage = result?.error || result?.warning || 'No models returned';
    logger.warn('Failed to get Droid models:', { error: result?.error, warning: result?.warning });
    throw toDroidError(errorMessage);
  } catch (error) {
    logger.warn('Failed to get Droid models:', { error });
    throw toDroidError(toErrorMessage(error));
  }
}

