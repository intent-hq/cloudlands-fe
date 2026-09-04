import { app, BrowserWindow, protocol, session, webContents } from 'electron';
import { decodeUrlPath } from './utils/decode-url-path';
import { logger } from '../shared/logger';
import path from 'path';
import * as fs from 'fs';
import { safeResolvePath } from './utils/safe-resolve-path';
import {
  parseWorkspaceFileRequest,
  parseWorkspaceMediaBackendHint,
  withWorkspaceMediaBackendHint,
} from './utils/workspace-file-url';
import { isTrustedRendererUrl } from './ipc-authorization';
import {
  createWorkspaceOwnershipProber,
  resolveWorkspaceBackendClientWithRetry,
  type WorkspaceOwnershipProber,
} from './utils/workspace-backend-client';
import { getBackendIdForWindow } from './window-backend';
import { LOCAL_CONNECTION_ID } from '../shared/types/connections';
import { JsonRpcError } from '../features/backend/main/json-rpc-errors';
import type { JsonRpcClient } from '../features/backend/main/json-rpc-client';

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
 * `protocol.handle` does not expose the initiating webContents, so the
 * requesting window's backend arrives as a URL hint stamped by
 * `setupWorkspaceMediaBackendHinting`. A hinted request is served by that
 * backend only: live pooled client, or the primary compatibility client for
 * the implicit local backend, else fail closed — never another backend and
 * never an ownership probe. An unhinted (legacy) request keeps the
 * window-map resolution: primary fallback when no hosting window is found
 * (after a short retry) or when the stamped backend is the implicit local
 * one; a stamped named backend without a live pooled client fails closed.
 * See `./utils/workspace-backend-client`.
 */
async function backendClientForWorkspace(workspaceId: string, backendIdHint: string | null) {
  const [{ getBackendClient, getBackendClientForConnection }, { getWindowIdsForWorkspace }] =
    await Promise.all([
      import('../features/backend/main/backend.ipc'),
      import('../features/system/main/system.ipc'),
    ]);
  const resolution = await resolveWorkspaceBackendClientWithRetry(
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
      onAmbiguousHosting: (ambiguousWorkspaceId, hostingBackendIds) => {
        logger.warn('workspace hosted by windows on multiple backends — unhinted request', {
          workspaceId: ambiguousWorkspaceId,
          hostingBackendIds,
        });
      },
    },
    {
      attempts: WORKSPACE_BACKEND_RESOLUTION_ATTEMPTS,
      delayMs: WORKSPACE_BACKEND_RESOLUTION_RETRY_MS,
    },
    { backendIdHint },
  );
  if (
    backendIdHint !== null ||
    (resolution.fallback !== 'no-hosting-window' && resolution.fallback !== 'backend-disconnected')
  ) {
    return resolution;
  }
  // The window map could not name a live owning backend: find the owner by
  // positive confirmation instead of blindly trusting the local fallback
  // (v2.123.1 remote-backend broken-images regression). No confirmed owner
  // keeps the previous semantics: primary-client guess or fail closed.
  const owner = await (await workspaceOwnershipProber()).probeOwner(workspaceId);
  if (!owner) return resolution;
  logger.info('workspace backend resolved by ownership probe', {
    workspaceId,
    rescuedBackendId: owner.backendId,
    originalFallback: resolution.fallback,
    originalBackendId: resolution.backendId,
  });
  return { client: owner.client, backendId: owner.backendId, fallback: 'ownership-probe' as const };
}

/**
 * Shared ownership prober for the workspace protocol handlers: confirms which
 * live pooled backend owns a workspace via a cheap `workspace.get` (-32602 if
 * unknown; any rejection means "not the owner"). Lazily created because the
 * backend client pool is behind a dynamic import like the resolvers above.
 */
let ownershipProber: WorkspaceOwnershipProber<JsonRpcClient> | null = null;

