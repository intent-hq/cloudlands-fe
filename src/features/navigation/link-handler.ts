/**
 * Unified Link Handler
 *
 * Central system for handling all link clicks in the application.
 * Provides consistent behavior across terminal, editor, markdown viewer, etc.
 *
 * Default behavior:
 * - Path-like targets (schemeless raw href or self-origin URL) → Workspace file viewer
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
import {
  type LinkHandlerOptions,
  isAuthUrl,
  isCmdClickModifier,
  isGitHubUrl,
} from '$shared/utils/link-helpers';
import { openTerminalTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
import { openWorkspaceFile } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
import { store as appStore } from '$store/renderer/store';
import { invoke as invokeIpc } from '../../shared/generated/ipc-client';

const logger = new Logger('LinkHandler');

// ============================================================================
// Main handler
// ============================================================================

/**
 * Handle a link click with unified behavior.
 *
 * Routing rules (in priority order):
 * 1. Custom handler (if provided and returns true)
 * 2. `intent://` → internal navigation
 * 3. `devspace://` → internal resources (terminals)
 * 4. Path-like targets (schemeless raw href, or resolved URL on the app's own
 *    origin) → workspace file viewer
 * 5. Auth/OAuth URLs → external browser (always)
 * 6. GitHub URLs (`github.com`) → external browser (always)
 * 7. `http(s)://` + Cmd+Click or forceExternal → external browser
 * 8. `http(s)://` (plain click) → embedded browser panel
 * 9. `file://` → external editor
 * 10. Anything else → external browser (fallback)
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

    // Handle devspace:// links (internal resources like terminals)
    if (url.startsWith('devspace://')) {
      return await handleDevspaceLink(url, options.workspaceId);
    }

    // Route path-like targets (schemeless raw hrefs, or resolved URLs on the
    // app's own origin) to the workspace file viewer — never the browser panel
    const fileTarget = extractFilePathTarget(url, options.rawHref);
    if (fileTarget) {
      return await openFilePathLink(fileTarget.path, options, fileTarget.fromResolvedUrl);
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

      // Default: embedded browser panel (requires a workspace), otherwise external browser
      if (options.workspaceId) {
        return await openInBrowserPanel(url, options.workspaceId);
      }
      logger.debug('No workspaceId available, opening in external browser', { url });
      return await openInExternalBrowser(url);
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
 * Handle devspace:// links (internal resources)
 *
 * Currently supports:
 * - devspace://terminal/{id} → open terminal tab
 */
async function handleDevspaceLink(url: string, workspaceId?: WorkspaceId): Promise<boolean> {
  try {
    const terminalMatch = url.match(/^devspace:\/\/terminal\/(.+)$/);
    if (terminalMatch) {
      if (!workspaceId) {
        logger.warn('Cannot open terminal without workspaceId', { url });
        return false;
      }
      const terminalId = decodeURIComponent(terminalMatch[1]);
      logger.debug('Opening terminal from devspace link', { terminalId, workspaceId });
      appStore.dispatch(openTerminalTabRequested(workspaceId, { terminalId }));
      return true;
    }

    logger.warn('Unhandled devspace:// link type', { url });
    return false;
  } catch (error) {
    logger.error('Failed to handle devspace link', { url, error });
    return false;
  }
}

/** Matches an explicit URL scheme prefix (e.g. `https:`, `intent:`, `vscode:`). */
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/;

/**
 * Detect a path-like link target.
 *
 * - If the raw href is present and schemeless (no scheme prefix, not
 *   protocol-relative `//`, not an in-page fragment `#...`), it IS the path.
 * - Safety net: if the resolved http(s) URL sits on the app's own origin, the
 *   URL's pathname (+ hash) is treated as the path — self-origin URLs must
 *   never reach the embedded browser panel.
 *
 * Returns null when the target is not path-like.
 */
