/**
 * Metadata Extractor
 *
 * Extracts metadata from URLs including OpenGraph tags, page content, and service-specific data
 */

import { Logger } from '../../shared/logger';
import type { ThirdPartySourceType } from '../../shared/types';
import { Result } from '../../shared/result';
import * as cheerio from 'cheerio';

const logger = new Logger('metadata-extractor');

export interface ExtractedMetadata {
  title: string;
  description?: string;
  favicon?: string;
  metadata: {
    ogImage?: string;
    author?: string;
    publishedAt?: string;
    extractedContent?: string;
    extractedHtml?: string;
    sourceSpecific?: Record<string, any>;
  };
}

export class MetadataExtractor {
  private readonly userAgent = 'Mozilla/5.0 (compatible; AugmentBot/1.0)';
  private readonly timeout = 10000; // 10 seconds
  private readonly requestCache = new Map<string, { data: ExtractedMetadata; timestamp: number }>();
  private readonly cacheTimeout = 5 * 60 * 1000; // 5 minutes

  /**
   * Extract metadata from a URL
   */
  async extract(
    url: string,
    type: ThirdPartySourceType,
  ): Promise<Result<ExtractedMetadata, string>> {
    try {
      // Check cache first
      const cached = this.requestCache.get(url);
      if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
        logger.debug('Using cached metadata', { url });
        return { ok: true, data: cached.data };
      }

      logger.info('Extracting metadata', { url, type });

      // Use type-specific extractors if available
      const extractor = this.getExtractor(type);
      let result: Result<ExtractedMetadata, string>;

      if (extractor) {
        result = await extractor(url);
      } else {
        // Fall back to generic extraction
        result = await this.extractGeneric(url);
      }

      // Cache successful results
      if (result.ok) {
        this.requestCache.set(url, {
          data: result.data,
          timestamp: Date.now(),
        });
      }

      return result;
    } catch (error) {
      logger.error('Failed to extract metadata', error as Error);
      return {
        ok: false,
        error: `Failed to extract metadata: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Generic metadata extraction using OpenGraph and meta tags
   */
  private async extractGeneric(url: string): Promise<Result<ExtractedMetadata, string>> {
    try {
      // Add timeout and better error handling
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(url, {
        headers: {
          'User-Agent': this.userAgent,
          Accept: 'text/html,application/xhtml+xml',
        },
        signal: controller.signal,
        redirect: 'follow',
      }).finally(() => clearTimeout(timeoutId));

      if (!response.ok) {
        // Return basic metadata even if fetch fails
        logger.warn(`Failed to fetch URL: ${response.status}`, { url });
        return {
          ok: true,
          data: {
            title: this.getTitleFromUrl(url),
            description: `External source: ${url}`,
            metadata: {
              extractedContent: `Unable to fetch content from ${url}`,
            },
          },
        };
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      // Extract OpenGraph tags
      const ogTitle = $('meta[property="og:title"]').attr('content');
      const ogDescription = $('meta[property="og:description"]').attr('content');
      const ogImage = $('meta[property="og:image"]').attr('content');

      // Extract standard meta tags
      const title = ogTitle || $('title').text() || '';
      const description =
        ogDescription ||
        $('meta[name="description"]').attr('content') ||
        $('meta[name="twitter:description"]').attr('content') ||
        '';

      // Extract favicon
      let favicon =
        $('link[rel="icon"]').attr('href') ||
        $('link[rel="shortcut icon"]').attr('href') ||
        $('link[rel="apple-touch-icon"]').attr('href');

      if (favicon && !favicon.startsWith('http')) {
        const urlObj = new URL(url);
        favicon = new URL(favicon, urlObj.origin).toString();
      }

      // Extract author
      const author =
        $('meta[name="author"]').attr('content') ||
        $('meta[property="article:author"]').attr('content') ||
        '';

      // Extract publish date
      const publishedAt =
        $('meta[property="article:published_time"]').attr('content') ||
        $('time[datetime]').first().attr('datetime') ||
        '';

      // Extract main content (simplified)
      const extractedContent = this.extractTextContent($, url);

      return {
        ok: true,
        data: {
          title: this.cleanText(title),
          description: this.cleanText(description),
          favicon,
          metadata: {
            ogImage,
            author,
            publishedAt,
            extractedContent,
            extractedHtml: this.extractMainHtml($, url),
          },
        },
      };
    } catch (error) {
      logger.error('Generic extraction failed', error as Error);
      return {
        ok: false,
        error: `Failed to extract metadata: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Extract main text content from HTML
   */
  private extractTextContent($: cheerio.CheerioAPI, url: string): string {
    // Remove script and style elements
    $('script, style, noscript').remove();

    // Try to find main content areas
    const contentSelectors = [
      'main',
      'article',
      '[role="main"]',
      '.content',
      '#content',
      '.post-content',
      '.entry-content',
      '.markdown-body', // GitHub
      '.issue-body', // GitHub issues
    ];

    let content = '';
    for (const selector of contentSelectors) {
      const element = $(selector).first();
      if (element.length > 0) {
        content = element.text();
        break;
      }
    }

    // Fallback to body if no specific content area found
    if (!content) {
      content = $('body').text();
    }

    // Clean and truncate
    content = this.cleanText(content);
    const maxLength = 5000; // Limit content length for storage
    if (content.length > maxLength) {
      content = `${content.substring(0, maxLength)}...`;
    }

    return content;
  }

  /**
   * Extract main HTML content (for offline viewing)
   */
  private extractMainHtml($: cheerio.CheerioAPI, url: string): string {
    // Try to find main content area
    const contentSelectors = ['main', 'article', '[role="main"]', '.content', '#content'];

    for (const selector of contentSelectors) {
      const element = $(selector).first();
      if (element.length > 0) {
        // Clean up the HTML
        element.find('script, style, iframe').remove();
        return element.html() || '';
      }
    }

    return '';
  }

  /**
   * Clean text by removing extra whitespace
   */
  private cleanText(text: string): string {
    return text
      .replace(/\s+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /**
   * Get type-specific extractor
   */
  private getExtractor(
    type: ThirdPartySourceType,
  ): ((url: string) => Promise<Result<ExtractedMetadata, string>>) | null {
    switch (type) {
      case 'LinearIssue':
        return this.extractLinear.bind(this);
      case 'github_issue':
      case 'GithubPR':
        return this.extractGitHub.bind(this);
      default:
        return null;
    }
  }

  /**
   * Extract Linear issue metadata
   */
  private async extractLinear(url: string): Promise<Result<ExtractedMetadata, string>> {
    // For Linear, we'll use the generic extractor but could enhance with API calls
    const result = await this.extractGeneric(url);

    if (result.ok && result.data) {
      // Add Linear-specific metadata
      result.data.metadata.sourceSpecific = {
        platform: 'linear',
        // Could parse issue ID from URL and fetch via API
      };
    }

    return result;
  }

  /**
   * Get title from URL
   */
  private getTitleFromUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname.replace(/\/$/, '');
      const lastSegment = pathname.split('/').pop() || '';

      if (lastSegment) {
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

  /**
   * Extract GitHub issue/PR metadata
   */
  private async extractGitHub(url: string): Promise<Result<ExtractedMetadata, string>> {
    try {
      // Parse GitHub URL
      const match = url.match(/github\.com\/([^\/]+)\/([^\/]+)\/(issues|pull)\/(\d+)/);
      if (!match) {
        return this.extractGeneric(url);
      }

      const [, owner, repo, type, number] = match;

      // Try to use GitHub API (if available)
      // For now, fall back to generic extraction
      const result = await this.extractGeneric(url);

      if (result.ok && result.data) {
        // Add GitHub-specific metadata
        result.data.metadata.sourceSpecific = {
          platform: 'github',
          owner,
          repo,
          type: type === 'issues' ? 'issue' : 'pr',
          number: parseInt(number),
        };
      }

      return result;
    } catch (error) {
      return this.extractGeneric(url);
    }
  }

  /**
   * Clear the metadata cache
   */
  clearCache(): void {
    this.requestCache.clear();
  }

  /**
   * Clean up expired cache entries
   */
  cleanupCache(): void {
    const now = Date.now();
    for (const [url, cached] of this.requestCache.entries()) {
      if (now - cached.timestamp > this.cacheTimeout) {
        this.requestCache.delete(url);
      }
    }
  }
}
