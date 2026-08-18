import { BROWSER_PROTOCOLS } from '../../../shared/constants';

export function isValidBrowserUrl(
  targetUrl: string,
  appOrigin = typeof window !== 'undefined' ? window.location.origin : '',
): boolean {
  if (targetUrl === 'about:blank') return true;
  if (!targetUrl) return false;

  try {
    const parsedUrl = new URL(targetUrl);
    return (
      BROWSER_PROTOCOLS.NAVIGATION_ALLOWED.includes(parsedUrl.protocol) &&
      parsedUrl.origin !== appOrigin
    );
  } catch {
    return false;
  }
}
