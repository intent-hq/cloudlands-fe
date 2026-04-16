/**
 * Auggie Models Client
 *
 * Client-side functions for getting available models from auggie
 */

import { invoke } from '$lib/electron-bridge';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('AuggieModelsClient');

export interface AuggieModelBadge {
  color: string;
  label: string;
  variant?: string;
}

export interface AuggieModel {
  value: string;
  label: string;
  description?: string;
  /** Ordering priority within the model list. Lower = higher priority. Models with priority 1 are primary, 2 are secondary. */
  modelGroupPriority?: number;
  /** Whether this is a legacy/deprecated model - should be hidden from the picker */
  isLegacyModel?: boolean;
  /** Cost tier: 1 = cheap ($), 2 = moderate ($$), 3 = expensive ($$$) */
  costTier?: number;
  /** Badges to display next to the model name (e.g., "Auto", "Free") */
  badges?: AuggieModelBadge[];
  /** Supported effort levels for this model */
  effortLevels?: string[];

  /** Whether this is the default model */
  isDefault?: boolean;
  /** Within-group ordering priority. Lower = higher in the list. */
  priority?: number;
}

/**
 * Get available models from auggie CLI
 */
export async function getAuggieModels(): Promise<AuggieModel[]> {
  // Skip in Node.js environment (backend)
  if (typeof window === 'undefined') {
    logger.debug('Skipping auggie models fetch - not in browser environment');
    return [];
  }

  try {
    logger.debug('Getting models from auggie');

    const result = await invoke<{
      success: boolean;
      data?: AuggieModel[];
      warning?: string;
      error?: string;
    }>('auggie:get-models');

    if (!result.success) {
      logger.error(`Failed to get models from auggie: ${result.error || 'unknown error'}`);
      return [];
    }

    if (result.warning) {
      logger.warn(result.warning);
    }

    return result.data || [];
  } catch (error) {
    logger.error('Error getting models from auggie', { error });
    return [];
  }
}

/**
 * Map model value to emoji icon
 */
export function getModelIcon(modelValue: string): string {
  const iconMap: Record<string, string> = {
    // Claude models
    'haiku4.5': '🌸',
    'opus4.7-xhigh': '🎭',
    'opus4.6': '🎭',
    'opus4.1': '🎭',
    sonnet4: '🎵',
    'sonnet4.5': '🎭',
    'sonnet4.5_1m': '📖',
    'sonnet4.5_direct': '⚡',
    sonnet4_1m: '📚',

    // Gemini models
    'gemini25-pro': '💎',
    'gemini3-eap': '🔥',

    // GPT models
    'gpt5.4': '🧠',

    // Other models
    'glm4.6': '🌟',
    'gpt5-codex': '🤖',
    'gpt5-r-high-grep': '📊',
    'gpt5-r-low-grep': '📉',
    'gpt5-r-medium-grep': '📈',
    'kimi-k2': '🎋',
    'willow-alpha': '🌳',
    'willow-alpha-apply-patch': '🌲',
  };

  return iconMap[modelValue] || '🤖';
}
