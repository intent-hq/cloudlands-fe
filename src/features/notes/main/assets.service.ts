/**
 * Assets Service
 *
 * Handles saving and retrieving image assets for notes.
 * Assets are stored in the workspace metadata assets folder.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { WorkspaceConfig } from '../../../shared/main/config';
import { Logger } from '../../../shared/logger';

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
      // Ensure assets directory exists
      const assetsDir = WorkspaceConfig.paths.assets(workspaceId);
      await fs.mkdir(assetsDir, { recursive: true });

      // Strip data URL prefix if present
      const base64Data = data.replace(/^data:[^;]+;base64,/, '');

      // Generate a unique asset ID based on content hash + timestamp
      const contentHash = crypto.createHash('md5').update(base64Data).digest('hex').slice(0, 8);
      const timestamp = Date.now().toString(36);
      const extension = this.getExtensionFromMimeType(mimeType);
      const assetId = `${timestamp}-${contentHash}${extension}`;

      // Convert base64 to buffer and save
      const buffer = Buffer.from(base64Data, 'base64');
      const assetPath = WorkspaceConfig.paths.asset(workspaceId, assetId);
      await fs.writeFile(assetPath, buffer);

      // Save metadata alongside the asset
      const metadata: AssetMetadata = {
        id: assetId,
        originalName: originalName || assetId,
        mimeType,
        size: buffer.length,
        createdAt: new Date().toISOString(),
      };
      await fs.writeFile(`${assetPath}.meta.json`, JSON.stringify(metadata, null, 2));

      logger.info('Asset saved successfully', {
        workspaceId,
        assetId,
        size: buffer.length,
        mimeType,
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
   * Read an asset as a buffer
   */
  async readAsset(workspaceId: string, assetId: string): Promise<Buffer> {
    const assetPath = this.getAssetPath(workspaceId, assetId);
    return fs.readFile(assetPath);
  }

  /**
   * Read an asset as base64 data URL
   */
  async readAssetAsDataUrl(workspaceId: string, assetId: string): Promise<string> {
    const assetPath = this.getAssetPath(workspaceId, assetId);
    const buffer = await fs.readFile(assetPath);
    const metadata = await this.getAssetMetadata(workspaceId, assetId);
    const mimeType = metadata?.mimeType || this.getMimeTypeFromExtension(assetId);
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
  }

  /**
   * Get asset metadata
   */
  async getAssetMetadata(workspaceId: string, assetId: string): Promise<AssetMetadata | null> {
    try {
      const assetPath = this.getAssetPath(workspaceId, assetId);
      const metadataPath = `${assetPath}.meta.json`;
      const content = await fs.readFile(metadataPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * Delete an asset
   */
  async deleteAsset(workspaceId: string, assetId: string): Promise<void> {
    const assetPath = this.getAssetPath(workspaceId, assetId);
    await fs.unlink(assetPath).catch(() => {});
    await fs.unlink(`${assetPath}.meta.json`).catch(() => {});
  }

  /**
   * List all assets for a workspace
   */
  async listAssets(workspaceId: string): Promise<AssetMetadata[]> {
    try {
      const assetsDir = WorkspaceConfig.paths.assets(workspaceId);
      const files = await fs.readdir(assetsDir);
      const assets: AssetMetadata[] = [];

      for (const file of files) {
        if (file.endsWith('.meta.json')) continue;
        const metadata = await this.getAssetMetadata(workspaceId, file);
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
