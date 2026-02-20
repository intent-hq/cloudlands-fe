/**
 * Third-Party Sources Service
 *
 * Manages external sources linked to workspaces (Linear issues, web pages, etc.)
 */

import { randomUUID } from 'crypto';
import { Logger } from '../../../shared/logger';
import type {
  ThirdPartySource,
  ThirdPartySourceType,
  CreateThirdPartySourceRequest,
  UpdateThirdPartySourceRequest,
  WorkspaceId,
} from '../../../shared/types';
import { Result } from '../../../shared/result';
import { ThirdPartySourcesRepository } from './third-party-sources.repository';
import { MetadataExtractor } from '../metadata-extractor';
import { unifiedEventBus, type UnifiedEventBus } from '../../events/main/unified-event-bus';

const logger = new Logger('third-party-sources-service');

// Constants for validation
const MAX_URL_LENGTH = 2048;
const MAX_TITLE_LENGTH = 255;
const MAX_DESCRIPTION_LENGTH = 1000;

export class ThirdPartySourcesService {
  private eventListeners: Array<() => void> = [];

  constructor(
    private readonly repository: ThirdPartySourcesRepository = new ThirdPartySourcesRepository(),
    private readonly metadataExtractor: MetadataExtractor = new MetadataExtractor(),
    private readonly eventBus: UnifiedEventBus = unifiedEventBus,
  ) {}

  /**
   * Clean up resources and event listeners
   */
  dispose(): void {
    this.eventListeners.forEach((cleanup) => cleanup());
    this.eventListeners = [];
  }

  /**
   * Validate create request
   */
  private validateCreateRequest(request: CreateThirdPartySourceRequest): string | null {
    if (!request.workspaceId) {
      return 'Workspace ID is required';
    }
    if (!request.url) {
      return 'URL is required';
    }
    try {
      const url = new URL(request.url);
      if (!['http:', 'https:'].includes(url.protocol)) {
        return 'Only HTTP and HTTPS URLs are supported';
      }
    } catch {
      return 'Invalid URL format';
    }
    return null;
  }

  /**
   * Validate update request
   */
  private validateUpdateRequest(request: UpdateThirdPartySourceRequest): string | null {
    // At least one field should be provided for update
    if (
      !request.title &&
      request.description === undefined &&
      request.isPinned === undefined &&
      request.isArchived === undefined &&
      !request.metadata
    ) {
      return 'No fields to update';
    }
    return null;
  }

  /**
   * Create a new third-party source
   */
  async createSource(
    request: CreateThirdPartySourceRequest,
  ): Promise<Result<ThirdPartySource, string>> {
    try {
      // Validate input
      const validationError = this.validateCreateRequest(request);
      if (validationError) {
        return { ok: false, error: validationError };
      }

      logger.info('Creating third-party source', {
        workspaceId: request.workspaceId,
        url: request.url,
      });

      // Generate ID
      const id = randomUUID();
      const now = new Date().toISOString();

      // Detect source type if not provided
      const type = request.type || this.detectSourceType(request.url);

      // Extract metadata if not provided
      let metadata = request.metadata;
      let title = request.title;
      let description = request.description;
      let favicon: string | undefined;

      if (!title || !metadata) {
        const extracted = await this.metadataExtractor.extract(request.url, type);
        if (extracted.ok) {
          title = title || extracted.data.title;
          description = description || extracted.data.description;
          favicon = extracted.data.favicon;
          metadata = {
            ...metadata,
            ...extracted.data.metadata,
            lastFetched: now,
          };
        } else {
          // Use fallback values if extraction fails
          logger.warn('Metadata extraction failed, using fallbacks', {
            url: request.url,
            error: extracted.error,
          });
          title = title || this.getTitleFromUrl(request.url);
          description = description || `External source from ${new URL(request.url).hostname}`;
        }
      }

      const source: ThirdPartySource = {
        id,
        workspaceId: request.workspaceId,
        type,
        url: request.url,
        title: title || this.getTitleFromUrl(request.url),
        description,
        favicon,
        metadata,
        createdAt: now,
        updatedAt: now,
        isPinned: false,
        isArchived: false,
      };

      // Save to repository
      await this.repository.save(source);

      // Emit event
      this.eventBus.emitDomainEvent('source:created', {
        workspaceId: request.workspaceId,
        sourceId: id,
        source,
      });

      logger.info('Third-party source created', {
        id,
        workspaceId: request.workspaceId,
        type,
      });

      return { ok: true, data: source };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to create third-party source', { error: errorMessage });
      return {
        ok: false,
        error: `Failed to create source: ${errorMessage}`,
      };
    }
  }

