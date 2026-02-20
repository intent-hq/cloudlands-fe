/**
 * Claude Code Models Client
 *
 * Client-side functions for fetching Claude Code models
 */

import { invoke } from '$lib/electron-bridge';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('ClaudeCodeModelsClient');

export interface ClaudeCodeModel {
  value: string;
  label: string;
  description?: string;
}

interface GetModelsResponse {
  success: boolean;
  data?: ClaudeCodeModel[];
  error?: string;
  warning?: string;
}

interface CheckAvailabilityResponse {
  success: boolean;
  available: boolean;
}

/**
 * Check if Claude Code CLI is available
 */
export async function checkClaudeCodeAvailability(): Promise<boolean> {
  // Skip in Node.js environment (backend)
  if (typeof window === 'undefined') {
    logger.debug('Skipping Claude Code availability check - not in browser environment');
    return false;
  }

  try {
    const result = await invoke<CheckAvailabilityResponse>('claude-code:check-availability');
    return result?.available ?? false;
  } catch (error) {
    logger.warn('Failed to check Claude Code availability:', { error });
    return false;
  }
}

/**
 * Get available models from Claude Code
 */
export async function getClaudeCodeModels(): Promise<ClaudeCodeModel[]> {
  // Skip in Node.js environment (backend)
  if (typeof window === 'undefined') {
    logger.debug('Skipping Claude Code models fetch - not in browser environment');
    return [];
  }

  try {
    logger.debug('Getting models from Claude Code');

    const result = await invoke<GetModelsResponse>('claude-code:get-models');
    if (result?.success && result.data) {
      logger.info('Got models from Claude Code', { count: result.data.length });
      return result.data;
    }
    logger.warn('Failed to get Claude Code models:', {
      error: result?.error,
      warning: result?.warning,
    });
    return [];
  } catch (error) {
    logger.warn('Failed to get Claude Code models:', { error });
    return [];
  }
}
