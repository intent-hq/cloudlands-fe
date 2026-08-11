const INVALID_URL_DESCRIPTOR = '[invalid-url]';

/** Describe a backend URL without retaining credentials or request-specific data. */
export function describeBackendUrl(raw: string | undefined): string {
  if (!raw) return INVALID_URL_DESCRIPTOR;

  try {
    const url = new URL(raw);
    if (!url.host || (url.protocol !== 'ws:' && url.protocol !== 'wss:')) {
      return INVALID_URL_DESCRIPTOR;
    }
    return `${url.protocol}//${url.host}${url.pathname || '/'}`;
  } catch {
    return INVALID_URL_DESCRIPTOR;
  }
}