  /**
   * Update an existing third-party source
   */
  async updateSource(
    workspaceId: WorkspaceId,
    sourceId: string,
    request: UpdateThirdPartySourceRequest,
  ): Promise<Result<ThirdPartySource, string>> {
    try {
      // Validate input
      const validationError = this.validateUpdateRequest(request);
      if (validationError) {
        return { ok: false, error: validationError };
      }

      const existing = await this.repository.findById(workspaceId, sourceId);
      if (!existing) {
        return { ok: false, error: 'Source not found' };
      }

      const updated: ThirdPartySource = {
        ...existing,
        ...request,
        updatedAt: new Date().toISOString(),
      };

      await this.repository.save(updated);

      this.eventBus.emitDomainEvent('source:updated', {
        workspaceId,
        sourceId,
        source: updated,
      });

      return { ok: true, data: updated };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to update third-party source', { error: errorMessage });
      return {
        ok: false,
        error: `Failed to update source: ${errorMessage}`,
      };
    }
  }

  /**
   * Get a third-party source by ID
   */
  async getSource(
    workspaceId: WorkspaceId,
    sourceId: string,
  ): Promise<Result<ThirdPartySource | null, string>> {
    try {
      const source = await this.repository.findById(workspaceId, sourceId);
      return { ok: true, data: source };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to get third-party source', { error: errorMessage });
      return {
        ok: false,
        error: `Failed to get source: ${errorMessage}`,
      };
    }
  }

  /**
   * List all third-party sources for a workspace
   */
  async listByWorkspace(workspaceId: WorkspaceId): Promise<Result<ThirdPartySource[], string>> {
    try {
      const sources = await this.repository.findByWorkspace(workspaceId);
      return { ok: true, data: sources };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to list third-party sources', { error: errorMessage });
      return {
        ok: false,
        error: `Failed to list sources: ${errorMessage}`,
      };
    }
  }

  /**
   * Delete a third-party source
   */
  async deleteSource(workspaceId: WorkspaceId, sourceId: string): Promise<Result<void, string>> {
    try {
      await this.repository.delete(workspaceId, sourceId);

      this.eventBus.emitDomainEvent('source:deleted', {
        workspaceId,
        sourceId,
      });

      return { ok: true, data: undefined };
    } catch (error) {
      logger.error('Failed to delete third-party source', error as Error);
      return {
        ok: false,
        error: `Failed to delete source: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Refresh metadata for a source
   */
  async refreshMetadata(
    workspaceId: WorkspaceId,
    sourceId: string,
  ): Promise<Result<ThirdPartySource, string>> {
    try {
      const source = await this.repository.findById(workspaceId, sourceId);
      if (!source) {
        return { ok: false, error: 'Source not found' };
      }

      const extracted = await this.metadataExtractor.extract(source.url, source.type);
      if (!extracted.ok) {
        return { ok: false, error: extracted.error };
      }

      const updated: ThirdPartySource = {
        ...source,
        title: extracted.data.title || source.title,
        description: extracted.data.description || source.description,
        favicon: extracted.data.favicon || source.favicon,
        metadata: {
          ...source.metadata,
          ...extracted.data.metadata,
          lastFetched: new Date().toISOString(),
        },
        updatedAt: new Date().toISOString(),
      };

      await this.repository.save(updated);

      return { ok: true, data: updated };
    } catch (error) {
      logger.error('Failed to refresh metadata', error as Error);
      return {
        ok: false,
        error: `Failed to refresh metadata: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Detect source type from URL
   */
  private detectSourceType(url: string): ThirdPartySourceType {
    const urlLower = url.toLowerCase();

    if (urlLower.includes('linear.app')) {
      return 'LinearIssue' as ThirdPartySourceType;
    }
    if (urlLower.includes('github.com')) {
      if (urlLower.includes('/pull/')) {
        return 'GithubPR' as ThirdPartySourceType;
      }
      if (urlLower.includes('/issues/')) {
        return 'github_issue' as ThirdPartySourceType;
      }
    }
    if (urlLower.includes('atlassian.net') || urlLower.includes('jira.')) {
      return 'jira_ticket' as ThirdPartySourceType;
    }
    if (urlLower.includes('docs.google.com')) {
      return 'google_doc' as ThirdPartySourceType;
    }
    if (urlLower.includes('notion.so') || urlLower.includes('notion.site')) {
      return 'notion_page' as ThirdPartySourceType;
    }
    if (urlLower.includes('confluence.') || urlLower.includes('atlassian.net/wiki')) {
      return 'confluence_page' as ThirdPartySourceType;
    }
    if (urlLower.includes('slack.com')) {
      return 'slack_thread' as ThirdPartySourceType;
    }
    if (urlLower.includes('figma.com')) {
      return 'figma_design' as ThirdPartySourceType;
    }

    return 'webpage' as ThirdPartySourceType;
  }

  /**
   * Get a fallback title from URL
   */
  private getTitleFromUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname.replace(/\/$/, '');
      const lastSegment = pathname.split('/').pop() || '';

      if (lastSegment) {
        // Clean up the segment (remove file extensions, replace dashes/underscores)
        return lastSegment
          .replace(/\.[^/.]+$/, '')
          .replace(/[-_]/g, ' ')
          .replace(/\b\w/g, (l) => l.toUpperCase());
      }

      return urlObj.hostname;
    } catch {
      return 'External Source';
    }
  }
}

// Export singleton instance
export const thirdPartySourcesService = new ThirdPartySourcesService();
