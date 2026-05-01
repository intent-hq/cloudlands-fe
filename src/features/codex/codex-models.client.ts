/**
 * Codex Models Client
 *
 * Client-side functions for fetching Codex models
 */

import { invoke } from '$lib/electron-bridge';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('CodexModelsClient');

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return 'Unknown error';
}

function toCodexError(message: string): Error {
  return new Error(message.startsWith('Codex:') ? message : `Codex: ${message}`);
}

export interface CodexModel {
  value: string;
  label: string;
  description?: string;
}

interface GetModelsResponse {
  success: boolean;
  data?: CodexModel[];
  error?: string;
  warning?: string;
}

interface CheckAvailabilityResponse {
  success: boolean;
  available: boolean;
}

/**
 * Check if Codex CLI is available
 */
export async function checkCodexAvailability(): Promise<boolean> {
  // Skip in Node.js environment (backend)
  if (typeof window === 'undefined') {
    logger.debug('Skipping Codex availability check - not in browser environment');
    return false;
  }

  try {
    const result = await invoke<CheckAvailabilityResponse>('codex:check-availability');
    return result?.available ?? false;
  } catch (error) {
    logger.warn('Failed to check Codex availability:', { error });
    return false;
  }
}

/**
 * Get available models from Codex
 */
export async function getCodexModels(): Promise<CodexModel[]> {
  // Skip in Node.js environment (backend)
  if (typeof window === 'undefined') {
    logger.debug('Skipping Codex models fetch - not in browser environment');
    return [];
  }

  try {
    logger.debug('Getting models from Codex');

    const result = await invoke<GetModelsResponse>('codex:get-models');
    if (result?.success && result.data && result.data.length > 0) {
      if (result.warning) {
        logger.warn('Codex models returned with warning:', { warning: result.warning });
      }
      logger.info('Got models from Codex', { count: result.data.length });
      return result.data;
    }
    const errorMessage = result?.error || result?.warning || 'No models returned';
    logger.warn('Failed to get Codex models:', {
      error: result?.error,
      warning: result?.warning,
    });
    throw toCodexError(errorMessage);
  } catch (error) {
    logger.warn('Failed to get Codex models:', { error });
    throw toCodexError(toErrorMessage(error));
  }
}
