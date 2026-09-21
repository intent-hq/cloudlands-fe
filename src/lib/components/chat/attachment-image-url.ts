/**
 * Renderable URLs for attachment-reference image blocks (monorepo#3338).
 * A reference block carries only `{ type: 'image', attachmentId }` — no
 * bytes — so rendering resolves the registry row (`file.getAttachmentInfo`,
 * PROTOCOL §5.9) to its workspace-relative path and serves the bytes over
 * the privileged `workspace-file://{workspaceId}/{path}` protocol (image
 * MIME allowlist + containment enforced by the main-process handler).
 */
import { getAttachmentInfo } from './input/context-api';
import { createLogger } from '$lib/utils/client-logger';
import { onBackendReconnected } from '$lib/client/live/backend-transport';

const logger = createLogger('AttachmentImageUrl');

/** Build a `workspace-file://` URL with each path segment percent-encoded. */
function workspaceFileUrl(workspaceId: string, relativePath: string): string {
  const encoded = relativePath
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `workspace-file://${workspaceId}/${encoded}`;
}

/**
 * Attachment rows are immutable (id → path never changes), so resolved URLs
 * cache process-wide. Failures are NOT cached: a transient daemon error may
 * succeed on the next render pass.
 */
const urlCache = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

/**
 * Drop a cached URL whose `<img>` failed to load (e.g. the protocol handler
 * 404'd because the workspace's backend was disconnected), so the next
 * render re-resolves instead of re-issuing a URL already known to fail.
 */
export function evictAttachmentImageUrl(workspaceId: string, attachmentId: string): void {
  urlCache.delete(`${workspaceId}/${attachmentId}`);
}

/** Resolve a mounted image and retry failed reads after a backend reconnect. */
export function observeAttachmentImageUrl(
  workspaceId: string,
  attachmentId: string,
  onUrl: (url: string | null) => void,
): { imageFailed: () => void; dispose: () => void } {
  let disposed = false;
  let resolving = false;
  let retryPending = false;
  let failed = false;

  async function resolve(): Promise<void> {
    if (disposed) return;
    if (resolving) {
      retryPending = true;
      return;
    }
    resolving = true;
    try {
      const url = await resolveAttachmentImageUrl(workspaceId, attachmentId);
      if (!disposed) {
        failed = url === null;
        onUrl(url);
      }
    } finally {
      resolving = false;
      if (retryPending) {
        retryPending = false;
        void resolve();
      }
    }
  }

  const unsubscribe = onBackendReconnected(() => {
    if (failed || resolving) void resolve();
  });
  void resolve();
  return {
    imageFailed() {
      if (disposed) return;
      failed = true;
      evictAttachmentImageUrl(workspaceId, attachmentId);
      onUrl(null);
    },
    dispose() {
      disposed = true;
      unsubscribe();
    },
  };
}

/**
 * Resolve an attachment-reference image block to a renderable URL. Returns
 * null (after a warn log) when the registry row is unknown or its file was
 * deleted out-of-band — the caller renders a broken-image placeholder.
 */
export function resolveAttachmentImageUrl(
  workspaceId: string,
  attachmentId: string,
): Promise<string | null> {
  const cacheKey = `${workspaceId}/${attachmentId}`;
  const cached = urlCache.get(cacheKey);
  if (cached) return Promise.resolve(cached);
  const pending = inflight.get(cacheKey);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const info = await getAttachmentInfo(attachmentId);
      if (!info.exists) {
        logger.warn('Attachment file missing on disk', { attachmentId });
        return null;
      }
      const url = workspaceFileUrl(workspaceId, info.path);
      urlCache.set(cacheKey, url);
      return url;
    } catch (error) {
      logger.warn('Failed to resolve attachment image', { attachmentId, error });
      return null;
    } finally {
      inflight.delete(cacheKey);
    }
  })();
  inflight.set(cacheKey, promise);
  return promise;
}
