/**
 * Pi Models Client
 *
 * Client-side functions for fetching Pi models
 */

import { invoke } from '$lib/electron-bridge';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('PiModelsClient');

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return 'Unknown error';
}

function toPiError(message: string): Error {
  return new Error(message.startsWith('Pi:') ? message : `Pi: ${message}`);
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

    const result = await invoke<GetModelsResponse>('pi:get-models');
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
