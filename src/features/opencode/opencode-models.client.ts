/**
 * OpenCode Models Client
 *
 * Client-side functions for fetching OpenCode models
 */

import { invoke } from '$lib/electron-bridge';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('OpenCodeModelsClient');

export interface OpenCodeModel {
  value: string; // Full model ID in format "provider/model"
  label: string; // Display label
  provider?: string; // Provider name (e.g., "openai", "anthropic")
}

interface GetModelsResponse {
  success: boolean;
  data?: OpenCodeModel[];
  error?: string;
  warning?: string;
}

interface CheckAvailabilityResponse {
  success: boolean;
  available: boolean;
}

/**
 * Check if OpenCode CLI is available
 */
export async function checkOpencodeAvailability(): Promise<boolean> {
  // Skip in Node.js environment (backend)
  if (typeof window === 'undefined') {
    logger.debug('Skipping opencode availability check - not in browser environment');
    return false;
  }

  try {
    const result = await invoke<CheckAvailabilityResponse>('opencode:check-availability');
    return result?.available ?? false;
  } catch (error) {
    logger.warn('Failed to check OpenCode availability:', { error });
    return false;
  }
}

/**
 * Get available models from OpenCode CLI
 */
export async function getOpencodeModels(): Promise<OpenCodeModel[]> {
  // Skip in Node.js environment (backend)
  if (typeof window === 'undefined') {
    logger.debug('Skipping opencode models fetch - not in browser environment');
    return [];
  }

  try {
    logger.debug('Getting models from opencode');

    const result = await invoke<GetModelsResponse>('opencode:get-models');
    if (result?.success && result.data) {
      logger.info('Got models from opencode', { count: result.data.length });
      return result.data;
    }
    logger.warn('Failed to get OpenCode models:', { error: result?.error, warning: result?.warning });
    return [];
  } catch (error) {
    logger.warn('Failed to get OpenCode models:', { error });
    return [];
  }
}
