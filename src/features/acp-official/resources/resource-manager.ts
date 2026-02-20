/**
 * Resource Manager for ACP
 *
 * Handles embedded resources in messages with preview and caching.
 */

import { EventEmitter } from '../utils/browser-event-emitter';
import { Logger } from '../../../shared/logger';
import type { ContentBlock } from '../types/content';

const logger = new Logger('ResourceManager');

export interface Resource {
  id: string;
  uri: string;
  mimeType?: string;
  title?: string;
  description?: string;
  size?: number;
  preview?: string;
  metadata?: Record<string, any>;
  createdAt: number;
  accessedAt: number;
  cached?: boolean;
}

export interface ResourcePreview {
  type: 'text' | 'image' | 'code' | 'data' | 'unknown';
  content: string;
  language?: string;
  truncated?: boolean;
}

export class ResourceManager extends EventEmitter {
  private resources = new Map<string, Resource>();
  private cache = new Map<string, any>();
  private maxCacheSize = 50 * 1024 * 1024; // 50MB
  private currentCacheSize = 0;

  /**
   * Add a resource
   */
  async addResource(
    uri: string,
    content?: string | ArrayBuffer,
    metadata?: Partial<Resource>,
  ): Promise<Resource> {
    const id = this.generateResourceId(uri);

    // Check if already exists
    let resource = this.resources.get(id);
    if (resource) {
      resource.accessedAt = Date.now();
      return resource;
    }

    // Create new resource
    resource = {
      id,
      uri,
      mimeType: metadata?.mimeType || this.detectMimeType(uri),
      title: metadata?.title || this.extractTitle(uri),
      description: metadata?.description,
      size: metadata?.size || (content ? this.getSize(content) : undefined),
      preview: metadata?.preview,
      metadata: metadata?.metadata,
      createdAt: Date.now(),
      accessedAt: Date.now(),
      cached: false,
    };

    // Generate preview if content provided
    if (content) {
      resource.preview = await this.generatePreview(content, resource.mimeType);

      // Cache if small enough
      if (resource.size && resource.size < this.maxCacheSize / 10) {
        this.cacheResource(id, content);
        resource.cached = true;
      }
    }

    this.resources.set(id, resource);
    this.emit('resource:added', resource);

    logger.info('Resource added', { id, uri, mimeType: resource.mimeType });
    return resource;
  }

  /**
   * Get a resource
   */
  getResource(idOrUri: string): Resource | undefined {
    let resource = this.resources.get(idOrUri);
    if (!resource) {
      // Try by URI
      const id = this.generateResourceId(idOrUri);
      resource = this.resources.get(id);
    }

    if (resource) {
      resource.accessedAt = Date.now();
    }

    return resource;
  }

  /**
   * Get resource content from cache
   */
  getCachedContent(idOrUri: string): any {
    const resource = this.getResource(idOrUri);
    if (!resource) return null;

    return this.cache.get(resource.id);
  }

  /**
   * Create resource content block
   */
  createResourceBlock(uri: string, text?: string, mimeType?: string): ContentBlock {
    return {
      type: 'resource',
      uri,
      text: text || uri,
      mimeType,
    } as any;
  }

  /**
   * Parse resource from URI
   */
  async parseResourceFromUri(uri: string): Promise<Resource | null> {
    try {
      // Handle different URI schemes
      if (uri.startsWith('file://')) {
        return this.parseFileResource(uri);
      } else if (uri.startsWith('http://') || uri.startsWith('https://')) {
        return this.parseWebResource(uri);
      } else if (uri.startsWith('data:')) {
        return this.parseDataUri(uri);
      } else {
        // Assume local file path
        return this.parseFileResource(`file://${uri}`);
      }
    } catch (error) {
      logger.error('Failed to parse resource', error as Error, { uri });
      return null;
    }
  }

