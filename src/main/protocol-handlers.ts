import { app, BrowserWindow, protocol } from 'electron';
import { decodeUrlPath } from './utils/decode-url-path';
import { logger } from '../shared/logger';
import path from 'path';
import * as fs from 'fs';
import { safeResolvePath } from './utils/safe-resolve-path';
import { parseWorkspaceFileRequest } from './utils/workspace-file-url';
import { resolveWorkspaceBackendClientWithRetry } from './utils/workspace-backend-client';
import { LOCAL_CONNECTION_ID } from '../shared/types/connections';

/**
 * Bounded retry while no hosting window is known yet: the window→workspace
 * maps are populated by un-awaited renderer IPCs after navigation, so a
 * cached image can fetch before the main process has recorded the workspace
 * (monorepo#3501); <img> never retries a 404.
 */
const WORKSPACE_BACKEND_RESOLUTION_ATTEMPTS = 5;
const WORKSPACE_BACKEND_RESOLUTION_RETRY_MS = 200;

/**
 * Resolve the backend client that owns `workspaceId` (monorepo#3501).
 * `protocol.handle` does not expose the initiating webContents, so the owning
 * backend is resolved from the windows hosting the workspace. Fallback to the
 * app-primary compatibility client applies when no hosting window is found
 * (after a short retry) or when the stamped backend is the implicit local
 * one; a stamped named backend without a live pooled client fails closed.
 * See `./utils/workspace-backend-client`.
 */
async function backendClientForWorkspace(workspaceId: string) {
  const [
    { getBackendClient, getBackendClientForConnection },
    { getWindowIdsForWorkspace },
    { getBackendIdForWindow },
  ] = await Promise.all([
    import('../features/backend/main/backend.ipc'),
    import('../features/system/main/system.ipc'),
    import('./window'),
  ]);
  return resolveWorkspaceBackendClientWithRetry(
    workspaceId,
    {
      getWindowIdsForWorkspace,
      getBackendIdForWindowId: (windowId) => {
        const window = BrowserWindow.fromId(windowId);
        return window && !window.isDestroyed() ? getBackendIdForWindow(window) : null;
      },
      getClientForBackend: getBackendClientForConnection,
      getPrimaryClient: getBackendClient,
      // The local pooled client and the compatibility client coincide at
      // startup, so the primary fallback cannot retarget another daemon here;
      // named/remote backends fail closed instead (wrong-backend bytes risk).
      isPrimaryFallbackAllowed: (backendId) => backendId === LOCAL_CONNECTION_ID,
    },
    {
      attempts: WORKSPACE_BACKEND_RESOLUTION_ATTEMPTS,
      delayMs: WORKSPACE_BACKEND_RESOLUTION_RETRY_MS,
    },
  );
}

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
      // i18n-ignore (internal protocol response body)
      return new Response('File not found', { status: 404 });
    }
    logger.error('Failed to serve file:', error);
    // i18n-ignore (internal protocol response body)
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
      // i18n-ignore (internal protocol response body)
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
      // i18n-ignore (internal protocol response body)
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
      // i18n-ignore (internal protocol response body)
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
    // i18n-ignore (internal protocol response body)
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
      // i18n-ignore (internal protocol response body)
      return new Response('Invalid asset URL', { status: 400 });
    }

    const assetId = decodedPath.replace(/^\/+/, '');

    if (!workspaceId || !assetId) {
      logger.warn('Invalid workspace-asset URL:', request.url);
      // i18n-ignore (internal protocol response body)
      return new Response('Invalid asset URL', { status: 400 });
    }

    if (assetId.includes('/') || assetId.includes('\\')) {
      logger.warn('Rejected workspace-asset request with path separators', {
        workspaceId,
        assetId,
      });
      // i18n-ignore (internal protocol response body)
      return new Response('Invalid asset URL', { status: 400 });
    }

    // Assets are served by the daemon via `note.readAsset` (PROTOCOL §5.2),
    // issued on the backend that owns the workspace (monorepo#3501).
    // The legacy local-assets fallback was retired in D6.
    let backendId: string | null = null;
    let fallback: string | null = null;
    try {
      const resolved = await backendClientForWorkspace(workspaceId);
      backendId = resolved.backendId;
      fallback = resolved.fallback;
      if (resolved.client === null) {
        // Fail closed: the workspace's stamped backend is disconnected —
        // retargeting the primary client could serve wrong-backend bytes.
        logger.warn('workspace-asset backend disconnected', {
          workspaceId,
          assetId,
          backendId,
          attemptedBackendIds: resolved.attemptedBackendIds,
        });
        // i18n-ignore (internal protocol response body)
        return new Response('Asset not found', { status: 404 });
      }
      const result = (await resolved.client.request('note.readAsset', {
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
      logger.warn('Daemon note.readAsset failed', {
        workspaceId,
        assetId,
        backendId,
        fallback,
        error: error instanceof Error ? error.message : String(error),
      });
      // i18n-ignore (internal protocol response body)
      return new Response('Asset not found', { status: 404 });
    }
  });
}

