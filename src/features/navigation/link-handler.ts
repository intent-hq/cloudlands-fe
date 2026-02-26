/**
 * Unified Link Handler
 *
 * Central system for handling all link clicks in the application.
 * Provides consistent behavior across terminal, editor, markdown viewer, etc.
 *
 * Default behavior:
 * - HTTP/HTTPS links → Open in embedded browser panel
 * - Cmd+Click (⌘ on Mac, Ctrl on Windows/Linux) → Open in external browser
 * - Auth/OAuth URLs → Always open in external browser
 * - GitHub URLs (github.com) → Always open in external browser
 * - Intent links (intent://) → Handle internally (navigate to notes/tasks)
 * - File links (file://) → Open in external editor
 * - Other links → External browser as fallback
 */

import { Logger } from '$shared/logger';
import type { WorkspaceId } from '$shared/types/branded-ids';

const logger = new Logger('LinkHandler');

// ============================================================================
// Types
// ============================================================================

/** Modifier key flags extracted from a MouseEvent */
export interface ModifierFlags {
  metaKey?: boolean;
  ctrlKey?: boolean;
}

export interface LinkHandlerOptions {
  /** Workspace ID for panel layout manager lookup */
  workspaceId: WorkspaceId;
  /** The original MouseEvent (used to detect Cmd+Click) */
  event?: MouseEvent;
  /** Extracted modifier flags — alternative to passing the full event */
  modifiers?: ModifierFlags;
  /** Force external browser even for HTTP/HTTPS links */
  forceExternal?: boolean;
  /** Custom handler for specific link types */
  customHandler?: (url: string) => Promise<boolean> | boolean;
}

// ============================================================================
// Auth URL detection
// ============================================================================

/** Path segments that indicate an OAuth / authentication flow */
const AUTH_PATH_PATTERNS = ['/oauth', '/authorize', '/login/oauth', '/auth/'];

/**
 * Detect whether a URL is an OAuth / authentication URL.
 * Auth URLs should always open in the external browser so the user has access
 * to their password manager, cookies, 2FA prompts, etc.
 */
export function isAuthUrl(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    const lower = pathname.toLowerCase();
    return AUTH_PATH_PATTERNS.some((pattern) => lower.includes(pattern));
  } catch {
    return false;
  }
}

// ============================================================================
// GitHub URL detection
// ============================================================================

/**
 * Detect whether a URL points to GitHub.
 * GitHub URLs should always open in the external browser because the embedded
 * browser panel cannot handle GitHub's authentication and interactive features.
 */
export function isGitHubUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === 'github.com' || hostname.endsWith('.github.com');
  } catch {
    return false;
  }
}

// ============================================================================
// Modifier-key helpers
// ============================================================================

/**
 * Detect whether the platform-appropriate "Cmd" modifier is held.
 * Mac → metaKey, Windows/Linux → ctrlKey.
 */
function isCmdClickModifier(options: LinkHandlerOptions): boolean {
  const flags: ModifierFlags = options.modifiers ?? options.event ?? {};
  const isMac =
    typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');
  return isMac ? !!flags.metaKey : !!flags.ctrlKey;
}

// ============================================================================
// Main handler
// ============================================================================

/**
 * Handle a link click with unified behavior.
 *
 * Routing rules (in priority order):
 * 1. Custom handler (if provided and returns true)
 * 2. `intent://` → internal navigation
 * 3. Auth/OAuth URLs → external browser (always)
 * 4. GitHub URLs (`github.com`) → external browser (always)
 * 5. `http(s)://` + Cmd+Click or forceExternal → external browser
 * 6. `http(s)://` (plain click) → embedded browser panel
 * 7. `file://` → external editor
 * 8. Anything else → external browser (fallback)
 *
 * @returns true if handled, false if not
 */
