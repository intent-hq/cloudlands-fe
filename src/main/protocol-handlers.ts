import {
  app,
  protocol,
} from 'electron';
import { decodeUrlPath } from './utils/decode-url-path';
import { logger } from '../shared/logger';
import path from 'path';
import * as fs from 'fs';
import { safeResolvePath } from './utils/safe-resolve-path';

// ---- Shared Helpers ----

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

/**
 * Read a file from disk and return it as a Response with the correct MIME type.
 * Returns 404 for missing files (ENOENT), 500 for other I/O errors.
 */
async function serveFile(
  filePath: string,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  try {
    const content = await fs.promises.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
    return new Response(new Uint8Array(content), {
      status: 200,
      headers: { 'Content-Type': mimeType, ...extraHeaders },
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      logger.error('File not found:', filePath);
      return new Response('File not found', { status: 404 });
    }
    logger.error('Failed to serve file:', error);
    return new Response('Failed to serve file', { status: 500 });
  }
}

// ---- Protocol Handlers ----

export function setupAppProtocolHandler() {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    const decodedPath = decodeUrlPath(url.pathname);
    if (decodedPath === null) {
      logger.warn('Rejected protocol request with invalid path encoding', {
        originalPath: url.pathname,
      });
      return new Response('Invalid path', { status: 400 });
    }

    const normalizedPath = decodedPath.replace(/\\/g, '/');
    // Remove all leading slashes for proper path joining
    const filePath = normalizedPath.replace(/^\/+/, '');

    // Get the unpacked path
    const appPath = app.getAppPath();
    const unpackedPath = appPath.replace('app.asar', 'app.asar.unpacked');
    const rendererRoot = path.join(unpackedPath, 'dist', 'renderer');

    logger.info('Protocol handler requested:', {
      originalPath: url.pathname,
      processedPath: filePath,
      isIndexHtml: filePath === 'index.html',
      isEmpty: filePath === '',
      hasNoExtension: !filePath.includes('.'),
    });

    // Special handling for SvelteKit routes
    // If it's /index.html or any route without an extension, serve index.html
    // This allows SvelteKit's client-side router to handle navigation
    if (
      filePath === 'index.html' ||
      filePath === '' ||
      (!filePath.includes('.') && !filePath.startsWith('app/') && !filePath.startsWith('_app/'))
    ) {
      logger.info('Serving index.html for route:', filePath);
      return serveFile(path.join(rendererRoot, 'index.html'), {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      });
    }

    // Reject .ts requests in production
    if (filePath.endsWith('.ts')) {
      logger.warn('TypeScript file requested in production:', filePath);
      return new Response('TypeScript files should not be loaded in production', {
        status: 404,
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    // Try multiple paths for resources
    let fullPath: string | null = null;

    if (filePath.startsWith('resources/')) {
      const resourceRoots = [
        unpackedPath,
        path.join(unpackedPath, 'src'),
        path.join(unpackedPath, 'dist'),
      ];
      for (const resourceRoot of resourceRoots) {
        const candidate = safeResolvePath(resourceRoot, filePath);
        if (candidate && fs.existsSync(candidate)) {
          fullPath = candidate;
          logger.info('Found resource:', { filePath, fullPath: candidate, root: resourceRoot });
          break;
        }
      }
      if (!fullPath) {
        logger.warn('Resource not found in any location:', {
          requested: filePath,
          tried: resourceRoots,
        });
      }
    }

    if (!fullPath) {
      fullPath = safeResolvePath(rendererRoot, filePath);
    }

    if (!fullPath) {
      logger.warn('Rejected protocol request with unsafe path', { filePath });
      return new Response('Invalid path', { status: 400 });
    }

    // File exists — serve it
    if (fs.existsSync(fullPath)) {
      return serveFile(fullPath);
    }

    // File not found — fall back to index.html for navigation requests (client-side routing)
    const ext = path.extname(filePath).toLowerCase();
    if (!ext || ext === '.html') {
      return serveFile(path.join(rendererRoot, 'index.html'));
    }

    logger.error('File not found:', { filePath, fullPath });
    return new Response('File not found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain' },
    });
  });
}

// Serves images from workspace note assets via workspace-asset://{workspaceId}/{assetId}
export function setupWorkspaceAssetProtocolHandler() {
  protocol.handle('workspace-asset', async (request) => {
    const url = new URL(request.url);
    const workspaceId = url.hostname;
    const decodedPath = decodeUrlPath(url.pathname);
    if (decodedPath === null) {
      logger.warn('Rejected workspace-asset request with invalid path encoding', {
        originalPath: url.pathname,
      });
      return new Response('Invalid asset URL', { status: 400 });
    }

    const assetId = decodedPath.replace(/^\/+/, '');

    if (!workspaceId || !assetId) {
      logger.warn('Invalid workspace-asset URL:', request.url);
      return new Response('Invalid asset URL', { status: 400 });
    }

    if (assetId.includes('/') || assetId.includes('\\')) {
      logger.warn('Rejected workspace-asset request with path separators', {
        workspaceId,
        assetId,
      });
      return new Response('Invalid asset URL', { status: 400 });
    }

    // Daemon-first: assets saved via `note.saveAsset` live under the daemon's
    // data dir, so resolve through `note.readAsset` (PROTOCOL §5.2) and fall
    // back to the legacy local assets dir for pre-daemon assets.
    try {
      const { getBackendClient } = await import('../features/backend/main/backend.ipc');
      const result = (await getBackendClient().request('note.readAsset', {
        workspaceId,
        asset: assetId,
      })) as { assetId: string; mimeType: string; data: string; sizeKb: number };
      return new Response(new Uint8Array(Buffer.from(result.data, 'base64')), {
        status: 200,
        headers: {
          'Content-Type': result.mimeType,
          'Cache-Control': 'max-age=31536000', // 1 year — assets are content-addressed
        },
      });
    } catch (error) {
      logger.warn('Daemon note.readAsset failed; trying legacy local assets', {
        workspaceId,
        assetId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      const { assetsService } = await import('../features/notes/main/assets.service');
      const assetPath = assetsService.getAssetPath(workspaceId, assetId);

      if (!fs.existsSync(assetPath)) {
        logger.warn('Asset not found:', { workspaceId, assetId, assetPath });
        return new Response('Asset not found', { status: 404 });
      }

      return serveFile(assetPath, {
        'Cache-Control': 'max-age=31536000', // 1 year — assets are content-addressed
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (message.startsWith('Invalid asset')) {
        logger.warn('Rejected workspace-asset request', { workspaceId, assetId, message });
        return new Response('Invalid asset URL', { status: 400 });
      }
      logger.error('Failed to serve asset:', error);
      return new Response('Failed to serve asset', { status: 500 });
    }
  });
}
