/**
 * Cortex Models Client
 *
 * Client-side functions for fetching Cortex models
 */

import { invoke } from '$lib/electron-bridge';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('CortexModelsClient');

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

    const result = await invoke<GetModelsResponse>('cortex:get-models');
    if (result?.success && result.data) {
      logger.info('Got models from Cortex', { count: result.data.length });
      return result.data;
    }
    logger.warn('Failed to get Cortex models:', {
      error: result?.error,
      warning: result?.warning,
    });
    return [];
  } catch (error) {
    logger.warn('Failed to get Cortex models:', { error });
    return [];
  }
}