export async function handleLink(url: string, options: LinkHandlerOptions): Promise<boolean> {
  try {
    // Try custom handler first
    if (options.customHandler) {
      const handled = await options.customHandler(url);
      if (handled) {
        logger.debug('Link handled by custom handler', { url });
        return true;
      }
    }

    // Handle intent:// links (internal navigation to notes/tasks)
    if (url.startsWith('intent://')) {
      return await handleIntentLink(url);
    }

    // Handle HTTP/HTTPS links
    if (url.startsWith('http://') || url.startsWith('https://')) {
      // Auth URLs always go to external browser
      if (isAuthUrl(url)) {
        logger.debug('Auth URL detected, opening in external browser', { url });
        return await openInExternalBrowser(url);
      }

      // GitHub URLs always go to external browser
      if (isGitHubUrl(url)) {
        logger.debug('GitHub URL detected, opening in external browser', { url });
        return await openInExternalBrowser(url);
      }

      // Cmd+Click or explicit forceExternal → external browser
      if (options.forceExternal || isCmdClickModifier(options)) {
        return await openInExternalBrowser(url);
      }

      // Default: embedded browser panel
      return await openInBrowserPanel(url, options.workspaceId);
    }

    // Handle file:// links
    if (url.startsWith('file://')) {
      return await openInExternalEditor(url);
    }

    // Fallback: try external browser
    logger.warn('Unknown link type, falling back to external browser', { url });
    return await openInExternalBrowser(url);
  } catch (error) {
    logger.error('Failed to handle link', { url, error });
    return false;
  }
}

/**
 * Handle intent:// links (internal navigation)
 */
async function handleIntentLink(url: string): Promise<boolean> {
  try {
    const { handleIntentLink: handleIntent } = await import('$lib/utils/workspaces-link-handler');
    return await handleIntent(url);
  } catch (error) {
    logger.error('Failed to handle intent link', { url, error });
    return false;
  }
}

/**
 * Open URL in browser panel
 */
async function openInBrowserPanel(url: string, workspaceId: WorkspaceId): Promise<boolean> {
  try {
    const { getPanelLayoutManager } = await import('$features/layout/panel-layout-manager.svelte');
    const layoutManager = getPanelLayoutManager(workspaceId);
    layoutManager.openBrowserPanel(url);
    logger.debug('Opened URL in browser panel', { url, workspaceId });
    return true;
  } catch (error) {
    logger.warn('Failed to open URL in browser panel, falling back to external browser', {
      url,
      error,
    });
    return await openInExternalBrowser(url);
  }
}

/**
 * Open URL in external browser
 */
async function openInExternalBrowser(url: string): Promise<boolean> {
  try {
    if (typeof window !== 'undefined' && window.electronAPI) {
      await window.electronAPI.invoke('shell:openExternal', { url });
      logger.debug('Opened URL in external browser', { url });
      return true;
    }
    // Fallback for non-Electron environments
    window.open(url, '_blank');
    return true;
  } catch (error) {
    logger.error('Failed to open URL in external browser', { url, error });
    return false;
  }
}

/**
 * Open file in external editor
 */
async function openInExternalEditor(url: string): Promise<boolean> {
  try {
    // Convert file:// URL to path
    const filePath = url.replace('file://', '');

    if (typeof window !== 'undefined' && window.electronAPI) {
      await window.electronAPI.invoke('shell:openExternal', { url: `vscode://file/${filePath}` });
      logger.debug('Opened file in external editor', { filePath });
      return true;
    }
    return false;
  } catch (error) {
    logger.error('Failed to open file in external editor', { url, error });
    return false;
  }
}

// ============================================================================
// Event handler factories
// ============================================================================

export interface GlobalLinkClickHandlerOptions {
  /** Workspace ID for panel layout manager lookup */
  workspaceId: WorkspaceId;
  /** Custom handler for specific link types */
  customHandler?: (url: string) => Promise<boolean> | boolean;
}

/**
 * Create a global link handler that intercepts `<a>` clicks inside a
 * container element and routes them through the unified link handler.
 * Also sets up hover tooltip behavior on links (via `createLinkTooltipHandler`).
 *
 * Attaches click and mouseenter/mouseleave listeners to the container.
 * Returns a cleanup function that removes all listeners.
 *
 * @example
 * ```typescript
 * const cleanup = createGlobalLinkClickHandler(containerEl, { workspaceId });
 * // Later, to remove all listeners:
 * cleanup();
 * ```
 */