async function workspaceOwnershipProber(): Promise<WorkspaceOwnershipProber<JsonRpcClient>> {
  if (!ownershipProber) {
    const { getLiveBackendIds, getBackendClientForConnection } =
      await import('../features/backend/main/backend.ipc');
    ownershipProber = createWorkspaceOwnershipProber<JsonRpcClient>({
      getLiveBackendIds,
      getClientForBackend: getBackendClientForConnection,
      confirmOwnership: async (client, workspaceId) => {
        await client.request('workspace.get', { workspaceId });
        return true;
      },
      onAmbiguousOwnership: (workspaceId, confirmingBackendIds) => {
        logger.warn('workspace ownership probe ambiguous — failing closed', {
          workspaceId,
          confirmingBackendIds,
        });
      },
    });
  }
  return ownershipProber;
}

/**
 * Heal a wrong-stamp read: when the resolved backend refuses a read because
 * the workspace is unknown to it, re-probe ownership and hand back the
 * confirmed owner so the caller can retry once. The daemon surfaces an
 * unknown workspace as -32602 (invalid params, e.g. workspace.get) or -32603
 * (internal error — file.readChunk fails root resolution, note.readAsset
 * fails the asset read); both trigger the probe, which fails closed, and a
 * genuine local error on the confirmed owner still 404s because same-backend
 * confirmation rethrows — a primary-fallback failure carries a null
 * backendId, which is treated as the local backend for this comparison (the
 * primary client is the local daemon). Null when the error is not a JSON-RPC
 * refusal, no live backend confirms ownership, or the confirmed owner is the
 * backend that already failed — the caller then rethrows and fails with 404
 * as before (never serve unconfirmed bytes).
 */
async function rescueBackendAfterWorkspaceUnknown(
  workspaceId: string,
  failedBackendId: string | null,
  error: unknown,
): Promise<{ client: JsonRpcClient; backendId: string } | null> {
  if (!(error instanceof JsonRpcError)) return null;
  if (error.rpcCode !== -32602 && error.rpcCode !== -32603) return null;
  const prober = await workspaceOwnershipProber();
  prober.invalidate(workspaceId);
  const owner = await prober.probeOwner(workspaceId);
  if (!owner || owner.backendId === (failedBackendId ?? LOCAL_CONNECTION_ID)) return null;
  logger.info('workspace read rescued by ownership probe', {
    workspaceId,
    rescuedBackendId: owner.backendId,
    failedBackendId,
  });
  return owner;
}

/** Diagnostic fields for a failed daemon read: JSON-RPC code + data when available. */
function describeReadError(error: unknown) {
  if (error instanceof JsonRpcError) {
    return { error: error.message, rpcCode: error.rpcCode, data: error.data };
  }
  return { error: error instanceof Error ? error.message : String(error) };
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

/**
 * Stamp the requesting window's backend id onto `workspace-file://` and
 * `workspace-asset://` requests. `protocol.handle` cannot see the initiating
 * webContents, but `webRequest.onBeforeRequest` can: an unhinted request from
 * a BrowserWindow is redirected to the same URL with `?backend={id}`, which
 * the handlers then honor (hinted backend only, fail closed if it is down).
 * A URL already hinted with another backend (e.g. authored in markdown) is
 * redirected with the hint overwritten to the requester's backend. Requests
 * without a window (no webContentsId, or a webContents that is not a
 * BrowserWindow) and URLs hinted with the requester's own backend pass
 * through untouched.
 */
export function setupWorkspaceMediaBackendHinting() {
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['workspace-file://*/*', 'workspace-asset://*/*'] },
    (details, callback) => {
      callback(workspaceMediaBackendRedirect(details.url, details.webContentsId));
    },
  );
}

/** The `onBeforeRequest` decision for one workspace media request. */
export function workspaceMediaBackendRedirect(
  url: string,
  webContentsId: number | undefined,
): { redirectURL?: string } {
  if (webContentsId === undefined) return {};
  const contents = webContents.fromId(webContentsId);
  const window =
    contents && !contents.isDestroyed() ? BrowserWindow.fromWebContents(contents) : null;
  if (!window) return {};
  const redirectURL = withWorkspaceMediaBackendHint(url, getBackendIdForWindow(window));
  return redirectURL ? { redirectURL } : {};
}

