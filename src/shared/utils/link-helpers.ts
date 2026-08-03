import type { WorkspaceId } from '$shared/types/branded-ids';

/** Modifier key flags extracted from a MouseEvent */
export interface ModifierFlags {
  metaKey?: boolean;
  ctrlKey?: boolean;
}

export interface LinkHandlerOptions {
  /** Workspace ID for panel layout manager lookup. When undefined, HTTP/HTTPS links fall back to the external browser. */
  workspaceId?: WorkspaceId;
  /** The raw (unresolved) `href` attribute of the clicked anchor, e.g. `src/main.rs`.
   *  Used to detect schemeless path-like targets that the DOM resolves against the app's own origin. */
  rawHref?: string;
  /** The original MouseEvent (used to detect Cmd+Click) */
  event?: MouseEvent;
  /** Extracted modifier flags — alternative to passing the full event */
  modifiers?: ModifierFlags;
  /** Force external browser even for HTTP/HTTPS links */
  forceExternal?: boolean;
  /** Custom handler for specific link types */
  customHandler?: (url: string) => Promise<boolean> | boolean;
}

/** Path segments that indicate an OAuth / authentication flow */
const AUTH_PATH_PATTERNS = ['/oauth', '/authorize', '/login/oauth', '/auth/'];

/** Detect whether a URL is an OAuth / authentication URL. */
export function isAuthUrl(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    const lower = pathname.toLowerCase();
    return AUTH_PATH_PATTERNS.some((pattern) => lower.includes(pattern));
  } catch {
    return false;
  }
}

/** Detect whether a URL points to GitHub. */
export function isGitHubUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === 'github.com' || hostname.endsWith('.github.com');
  } catch {
    return false;
  }
}

/** Detect whether the platform-appropriate "Cmd" modifier is held. */
export function isCmdClickModifier(
  options: Pick<LinkHandlerOptions, 'event' | 'modifiers'>,
  platform = typeof navigator !== 'undefined' ? navigator.platform : undefined,
): boolean {
  const flags: ModifierFlags = options.modifiers ?? options.event ?? {};
  const isMac = typeof platform === 'string' && platform.toUpperCase().includes('MAC');
  return isMac ? !!flags.metaKey : !!flags.ctrlKey;
}