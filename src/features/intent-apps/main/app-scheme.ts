/**
 * The main-owned `intent-app://<appId>/` scheme (`docs/protocol/methods/apps.md`
 * → "Serving and isolation"). Each app's session partition gets its own handler
 * that serves only that app's files, pinned to the bundle hash of its session,
 * through `app.readBundle`. An app never loads from a remote URL, a `file://`
 * path or the Vite dev origin.
 *
 * No Electron imports: the handler takes a `Request` and returns a `Response`.
 */

export const INTENT_APP_SCHEME = 'intent-app';

/** The Content-Security-Policy of every scheme response (contract, verbatim). */
export const INTENT_APP_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'self'; base-uri 'none'; form-action 'none'";

export interface BundleFile {
  mimeType: string;
  contentBase64: string;
}

export interface AppSchemeTarget {
  appId: string;
  bundleHash: string;
  entry: string;
}

export type ReadBundle = (params: {
  appId: string;
  path: string;
  bundleHash: string;
}) => Promise<BundleFile>;

/** The app's start URL. */
export function intentAppEntryUrl(appId: string, entry: string): string {
  return `${INTENT_APP_SCHEME}://${appId}/${entry.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * The bundle path a request names, or null when it is not a file of this app:
 * another host, `..`, `\`, NUL, or an empty path (the root serves the entry).
 */
export function bundlePathForUrl(url: string, target: AppSchemeTarget): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${INTENT_APP_SCHEME}:` || parsed.hostname !== target.appId) return null;
  const raw = parsed.pathname.replace(/^\/+/, '');
  if (raw === '') return target.entry;
  const segments = raw.split('/');
  const decoded: string[] = [];
  for (const segment of segments) {
    let value: string;
    try {
      value = decodeURIComponent(segment);
    } catch {
      return null;
    }
    if (value === '' || value === '.' || value === '..') return null;
    if (value.includes('/') || value.includes('\\') || value.includes('\0')) return null;
    decoded.push(value);
  }
  const path = decoded.join('/');
  return Buffer.byteLength(path, 'utf8') > 512 ? null : path;
}

/** `text/*` types get `; charset=utf-8` (the daemon sends them without a charset). */
export function contentTypeFor(mimeType: string): string {
  return mimeType.startsWith('text/') && !mimeType.includes(';')
    ? `${mimeType}; charset=utf-8`
    : mimeType;
}

function securityHeaders(): Record<string, string> {
  return {
    'Content-Security-Policy': INTENT_APP_CSP,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  };
}

function plainResponse(status: number, text: string): Response {
  return new Response(text, {
    status,
    headers: { ...securityHeaders(), 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

/** Whether a daemon error is a "this file is not in the bundle" answer. */
function isNotFound(error: unknown): boolean {
  const data = (error as { data?: { code?: unknown } } | null)?.data;
  return data?.code === 'file-not-found';
}

/** Build the protocol handler for one app's partition. `target()` is read per request. */
export function createAppSchemeHandler(
  target: () => AppSchemeTarget | null,
  readBundle: ReadBundle,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const current = target();
    if (!current) return plainResponse(410, 'This app is closed');
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return plainResponse(405, 'Method not allowed');
    }
    const path = bundlePathForUrl(request.url, current);
    if (!path) return plainResponse(404, 'Not found');
    try {
      const file = await readBundle({
        appId: current.appId,
        path,
        bundleHash: current.bundleHash,
      });
      const body = Buffer.from(file.contentBase64, 'base64');
      return new Response(request.method === 'HEAD' ? null : body, {
        status: 200,
        headers: {
          ...securityHeaders(),
          'Content-Type': contentTypeFor(file.mimeType),
          'Content-Length': String(body.byteLength),
        },
      });
    } catch (error) {
      if (isNotFound(error)) return plainResponse(404, 'Not found');
      return plainResponse(502, 'The app file could not be read');
    }
  };
}
