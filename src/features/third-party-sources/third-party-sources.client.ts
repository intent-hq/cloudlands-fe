/**
 * Third-Party Sources Client
 *
 * Client-side API for managing third-party sources
 */

import { invoke } from '$lib/electron-bridge';
import type {
  ThirdPartySource,
  CreateThirdPartySourceRequest,
  UpdateThirdPartySourceRequest,
  WorkspaceId,
  CommandResponse,
} from '$shared/types';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('third-party-sources-client');

class ThirdPartySourcesClient {
  /**
   * Create a new third-party source
   */
  async create(request: CreateThirdPartySourceRequest): Promise<CommandResponse<ThirdPartySource>> {
    try {
      logger.debug('Creating third-party source', request);
      const response = await invoke<CommandResponse<ThirdPartySource>>('sources:create', request);

      if (response.success) {
        logger.info('Third-party source created', { id: response.data?.id });
      } else {
        logger.error('Failed to create third-party source', { error: response.error });
      }

      return response;
    } catch (error) {
      logger.error('Error creating third-party source', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Update an existing third-party source
   */
  async update(
    workspaceId: WorkspaceId,
    sourceId: string,
    data: UpdateThirdPartySourceRequest,
  ): Promise<CommandResponse<ThirdPartySource>> {
    try {
      logger.debug('Updating third-party source', { workspaceId, sourceId, data });
      const response = await invoke<CommandResponse<ThirdPartySource>>('sources:update', {
        workspaceId,
        sourceId,
        data,
      });

      if (response.success) {
        logger.info('Third-party source updated', { id: sourceId });
      } else {
        logger.error('Failed to update third-party source', { error: response.error });
      }

      return response;
    } catch (error) {
      logger.error('Error updating third-party source', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get a third-party source by ID
   */
  async get(
    workspaceId: WorkspaceId,
    sourceId: string,
  ): Promise<CommandResponse<ThirdPartySource | null>> {
    try {
      logger.debug('Getting third-party source', { workspaceId, sourceId });
      const response = await invoke<CommandResponse<ThirdPartySource | null>>('sources:get', {
        workspaceId,
        sourceId,
      });

      return response;
    } catch (error) {
      logger.error('Error getting third-party source', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * List all third-party sources for a workspace
   */
  async list(workspaceId: WorkspaceId): Promise<CommandResponse<ThirdPartySource[]>> {
    try {
      logger.debug('Listing third-party sources', { workspaceId });
      const response = await invoke<CommandResponse<ThirdPartySource[]>>('sources:list', {
        workspaceId,
      });

      if (response.success) {
        logger.debug('Listed third-party sources', { count: response.data?.length });
      } else {
        logger.error('Failed to list third-party sources', { error: response.error });
      }

      return response;
    } catch (error) {
      logger.error('Error listing third-party sources', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Delete a third-party source
   */
  async delete(workspaceId: WorkspaceId, sourceId: string): Promise<CommandResponse<void>> {
    try {
      logger.debug('Deleting third-party source', { workspaceId, sourceId });
      const response = await invoke<CommandResponse<void>>('sources:delete', {
        workspaceId,
        sourceId,
      });

      if (response.success) {
        logger.info('Third-party source deleted', { id: sourceId });
      } else {
        logger.error('Failed to delete third-party source', { error: response.error });
      }

      return response;
    } catch (error) {
      logger.error('Error deleting third-party source', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Refresh metadata for a source
   */
  async refreshMetadata(
    workspaceId: WorkspaceId,
    sourceId: string,
  ): Promise<CommandResponse<ThirdPartySource>> {
    try {
      logger.debug('Refreshing source metadata', { workspaceId, sourceId });
      const response = await invoke<CommandResponse<ThirdPartySource>>('sources:refresh', {
        workspaceId,
        sourceId,
      });

      if (response.success) {
        logger.info('Source metadata refreshed', { id: sourceId });
      } else {
        logger.error('Failed to refresh source metadata', { error: response.error });
      }

      return response;
    } catch (error) {
      logger.error('Error refreshing source metadata', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Extract metadata from a URL (for preview)
   */
  async extractMetadata(url: string, type?: string): Promise<CommandResponse<any>> {
    try {
      logger.debug('Extracting metadata from URL', { url, type });
      const response = await invoke<CommandResponse<any>>('sources:extract-metadata', {
        url,
        type,
      });

      return response;
    } catch (error) {
      logger.error('Error extracting metadata', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

// Export singleton instance
export const thirdPartySourcesClient = new ThirdPartySourcesClient();