// Serves images from workspace note assets via workspace-asset://{workspaceId}/{assetId}
export function setupWorkspaceAssetProtocolHandler() {
  protocol.handle('workspace-asset', async (request) => {
    const url = new URL(request.url);
    const workspaceId = url.hostname;
    const hint = parseWorkspaceMediaBackendHint(url.search);
    if (!hint.ok) {
      logger.warn('Rejected workspace-asset request', { url: request.url, reason: hint.reason });
      // i18n-ignore (internal protocol response body)
      return new Response('Invalid asset URL', { status: 400 });
    }
    const backendIdHint = hint.backendId;
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
      const resolved = await backendClientForWorkspace(workspaceId, backendIdHint);
      backendId = resolved.backendId;
      fallback = resolved.fallback;
      if (resolved.client === null) {
        // Fail closed: the workspace's stamped backend is disconnected —
        // retargeting the primary client could serve wrong-backend bytes.
        logger.warn('workspace-asset backend disconnected', {
          workspaceId,
          assetId,
          backendId,
          backendIdHint,
          attemptedBackendIds: resolved.attemptedBackendIds,
        });
        // i18n-ignore (internal protocol response body)
        return new Response('Asset not found', { status: 404 });
      }
      let client = resolved.client;
      let result: { assetId: string; mimeType: string; data: string; sizeKb: number };
      try {
        result = (await client.request('note.readAsset', {
          workspaceId,
          asset: assetId,
        })) as typeof result;
      } catch (error) {
        // Wrong-stamp heal: the resolved backend does not know the workspace —
        // retry once from the positively confirmed owner (or rethrow → 404).
        // A hinted request names its backend authoritatively: no probe.
        if (backendIdHint !== null) throw error;
        const rescued = await rescueBackendAfterWorkspaceUnknown(workspaceId, backendId, error);
        if (!rescued) throw error;
        backendId = rescued.backendId;
        fallback = 'ownership-probe';
        client = rescued.client;
        result = (await client.request('note.readAsset', {
          workspaceId,
          asset: assetId,
        })) as typeof result;
      }
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
        backendIdHint,
        fallback,
        ...describeReadError(error),
      });
      // i18n-ignore (internal protocol response body)
      return new Response('Asset not found', { status: 404 });
    }
  });
}

/** Decoded bytes requested per daemon `file.readChunk` call (the daemon's 16 MiB cap). */
export const WORKSPACE_FILE_CHUNK_BYTES = 16 * 1024 * 1024;

/** Refuse workspace media beyond this size, including ranged video requests. */
export const WORKSPACE_FILE_MAX_BYTES = 128 * 1024 * 1024;

type WorkspaceFileChunk = { content: string; bytesRead: number; size: number };

type ParsedByteRange =
  { kind: 'closed'; start: number; end: number | null } | { kind: 'suffix'; length: number };

type WorkspaceFileRequestAuthorization =
  { ok: true; corsHeaders: Record<string, string> } | { ok: false; reason: string };

function trustedRendererOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (!isTrustedRendererUrl(value) || url.search || url.hash) return null;

    if (url.protocol === 'app:') {
      return url.pathname === '' || url.pathname === '/' ? 'app://workspaces' : null;
    }

    return url.pathname === '/' ? url.origin : null;
  } catch {
    return null;
  }
}

function authorizeWorkspaceFileRequest(request: Request): WorkspaceFileRequestAuthorization {
  const origin = request.headers.get('origin');
  if (origin === null) return { ok: true, corsHeaders: { Vary: 'Origin' } };

  const trustedOrigin = trustedRendererOrigin(origin);
  if (!trustedOrigin) return { ok: false, reason: 'untrusted origin' };

  return {
    ok: true,
    corsHeaders: {
      'Access-Control-Allow-Origin': trustedOrigin,
      Vary: 'Origin',
    },
  };
}

