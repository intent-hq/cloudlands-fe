/**
 * Assets Service
 *
 * Handles saving and retrieving image assets for notes.
 * Assets are stored in the workspace metadata assets folder.
 *
 * Storage format:
 * - **Local workspaces**: Binary (backwards compatible with pre-IMetadataFS assets)
 * - **Remote workspaces**: Base64 text (IMetadataFS only supports utf-8 encoding)
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { WorkspaceConfig } from '../../../shared/main/config';
import { Logger } from '../../../shared/logger';
import type { IMetadataFS } from '../../metadata-fs/main/metadata-fs';
import { LocalMetadataFS } from '../../metadata-fs/main/local-metadata-fs';

const logger = new Logger('AssetsService');

export interface SaveAssetResult {
  assetId: string;
  path: string;
  url: string;
}

export interface AssetMetadata {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

class AssetsService {
  /**
   * Resolver that returns the correct IMetadataFS for a workspace.
   * Defaults to LocalMetadataFS for backward compatibility.
   */
  private metadataFSResolver: (workspaceId: string) => IMetadataFS = () => new LocalMetadataFS();

  /**
   * Set the IMetadataFS resolver for remote workspace support.
   */
  setMetadataFSResolver(resolver: (workspaceId: string) => IMetadataFS): void {
    this.metadataFSResolver = resolver;
  }

  private getFS(workspaceId: string): IMetadataFS {
    return this.metadataFSResolver(workspaceId);
  }

  /**
   * Check if a workspace uses local storage (vs remote/cached).
   * Local workspaces store assets as binary for backwards compatibility.
   * Remote workspaces store assets as base64 text (IMetadataFS only supports utf-8).
   */
  private isLocalWorkspace(workspaceId: string): boolean {
    const metadataFS = this.getFS(workspaceId);
    return metadataFS instanceof LocalMetadataFS;
  }

  /**
   * Save an image asset to the workspace assets folder
   *
   * @param workspaceId - The workspace ID
   * @param data - Base64 encoded image data (with or without data URL prefix)
   * @param mimeType - The MIME type of the image (e.g., 'image/png')
   * @param originalName - Optional original filename
   * @returns Asset info including the ID and local path
   */
  async saveAsset(
    workspaceId: string,
    data: string,
    mimeType: string,
    originalName?: string,
  ): Promise<SaveAssetResult> {
    try {
      const metadataFS = this.getFS(workspaceId);
      const isLocal = this.isLocalWorkspace(workspaceId);

      // Ensure assets directory exists
      const assetsDir = WorkspaceConfig.paths.assets(workspaceId);
      await metadataFS.mkdir(assetsDir, { recursive: true });

      // Strip data URL prefix if present
      const base64Data = data.replace(/^data:[^;]+;base64,/, '');

      // Generate a unique asset ID based on content hash + timestamp
      const contentHash = crypto.createHash('md5').update(base64Data).digest('hex').slice(0, 8);
      const timestamp = Date.now().toString(36);
      const extension = this.getExtensionFromMimeType(mimeType);
      const assetId = `${timestamp}-${contentHash}${extension}`;

      const buffer = Buffer.from(base64Data, 'base64');
      const assetPath = WorkspaceConfig.paths.asset(workspaceId, assetId);

      if (isLocal) {
        // Local: save as binary (backwards compatible with existing assets)
        await fs.writeFile(assetPath, buffer);
      } else {
        // Remote: save as base64 text (IMetadataFS only supports utf-8)
        await metadataFS.writeFile(assetPath, base64Data, 'utf-8');
      }

      // Save metadata alongside the asset
      const metadata: AssetMetadata = {
        id: assetId,
        originalName: originalName || assetId,
        mimeType,
        size: buffer.length,
        createdAt: new Date().toISOString(),
      };
      await metadataFS.writeFile(`${assetPath}.meta.json`, JSON.stringify(metadata, null, 2), 'utf-8');

      logger.info('Asset saved successfully', {
        workspaceId,
        assetId,
        size: buffer.length,
        mimeType,
        storageFormat: isLocal ? 'binary' : 'base64',
      });

      // Return the asset info with a workspace-relative URL
      return {
        assetId,
        path: assetPath,
        url: `workspace-asset://${workspaceId}/${assetId}`,
      };
    } catch (error) {
      logger.error('Failed to save asset', error as Error, { workspaceId, mimeType });
      throw error;
    }
  }

  /**
   * Get the file path for an asset
   */
  getAssetPath(workspaceId: string, assetId: string): string {
    return WorkspaceConfig.paths.asset(workspaceId, assetId);
  }

  /**
   * Read an asset as a buffer.
   *
   * Storage format depends on workspace type:
   * - Local: binary (backwards compatible)
   * - Remote: base64 text
   */
  async readAsset(workspaceId: string, assetId: string): Promise<Buffer> {
    const assetPath = this.getAssetPath(workspaceId, assetId);

    if (this.isLocalWorkspace(workspaceId)) {
      // Local: read as binary (backwards compatible with existing assets)
      return fs.readFile(assetPath);
    } else {
      // Remote: read as base64 text
      const metadataFS = this.getFS(workspaceId);
      const base64Data = await metadataFS.readFile(assetPath, 'utf-8');
      return Buffer.from(base64Data, 'base64');
    }
  }

  /**
   * Read an asset as base64 data URL.
   *
   * Storage format depends on workspace type:
   * - Local: binary (backwards compatible)
   * - Remote: base64 text
   */
  async readAssetAsDataUrl(workspaceId: string, assetId: string): Promise<string> {
    const assetPath = this.getAssetPath(workspaceId, assetId);
    const metadata = await this.getAssetMetadata(workspaceId, assetId);
    const mimeType = metadata?.mimeType || this.getMimeTypeFromExtension(assetId);

    if (this.isLocalWorkspace(workspaceId)) {
      // Local: read as binary, then convert to base64
      const buffer = await fs.readFile(assetPath);
      return `data:${mimeType};base64,${buffer.toString('base64')}`;
    } else {
      // Remote: already stored as base64 text
      const metadataFS = this.getFS(workspaceId);
      const base64Data = await metadataFS.readFile(assetPath, 'utf-8');
      return `data:${mimeType};base64,${base64Data}`;
    }
  }

  /**
   * Get asset metadata
   */
  async getAssetMetadata(workspaceId: string, assetId: string): Promise<AssetMetadata | null> {
    try {
      const metadataFS = this.getFS(workspaceId);
      const assetPath = this.getAssetPath(workspaceId, assetId);
      const metadataPath = `${assetPath}.meta.json`;
      const content = await metadataFS.readFile(metadataPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * Delete an asset
   */
  async deleteAsset(workspaceId: string, assetId: string): Promise<void> {
    const metadataFS = this.getFS(workspaceId);
    const assetPath = this.getAssetPath(workspaceId, assetId);
    try { await metadataFS.unlink(assetPath); } catch { /* ignore */ }
    try { await metadataFS.unlink(`${assetPath}.meta.json`); } catch { /* ignore */ }
  }

  /**
   * List all assets for a workspace
   */
  async listAssets(workspaceId: string): Promise<AssetMetadata[]> {
    try {
      const metadataFS = this.getFS(workspaceId);
      const assetsDir = WorkspaceConfig.paths.assets(workspaceId);
      const entries = await metadataFS.readdir(assetsDir, { withFileTypes: true });
      const assets: AssetMetadata[] = [];

      for (const entry of entries) {
        if (!entry.isFile() || entry.name.endsWith('.meta.json')) continue;
        const metadata = await this.getAssetMetadata(workspaceId, entry.name);
        if (metadata) {
          assets.push(metadata);
        }
      }

      return assets;
    } catch {
      return [];
    }
  }

  private getExtensionFromMimeType(mimeType: string): string {
    const map: Record<string, string> = {
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'image/svg+xml': '.svg',
      'image/bmp': '.bmp',
      'image/tiff': '.tiff',
    };
    return map[mimeType] || '.png';
  }

  private getMimeTypeFromExtension(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    const map: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.bmp': 'image/bmp',
      '.tiff': 'image/tiff',
    };
    return map[ext] || 'image/png';
  }
}

// Export singleton instance
export const assetsService = new AssetsService();