  /**
   * Generate preview for content
   */
  private async generatePreview(content: string | ArrayBuffer, mimeType?: string): Promise<string> {
    const textContent =
      typeof content === 'string' ? content : new TextDecoder().decode(content as ArrayBuffer);

    // Text preview
    if (!mimeType || mimeType.startsWith('text/')) {
      const lines = textContent.split('\n').slice(0, 10);
      const preview = lines.join('\n');
      return preview.length > 500 ? `${preview.substring(0, 500)}...` : preview;
    }

    // Code preview
    if (this.isCodeMimeType(mimeType)) {
      const lines = textContent.split('\n').slice(0, 20);
      return lines.join('\n');
    }

    // JSON preview
    if (mimeType === 'application/json') {
      try {
        const json = JSON.parse(textContent);
        return JSON.stringify(json, null, 2).substring(0, 500);
      } catch {
        return textContent.substring(0, 500);
      }
    }

    // Image preview (base64)
    if (mimeType.startsWith('image/')) {
      if (typeof content === 'string' && content.startsWith('data:')) {
        return content;
      }
      // Convert to base64 if needed
      if (content instanceof ArrayBuffer) {
        const base64 = btoa(String.fromCharCode(...new Uint8Array(content)));
        return `data:${mimeType};base64,${base64}`;
      }
    }

    return textContent.substring(0, 200);
  }

  /**
   * Parse file resource
   */
  private async parseFileResource(uri: string): Promise<Resource> {
    const path = uri.replace('file://', '');
    const name = path.split('/').pop() || 'file';

    return this.addResource(uri, undefined, {
      title: name,
      mimeType: this.detectMimeType(path),
    });
  }

  /**
   * Parse web resource
   */
  private async parseWebResource(uri: string): Promise<Resource> {
    const url = new URL(uri);
    const name = url.pathname.split('/').pop() || url.hostname;

    return this.addResource(uri, undefined, {
      title: name,
      description: `Web resource from ${url.hostname}`,
      mimeType: this.detectMimeType(uri),
    });
  }

  /**
   * Parse data URI
   */
  private async parseDataUri(uri: string): Promise<Resource> {
    const match = uri.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      throw new Error('Invalid data URI');
    }

    const [, mimeType, base64] = match;
    const content = atob(base64);

    return this.addResource(uri, content, {
      title: 'Embedded Data',
      mimeType,
      size: content.length,
    });
  }

  /**
   * Detect MIME type from URI/path
   */
  private detectMimeType(uri: string): string {
    const ext = uri.split('.').pop()?.toLowerCase();

    const mimeTypes: Record<string, string> = {
      // Text
      txt: 'text/plain',
      md: 'text/markdown',
      html: 'text/html',
      css: 'text/css',

      // Code
      js: 'application/javascript',
      ts: 'application/typescript',
      jsx: 'application/javascript',
      tsx: 'application/typescript',
      py: 'text/x-python',
      java: 'text/x-java',
      c: 'text/x-c',
      cpp: 'text/x-c++',
      cs: 'text/x-csharp',
      go: 'text/x-go',
      rs: 'text/x-rust',
      rb: 'text/x-ruby',
      php: 'text/x-php',

      // Data
      json: 'application/json',
      xml: 'application/xml',
      yaml: 'application/yaml',
      yml: 'application/yaml',
      csv: 'text/csv',

      // Images
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      svg: 'image/svg+xml',
      webp: 'image/webp',

      // Documents
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };

    return mimeTypes[ext || ''] || 'application/octet-stream';
  }

  /**
   * Check if MIME type is code
   */
  private isCodeMimeType(mimeType: string): boolean {
    return (
      mimeType.includes('javascript') ||
      mimeType.includes('typescript') ||
      mimeType.startsWith('text/x-')
    );
  }

  /**
   * Extract title from URI
   */
  private extractTitle(uri: string): string {
    if (uri.startsWith('data:')) {
      return 'Embedded Data';
    }

    const parts = uri.split('/');
    return parts[parts.length - 1] || 'Resource';
  }

  /**
   * Get size of content
   */
  private getSize(content: string | ArrayBuffer): number {
    if (typeof content === 'string') {
      return new Blob([content]).size;
    }
    return content.byteLength;
  }

  /**
   * Generate resource ID
   */
  private generateResourceId(uri: string): string {
    // Simple hash function
    let hash = 0;
    for (let i = 0; i < uri.length; i++) {
      const char = uri.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return `res_${Math.abs(hash)}`;
  }

  /**
   * Cache resource content
   */
  private cacheResource(id: string, content: any): void {
    const size = this.getSize(content);

    // Evict old entries if needed
    while (this.currentCacheSize + size > this.maxCacheSize && this.cache.size > 0) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        const evicted = this.cache.get(firstKey);
        this.cache.delete(firstKey);
        if (evicted) {
          this.currentCacheSize -= this.getSize(evicted);
        }
      } else {
        break;
      }
    }

    this.cache.set(id, content);
    this.currentCacheSize += size;
  }
}

// Singleton instance
export const resourceManager = new ResourceManager();
