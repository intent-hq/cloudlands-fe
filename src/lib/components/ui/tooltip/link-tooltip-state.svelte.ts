/**
 * Singleton link tooltip state.
 * Call `showLinkTooltip` / `hideLinkTooltip` from anywhere to control it.
 */
import { parseGitHubIssueOrPrUrl } from '$shared/utils/link-helpers';
import {
  createPreviewRequest,
  loadGitHubLinkPreview,
  type GitHubLinkPreview,
} from './github-link-preview';

/**
 * Hover-card preview for GitHub issue/PR links. `idle` for every other URL
 * (and after a failed load, which renders the URL-only fallback via `error`).
 */
export type LinkTooltipPreview =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: GitHubLinkPreview }
  | { status: 'error' };

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

/**
 * Start loading the GitHub hover card for `url`. A newer hover (or a hide)
 * retires the ticket so a late response never overwrites the current tooltip.
 */
function startPreview(url: string): void {
  const ticket = previewRequest.next();
  if (!parseGitHubIssueOrPrUrl(url)) {
    state.preview = { status: 'idle' };
    return;
  }
  state.preview = { status: 'loading' };
  loadGitHubLinkPreview(url).then(
    (data) => {
      if (!ticket.isCurrent) return;
      state.preview = data ? { status: 'ready', data } : { status: 'idle' };
    },
    () => {
      if (!ticket.isCurrent) return;
      state.preview = { status: 'error' };
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
export function showLinkTooltip(anchor: HTMLAnchorElement, url: string): void {
  // Clear any pending show
  if (showTimeout) clearTimeout(showTimeout);

  // Cancel any active "Copied!" flash so the new tooltip starts clean
  if (copiedTimeout) {
    clearTimeout(copiedTimeout);
    copiedTimeout = null;
  }
  state.copied = false;

  showTimeout = setTimeout(() => {
    const rect = anchor.getBoundingClientRect();
    state.visible = true;
    state.url = url;
    state.x = rect.left + rect.width / 2;
    state.y = rect.top;
    state.anchorBottom = rect.bottom;
    startPreview(url);
  }, 300);
}

/**
 * Hide the link tooltip immediately.
 * No-ops while a "Copied!" flash is active — the flash has its own auto-hide timer.
 */
export function hideLinkTooltip(): void {
  if (showTimeout) {
    clearTimeout(showTimeout);
    showTimeout = null;
  }
  if (state.copied) return;
  state.visible = false;
  previewRequest.invalidate();
  state.preview = { status: 'idle' };
}
