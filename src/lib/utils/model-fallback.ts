/**
 * Model Fallback Utility
 *
 * Provides robust model selection with fallback logic for background agents.
 * When a requested model is not in the available list, falls back to alternatives
 * from the available models list (no hardcoded model names).
 */

import type { AuggieModel } from '$features/auggie/auggie-models.client';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('ModelFallback');

export interface ModelFallbackResult {
  /** The model to use (either requested or fallback), or null if no models available */
  model: string | null;
  /** Whether we had to use a fallback */
  usedFallback: boolean;
  /** Reason for fallback (if applicable) */
  fallbackReason?: string;
  /** The original requested model */
  requestedModel: string;
}

/**
 * Find the best available model with fallback logic.
 *
 * Fallback order (when requested model is not available):
 * 1. First available model from the list
 * 2. null if no models are available (caller should handle this case)
 *
 * @param requestedModel - The model that was requested
 * @param availableModels - List of available models from auggie
 * @returns ModelFallbackResult with the model to use and fallback info
 */
export function findBestAvailableModel(
  requestedModel: string,
  availableModels: AuggieModel[],
): ModelFallbackResult {
  // If no models available, return null - caller should handle this case
  if (!availableModels || availableModels.length === 0) {
    logger.warn('No available models provided', { requestedModel });
    return {
      model: null,
      usedFallback: true,
      // i18n-ignore (diagnostic-only field, never rendered)
      fallbackReason: 'No models available. Please retry loading models.',
      requestedModel,
    };
  }

  const modelValues = availableModels.map((m) => m.value);

  // Check if requested model is available
  if (modelValues.includes(requestedModel)) {
    logger.debug('Requested model is available', { requestedModel });
    return {
      model: requestedModel,
      usedFallback: false,
      requestedModel,
    };
  }

  // Model not available, use first available model
  const firstAvailable = modelValues[0];
  logger.warn('Requested model not available, using first available', {
    requestedModel,
    fallbackModel: firstAvailable,
    availableModels: modelValues,
  });
  return {
    model: firstAvailable,
    usedFallback: true,
    // i18n-ignore (diagnostic-only field, never rendered)
    fallbackReason: `Model "${requestedModel}" not available, using "${firstAvailable}" instead`,
    requestedModel,
  };
}

/**
 * Check if a model is available in the list of available models
 */
export function isModelAvailable(model: string, availableModels: AuggieModel[]): boolean {
  return availableModels.some((m) => m.value === model);
}

/**
 * Get a user-friendly model name from the available models list
 */
export function getModelLabel(model: string, availableModels: AuggieModel[]): string {
  const found = availableModels.find((m) => m.value === model);
  return found?.label || model;
}

/**
 * Generate a fallback chain from available models.
 *
 * Simply returns all available models in the order they were provided.
 * The API already returns models in a sensible order, so we don't need
 * to apply any hardcoded prioritization.
 *
 * @param availableModels - List of available models from auggie
 * @returns Array of model IDs in the order provided by the API
 */
export function generateFallbackChain(availableModels: AuggieModel[]): string[] {
  if (!availableModels || availableModels.length === 0) {
    logger.warn('No available models to generate fallback chain');
    return [];
  }

  const chain = availableModels.map((m) => m.value);

  logger.debug('Generated fallback chain', {
    totalModels: chain.length,
    chain,
  });

  return chain;
}