export function createGlobalLinkClickHandler(
  container: HTMLElement,
  options: GlobalLinkClickHandlerOptions,
): () => void {
  const clickHandler = async (event: MouseEvent) => {
    const target = event.target as HTMLElement;
    const anchor = target.closest('a');

    if (anchor?.href) {
      event.preventDefault();
      event.stopPropagation();
      await handleLink(anchor.href, {
        workspaceId: options.workspaceId,
        event,
        customHandler: options.customHandler,
      });
    }
  };

  container.addEventListener('click', clickHandler);

  // Also set up tooltip behavior on the same container
  const cleanupTooltip = createLinkTooltipHandler(container);

  return () => {
    container.removeEventListener('click', clickHandler);
    cleanupTooltip();
  };
}

/**
 * @deprecated Use `createGlobalLinkClickHandler` instead.
 * This alias is kept for backward compatibility.
 */
export function createLinkClickHandler(options: LinkHandlerOptions) {
  return async (event: MouseEvent) => {
    const target = event.target as HTMLElement;
    const anchor = target.closest('a');

    if (anchor?.href) {
      event.preventDefault();
      event.stopPropagation();
      await handleLink(anchor.href, { ...options, event });
    }
  };
}

// ============================================================================
// Link tooltip handler
// ============================================================================

/**
 * Create event handlers that show a tooltip when hovering over `<a>` tags
 * inside a container element.
 *
 * The tooltip shows the URL and a hint about Cmd+Click for external browser.
 * It works alongside `createGlobalLinkClickHandler` — attach both to the
 * same container for full link behavior.
 *
 * Returns a cleanup function that removes the event listeners.
 *
 * @example
 * ```typescript
 * const cleanup = createLinkTooltipHandler(containerEl);
 * // Later, to remove:
 * cleanup();
 * ```
 */
export function createLinkTooltipHandler(container: HTMLElement): () => void {
  let currentAnchor: HTMLAnchorElement | null = null;

  // Lazy-import the tooltip functions to avoid circular deps
  // and keep the module lightweight until first hover
  let showFn: ((anchor: HTMLAnchorElement, url: string) => void) | null = null;
  let hideFn: (() => void) | null = null;

  async function ensureImported() {
    if (!showFn || !hideFn) {
      const mod = await import('$lib/components/ui/tooltip/link-tooltip-state.svelte');
      showFn = mod.showLinkTooltip;
      hideFn = mod.hideLinkTooltip;
    }
  }

  function handleMouseOver(event: MouseEvent) {
    const target = event.target as HTMLElement;
    const anchor = target.closest('a');

    if (anchor?.href && !anchor.href.startsWith('intent://')) {
      if (anchor === currentAnchor) return; // Already tracking this anchor
      currentAnchor = anchor;

      ensureImported().then(() => {
        // Double-check we're still on the same anchor after async import
        if (currentAnchor === anchor) {
          showFn!(anchor, anchor.href);
        }
      });
    } else if (currentAnchor) {
      // Mouse moved to a non-link element
      currentAnchor = null;
      hideFn?.();
    }
  }

  function handleMouseOut(event: MouseEvent) {
    const target = event.target as HTMLElement;
    const anchor = target.closest('a');

    if (anchor && anchor === currentAnchor) {
      // Check if we're moving to a child of the same anchor (not actually leaving)
      const related = event.relatedTarget as HTMLElement | null;
      if (related && anchor.contains(related)) return;

      currentAnchor = null;
      hideFn?.();
    }
  }

  function handleClick() {
    // Hide tooltip on any click
    if (currentAnchor) {
      currentAnchor = null;
      hideFn?.();
    }
  }

  container.addEventListener('mouseover', handleMouseOver);
  container.addEventListener('mouseout', handleMouseOut);
  container.addEventListener('click', handleClick);

  return () => {
    container.removeEventListener('mouseover', handleMouseOver);
    container.removeEventListener('mouseout', handleMouseOut);
    container.removeEventListener('click', handleClick);
    hideFn?.();
  };
}
