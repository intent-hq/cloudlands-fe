/**
 * Third-party sources drag and drop utilities
 */

import { thirdPartySourcesClient } from '$features/third-party-sources/third-party-sources.client';
import { ThirdPartySourceType } from '$shared/types';
import { createLogger } from '$lib/utils/client-logger';
import { WorkspaceId } from '$shared/types/branded-ids';

const logger = createLogger('third-party-drag-drop');

/**
 * Check if a drag event contains URLs
 */
export function hasUrls(event: DragEvent): boolean {
  if (!event.dataTransfer) return false;

  // Check for text/uri-list (standard for dragged URLs)
  if (event.dataTransfer.types.includes('text/uri-list')) {
    return true;
  }

  // Check for text/plain that might contain URLs
  if (event.dataTransfer.types.includes('text/plain')) {
    return true;
  }

  return false;
}

/**
 * Extract URLs from a drag event
 */
export async function extractUrls(event: DragEvent): Promise<string[]> {
  if (!event.dataTransfer) return [];

  const urls: string[] = [];

  // Try to get text/uri-list first (standard for dragged URLs)
  const uriList = event.dataTransfer.getData('text/uri-list');
  if (uriList) {
    // Split by newline and filter out comments
    const lines = uriList.split('\n').filter((line) => !line.startsWith('#'));
    urls.push(...lines.filter((line) => line.trim()));
  }

  // Also try text/plain as fallback
  if (urls.length === 0) {
    const plainText = event.dataTransfer.getData('text/plain');
    if (plainText && isValidUrl(plainText.trim())) {
      urls.push(plainText.trim());
    }
  }

  return urls.filter((url) => isValidUrl(url));
}

/**
 * Check if a string is a valid URL
 */
export function isValidUrl(str: string): boolean {
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Detect the type of third-party source from URL
 */
export function detectSourceType(url: string): ThirdPartySourceType {
  const urlLower = url.toLowerCase();

  if (urlLower.includes('linear.app')) {
    return ThirdPartySourceType.LinearIssue;
  }
  if (urlLower.includes('github.com')) {
    if (urlLower.includes('/pull/')) {
      return ThirdPartySourceType.GitHubPR;
    }
    if (urlLower.includes('/issues/')) {
      return ThirdPartySourceType.GitHubIssue;
    }
  }
  if (urlLower.includes('atlassian.net') || urlLower.includes('jira.')) {
    return ThirdPartySourceType.JiraTicket;
  }
  if (urlLower.includes('docs.google.com')) {
    return ThirdPartySourceType.GoogleDoc;
  }
  if (urlLower.includes('notion.so') || urlLower.includes('notion.site')) {
    return ThirdPartySourceType.Notion;
  }
  if (urlLower.includes('confluence.') || urlLower.includes('atlassian.net/wiki')) {
    return ThirdPartySourceType.Confluence;
  }
  if (urlLower.includes('slack.com')) {
    return ThirdPartySourceType.Slack;
  }
  if (urlLower.includes('figma.com')) {
    return ThirdPartySourceType.Figma;
  }

  return ThirdPartySourceType.WebPage;
}

/**
 * Handle drop event for third-party sources
 */
export async function handleThirdPartyDrop(
  event: DragEvent,
  workspaceId: string,
  onSuccess?: (sourceId: string) => void,
  onError?: (error: string) => void,
): Promise<void> {
  event.preventDefault();
  event.stopPropagation();

  try {
    const urls = await extractUrls(event);

    if (urls.length === 0) {
      logger.warn('No valid URLs found in drop event');
      onError?.('No valid URLs found');
      return;
    }

    // For now, handle the first URL
    const url = urls[0];
    const type = detectSourceType(url);

    logger.info('Creating third-party source from dropped URL', { url, type });

    // Extract metadata first
    const metadataResponse = await thirdPartySourcesClient.extractMetadata(url, type);

    // Create the source
    const response = await thirdPartySourcesClient.create({
      workspaceId: WorkspaceId(workspaceId),
      url,
      type,
      title: metadataResponse.success ? metadataResponse.data?.title : undefined,
      description: metadataResponse.success ? metadataResponse.data?.description : undefined,
      metadata: metadataResponse.success ? metadataResponse.data : undefined,
    });

    if (response.success && response.data) {
      logger.info('Third-party source created', { id: response.data.id });
      onSuccess?.(response.data.id);
    } else {
      logger.error('Failed to create third-party source', response.error);
      onError?.(response.error || 'Failed to create source');
    }
  } catch (error) {
    logger.error('Error handling third-party drop', error);
    onError?.(error instanceof Error ? error.message : 'Unknown error');
  }
}