function extractFilePathTarget(
  url: string,
  rawHref?: string,
): { path: string; fromResolvedUrl: boolean } | null {
  if (rawHref) {
    // In-page fragment links keep their current behavior
    if (rawHref.startsWith('#')) return null;
    if (!rawHref.startsWith('//') && !SCHEME_PATTERN.test(rawHref)) {
      return { path: rawHref, fromResolvedUrl: false };
    }
  }

  if ((url.startsWith('http://') || url.startsWith('https://')) && typeof window !== 'undefined') {
    try {
      const parsed = new URL(url);
      if (parsed.origin === window.location.origin) {
        return { path: decodeURIComponent(parsed.pathname) + parsed.hash, fromResolvedUrl: true };
      }
    } catch {
      // Not a parseable URL — fall through to the regular handlers
    }
  }

  return null;
}

/**
 * Open a path-like link target in the workspace file viewer.
 *
 * - A trailing `#L<n>` fragment maps to the `line` option.
 * - Relative paths are dispatched as-is (worktree-relative).
 * - Absolute paths under the workspace's worktree root are relativized;
 *   absolute paths outside it fall back to the external editor. Leading-slash
 *   pathnames from self-origin resolved URLs are treated as worktree-relative.
 * - Cmd/Ctrl+Click opens the file in an adjacent panel.
 */
async function openFilePathLink(
  target: string,
  options: LinkHandlerOptions,
  fromResolvedUrl: boolean,
): Promise<boolean> {
  try {
    let path = target;
    let line: number | undefined;
    const lineMatch = path.match(/#L(\d+)$/);
    if (lineMatch) {
      line = Number.parseInt(lineMatch[1], 10);
      path = path.slice(0, -lineMatch[0].length);
    }

    const { workspaceId } = options;
    if (!workspaceId) {
      logger.warn('Cannot open file link without workspaceId', { path });
      return false;
    }

    if (path.startsWith('/')) {
      const { selectWorkspaceById } = await import(
        '$store/renderer/slices/workspace/workspace-selectors'
      );
      const workspace = selectWorkspaceById.select(appStore.state, workspaceId);
      const root = workspace?.worktreePath ?? workspace?.path;
      const normalizedRoot = root?.endsWith('/') ? root.slice(0, -1) : root;
      if (normalizedRoot && path.startsWith(`${normalizedRoot}/`)) {
        path = path.slice(normalizedRoot.length + 1);
      } else if (fromResolvedUrl) {
        // Self-origin pathname (e.g. `/src/main.rs`) — treat as worktree-relative
        path = path.replace(/^\/+/, '');
      } else {
        logger.debug('Absolute path outside workspace root, opening in external editor', { path });
        return await openInExternalEditor(`file://${path}`);
      }
    }

    const openInAdjacentPanel = isCmdClickModifier(options);
    appStore.dispatch(openWorkspaceFile(workspaceId, path, { line, openInAdjacentPanel }));
    logger.debug('Opened file link in workspace file viewer', { path, workspaceId, line });
    return true;
  } catch (error) {
    logger.error('Failed to open file link', { target, error });
    return false;
  }
}

/**
 * Open URL in browser panel
 */
async function openInBrowserPanel(url: string, workspaceId: WorkspaceId): Promise<boolean> {
  try {
    const { getPanelLayoutManager } = await import('$features/layout/panel-layout-adapter');
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
    // shell:openExternal converges on the shared openExternalUrl opener
    // (host-bridge-seeder), which handles preload-bridge/window.open fallback.
    await invokeIpc('shell:openExternal', { url });
    logger.debug('Opened URL in external browser', { url });
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
      await invokeIpc('shell:openExternal', { url: `vscode://file/${filePath}` });
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
  /** Workspace ID for panel layout manager lookup. When undefined, HTTP/HTTPS links fall back to the external browser. */
  workspaceId?: WorkspaceId;
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
        rawHref: anchor.getAttribute('href') ?? undefined,
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
      await handleLink(anchor.href, {
        ...options,
        event,
        rawHref: anchor.getAttribute('href') ?? undefined,
      });
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

    if (anchor?.href && !anchor.href.startsWith('intent://') && !anchor.href.startsWith('devspace://')) {
      if (anchor === currentAnchor) return; // Already tracking this anchor
      currentAnchor = anchor;

      ensureImported().then(() => {
        // Double-check we're still on the same anchor after async import
        if (currentAnchor === anchor && showFn) {
          showFn(anchor, anchor.href);
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
