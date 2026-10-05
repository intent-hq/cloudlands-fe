/**
 * Singleton link tooltip state.
 * Call `showLinkTooltip` / `hideLinkTooltip` from anywhere to control it.
 */
import { captureIntegrationContext } from '$features/integrations-request-context';
import { parseGitHubIssueOrPrUrl } from '$shared/utils/link-helpers';
import {
  classifyGitHubLinkPreviewError,
  createPreviewRequest,
  loadGitHubLinkPreview,
  observeGitLabLinkPreview,
  type GitLabPreviewUpdate,
  type GitHubLinkPreview,
  type GitHubLinkPreviewFailure,
} from './github-link-preview';

/**
 * Hover-card preview for GitHub issue/PR links. `idle` keeps every other URL
 * on the plain tooltip; failures retain the GitHub card and its reference.
 */
export type LinkTooltipPreview =
  | GitLabPreviewUpdate
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: GitHubLinkPreview }
  | { status: 'error'; reason: GitHubLinkPreviewFailure };

export interface LinkTooltipState {
  visible: boolean;
  url: string;
  /** Horizontal center of the hovered anchor (viewport px). */
  x: number;
  /** Top edge of the hovered anchor (viewport px); the tooltip sits above it. */
  y: number;
  /** Bottom edge of the hovered anchor; used when the card must flip below. */
  anchorBottom: number;
  copied: boolean;
  preview: LinkTooltipPreview;
}

export const state = $state<LinkTooltipState>({
  visible: false,
  url: '',
  x: 0,
  y: 0,
  anchorBottom: 0,
  copied: false,
  preview: { status: 'idle' },
});

let showTimeout: ReturnType<typeof setTimeout> | null = null;
let copiedTimeout: ReturnType<typeof setTimeout> | null = null;
const previewRequest = createPreviewRequest();
let closeResource: (() => void) | undefined;
let stopAnchor: (() => void) | undefined;

/**
 * Start loading the GitHub hover card for `url`. A newer hover (or a hide)
 * retires the ticket so a late response never overwrites the current tooltip.
 */
function startPreview(url: string, workspaceId?: string): void {
  const context = captureIntegrationContext(workspaceId);
  closeResource?.();
  closeResource = undefined;
  const ticket = previewRequest.next();
  if (!parseGitHubIssueOrPrUrl(url)) {
    state.preview = { status: 'idle' };
    closeResource = observeGitLabLinkPreview(url, workspaceId, (update) => {
      if (ticket.isCurrent) state.preview = update;
    });
    return;
  }
  state.preview = { status: 'loading' };
  loadGitHubLinkPreview(url, { workspaceId }).then(
    (data) => {
      if (!ticket.isCurrent || !context.isCurrent()) return;
      state.preview = data ? { status: 'ready', data } : { status: 'idle' };
    },
    (error: unknown) => {
      if (!ticket.isCurrent || !context.isCurrent()) return;
      state.preview = { status: 'error', reason: classifyGitHubLinkPreviewError(error) };
    },
  );
}

/**
 * Format a URL for display in the tooltip.
 * Strips protocol, truncates long paths to ~50 chars.
 */
export function formatUrlForDisplay(url: string): string {
  try {
    const parsed = new URL(url);
    const display = parsed.host + parsed.pathname;
    // Remove trailing slash
    const cleaned = display.endsWith('/') ? display.slice(0, -1) : display;
    if (cleaned.length <= 50) return cleaned;
    // Truncate: keep domain + first part of path + ellipsis
    const parts = cleaned.split('/');
    let result = parts[0]; // domain
    for (let i = 1; i < parts.length; i++) {
      const next = result + '/' + parts[i];
      if (next.length > 47) {
        return result + '/…';
      }
      result = next;
    }
    return result;
  } catch {
    // Not a valid URL, just truncate
    return url.length > 50 ? url.slice(0, 47) + '…' : url;
  }
}

/**
 * Show the link tooltip near the given anchor element after a delay.
 */
export function showLinkTooltip(
  anchor: HTMLAnchorElement,
  url: string,
  workspaceId?: string,
): void {
  // Clear any pending show
  if (showTimeout) clearTimeout(showTimeout);
  previewRequest.invalidate();
  closeResource?.();
  closeResource = undefined;
  stopAnchor?.();
  state.preview = { status: 'idle' };

  const surface = anchor.closest<HTMLElement>('[data-workspace-surface]');
  const originalWorkspace = workspaceId ?? surface?.dataset.workspaceSurface;
  const originalHref = anchor.href;
  const current = () =>
    anchor.isConnected &&
    anchor.href === originalHref &&
    (!surface ||
      (surface.contains(anchor) && surface.dataset.workspaceSurface === originalWorkspace));
  const observer = new MutationObserver(() => {
    if (!current()) hideLinkTooltip();
  });
  observer.observe(anchor.ownerDocument.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-workspace-surface', 'href'],
  });
  stopAnchor = () => observer.disconnect();

  // Cancel any active "Copied!" flash so the new tooltip starts clean
  if (copiedTimeout) {
    clearTimeout(copiedTimeout);
    copiedTimeout = null;
  }
  state.copied = false;

  showTimeout = setTimeout(() => {
    if (!current()) {
      hideLinkTooltip();
      return;
    }
    const rect = anchor.getBoundingClientRect();
    state.visible = true;
    state.url = url;
    state.x = rect.left + rect.width / 2;
    state.y = rect.top;
    state.anchorBottom = rect.bottom;
    startPreview(url, originalWorkspace);
  }, 300);
}

/**
 * Hide the link tooltip immediately.
 * No-ops while a "Copied!" flash is active — the flash has its own auto-hide timer.
 */
export function hideLinkTooltip(): void {
  stopAnchor?.();
  stopAnchor = undefined;
  closeResource?.();
  closeResource = undefined;
  if (showTimeout) {
    clearTimeout(showTimeout);
    showTimeout = null;
  }
  if (state.copied) {
    state.preview = { status: 'idle' };
    previewRequest.invalidate();
    return;
  }
  state.visible = false;
  previewRequest.invalidate();
  state.preview = { status: 'idle' };
}
