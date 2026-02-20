/**
 * Singleton link tooltip state.
 * Call `showLinkTooltip` / `hideLinkTooltip` from anywhere to control it.
 */

export interface LinkTooltipState {
  visible: boolean;
  url: string;
  x: number;
  y: number;
  copied: boolean;
}

export let state = $state<LinkTooltipState>({
  visible: false,
  url: '',
  x: 0,
  y: 0,
  copied: false,
});

let showTimeout: ReturnType<typeof setTimeout> | null = null;
let copiedTimeout: ReturnType<typeof setTimeout> | null = null;

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
}

/**
 * Briefly show "Copied!" in the tooltip hint, then auto-hide.
 * Pass an anchor element to position and show the tooltip if it isn't already visible.
 */
export function flashCopied(anchor?: HTMLAnchorElement): void {
  if (anchor && !state.visible) {
    const rect = anchor.getBoundingClientRect();
    state.url = anchor.href;
    state.x = rect.left + rect.width / 2;
    state.y = rect.top;
    state.visible = true;
  }
  state.copied = true;
  if (copiedTimeout) clearTimeout(copiedTimeout);
  copiedTimeout = setTimeout(() => {
    state.copied = false;
    state.visible = false;
    copiedTimeout = null;
  }, 1200);
}