function parseByteRangeHeader(value: string): ParsedByteRange | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    const length = Number(match[2]);
    return Number.isSafeInteger(length) && length > 0 ? { kind: 'suffix', length } : null;
  }

  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : null;
  if (!Number.isSafeInteger(start) || start < 0) return null;
  if (end !== null && (!Number.isSafeInteger(end) || end < start)) return null;
  return { kind: 'closed', start, end };
}

class WorkspaceFileReadError extends Error {
  constructor(
    readonly status: 404 | 413,
    message: string,
  ) {
    super(message);
  }
}

// Serves workspace file images and narrowly allowlisted videos via
// workspace-file://{workspaceId}/{percent-encoded-path},
// backed by the daemon's `file.readChunk` (PROTOCOL §5.9) so reads stay contained
// within the workspace root. SVG and active/arbitrary formats remain excluded.
export function setupWorkspaceFileProtocolHandler() {
  protocol.handle('workspace-file', async (request) => {
    const authorization = authorizeWorkspaceFileRequest(request);
    if (!authorization.ok) {
      logger.warn('Rejected workspace-file request authorization', {
        reason: authorization.reason,
      });
      // i18n-ignore (internal protocol response body)
      return new Response('Forbidden', { status: 403, headers: { Vary: 'Origin' } });
    }

    const { corsHeaders } = authorization;
    const parsed = parseWorkspaceFileRequest(request.url);
    if (!parsed.ok) {
      logger.warn('Rejected workspace-file request', {
        url: request.url,
        status: parsed.status,
        reason: parsed.reason,
      });
      // i18n-ignore (internal protocol response body)
      return new Response('Invalid workspace file URL', {
        status: parsed.status,
        headers: corsHeaders,
      });
    }

    const { workspaceId, filePath, mimeType, backendId: backendIdHint } = parsed;
    // Bytes come from the backend that owns the workspace (monorepo#3501).
    let backendId: string | null = null;
    let fallback: string | null = null;
    try {
      const rangeHeader = request.headers.get('range');
      const requestedRange = rangeHeader ? parseByteRangeHeader(rangeHeader) : undefined;
      if (rangeHeader && !requestedRange) {
        return new Response('Invalid range', {
          status: 416,
          headers: {
            ...corsHeaders,
            'Accept-Ranges': 'bytes',
            'Content-Range': 'bytes */*',
          },
        });
      }

      const resolved = await backendClientForWorkspace(workspaceId, backendIdHint);
      backendId = resolved.backendId;
      fallback = resolved.fallback;
      if (resolved.client === null) {
        // Fail closed: the workspace's stamped backend is disconnected —
        // retargeting the primary client could serve wrong-backend bytes.
        logger.warn('workspace-file backend disconnected', {
          workspaceId,
          filePath,
          backendId,
          backendIdHint,
          attemptedBackendIds: resolved.attemptedBackendIds,
        });
        // i18n-ignore (internal protocol response body)
        return new Response('File not found', { status: 404 });
      }
      let client = resolved.client;
      let rescueAttempted = false;
      const chunks: Buffer[] = [];

      async function readChunk(offset: number, length: number): Promise<WorkspaceFileChunk> {
        let chunk: WorkspaceFileChunk;
        try {
          chunk = (await client.request('file.readChunk', {
            workspaceId,
            path: filePath,
            offset,
            length,
          })) as WorkspaceFileChunk;
        } catch (error) {
          // Wrong-stamp heal: the resolved backend does not know the workspace
          // — retry once from the positively confirmed owner (or rethrow → 404).
          // Only before any bytes are assembled: a mid-file rescue would splice
          // chunks from two daemons into one body, and in a workspace-id
          // collision a same-size file on the other daemon would pass the
          // size check silently. A hinted request names its backend
          // authoritatively: no probe.
          if (backendIdHint !== null || rescueAttempted || chunks.length > 0) throw error;
          rescueAttempted = true;
          const rescued = await rescueBackendAfterWorkspaceUnknown(workspaceId, backendId, error);
          if (!rescued) throw error;
          backendId = rescued.backendId;
          fallback = 'ownership-probe';
          client = rescued.client;
          chunk = (await client.request('file.readChunk', {
            workspaceId,
            path: filePath,
            offset,
            length,
          })) as WorkspaceFileChunk;
        }
        if (
          !Number.isSafeInteger(chunk.size) ||
          chunk.size < 0 ||
          !Number.isSafeInteger(chunk.bytesRead) ||
          chunk.bytesRead < 0 ||
          chunk.bytesRead > length ||
          offset + chunk.bytesRead > chunk.size ||
          typeof chunk.content !== 'string'
        ) {
          throw new WorkspaceFileReadError(404, 'invalid file.readChunk response');
        }
        if (chunk.size > WORKSPACE_FILE_MAX_BYTES) {
          throw new WorkspaceFileReadError(413, 'File too large');
        }
        return chunk;
      }

      let expectedSize: number | undefined;
      let start = 0;
      let endExclusive: number | undefined;
      if (requestedRange) {
        const probe = await readChunk(0, 1);
        expectedSize = probe.size;
        if (expectedSize === 0) {
          return new Response('Range not satisfiable', {
            status: 416,
            headers: {
              ...corsHeaders,
              'Accept-Ranges': 'bytes',
              'Content-Range': 'bytes */0',
            },
          });
        }
        if (requestedRange.kind === 'suffix') {
          start = Math.max(expectedSize - requestedRange.length, 0);
          endExclusive = expectedSize;
        } else {
          start = requestedRange.start;
          if (start >= expectedSize) {
            return new Response('Range not satisfiable', {
              status: 416,
              headers: {
                ...corsHeaders,
                'Accept-Ranges': 'bytes',
                'Content-Range': `bytes */${expectedSize}`,
              },
            });
          }
          endExclusive = Math.min((requestedRange.end ?? expectedSize - 1) + 1, expectedSize);
        }
      }

      let offset = start;
      for (;;) {
        const remaining =
          endExclusive === undefined ? WORKSPACE_FILE_CHUNK_BYTES : endExclusive - offset;
        if (remaining <= 0) break;
        const chunk = await readChunk(offset, Math.min(WORKSPACE_FILE_CHUNK_BYTES, remaining));
        if (expectedSize !== undefined && chunk.size !== expectedSize) {
          throw new WorkspaceFileReadError(404, 'file size changed during read');
        }
        expectedSize = chunk.size;
        if (chunk.bytesRead > 0) {
          const decoded = Buffer.from(chunk.content, 'base64');
          if (decoded.byteLength !== chunk.bytesRead) {
            throw new WorkspaceFileReadError(404, 'workspace-file chunk length mismatch');
          }
          chunks.push(decoded);
          offset += decoded.byteLength;
        }
        const targetEnd = endExclusive ?? chunk.size;
        if (offset >= targetEnd) break;
        if (chunk.bytesRead === 0) {
          throw new WorkspaceFileReadError(404, 'unexpected end of workspace file');
        }
      }

      const body = Buffer.concat(chunks);
      const responseBody = new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
      const commonHeaders = {
        ...corsHeaders,
        'Content-Type': mimeType,
        'Cache-Control': 'no-cache',
        'Accept-Ranges': 'bytes',
        'Content-Length': String(body.byteLength),
      };
      if (requestedRange && expectedSize !== undefined) {
        return new Response(responseBody, {
          status: 206,
          headers: {
            ...commonHeaders,
            'Content-Range': `bytes ${start}-${start + body.byteLength - 1}/${expectedSize}`,
          },
        });
      }

      return new Response(responseBody, {
        status: 200,
        headers: commonHeaders,
      });
    } catch (error) {
      logger.warn('Daemon file.readChunk failed', {
        workspaceId,
        filePath,
        backendId,
        backendIdHint,
        fallback,
        ...describeReadError(error),
      });
      // i18n-ignore (internal protocol response body)
      if (error instanceof WorkspaceFileReadError && error.status === 413) {
        return new Response('File too large', { status: 413, headers: corsHeaders });
      }
      return new Response('File not found', { status: 404, headers: corsHeaders });
    }
  });
}
