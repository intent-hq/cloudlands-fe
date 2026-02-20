/**
 * Config Cache Proxy Service
 *
 * Browser-safe proxy that communicates with the main process config cache service via IPC.
 */

import { invoke } from '$lib/electron-bridge';
import { createLogger } from '$lib/utils/client-logger';
import type { ModelId } from '$shared/types/agent.types';
import type { CommandResponse } from '$shared/types';
import { CONFIG_CHANNELS } from '$shared/ipc/channels';

const logger = createLogger('ConfigCacheProxy');

interface ModelConfig {
  id: ModelId;
  name: string;
  provider: string;
  maxTokens?: number;
  temperature?: number;
  available: boolean;
}

export class ConfigCacheProxyService {
  /**
   * Get model configuration from the main process
   */
  async getModelConfig(modelId: ModelId): Promise<ModelConfig | null> {
    try {
      const response = await invoke<CommandResponse<ModelConfig>>('config:get-model', {
        modelId,
      });

      if (!response.success) {
        logger.warn(`Model config not found for ${modelId}`);
        return null;
      }

      return response.data || null;
    } catch (error) {
      logger.error(`Failed to get model config for ${modelId}:`, error);
      return null;
    }
  }

  /**
   * Get all available models from the main process
   */
  async getAllModels(): Promise<ModelConfig[]> {
    try {
      const response = await invoke<CommandResponse<ModelConfig[]>>('config:get-all-models', {});

      if (!response.success) {
        throw new Error(response.error || 'Failed to get models');
      }

      return response.data || [];
    } catch (error) {
      logger.error('Failed to get all models:', error);
      return [];
    }
  }

  /**
   * Clear the cache in the main process
   */
  async clearCache(): Promise<void> {
    try {
      await invoke(CONFIG_CHANNELS.CLEAR_CACHE, {});
      logger.info('Cache cleared');
    } catch (error) {
      logger.error('Failed to clear cache:', error);
    }
  }

  /**
   * Invalidate a specific cache entry in the main process
   */
  async invalidate(key: string): Promise<void> {
    try {
      await invoke(CONFIG_CHANNELS.INVALIDATE, { key });
      logger.debug(`Invalidated cache key: ${key}`);
    } catch (error) {
      logger.error(`Failed to invalidate cache key ${key}:`, error);
    }
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<any> {
    try {
      const response = (await invoke(CONFIG_CHANNELS.GET_STATS, {})) as any;
      return response.data || {};
    } catch (error) {
      logger.error('Failed to get config cache stats:', error);
      return {};
    }
  }
}

// Export singleton instance for backward compatibility
export const configCache = new ConfigCacheProxyService();