/** Decoded bytes requested per daemon `file.readChunk` call (the daemon's 16 MiB cap). */
export const WORKSPACE_FILE_CHUNK_BYTES = 16 * 1024 * 1024;

/** The handler buffers the whole file in memory, so refuse files beyond this size. */
export const WORKSPACE_FILE_MAX_BYTES = 128 * 1024 * 1024;

// Serves workspace file images via workspace-file://{workspaceId}/{percent-encoded-path},
// backed by the daemon's `file.readChunk` (PROTOCOL §5.9) so reads stay contained
// within the workspace root. Image-allowlist only — SVG is excluded in v1.
export function setupWorkspaceFileProtocolHandler() {
  protocol.handle('workspace-file', async (request) => {
    const parsed = parseWorkspaceFileRequest(request.url);
    if (!parsed.ok) {
      logger.warn('Rejected workspace-file request', {
        url: request.url,
        status: parsed.status,
        reason: parsed.reason,
      });
      // i18n-ignore (internal protocol response body)
      return new Response('Invalid workspace file URL', { status: parsed.status });
    }

    const { workspaceId, filePath, mimeType } = parsed;
    // Bytes come from the backend that owns the workspace (monorepo#3501).
    let backendId: string | null = null;
    let fallback: string | null = null;
    try {
      const resolved = await backendClientForWorkspace(workspaceId);
      backendId = resolved.backendId;
      fallback = resolved.fallback;
      if (resolved.client === null) {
        // Fail closed: the workspace's stamped backend is disconnected —
        // retargeting the primary client could serve wrong-backend bytes.
        logger.warn('workspace-file backend disconnected', {
          workspaceId,
          filePath,
          backendId,
          attemptedBackendIds: resolved.attemptedBackendIds,
        });
        // i18n-ignore (internal protocol response body)
        return new Response('File not found', { status: 404 });
      }
      const client = resolved.client;
      const chunks: Buffer[] = [];
      let offset = 0;
      for (;;) {
        const chunk = (await client.request('file.readChunk', {
          workspaceId,
          path: filePath,
          offset,
          length: WORKSPACE_FILE_CHUNK_BYTES,
        })) as { content: string; bytesRead: number; size: number };
        if (chunk.size > WORKSPACE_FILE_MAX_BYTES) {
          logger.warn('Refused oversized workspace-file request', {
            workspaceId,
            filePath,
            size: chunk.size,
          });
          // i18n-ignore (internal protocol response body)
          return new Response('File too large', { status: 413 });
        }
        if (chunk.bytesRead > 0) {
          const decoded = Buffer.from(chunk.content, 'base64');
          if (decoded.byteLength !== chunk.bytesRead) {
            // Fail closed instead of serving a spliced body if the daemon's
            // reported bytesRead ever diverges from the decoded content.
            logger.warn('workspace-file chunk length mismatch', {
              workspaceId,
              filePath,
              bytesRead: chunk.bytesRead,
              decodedLength: decoded.byteLength,
            });
            // i18n-ignore (internal protocol response body)
            return new Response('Not found', { status: 404 });
          }
          chunks.push(decoded);
          offset += decoded.byteLength;
        }
        if (chunk.bytesRead === 0 || offset >= chunk.size) {
          break;
        }
      }
      return new Response(new Uint8Array(Buffer.concat(chunks)), {
        status: 200,
        headers: {
          'Content-Type': mimeType,
          // Workspace files are mutable — never cache long-term.
          'Cache-Control': 'no-cache',
          // corsEnabled schemes need this for renderer fetch() reads from
          // the app:// (or dev HTTP) origin; <img> loads work without it.
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch (error) {
      logger.warn('Daemon file.readChunk failed', {
        workspaceId,
        filePath,
        backendId,
        fallback,
        error: error instanceof Error ? error.message : String(error),
      });
      // i18n-ignore (internal protocol response body)
      return new Response('File not found', { status: 404 });
    }
  });
}
